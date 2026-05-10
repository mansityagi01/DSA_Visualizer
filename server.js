import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DebuggerCore } from './DebuggerCore.js';
import { AIClassifier } from './AIClassifier.js';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
let currentPort = null;
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100MB for large code files
});

app.use(express.json({ limit: '50mb' }));

// Basic CORS for browser fetch calls from Vite dev server (e.g. /health probing)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.static(join(__dirname, 'dist')));

app.get('/health', (req, res) => {
  res.json({ ok: true, port: currentPort });
});

// Global session storage for active debugging sessions
const activeSessions = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  
  // Initialize session-specific debugger and classifier
  const sessionDebugger = new DebuggerCore(socket.id);
  const sessionClassifier = new AIClassifier();
  activeSessions.set(socket.id, { debugger: sessionDebugger, classifier: sessionClassifier });

  // =====================================================================
  // EVENT: COMPILE AND CLASSIFY CODE
  // =====================================================================
  socket.on('compile:start', async (data) => {
    const { code, language } = data;
    
    try {
      socket.emit('status:update', { 
        stage: 'compiling', 
        message: '⚙️ Compiling C++ with debug symbols...' 
      });

      // Step 1: Compile the code
      const compilationResult = await sessionDebugger.compile(code);
      
      if (!compilationResult.success) {
        socket.emit('compilation:error', {
          error: compilationResult.error,
          stderr: compilationResult.stderr,
          timestamp: Date.now()
        });
        return;
      }

      socket.emit('status:update', { 
        stage: 'classifying', 
        message: '🤖 AI analyzing code structure...' 
      });

      // Step 2: Use Gemini to classify the algorithm/data structure
      const classification = await sessionClassifier.classify(code);
      
      socket.emit('classification:complete', {
        dataStructure: classification.dataStructure,
        algorithm: classification.algorithm,
        visualArchetype: classification.visualArchetype,
        complexity: classification.complexity,
        metadata: classification.metadata
      });

      socket.emit('compilation:success', {
        executablePath: compilationResult.executablePath,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`❌ Compilation/Classification error for ${socket.id}:`, error);
      socket.emit('compilation:error', {
        error: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
    }
  });

  // =====================================================================
  // EVENT: START GDB DEBUGGING SESSION
  // =====================================================================
  socket.on('debug:start', async (data) => {
    try {
      socket.emit('status:update', { 
        stage: 'debugging', 
        message: '🐛 Launching GDB debugger...' 
      });

      // Start GDB session and get line-by-line execution frames
      await sessionDebugger.startGDBSession({
        onFrame: (frame) => {
          // Stream each execution frame to the client in real-time
          socket.emit('debug:frame', frame);
        },
        onError: (error) => {
          socket.emit('debug:error', {
            type: error.type,
            message: error.message,
            line: error.line,
            severity: error.severity,
            timestamp: Date.now()
          });
        },
        onComplete: () => {
          socket.emit('debug:complete', {
            message: '✅ Execution completed successfully',
            timestamp: Date.now()
          });
        }
      });

    } catch (error) {
      console.error(`❌ Debug session error for ${socket.id}:`, error);
      socket.emit('debug:error', {
        type: 'RUNTIME_ERROR',
        message: error.message,
        severity: 'critical',
        timestamp: Date.now()
      });
    }
  });

  // =====================================================================
  // EVENT: STEP THROUGH CODE (MANUAL CONTROL)
  // =====================================================================
  socket.on('debug:step', async () => {
    try {
      const frame = await sessionDebugger.stepNext();
      socket.emit('debug:frame', frame);
    } catch (error) {
      socket.emit('debug:error', {
        type: 'STEP_ERROR',
        message: error.message,
        timestamp: Date.now()
      });
    }
  });

  // =====================================================================
  // EVENT: CONTINUE EXECUTION
  // =====================================================================
  socket.on('debug:continue', async () => {
    try {
      await sessionDebugger.continue();
    } catch (error) {
      socket.emit('debug:error', {
        type: 'CONTINUE_ERROR',
        message: error.message,
        timestamp: Date.now()
      });
    }
  });

  // =====================================================================
  // EVENT: SET BREAKPOINT
  // =====================================================================
  socket.on('debug:breakpoint', async (data) => {
    const { line, enabled } = data;
    try {
      if (enabled) {
        await sessionDebugger.setBreakpoint(line);
        socket.emit('breakpoint:set', { line, success: true });
      } else {
        await sessionDebugger.removeBreakpoint(line);
        socket.emit('breakpoint:removed', { line, success: true });
      }
    } catch (error) {
      socket.emit('breakpoint:error', {
        line,
        error: error.message,
        timestamp: Date.now()
      });
    }
  });

  // =====================================================================
  // EVENT: STOP/KILL DEBUG SESSION
  // =====================================================================
  socket.on('debug:stop', async () => {
    try {
      await sessionDebugger.kill();
      socket.emit('debug:stopped', {
        message: '🛑 Debug session terminated',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`❌ Error stopping debug session for ${socket.id}:`, error);
    }
  });

  // =====================================================================
  // EVENT: EVALUATE EXPRESSION (WATCH VARIABLES)
  // =====================================================================
  socket.on('debug:evaluate', async (data) => {
    const { expression } = data;
    try {
      const result = await sessionDebugger.evaluate(expression);
      socket.emit('debug:evaluation', {
        expression,
        result: result.value,
        type: result.type,
        timestamp: Date.now()
      });
    } catch (error) {
      socket.emit('debug:evaluation', {
        expression,
        error: error.message,
        timestamp: Date.now()
      });
    }
  });

  // =====================================================================
  // DISCONNECT CLEANUP
  // =====================================================================
  socket.on('disconnect', async () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    
    const session = activeSessions.get(socket.id);
    if (session) {
      try {
        await session.debugger.cleanup();
      } catch (error) {
        console.error(`Error cleaning up session ${socket.id}:`, error);
      }
      activeSessions.delete(socket.id);
    }
  });
});

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, cleaning up active sessions...');
  
  for (const [sessionId, session] of activeSessions.entries()) {
    try {
      await session.debugger.cleanup();
    } catch (error) {
      console.error(`Error cleaning up session ${sessionId}:`, error);
    }
  }
  
  httpServer.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3001;

async function tryListen(startPort = DEFAULT_PORT, maxAttempts = 10) {
  let port = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => {
          httpServer.removeAllListeners('error');
          resolve();
        });
      });

      // write backend port file so the Vite dev server (and client) can discover it
      try {
        await fs.promises.writeFile(join(__dirname, 'backend-port.json'), JSON.stringify({ port }), 'utf8');
      } catch (writeErr) {
        console.warn('⚠️ Failed to write backend-port.json:', writeErr.message);
      }

      console.log(`\nServer running on port ${port}`);
      console.log(`WebSocket ready for GDB sessions`);
      currentPort = port;
      return port;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${port} in use, trying port ${port + 1}...`);
        port += 1;
        // continue loop and try next port
      } else {
        console.error('Failed to start server:', err);
        throw err;
      }
    }
  }
  throw new Error('No available ports found for server after multiple attempts');
}

(async () => {
  try {
    const usedPort = await tryListen(DEFAULT_PORT, 50);
    console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
    console.log(`║  🚀 LIVE 3D DEBUGGER & ALGORITHM VISUALIZER                  ║`);
    console.log(`║  🌐 Server running on port ${usedPort}                            ║`);
    console.log(`║  🔧 WebSocket ready for GDB sessions                         ║`);
    console.log(`║  🤖 AI Classifier: Gemini API                                ║`);
    console.log(`║  🎮 Physics Engine: Rapier                                   ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════╝\n`);
  } catch (e) {
    console.error('Critical: could not start HTTP server', e);
    process.exit(1);
  }
})();