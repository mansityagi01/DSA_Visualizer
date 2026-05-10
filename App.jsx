import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import io from 'socket.io-client';
import { VisualizerEngine } from './VisualizerEngine';

const SAMPLE_CODE = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> arr = {5, 2, 8, 1, 9, 3};
    
    // Bubble Sort Visualization
    for (int i = 0; i < arr.size() - 1; i++) {
        for (int j = 0; j < arr.size() - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
    
    cout << "Sorted: ";
    for (int num : arr) {
        cout << num << " ";
    }
    
    return 0;
}`;

export default function App() {
  // ==================== STATE MANAGEMENT ====================
  const [code, setCode] = useState(SAMPLE_CODE);
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [compilationStatus, setCompilationStatus] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [allFrames, setAllFrames] = useState([]);
  const [classification, setClassification] = useState(null);
  const [errors, setErrors] = useState([]);
  const [logs, setLogs] = useState([]);
  const [breakpoints, setBreakpoints] = useState(new Set());
  const [currentLine, setCurrentLine] = useState(null);
  const [speed, setSpeed] = useState(1); // Playback speed multiplier
  const [isPaused, setIsPaused] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [showLogs, setShowLogs] = useState(true);
  const [editorTheme, setEditorTheme] = useState('vs-dark');
  
  const editorRef = useRef(null);
  const decorationsRef = useRef([]);
  const playbackIntervalRef = useRef(null);

  // ==================== SOCKET CONNECTION ====================
  useEffect(() => {
    (async () => {
      const protocol = window.location.protocol;
      const host = window.location.hostname;
      const candidatePorts = [];

      // 1) Try backend-port.json first
      try {
        const res = await fetch('/backend-port.json', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data?.port) candidatePorts.push(Number(data.port));
        }
      } catch (e) {
        // ignore, probe fallback ports below
      }

      // 2) Probe a small local range that server may pick when ports are busy
      for (let p = 3001; p <= 3010; p++) {
        if (!candidatePorts.includes(p)) candidatePorts.push(p);
      }

      let backendPort = 3001;
      for (const p of candidatePorts) {
        try {
          const health = await fetch(`${protocol}//${host}:${p}/health`, { cache: 'no-store' });
          if (health.ok) {
            backendPort = p;
            break;
          }
        } catch (_) {
          // try next
        }
      }

      const backendUrl = `${protocol}//${host}:${backendPort}`;

      const newSocket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        timeout: 20000
      });

      newSocket.on('connect', () => {
        setIsConnected(true);
        addLog('🟢 Connected to debugger server', 'success');
      });

      newSocket.on('connect_error', (err) => {
        addLog(`🔌 Connect error: ${err.message || err}`, 'error');
      });

      newSocket.on('reconnect_failed', () => {
        addLog('🔌 Reconnect failed, backend unreachable', 'error');
      });

      newSocket.on('disconnect', () => {
        setIsConnected(false);
        addLog('🔴 Disconnected from server', 'error');
      });

      // wire up remaining handlers below by reusing the newSocket variable

      setSocket(newSocket);
    })();
    // NOTE: remaining socket handlers that depend on `socket` are defined
    // below in other effects and callbacks which react to `socket` state.
    // Cleanup will be handled by the socket state watcher.
    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  // When `socket` becomes available, attach handlers that rely on it
  useEffect(() => {
    if (!socket) return;

    socket.on('status:update', (data) => {
      addLog(`📊 ${data.message}`, 'info');
    });

    socket.on('compilation:success', (data) => {
      setIsCompiling(false);
      setCompilationStatus({ success: true, ...data });
      addLog('✅ Compilation successful!', 'success');

      // Start debug immediately after confirmed successful compilation
      setIsDebugging(true);
      setAllFrames([]);
      setCurrentFrame(null);
      setFrameIndex(0);
      addLog('🐛 Starting debug session...', 'info');
      socket.emit('debug:start', {});
    });

    socket.on('compilation:error', (data) => {
      setIsCompiling(false);
      setCompilationStatus({ success: false, ...data });
      addLog(`❌ Compilation failed: ${data.error}`, 'error');
      setErrors(prev => [...prev, { type: 'COMPILATION', ...data }]);
    });

    socket.on('classification:complete', (data) => {
      setClassification(data);
      addLog(`🤖 AI detected: ${data.dataStructure} - ${data.algorithm}`, 'info');
    });

    socket.on('debug:frame', (frame) => {
      setCurrentFrame(frame);
      setAllFrames(prev => [...prev, frame]);
      setCurrentLine(frame.line);
      highlightLine(frame.line);
      addLog(`⏸️  Line ${frame.line}: ${Object.keys(frame.variables).length} vars`, 'debug');
    });

    socket.on('debug:error', (error) => {
      addLog(`💥 ${error.type}: ${error.message} at line ${error.line}`, 'error');
      setErrors(prev => [...prev, error]);
    });

    socket.on('debug:complete', (data) => {
      setIsDebugging(false);
      addLog('✅ Execution completed', 'success');
    });

    socket.on('breakpoint:set', (data) => {
      addLog(`🔴 Breakpoint set at line ${data.line}`, 'info');
    });

    socket.on('breakpoint:removed', (data) => {
      addLog(`⚪ Breakpoint removed from line ${data.line}`, 'info');
    });

    return () => {
      socket.removeAllListeners();
    };
  }, [socket]);

  // ==================== LOGGING SYSTEM ====================
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-99), { timestamp, message, type }]);
  }, []);

  // ==================== EDITOR SETUP ====================
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;

    // Configure editor options
    editor.updateOptions({
      minimap: { enabled: true },
      fontSize: 14,
      lineNumbers: 'on',
      glyphMargin: true,
      folding: true,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 3,
      renderLineHighlight: 'all',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 4
    });

    // Add breakpoint support via glyph margin clicks
    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position.lineNumber;
        toggleBreakpoint(line);
      }
    });
  };

  // ==================== BREAKPOINT MANAGEMENT ====================
  const toggleBreakpoint = (line) => {
    const newBreakpoints = new Set(breakpoints);
    
    if (newBreakpoints.has(line)) {
      newBreakpoints.delete(line);
      if (socket) {
        socket.emit('debug:breakpoint', { line, enabled: false });
      }
    } else {
      newBreakpoints.add(line);
      if (socket) {
        socket.emit('debug:breakpoint', { line, enabled: true });
      }
    }
    
    setBreakpoints(newBreakpoints);
    updateBreakpointDecorations(newBreakpoints);
  };

  const updateBreakpointDecorations = (bps) => {
    if (!editorRef.current) return;

    const decorations = Array.from(bps).map(line => ({
      range: new window.monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'breakpoint-glyph',
        glyphMarginHoverMessage: { value: '🔴 Breakpoint' }
      }
    }));

    decorationsRef.current = editorRef.current.deltaDecorations(
      decorationsRef.current,
      decorations
    );
  };

  // ==================== LINE HIGHLIGHTING ====================
  const highlightLine = (line) => {
    if (!editorRef.current || !line) return;

    const decorations = [{
      range: new window.monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'current-line-highlight',
        glyphMarginClassName: 'current-line-glyph'
      }
    }];

    decorationsRef.current = editorRef.current.deltaDecorations(
      decorationsRef.current,
      decorations
    );

    // Scroll to line
    editorRef.current.revealLineInCenter(line);
  };

  // ==================== COMPILATION & DEBUGGING ====================
  const handleCompileAndRun = () => {
    if (!socket || !isConnected) {
      addLog('❌ Not connected to server', 'error');
      return;
    }

    setIsCompiling(true);
    setCompilationStatus(null);
    setErrors([]);
    setAllFrames([]);
    setCurrentFrame(null);
    setCurrentLine(null);
    setFrameIndex(0);

    addLog('🚀 Starting compilation...', 'info');
    socket.emit('compile:start', { code, language: 'cpp' });
  };

  const handleStartDebugging = () => {
    if (!socket || !compilationStatus?.success) {
      addLog('❌ Compile first before debugging', 'error');
      return;
    }

    setIsDebugging(true);
    setAllFrames([]);
    setCurrentFrame(null);
    setFrameIndex(0);
    addLog('🐛 Starting debug session...', 'info');
    socket.emit('debug:start', {});
  };

  const handleStepNext = () => {
    if (!socket || !isDebugging) return;
    socket.emit('debug:step');
  };

  const handleContinue = () => {
    if (!socket || !isDebugging) return;
    socket.emit('debug:continue');
  };

  const handleStop = () => {
    if (!socket) return;
    socket.emit('debug:stop');
    setIsDebugging(false);
    setIsPaused(false);
    setIsPlaying(false);
    addLog('🛑 Debug session stopped', 'info');
  };

  // ==================== PLAYBACK CONTROLS ====================
  const handlePlayPause = () => {
    if (allFrames.length === 0) {
      addLog('❌ No frames to play', 'error');
      return;
    }

    if (isPlaying) {
      setIsPaused(!isPaused);
    } else {
      setIsPlaying(true);
      setIsPaused(false);
      startPlayback();
    }
  };

  const startPlayback = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
    }

    playbackIntervalRef.current = setInterval(() => {
      setFrameIndex(prev => {
        if (prev >= allFrames.length - 1) {
          stopPlayback();
          return prev;
        }
        
        const nextIndex = prev + 1;
        const frame = allFrames[nextIndex];
        setCurrentFrame(frame);
        setCurrentLine(frame.line);
        highlightLine(frame.line);
        
        return nextIndex;
      });
    }, 1000 / speed);
  };

  const stopPlayback = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
  };

  useEffect(() => {
    if (isPaused) {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    } else if (isPlaying) {
      startPlayback();
    }

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [isPaused, isPlaying, speed, allFrames]);

  const handleSpeedChange = (newSpeed) => {
    setSpeed(newSpeed);
    if (isPlaying && !isPaused) {
      stopPlayback();
      startPlayback();
    }
  };

  const handleSeek = (index) => {
    setFrameIndex(index);
    const frame = allFrames[index];
    if (frame) {
      setCurrentFrame(frame);
      setCurrentLine(frame.line);
      highlightLine(frame.line);
    }
  };

  // ==================== RENDER ====================
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100vh', width: '100vw', overflow: 'hidden' }} className="bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      
      {/* ==================== LEFT HALF: CODE EDITOR ==================== */}
      <div style={{ width: '50%', height: '100%', display: 'flex', flexDirection: 'column' }} className="border-r-2 border-purple-500/30 flex-col">
        
        {/* Header with Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', backgroundColor: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(168, 85, 247, 0.3)' }}>
          <div className="flex items-center gap-4">
            <div className="text-2xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              ⚡ LIVE 3D DEBUGGER
            </div>
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-xs text-gray-400">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <select 
            value={editorTheme} 
            onChange={(e) => setEditorTheme(e.target.value)}
            className="bg-purple-900/50 border border-purple-500/50 rounded px-3 py-1 text-sm"
          >
            <option value="vs-dark">Dark</option>
            <option value="vs-light">Light</option>
            <option value="hc-black">High Contrast</option>
          </select>
        </div>

        {/* Monaco Editor - Takes up remaining space */}
        <div style={{ flex: 1, width: '100%', height: '100%', minHeight: 0 }}>
          <Editor
            height="100%"
            defaultLanguage="cpp"
            theme={editorTheme}
            value={code}
            onChange={(value) => setCode(value || '')}
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true
            }}
          />
          <style>{`
            .breakpoint-glyph {
              background: #ff4444;
              width: 12px !important;
              height: 12px !important;
              border-radius: 50%;
              margin-left: 4px;
              margin-top: 4px;
            }
            .current-line-highlight {
              background: rgba(255, 215, 0, 0.15);
              border-left: 3px solid #ffd700;
            }
            .current-line-glyph {
              background: #ffd700;
              width: 0;
              height: 0;
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-top: 10px solid #ffd700;
              margin-left: 5px;
              margin-top: 5px;
            }
          `}</style>
        </div>

        {/* Bottom Control & Logs Panel */}
        <div style={{ backgroundColor: 'rgba(0,0,0,0.4)', borderTop: '1px solid rgba(168, 85, 247, 0.3)' }}>
          
          {/* Control Buttons */}
          <div className="px-4 py-3 border-b border-purple-500/20 flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCompileAndRun}
              disabled={isCompiling || isDebugging}
              className={`px-6 py-2 rounded-lg font-bold transition-all ${
                isCompiling || isDebugging
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-lg'
              }`}
            >
              {isCompiling ? '⚙️ Compiling...' : '🚀 Compile & Debug'}
            </button>

            {isDebugging && (
              <>
                <button onClick={handleStepNext} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-semibold">⏭️ Step</button>
                <button onClick={handleContinue} className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-semibold">▶️ Continue</button>
                <button onClick={handleStop} className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-semibold">⏹️ Stop</button>
              </>
            )}
          </div>

          {/* Compact Logs */}
          <div className="h-24 bg-black/60 overflow-y-auto p-2">
            <div className="space-y-1">
              {logs.slice(-6).map((log, i) => (
                <div key={i} className={`text-xs font-mono ${
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'success' ? 'text-green-400' :
                  log.type === 'debug' ? 'text-blue-400' :
                  'text-gray-400'
                }`}>
                  {log.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ==================== RIGHT HALF: 3D VISUALIZER ==================== */}
      <div style={{ width: '50%', height: '100%', display: 'flex', flexDirection: 'column' }} className="bg-black/20 flex-col">
        
        {/* Top Control Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(168, 85, 247, 0.3)' }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-purple-300">⚡ 3D VISUALIZER</span>
            {classification && (
              <>
                <span className="text-xs text-gray-400">|</span>
                <span className="text-xs font-semibold text-cyan-300">{classification.dataStructure}</span>
                <span className="text-xs text-pink-300">/ {classification.algorithm}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 text-xs bg-purple-900/50 hover:bg-purple-900 rounded border border-purple-500/30">↔️ Split</button>
            <button onClick={() => setShowLogs(!showLogs)} className="px-2 py-1 text-xs bg-purple-900/50 hover:bg-purple-900 rounded border border-purple-500/30">−</button>
          </div>
        </div>

        {/* 3D Canvas - Fills remaining space */}
        <div style={{ flex: 1, width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
          <VisualizerEngine
            currentFrame={currentFrame}
            allFrames={allFrames}
            classification={classification}
            errors={errors}
            isDebugging={isDebugging}
          />

          {/* Info Overlay */}
          {currentFrame && (
            <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-md rounded-lg p-3 max-w-xs border border-purple-500/30">
              <div className="text-xs font-bold text-purple-300 mb-2">
                Line {currentFrame.line}
              </div>
              <div className="space-y-0.5 text-xs font-mono">
                {Object.entries(currentFrame.variables).slice(0, 5).map(([name, data]) => (
                  <div key={name} className="text-gray-300">
                    <span className="text-purple-300">{name}:</span> <span className="text-green-400">{data.isArray ? `[...]` : String(data.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}