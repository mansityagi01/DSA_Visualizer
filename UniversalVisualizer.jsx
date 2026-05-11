import React, { useMemo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const COLORS = {
  bg: '#0b1020',
  panel: 'rgba(12, 18, 38, 0.78)',
  panel2: 'rgba(16, 24, 48, 0.92)',
  border: 'rgba(125, 170, 255, 0.14)',
  text: '#e5eefc',
  muted: '#9cb0d0',
  accent: '#8b5cf6',
  accent2: '#22d3ee',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
  glow: 'rgba(139, 92, 246, 0.35)',
};

const ACTION_STYLES = {
  start: { label: 'Start', tone: COLORS.success },
  finish: { label: 'Finish', tone: COLORS.success },
  step: { label: 'Step', tone: COLORS.accent2 },
  spawn: { label: 'Create', tone: COLORS.accent },
  assign: { label: 'Assign', tone: COLORS.accent2 },
  morph: { label: 'Update', tone: COLORS.warning },
  increment: { label: 'Increment', tone: COLORS.warning },
  'loop-enter': { label: 'Loop', tone: COLORS.accent },
  iterate: { label: 'Iterate', tone: COLORS.accent2 },
  'loop-exit': { label: 'Loop End', tone: COLORS.success },
  branch: { label: 'Branch', tone: COLORS.warning },
  swap: { label: 'Swap', tone: COLORS.danger },
  'spawn-array': { label: 'Array', tone: COLORS.accent },
  push: { label: 'Push', tone: COLORS.success },
  pop: { label: 'Pop', tone: COLORS.danger },
  print: { label: 'Print', tone: COLORS.success },
  call: { label: 'Call', tone: COLORS.accent2 },
  return: { label: 'Return', tone: COLORS.warning },
  mutate: { label: 'Mutate', tone: COLORS.warning },
  'line-glow': { label: 'Line', tone: COLORS.accent2 },
  compare: { label: 'Compare', tone: COLORS.warning },
  default: { label: 'Action', tone: COLORS.accent2 },
};

function asArrayItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (item && typeof item === 'object' && 'id' in item) {
      return {
        id: item.id,
        index: typeof item.index === 'number' ? item.index : index,
        value: 'value' in item ? item.value : item,
      };
    }
    return {
      id: `${index}-${String(item)}`,
      index,
      value: item,
    };
  });
}

function normalizeStateVariables(variables = {}) {
  const result = {};
  for (const [name, data] of Object.entries(variables)) {
    if (!data) continue;
    if (data.isArray && Array.isArray(data.value)) {
      result[name] = {
        type: data.type || 'array',
        isArray: true,
        value: asArrayItems(data.value),
      };
      continue;
    }
    result[name] = {
      type: data.type || typeof data.value,
      value: data.value,
      isOutput: Boolean(data.isOutput),
    };
  }
  return result;
}

function getActionKey(frame) {
  return frame?.action?.keyword || frame?.eventType?.toLowerCase?.() || 'step';
}

function getActionMeta(frame) {
  const key = getActionKey(frame);
  return ACTION_STYLES[key] || ACTION_STYLES.default;
}

function HighlightPill({ frame }) {
  const meta = getActionMeta(frame);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 999,
        background: `linear-gradient(135deg, ${meta.tone}22, ${meta.tone}10)`,
        border: `1px solid ${meta.tone}40`,
        color: meta.tone,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.3,
        boxShadow: `0 0 0 1px ${meta.tone}12, 0 10px 35px ${meta.tone}18`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.tone, boxShadow: `0 0 12px ${meta.tone}` }} />
      {meta.label}
      <span style={{ color: COLORS.text, fontWeight: 500, opacity: 0.7 }}>{frame?.eventType || 'STEP'}</span>
    </motion.div>
  );
}

function CodeLineRail({ currentFrame, allFrames }) {
  const currentLine = currentFrame?.executionLine || currentFrame?.line || 1;
  const recent = (allFrames || []).slice(-7).reverse();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 16,
      borderRadius: 20,
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
      minHeight: 180,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 800 }}>Execution Rail</div>
        <div style={{ color: COLORS.muted, fontSize: 11 }}>Line {currentLine}</div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {recent.map((frame, index) => {
          const active = (frame.executionLine || frame.line) === currentLine;
          const meta = getActionMeta(frame);
          return (
            <motion.div
              key={`${frame.stepId || index}-${frame.line}`}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 14,
                background: active ? `${meta.tone}16` : COLORS.panel2,
                border: `1px solid ${active ? `${meta.tone}55` : COLORS.border}`,
                color: active ? COLORS.text : COLORS.muted,
                fontSize: 12,
              }}
            >
              <span style={{ width: 26, color: active ? meta.tone : COLORS.muted, fontWeight: 800 }}>{frame.executionLine || frame.line}</span>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.tone, boxShadow: `0 0 10px ${meta.tone}` }} />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{frame.description || frame.eventType}</span>
              <span style={{ color: meta.tone, fontWeight: 700 }}>{meta.label}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function VariablePanel({ variables, currentFrame }) {
  const entries = Object.entries(variables || {}).filter(([, value]) => !value?.isArray && typeof value?.value !== 'undefined');
  const highlightKey = getActionKey(currentFrame);

  return (
    <div style={{
      display: 'grid',
      gap: 10,
      padding: 16,
      borderRadius: 20,
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 800 }}>Variables</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {entries.length > 0 ? entries.map(([name, data]) => {
          const active = highlightKey === 'assign' || highlightKey === 'morph' || highlightKey === 'increment';
          return (
            <motion.div
              key={name}
              layout
              animate={{ scale: active ? 1.02 : 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 20 }}
              style={{
                padding: '10px 12px',
                borderRadius: 16,
                background: COLORS.panel2,
                border: `1px solid ${active ? `${COLORS.accent2}55` : COLORS.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: COLORS.text,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: COLORS.muted }}>{name}</div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{String(data.value)}</div>
              </div>
              <div style={{ fontSize: 11, color: COLORS.accent2 }}>{data.type}</div>
            </motion.div>
          );
        }) : (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No scalar variables detected yet.</div>
        )}
      </div>
    </div>
  );
}

function ArrayStrip({ variables, currentFrame }) {
  const arrays = Object.entries(normalizeStateVariables(variables)).filter(([, data]) => data.isArray);
  const swapIndices = currentFrame?.action?.payload?.swapIndices || currentFrame?.stateDiff?.[Object.keys(currentFrame?.stateDiff || {})[0]]?.swap || null;

  return (
    <div style={{
      display: 'grid',
      gap: 14,
      padding: 16,
      borderRadius: 20,
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 800 }}>Collections</div>
        <div style={{ color: COLORS.muted, fontSize: 11 }}>{arrays.length} tracked</div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {arrays.length > 0 ? arrays.map(([name, data]) => {
          const items = data.value || [];
          return (
            <div key={name} style={{ display: 'grid', gap: 10 }}>
              <div style={{ color: COLORS.accent2, fontSize: 12, fontWeight: 700 }}>{name} [ {items.length} ]</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <AnimatePresence initial={false}>
                  {items.map((item, index) => {
                    const isSwapItem = Array.isArray(swapIndices) && swapIndices.includes(index);
                    return (
                      <motion.div
                        key={item.id || `${name}-${index}-${item.value}`}
                        layout
                        initial={{ opacity: 0, scale: 0.86, y: 18 }}
                        animate={{
                          opacity: 1,
                          scale: isSwapItem ? 1.12 : 1,
                          y: isSwapItem ? -16 : 0,
                        }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                        style={{
                          minWidth: 74,
                          padding: '12px 14px',
                          borderRadius: 18,
                          background: isSwapItem ? `linear-gradient(180deg, ${COLORS.danger}22, ${COLORS.panel2})` : COLORS.panel2,
                          border: `1px solid ${isSwapItem ? `${COLORS.danger}60` : COLORS.border}`,
                          boxShadow: isSwapItem ? `0 12px 40px ${COLORS.danger}20` : 'none',
                          display: 'grid',
                          placeItems: 'center',
                          gap: 8,
                          color: COLORS.text,
                        }}
                      >
                        <div style={{ fontSize: 11, color: COLORS.muted }}>idx {index}</div>
                        <div style={{ fontSize: 19, fontWeight: 900 }}>{String(item.value)}</div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          );
        }) : (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No arrays detected yet.</div>
        )}
      </div>
    </div>
  );
}

function ConsolePanel({ currentFrame }) {
  const [lines, setLines] = useState([]);
  const lineRef = useRef(null);

  useEffect(() => {
    if (!currentFrame) return;
    const text = currentFrame.action?.keyword === 'print'
      ? `OUTPUT: ${JSON.stringify(currentFrame.action?.payload?.value ?? currentFrame.stateDiff?.console?.to ?? '')}`
      : currentFrame.description || currentFrame.eventType;
    setLines((previous) => [...previous.slice(-9), text]);
  }, [currentFrame]);

  useEffect(() => {
    if (lineRef.current) {
      lineRef.current.scrollTop = lineRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div style={{
      display: 'grid',
      gap: 10,
      padding: 16,
      borderRadius: 20,
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
      minHeight: 180,
    }}>
      <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 800 }}>Console</div>
      <div ref={lineRef} style={{
        minHeight: 120,
        maxHeight: 180,
        overflow: 'auto',
        display: 'grid',
        gap: 8,
        paddingRight: 6,
      }}>
        {lines.length > 0 ? lines.map((line, index) => (
          <motion.div
            key={`${line}-${index}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              padding: '10px 12px',
              borderRadius: 14,
              background: COLORS.panel2,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.text,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {line}
          </motion.div>
        )) : (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No output yet.</div>
        )}
      </div>
    </div>
  );
}

function ActionHeader({ classification, currentFrame, executionPlan, isDebugging, errors }) {
  const meta = getActionMeta(currentFrame);
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '12px 16px',
      borderBottom: `1px solid ${COLORS.border}`,
      background: 'rgba(8, 12, 24, 0.72)',
      backdropFilter: 'blur(18px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: COLORS.text }}>Execution Canvas</div>
        {classification && (
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12, color: COLORS.muted }}>
            <span style={{ color: COLORS.accent2, fontWeight: 700 }}>{classification.dataStructure}</span>
            <span>/</span>
            <span style={{ color: COLORS.accent, fontWeight: 700 }}>{classification.algorithm}</span>
          </div>
        )}
        {currentFrame && <HighlightPill frame={currentFrame} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {executionPlan && (
          <div style={{ fontSize: 11, color: COLORS.muted }}>
            {executionPlan.stepCount} steps · {Math.round((executionPlan.confidence || 0) * 100)}% confidence · {executionPlan.mode}
          </div>
        )}
        {isDebugging && <span style={{ color: COLORS.success, fontSize: 12, fontWeight: 800 }}>LIVE</span>}
        {errors?.length > 0 && <span style={{ color: COLORS.danger, fontSize: 12, fontWeight: 800 }}>ERROR</span>}
        <span style={{ color: meta.tone, fontWeight: 800, fontSize: 12 }}>{meta.label}</span>
      </div>
    </div>
  );
}

function ExecutionBackdrop({ currentFrame }) {
  const meta = getActionMeta(currentFrame);
  return (
    <motion.div
      animate={{
        opacity: 1,
        background: `radial-gradient(circle at 20% 20%, ${meta.tone}1f, transparent 34%), radial-gradient(circle at 80% 20%, ${COLORS.accent2}16, transparent 30%), radial-gradient(circle at 50% 80%, ${COLORS.accent}14, transparent 30%), linear-gradient(180deg, #08101d 0%, #050816 100%)`,
      }}
      transition={{ duration: 0.45 }}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

export function VisualizerEngine({
  currentFrame = null,
  allFrames = [],
  classification = null,
  errors = [],
  isDebugging = false,
  executionPlan = null,
}) {
  const variables = useMemo(() => normalizeStateVariables(currentFrame?.variables || {}), [currentFrame]);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      color: COLORS.text,
      overflow: 'hidden',
      background: COLORS.bg,
    }}>
      <ExecutionBackdrop currentFrame={currentFrame} />
      <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%' }}>
        <ActionHeader
          classification={classification}
          currentFrame={currentFrame}
          executionPlan={executionPlan}
          isDebugging={isDebugging}
          errors={errors}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.8fr', gap: 14, padding: 14, minHeight: 0 }}>
          <div style={{ display: 'grid', gap: 14, minHeight: 0 }}>
            <ArrayStrip variables={variables} currentFrame={currentFrame} />
            <CodeLineRail currentFrame={currentFrame} allFrames={allFrames} />
          </div>
          <div style={{ display: 'grid', gap: 14, minHeight: 0 }}>
            <VariablePanel variables={variables} currentFrame={currentFrame} />
            <ConsolePanel currentFrame={currentFrame} />
          </div>
        </div>

        <div style={{ padding: '0 14px 14px' }}>
          <motion.div layout style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            padding: 12,
            borderRadius: 18,
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            color: COLORS.muted,
            fontSize: 12,
          }}>
            {(allFrames || []).slice(-8).map((frame, index) => {
              const meta = getActionMeta(frame);
              return (
                <div key={`${frame.stepId || index}-${frame.line}`} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: meta.tone, fontWeight: 800 }}>{frame.executionLine || frame.line}</span>
                  <span>·</span>
                  <span>{meta.label}</span>
                </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default VisualizerEngine;
