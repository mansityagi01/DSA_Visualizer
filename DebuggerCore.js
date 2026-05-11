import { spawn, spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { buildFallbackActionScript } from './codeActionScript.js';

export class DebuggerCore {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.sessionDir = join(tmpdir(), `debugger_${sessionId}_${Date.now()}`);
    this.sourceFile = null;
    this.executableFile = null;
    this.gdbProcess = null;
    this.gdbBuffer = '';
    this.gdbReady = false;
    this.currentLine = 0;
    this.emptyFrameCount = 0;
    this.syntheticFallbackTriggered = false;
    this.breakpoints = new Set();
    this.variableCache = new Map();
    this.frameHistory = [];
    this.executionPlan = null;
    this.isRunning = false;
    this.callbacks = {};
    this.sourceCode = '';
    this.stepDelayMs = 2000; // 2s per step as requested
    
    // GDB prompt marker for parsing
    this.GDB_PROMPT = '(gdb) ';
    this.commandQueue = [];
    this.isProcessingCommand = false;
    
    // Create session directory
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
    
    console.log(`🔧 DebuggerCore initialized for session: ${sessionId}`);
  }

  /**
   * Generate synthetic debug frames for bubble sort (fallback when GDB unavailable)
   */
  async generateSyntheticFrames() {
    return new Promise((resolve) => {
      console.log('📊 Generating synthetic debug frames for visualization...');
      const plan = this.executionPlan || buildFallbackActionScript(this.sourceCode);
      const delayBase = this.stepDelayMs;
      const frames = plan.steps || [];
      
      const emitFrame = (frame) => {
        if (this.callbacks.onFrame) {
          this.callbacks.onFrame({
            line: frame.line || 1,
            executionLine: frame.executionLine || frame.line || 1,
            eventType: frame.eventType,
            phase: frame.phase,
            description: frame.description,
            animationHint: frame.animationHint,
            action: frame.action,
            keywords: frame.keywords,
            stateDiff: frame.stateDiff,
            variables: this.stateToFrameVariables(frame.fullState || {}),
            timestamp: Date.now()
          });
        }
      };

      if (frames.length > 0) {
        const scheduleFrame = (frame, index) => {
          setTimeout(() => {
            emitFrame(frame);
          }, index * delayBase);
        };

        frames.forEach(scheduleFrame);

        setTimeout(() => {
          console.log('✅ Synthetic execution plan complete');
          resolve();
        }, delayBase * frames.length + 10);
        return;
      }

      console.log('✅ No execution plan generated; no synthetic frames emitted');
      resolve();
    });
  }

  stateToFrameVariables(state) {
    const variables = {};
    for (const [name, entry] of Object.entries(state || {})) {
      if (entry && entry.isArray) {
        variables[name] = {
          type: entry.type || 'array',
          value: Array.isArray(entry.value) ? [...entry.value] : [],
          isArray: true,
        };
        continue;
      }

      if (entry && entry.isOutput) {
        variables[name] = {
          type: 'output',
          value: entry.value,
          isOutput: true,
        };
        continue;
      }

      if (entry && typeof entry.value !== 'undefined') {
        variables[name] = {
          type: entry.type || typeof entry.value,
          value: entry.value,
        };
      }
    }

    return variables;
  }

  isSummationProgram() {
    const code = this.sourceCode || '';
    const hasSumUpdate = /sum\s*\+=\s*\w+\s*\[\s*\w+\s*\]/m.test(code);
    const hasForLoop = /for\s*\(/m.test(code);
    const hasArray = /int\s+\w+\s*\[\s*\]\s*=\s*\{[^}]*\}|vector\s*<\s*int\s*>\s*\w+\s*=\s*\{[^}]*\}/m.test(code);
    return hasSumUpdate && hasForLoop && hasArray;
  }

  /**
   * Extract an integer array from C++ source if present.
   * Supports patterns like: int arr[] = {1,2,3}; and vector<int> arr = {1,2,3};
   */
  extractArrayFromSource() {
    const code = this.sourceCode || '';
    const patterns = [
      /int\s+\w+\s*\[\s*\]\s*=\s*\{([^}]*)\}/m,
      /vector\s*<\s*int\s*>\s*\w+\s*=\s*\{([^}]*)\}/m
    ];

    for (const re of patterns) {
      const match = code.match(re);
      if (match && match[1]) {
        const values = match[1]
          .split(',')
          .map((v) => parseInt(v.trim(), 10))
          .filter((n) => Number.isFinite(n));
        if (values.length > 0) return values;
      }
    }

    // Safe fallback
    return [5, 2, 8, 1, 9, 3];
  }

  /**
   * Attempt to locate the gdb executable.
   * Returns full path to gdb if found, otherwise null.
   */
  findGDBExecutable() {
    // Respect explicit override
    if (process.env.GDB_PATH) {
      return process.env.GDB_PATH;
    }

    // Check common Windows MinGW install locations (user provided C:\MinGW\bin)
    if (process.platform === 'win32') {
      const candidatePaths = [
        'C:\\MinGW\\bin\\gdb.exe',
        'C:\\MinGW64\\bin\\gdb.exe',
        'C:\\msys64\\mingw64\\bin\\gdb.exe',
        'C:\\msys64\\mingw32\\bin\\gdb.exe'
      ];
      for (const p of candidatePaths) {
        try {
          if (existsSync(p)) return p;
        } catch (e) {}
      }
    }

    try {
      if (process.platform === 'win32') {
        // Use where on Windows
        const out = spawnSync('where', ['gdb'], { encoding: 'utf8' });
        if (out && out.status === 0 && out.stdout) {
          const first = out.stdout.split(/\r?\n/)[0].trim();
          if (first) return first;
        }
      } else {
        const out = spawnSync('which', ['gdb'], { encoding: 'utf8' });
        if (out && out.status === 0 && out.stdout) {
          const path = out.stdout.split(/\r?\n/)[0].trim();
          if (path) {
            console.log('🔍 Discovered gdb at', path);
            return path;
          }
        }
      }
    } catch (e) {
      // ignore
    }

    return null;
  }

  /**
   * Compile C++ code with debug symbols (-g flag)
   * @param {string} code - C++ source code
   * @returns {Promise<Object>} Compilation result
   */
  async compile(code) {
    return new Promise((resolve, reject) => {
      try {
        this.sourceCode = code;
        this.executionPlan = buildFallbackActionScript(code);
        // Generate unique filenames
        const uniqueId = randomBytes(8).toString('hex');
        this.sourceFile = join(this.sessionDir, `program_${uniqueId}.cpp`);
        this.executableFile = join(this.sessionDir, `program_${uniqueId}.out`);
        
        // Write source code to file
        writeFileSync(this.sourceFile, code, 'utf8');
        console.log(`📝 Source written to: ${this.sourceFile}`);
        
        // Compile with g++ including debug symbols and all warnings
        const compileArgs = [
          '-g',           // Debug symbols
          '-O0',          // No optimization (better debugging)
          '-std=c++17',   // C++17 standard
          '-Wall',        // All warnings
          '-Wextra',      // Extra warnings
          '-o', this.executableFile,
          this.sourceFile
        ];
        
        const compiler = spawn('g++', compileArgs);
        
        let stderr = '';
        let stdout = '';
        
        compiler.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        compiler.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        compiler.on('close', (code) => {
          if (code === 0) {
            console.log(`✅ Compilation successful: ${this.executableFile}`);
            resolve({
              success: true,
              executablePath: this.executableFile,
              warnings: stderr.trim()
            });
          } else {
            console.error(`❌ Compilation failed with code ${code}`);
            resolve({
              success: false,
              error: 'Compilation failed',
              stderr: stderr,
              stdout: stdout,
              exitCode: code
            });
          }
        });
        
        compiler.on('error', (error) => {
          reject({
            success: false,
            error: error.message,
            stack: error.stack
          });
        });
        
      } catch (error) {
        reject({
          success: false,
          error: error.message,
          stack: error.stack
        });
      }
    });
  }

  /**
   * Start GDB debugging session and stream frames line-by-line
   * @param {Object} options - Callbacks for frame streaming
   */
  async startGDBSession(options = {}) {
    const { onFrame, onError, onComplete } = options;
    this.callbacks = { onFrame, onError, onComplete };
    this.emptyFrameCount = 0;
    this.syntheticFallbackTriggered = false;

    // Vision-aligned behavior: when we already have an execution plan that
    // represents the step-by-step timeline, prefer emitting those steps as
    // frames to drive the 3D visualizer (works even without GDB).
    const shouldPreferSyntheticTimeline = Boolean(this.executionPlan?.shouldUseSyntheticTimeline)
      || (Array.isArray(this.executionPlan?.steps) && this.executionPlan.steps.length > 0);

    if (shouldPreferSyntheticTimeline) {
      try {
        await this.generateSyntheticFrames();
      } finally {
        if (this.callbacks.onComplete) this.callbacks.onComplete();
      }
      return;
    }
    
    return new Promise((resolve, reject) => {
      try {
        // allow a short delay for file system to flush
        setTimeout(() => {
          if (!this.executableFile || !existsSync(this.executableFile)) {
            console.warn('⚠️ Executable not found, aborting GDB start. Falling back.');
            // fallback: notify via callback and resolve
            if (this.callbacks.onError) {
              this.callbacks.onError({ type: 'NO_EXECUTABLE', message: 'Executable missing', severity: 'warning' });
            }
            this.generateSyntheticFrames().then(() => {
              if (this.callbacks.onComplete) this.callbacks.onComplete();
              resolve();
            }).catch(reject);
            return;
          }

          console.log(`🐛 Starting GDB session for: ${this.executableFile}`);

          // Try to discover gdb executable path
          const gdbPath = this.findGDBExecutable();
          if (!gdbPath) {
            console.warn('⚠️ GDB executable not found in PATH. Falling back to synthetic frames.');
            if (this.callbacks.onError) {
              this.callbacks.onError({ type: 'GDB_NOT_FOUND', message: 'gdb not found in PATH', severity: 'warning' });
            }
            // Fallback: generate synthetic frames
            this.generateSyntheticFrames().then(() => {
              if (this.callbacks.onComplete) this.callbacks.onComplete();
              resolve();
            }).catch(reject);
            return;
          }

          // Spawn GDB process
          this.gdbProcess = spawn(gdbPath, [
            '--interpreter=mi',  // Machine interface for better parsing
            '--quiet',           // Suppress GDB welcome message
            this.executableFile
          ]);
        
        this.isRunning = true;
        
        // Handle GDB output
        this.gdbProcess.stdout.on('data', (data) => {
          const s = data.toString();
          this.handleGDBOutput(s);
          // Once we see the gdb prompt, mark ready and send initial commands
          if (!this.gdbReady && (this.gdbBuffer.includes(this.GDB_PROMPT) || s.includes('(gdb)'))) {
            this.gdbReady = true;
            try {
              this.sendGDBCommand('break main');
              this.sendGDBCommand('run');
              // Start stepping after a short delay to allow 'run' to stop
              setTimeout(() => {
                this.stepThroughExecution();
              }, 200);
            } catch (e) {
              console.warn('Error sending initial GDB commands:', e && e.message);
            }
          }
        });
        
        this.gdbProcess.stderr.on('data', (data) => {
          console.error(`GDB stderr: ${data}`);
        });
        
        this.gdbProcess.on('close', (code) => {
          console.log(`GDB process exited with code ${code}`);
          this.isRunning = false;
          if (!this.syntheticFallbackTriggered && this.callbacks.onComplete) {
            this.callbacks.onComplete();
          }
        });
        
        this.gdbProcess.on('error', (error) => {
          console.error(`GDB process error:`, error);
          this.isRunning = false;
          if (this.callbacks.onError) {
            this.callbacks.onError({
              type: 'GDB_PROCESS_ERROR',
              message: error.message,
              severity: 'critical'
            });
          }
          reject(error);
        });
        
          // We'll resolve when stepThroughExecution starts or when gdb exits;
          // resolution is handled by the stepped commands or exit handlers.
          resolve();
        }, 100); // end setTimeout short delay
      } catch (error) {
        console.error('Error starting GDB session:', error);
        // fallback to synthetic frames
        this.generateSyntheticFrames().then(() => {
          if (this.callbacks.onComplete) this.callbacks.onComplete();
          resolve();
        }).catch(reject);
      }
    });
  }

  /**
   * Handle GDB output and parse it into structured data
   */
  handleGDBOutput(data) {
    this.gdbBuffer += data;
    
    // Check for segfaults and runtime errors
    if (this.gdbBuffer.includes('SIGSEGV') || this.gdbBuffer.includes('Segmentation fault')) {
      this.handleRuntimeError('SEGFAULT', 'Segmentation fault detected', this.currentLine);
    }
    
    if (this.gdbBuffer.includes('SIGABRT') || this.gdbBuffer.includes('Aborted')) {
      this.handleRuntimeError('ABORT', 'Program aborted', this.currentLine);
    }
    
    if (this.gdbBuffer.includes('SIGFPE')) {
      this.handleRuntimeError('DIVISION_BY_ZERO', 'Floating point exception (division by zero)', this.currentLine);
    }
    
    // Parse MI output for structured data
    const lines = this.gdbBuffer.split('\n');
    for (const line of lines) {
      if (line.includes('*stopped')) {
        this.parseStoppedEvent(line);
      }
    }
  }

  /**
   * Parse GDB stopped event to extract current state
   */
  parseStoppedEvent(line) {
    // Extract line number from MI output
    const lineMatch = line.match(/line="(\d+)"/);
    if (lineMatch) {
      this.currentLine = parseInt(lineMatch[1]);
    }
    
    // Extract function name
    const funcMatch = line.match(/func="([^"]+)"/);
    const functionName = funcMatch ? funcMatch[1] : 'unknown';
    
    // Extract reason for stopping
    const reasonMatch = line.match(/reason="([^"]+)"/);
    const stopReason = reasonMatch ? reasonMatch[1] : 'breakpoint-hit';
    
    console.log(`⏸️  Stopped at line ${this.currentLine} in ${functionName} (${stopReason})`);
  }

  /**
   * Step through execution line by line and extract state
   */
  async stepThroughExecution() {
    const maxIterations = 10000; // Safety limit
    let iteration = 0;
    
    const stepInterval = setInterval(async () => {
      if (!this.isRunning || iteration >= maxIterations) {
        clearInterval(stepInterval);
        if (this.callbacks.onComplete) {
          this.callbacks.onComplete();
        }
        return;
      }
      
      iteration++;
      
      try {
        // Get current state before stepping
        const frame = await this.extractCurrentFrame();

        const noVariables = !frame || !frame.variables || Object.keys(frame.variables).length === 0;
        const noLineInfo = !frame || !frame.line || frame.line === 0;

        if (noVariables && noLineInfo) {
          this.emptyFrameCount += 1;
        } else {
          this.emptyFrameCount = 0;
        }

        // If GDB repeatedly returns empty frames, switch to synthetic frames for visible visualization
        if (this.emptyFrameCount >= 5 && !this.syntheticFallbackTriggered) {
          this.syntheticFallbackTriggered = true;
          clearInterval(stepInterval);
          this.isRunning = false;
          console.warn('⚠️ GDB returned empty frames repeatedly. Switching to synthetic visualization frames.');
          try {
            if (this.gdbProcess) {
              this.gdbProcess.kill('SIGTERM');
            }
          } catch (_) {}

          await this.generateSyntheticFrames();
          if (this.callbacks.onComplete) {
            this.callbacks.onComplete();
          }
          return;
        }
        
        if (frame && this.callbacks.onFrame) {
          this.callbacks.onFrame(frame);
          this.frameHistory.push(frame);
        }
        
        // Step to next line
        this.sendGDBCommand('next');
        
      } catch (error) {
        console.error('Error during step execution:', error);
        clearInterval(stepInterval);
      }
      
    }, this.stepDelayMs); // 0.5s between steps
  }

  /**
   * Extract current execution frame with all variable states
   */
  async extractCurrentFrame() {
    return new Promise((resolve) => {
      const frame = {
        line: this.currentLine,
        timestamp: Date.now(),
        variables: {},
        stack: [],
        heap: {},
        pointers: {}
      };
      
      // Get local variables
      this.sendGDBCommand('info locals', (output) => {
        frame.variables = this.parseVariables(output);
        
        // Get stack backtrace
        this.sendGDBCommand('backtrace', (btOutput) => {
          frame.stack = this.parseBacktrace(btOutput);
          
          // Resolve heap allocations and pointers
          this.resolvePointers(frame);
          
          resolve(frame);
        });
      });
    });
  }

  /**
   * Parse variable output from GDB
   */
  parseVariables(output) {
    const variables = {};
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // Parse: variableName = value
      const match = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const [, name, rawValue] = match;
        variables[name] = this.parseValue(name, rawValue.trim());
      }
    }
    
    return variables;
  }

  /**
   * Parse individual variable value and detect type
   */
  parseValue(name, rawValue) {
    const value = {
      name,
      rawValue,
      type: 'unknown',
      value: null,
      isPointer: false,
      isArray: false,
      address: null,
      size: 0
    };
    
    // Detect pointers
    if (rawValue.startsWith('0x') && rawValue.length > 10) {
      value.isPointer = true;
      value.address = rawValue;
      value.type = 'pointer';
      
      // Try to dereference pointer
      const derefMatch = rawValue.match(/0x[0-9a-fA-F]+\s*"(.+)"/);
      if (derefMatch) {
        value.value = derefMatch[1];
        value.type = 'char*';
      }
    }
    // Detect arrays
    else if (rawValue.includes('{') && rawValue.includes('}')) {
      value.isArray = true;
      value.type = 'array';
      const elements = rawValue.match(/\{([^}]+)\}/);
      if (elements) {
        value.value = elements[1].split(',').map(v => v.trim()).filter(Boolean);
        value.size = value.value.length;
      }
    }
    // Detect integers
    else if (/^-?\d+$/.test(rawValue)) {
      value.type = 'int';
      value.value = parseInt(rawValue);
    }
    // Detect floats
    else if (/^-?\d+\.\d+$/.test(rawValue)) {
      value.type = 'float';
      value.value = parseFloat(rawValue);
    }
    // Detect strings
    else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      value.type = 'string';
      value.value = rawValue.slice(1, -1);
    }
    // Detect booleans
    else if (rawValue === 'true' || rawValue === 'false') {
      value.type = 'bool';
      value.value = rawValue === 'true';
    }
    // Detect NULL
    else if (rawValue === '0x0' || rawValue === 'NULL') {
      value.type = 'null';
      value.value = null;
      value.isPointer = true;
    }
    // Detect structs/objects
    else if (rawValue.includes('{') && rawValue.includes('=')) {
      value.type = 'struct';
      value.value = rawValue;
    }
    // Default: string representation
    else {
      value.value = rawValue;
    }
    
    return value;
  }

  /**
   * Parse stack backtrace
   */
  parseBacktrace(output) {
    const stack = [];
    const lines = output.split('\n').filter(line => line.trim().startsWith('#'));
    
    for (const line of lines) {
      const match = line.match(/#(\d+)\s+(?:0x[0-9a-fA-F]+\s+in\s+)?(\w+)\s*\(([^)]*)\)\s*at\s*([^:]+):(\d+)/);
      if (match) {
        const [, depth, func, args, file, line] = match;
        stack.push({
          depth: parseInt(depth),
          function: func,
          arguments: args.trim(),
          file: file.trim(),
          line: parseInt(line)
        });
      }
    }
    
    return stack;
  }

  /**
   * Resolve pointer relationships and heap allocations
   */
  resolvePointers(frame) {
    for (const [varName, varData] of Object.entries(frame.variables)) {
      if (varData.isPointer && varData.address && varData.address !== '0x0') {
        // Try to get what the pointer points to
        this.sendGDBCommand(`x/1xw ${varData.address}`, (output) => {
          const match = output.match(/0x[0-9a-fA-F]+:\s+0x([0-9a-fA-F]+)/);
          if (match) {
            frame.pointers[varName] = {
              from: varName,
              to: varData.address,
              value: match[1]
            };
          }
        });
        
        // For linked list nodes, try to get next pointer
        if (varName.toLowerCase().includes('node') || varName.toLowerCase().includes('next')) {
          this.sendGDBCommand(`print ${varName}->next`, (output) => {
            const nextMatch = output.match(/0x[0-9a-fA-F]+/);
            if (nextMatch) {
              frame.pointers[`${varName}->next`] = {
                from: varName,
                to: nextMatch[0],
                label: 'next'
              };
            }
          });
        }
      }
    }
  }

  /**
   * Send command to GDB and optionally get response
   */
  sendGDBCommand(command, callback = null) {
    if (!this.gdbProcess || !this.isRunning) {
      console.warn('GDB process not running');
      return;
    }
    
    this.commandQueue.push({ command, callback });
    this.processCommandQueue();
  }

  /**
   * Process command queue sequentially
   */
  processCommandQueue() {
    if (this.isProcessingCommand || this.commandQueue.length === 0) {
      return;
    }
    
    this.isProcessingCommand = true;
    const { command, callback } = this.commandQueue.shift();
    
    this.gdbBuffer = '';
    this.gdbProcess.stdin.write(command + '\n');
    
    // Wait for GDB prompt to know command completed
    const checkInterval = setInterval(() => {
      if (this.gdbBuffer.includes(this.GDB_PROMPT) || this.gdbBuffer.includes('(gdb)')) {
        clearInterval(checkInterval);
        
        if (callback) {
          callback(this.gdbBuffer);
        }
        
        this.isProcessingCommand = false;
        this.processCommandQueue();
      }
    }, 50);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      this.isProcessingCommand = false;
      this.processCommandQueue();
    }, 5000);
  }

  /**
   * Handle runtime errors detected by GDB
   */
  handleRuntimeError(type, message, line) {
    console.error(`💥 Runtime Error: ${type} at line ${line}`);
    
    const error = {
      type,
      message,
      line,
      severity: 'critical',
      timestamp: Date.now(),
      stackTrace: this.frameHistory.slice(-5) // Last 5 frames
    };
    
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
    
    // Stop execution on critical errors
    this.isRunning = false;
  }

  /**
   * Step to next line (manual control)
   */
  async stepNext() {
    return new Promise((resolve) => {
      this.sendGDBCommand('next', async () => {
        const frame = await this.extractCurrentFrame();
        resolve(frame);
      });
    });
  }

  /**
   * Continue execution until next breakpoint
   */
  async continue() {
    return new Promise((resolve) => {
      this.sendGDBCommand('continue', () => {
        resolve();
      });
    });
  }

  /**
   * Set breakpoint at line
   */
  async setBreakpoint(line) {
    return new Promise((resolve) => {
      this.sendGDBCommand(`break ${line}`, (output) => {
        this.breakpoints.add(line);
        console.log(`🔴 Breakpoint set at line ${line}`);
        resolve({ success: true, line });
      });
    });
  }

  /**
   * Remove breakpoint at line
   */
  async removeBreakpoint(line) {
    return new Promise((resolve) => {
      // First, find the breakpoint number
      this.sendGDBCommand('info breakpoints', (output) => {
        const match = output.match(new RegExp(`(\\d+)\\s+breakpoint.*:${line}`));
        if (match) {
          const bpNum = match[1];
          this.sendGDBCommand(`delete ${bpNum}`, () => {
            this.breakpoints.delete(line);
            console.log(`⚪ Breakpoint removed from line ${line}`);
            resolve({ success: true, line });
          });
        } else {
          resolve({ success: false, line });
        }
      });
    });
  }

  /**
   * Evaluate expression in current context
   */
  async evaluate(expression) {
    return new Promise((resolve) => {
      this.sendGDBCommand(`print ${expression}`, (output) => {
        const match = output.match(/\$\d+\s*=\s*(.+)/);
        if (match) {
          const value = this.parseValue(expression, match[1].trim());
          resolve(value);
        } else {
          resolve({ error: 'Could not evaluate expression', expression });
        }
      });
    });
  }

  /**
   * Kill GDB process
   */
  async kill() {
    if (this.gdbProcess) {
      this.sendGDBCommand('quit');
      setTimeout(() => {
        if (this.gdbProcess) {
          this.gdbProcess.kill('SIGTERM');
        }
      }, 1000);
    }
    this.isRunning = false;
  }

  /**
   * Cleanup session resources
   */
  async cleanup() {
    console.log(`🧹 Cleaning up session: ${this.sessionId}`);
    
    await this.kill();
    
    // Delete temporary files
    try {
      if (this.sourceFile && existsSync(this.sourceFile)) {
        unlinkSync(this.sourceFile);
      }
      if (this.executableFile && existsSync(this.executableFile)) {
        unlinkSync(this.executableFile);
      }
    } catch (error) {
      console.error('Error cleaning up files:', error);
    }
    
    this.variableCache.clear();
    this.frameHistory = [];
  }
}