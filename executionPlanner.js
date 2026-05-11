// ============================================================================
// FILE: executionPlanner.js (LEGACY COMPATIBILITY WRAPPER)
// Delegate to the main action-script builder so the schema stays in sync.
// ============================================================================

import { buildFallbackActionScript } from './codeActionScript.js';

const DEFAULT_DURATION_MS = 540;

const ACTION_KEYWORDS = {
  PROGRAM_START: { keyword: 'start', motion: 'scene_intro', target: 'program' },
  PROGRAM_END: { keyword: 'finish', motion: 'scene_end', target: 'program' },
  LINE_EXECUTE: { keyword: 'step', motion: 'line_glow', target: 'line' },
  VARIABLE_CREATE: { keyword: 'spawn', motion: 'value_pop', target: 'variable' },
  VARIABLE_UPDATE: { keyword: 'morph', motion: 'value_morph', target: 'variable' },
  ASSIGNMENT: { keyword: 'assign', motion: 'value_morph', target: 'variable' },
  INCREMENT: { keyword: 'increment', motion: 'value_bounce', target: 'variable' },
  LOOP_ENTER: { keyword: 'loop-enter', motion: 'loop_ring', target: 'loop' },
  LOOP_ITERATION: { keyword: 'iterate', motion: 'pointer_slide', target: 'loop' },
  LOOP_EXIT: { keyword: 'loop-exit', motion: 'loop_settle', target: 'loop' },
  CONDITION_CHECK: { keyword: 'branch', motion: 'branch_split', target: 'condition' },
  SWAP: { keyword: 'swap', motion: 'swap_lift', target: 'array' },
  ARRAY_CREATE: { keyword: 'spawn-array', motion: 'container_spawn', target: 'array' },
  ARRAY_INSERT: { keyword: 'push', motion: 'container_push', target: 'array' },
  COLLECTION_MUTATION: { keyword: 'mutate', motion: 'container_mutation', target: 'collection' },
  OUTPUT: { keyword: 'print', motion: 'console_print', target: 'console' },
  FUNCTION_CALL: { keyword: 'call', motion: 'call_stack_push', target: 'callstack' },
  RETURN: { keyword: 'return', motion: 'call_stack_pop', target: 'callstack' },
  UNKNOWN: { keyword: 'step', motion: 'line_glow', target: 'line' },
};

function toLines(code) {
  return String(code || '').replace(/\r\n/g, '\n').split('\n');
}

function lineNumber(lines, predicate) {
  for (let index = 0; index < lines.length; index += 1) {
    if (predicate(lines[index], index)) return index + 1;
  }
  return null;
}

function firstMatchLine(lines, regex) {
  return lineNumber(lines, (line) => regex.test(line));
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function createVariable(type, value, extra = {}) {
  return { type, value, ...extra };
}

function createAction(eventType, overrides = {}) {
  const base = ACTION_KEYWORDS[eventType] || ACTION_KEYWORDS.UNKNOWN;
  return { 
    keyword: base.keyword, 
    motion: base.motion, 
    target: base.target, 
    trigger: base.keyword,
    ...overrides 
  };
}

function createItemId(name, index, value) {
  return `${name}-${index}-${String(value).replace(/\s+/g, '-')}`;
}

function createArrayItems(name, values) {
  return values.map((value, index) => ({ 
    id: createItemId(name, index, value), 
    index, 
    value 
  }));
}

function createStep({ stepId, line, executionLine, phase, eventType, description, animationHint, stateDiff, state, durationMs, action, keywords = [] }) {
  return {
    stepId,
    line,
    executionLine: executionLine ?? line,
    phase,
    eventType,
    description,
    animationHint,
    action: action || createAction(eventType),
    keywords: keywords.length > 0 ? keywords : [ACTION_KEYWORDS[eventType]?.keyword || 'step'],
    stateDiff,
    fullState: cloneState(state),
    durationMs: durationMs ?? DEFAULT_DURATION_MS,
    timestamp: Date.now(),
  };
}

function summarizePlan(steps) {
  const summary = {};
  for (const step of steps) {
    summary[step.eventType] = (summary[step.eventType] || 0) + 1;
  }
  return summary;
}

function stateToFrameVariables(state) {
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

function extractVectorLiteral(code) {
  const patterns = [
    /vector\s*<\s*int\s*>\s*(\w+)\s*=\s*\{([^}]*)\}\s*;/m,
    /int\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}\s*;/m,
  ];

  for (const re of patterns) {
    const match = code.match(re);
    if (!match) continue;

    const name = match[1];
    const values = match[2]
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));

    if (values.length > 0) {
      return { name, values, kind: re.source.includes('vector') ? 'vector<int>' : 'int[]' };
    }
  }

  return null;
}

function extractLoopHeader(lines, iteratorName, sourceName) {
  return lineNumber(lines, (line) => {
    const normalized = line.replace(/\s+/g, ' ');
    return normalized.includes('for') && normalized.includes(iteratorName) && normalized.includes(sourceName);
  });
}

function extractArrayAccessLine(lines, arrayName) {
  return lineNumber(lines, (line) => line.includes(`${arrayName}[`) && line.includes('sum'));
}

function extractPrintLine(lines) {
  return lineNumber(lines, (line) => line.includes('cout') && line.includes('<<'));
}

function extractReturnLine(lines) {
  return firstMatchLine(lines, /return\s+0\s*;/);
}

function detectSummationPlan(source, lines) {
  const vector = extractVectorLiteral(source);
  const loopMatch = source.match(/for\s*\(\s*(?:const\s+)?(?:auto|int)\s+(\w+)\s*:\s*(\w+)\s*\)/m);
  const sumMatch = source.match(/(?:int|long|double|float|auto)\s+(\w+)\s*=\s*0\s*;/m);

  if (!vector || !loopMatch || !sumMatch) return null;

  const iteratorName = loopMatch[1];
  const sourceName = loopMatch[2];
  const sumName = sumMatch[1];
  const arrayLine = lineNumber(lines, (line) => line.includes(vector.name) && line.includes('{') && line.includes('='));
  const sumLine = lineNumber(lines, (line) => line.includes(`${sumName} = 0`) || line.includes(`${sumName}=0`));
  const loopLine = extractLoopHeader(lines, iteratorName, sourceName) || firstMatchLine(lines, /for\s*\(/m);
  const updateLine = extractArrayAccessLine(lines, vector.name) || lineNumber(lines, (line) => line.includes(`${sumName} +=`) || (line.includes(sumName) && line.includes('+')));
  const printLine = extractPrintLine(lines);
  const returnLine = extractReturnLine(lines);

  const steps = [];
  const state = {};
  let stepId = 1;
  let runningSum = 0;

  const push = (payload) => {
    steps.push(createStep({
      ...payload,
      stepId,
      state,
    }));
    stepId += 1;
  };

  state[vector.name] = createVariable(vector.kind, createArrayItems(vector.name, vector.values), { isArray: true });
  state[sumName] = createVariable('int', 0);

  push({
    line: arrayLine || 1,
    executionLine: arrayLine || 1,
    phase: 'setup',
    eventType: 'PROGRAM_START',
    description: 'Program started',
    animationHint: 'scene_intro',
    stateDiff: { program: { from: 'idle', to: 'running' } },
    action: createAction('PROGRAM_START'),
  });

  push({
    line: arrayLine || 1,
    executionLine: arrayLine || 1,
    phase: 'setup',
    eventType: 'ARRAY_CREATE',
    description: `Create ${vector.kind} ${vector.name}`,
    animationHint: 'vector_boxes_spawn',
    stateDiff: { [vector.name]: { from: null, to: state[vector.name].value } },
    action: createAction('ARRAY_CREATE', { payload: { name: vector.name, values: vector.values } }),
  });

  vector.values.forEach((value, index) => {
    push({
      line: arrayLine || 1,
      executionLine: arrayLine || 1,
      phase: 'setup',
      eventType: 'ARRAY_INSERT',
      description: `Insert ${value} into ${vector.name}[${index}]`,
      animationHint: 'value_spawn_at_index',
      stateDiff: { [vector.name]: { op: 'insert', index, value } },
      action: createAction('ARRAY_INSERT', { payload: { name: vector.name, index, value } }),
    });
  });

  push({
    line: sumLine || 1,
    executionLine: sumLine || 1,
    phase: 'setup',
    eventType: 'VARIABLE_CREATE',
    description: `Create ${sumName} = 0`,
    animationHint: 'value_pop',
    stateDiff: { [sumName]: { from: null, to: 0 } },
    action: createAction('VARIABLE_CREATE', { payload: { name: sumName, value: 0 } }),
  });

  push({
    line: loopLine || 1,
    executionLine: loopLine || 1,
    phase: 'loop',
    eventType: 'LOOP_ENTER',
    description: `Enter loop over ${vector.name}`,
    animationHint: 'loop_ring',
    stateDiff: { loop: { from: null, to: 'active' } },
    action: createAction('LOOP_ENTER', { payload: { arrayName: vector.name } }),
  });

  vector.values.forEach((value, index) => {
    state[iteratorName] = createVariable('int', value);
    runningSum += value;
    state[sumName] = createVariable('int', runningSum);

    push({
      line: updateLine || loopLine || 1,
      executionLine: updateLine || loopLine || 1,
      phase: 'loop',
      eventType: 'LOOP_ITERATION',
      description: `Iteration ${index + 1}: ${sumName} += ${vector.name}[${index}] (${value}), ${sumName} = ${runningSum}`,
      animationHint: 'pointer_slide',
      stateDiff: {
        [iteratorName]: { from: index === 0 ? null : vector.values[index - 1], to: value },
        [sumName]: { from: runningSum - value, to: runningSum },
      },
      action: createAction('LOOP_ITERATION', { 
        payload: { 
          index, 
          value, 
          sumBefore: runningSum - value, 
          sumAfter: runningSum,
          arrayName: vector.name 
        } 
      }),
    });
  });

  push({
    line: loopLine || 1,
    executionLine: loopLine || 1,
    phase: 'loop',
    eventType: 'LOOP_EXIT',
    description: 'Loop complete',
    animationHint: 'loop_settle',
    stateDiff: { loop: { from: 'active', to: 'complete' } },
    action: createAction('LOOP_EXIT'),
  });

  if (printLine) {
    state.console = createVariable('output', runningSum, { isOutput: true });
    push({
      line: printLine,
      executionLine: printLine,
      phase: 'output',
      eventType: 'OUTPUT',
      description: `Print ${sumName} = ${runningSum}`,
      animationHint: 'console_print',
      stateDiff: { console: { from: null, to: runningSum } },
      action: createAction('OUTPUT', { payload: { value: runningSum } }),
    });
  }

  if (returnLine) {
    push({
      line: returnLine,
      executionLine: returnLine,
      phase: 'end',
      eventType: 'PROGRAM_END',
      description: 'Program finished',
      animationHint: 'scene_end',
      stateDiff: { program: { from: 'running', to: 'finished' } },
      action: createAction('PROGRAM_END'),
    });
  }

  return {
    mode: 'legacy-summation',
    shouldUseSyntheticTimeline: true,
    confidence: 0.88,
    summary: summarizePlan(steps),
    stepCount: steps.length,
    finalValue: runningSum,
    steps,
  };
}

function detectBubbleSortPlan(source, lines) {
  const vector = extractVectorLiteral(source);
  if (!vector) return null;

  const isBubbleSort = /arr\s*\[\s*j\s*\]\s*>\s*arr\s*\[\s*j\s*\+\s*1\s*\]/m.test(source) || /swap\s*\(/m.test(source);
  if (!isBubbleSort) return null;

  const arrName = vector.name;
  const values = [...vector.values];
  const items = createArrayItems(arrName, values);
  const steps = [];
  const state = {};
  let stepId = 1;

  const push = (payload) => {
    steps.push(createStep({
      ...payload,
      stepId,
      state,
    }));
    stepId += 1;
  };

  const arrayLine = lineNumber(lines, (line) => line.includes(arrName) && line.includes('{'));
  const outerLoopLine = lineNumber(lines, (line) => /for\s*\(\s*(?:int|size_t)\s+i\s*=/m.test(line));
  const innerLoopLine = lineNumber(lines, (line) => /for\s*\(\s*(?:int|size_t)\s+j\s*=/m.test(line));
  const compareLine = lineNumber(lines, (line) => /arr\s*\[\s*j\s*\]\s*>\s*arr\s*\[\s*j\s*\+\s*1\s*\]/m.test(line));
  const swapLine = lineNumber(lines, (line) => /temp\s*=|swap\s*\(/.test(line));
  const printLine = extractPrintLine(lines);
  const returnLine = extractReturnLine(lines);

  state[arrName] = createVariable(vector.kind, items, { isArray: true, itemKind: 'number' });

  push({
    line: arrayLine || 1,
    executionLine: arrayLine || 1,
    phase: 'setup',
    eventType: 'PROGRAM_START',
    description: 'Program started',
    animationHint: 'scene_intro',
    stateDiff: { program: { from: 'idle', to: 'running' } },
    action: createAction('PROGRAM_START'),
  });

  push({
    line: arrayLine || 1,
    executionLine: arrayLine || 1,
    phase: 'setup',
    eventType: 'ARRAY_CREATE',
    description: `Create ${vector.kind} ${arrName}`,
    animationHint: 'vector_boxes_spawn',
    stateDiff: { [arrName]: { from: null, to: items } },
    action: createAction('ARRAY_CREATE', { payload: { name: arrName, values } }),
  });

  for (let outerIndex = 0; outerIndex < values.length - 1; outerIndex += 1) {
    state.i = createVariable('int', outerIndex);
    push({
      line: outerLoopLine || 1,
      executionLine: outerLoopLine || 1,
      phase: 'loop',
      eventType: 'LOOP_ENTER',
      description: `Outer pass ${outerIndex + 1}`,
      animationHint: 'loop_highlight',
      stateDiff: { i: { from: outerIndex === 0 ? null : outerIndex - 1, to: outerIndex } },
      action: createAction('LOOP_ENTER', { payload: { pass: outerIndex } }),
    });

    for (let innerIndex = 0; innerIndex < values.length - outerIndex - 1; innerIndex += 1) {
      const left = items[innerIndex].value;
      const right = items[innerIndex + 1].value;
      state.j = createVariable('int', innerIndex);
      state.comparison = createVariable('bool', left > right);

      push({
        line: innerLoopLine || outerLoopLine || 1,
        executionLine: compareLine || innerLoopLine || outerLoopLine || 1,
        phase: 'loop',
        eventType: 'LOOP_ITERATION',
        description: `Compare ${arrName}[${innerIndex}] = ${left} and ${arrName}[${innerIndex + 1}] = ${right}`,
        animationHint: 'loop_pointer_slide',
        stateDiff: {
          j: { from: innerIndex === 0 ? null : innerIndex - 1, to: innerIndex },
          comparison: { from: null, to: left > right },
        },
        action: createAction('LOOP_ITERATION', { 
          payload: { 
            leftIndex: innerIndex, 
            rightIndex: innerIndex + 1, 
            left, 
            right, 
            arrayName: arrName 
          } 
        }),
      });

      if (left > right) {
        const before = cloneState(items);
        [items[innerIndex], items[innerIndex + 1]] = [items[innerIndex + 1], items[innerIndex]];
        items.forEach((item, idx) => {
          item.index = idx;
        });
        const after = cloneState(items);
        state[arrName] = createVariable(vector.kind, items, { isArray: true, itemKind: 'number' });
        state.swapped = createVariable('bool', true);

        push({
          line: swapLine || innerLoopLine || 1,
          executionLine: swapLine || innerLoopLine || 1,
          phase: 'mutation',
          eventType: 'SWAP',
          description: `Swap ${arrName}[${innerIndex}] and ${arrName}[${innerIndex + 1}]`,
          animationHint: 'adjacent_swap',
          stateDiff: {
            [arrName]: { from: before, to: after, swap: [innerIndex, innerIndex + 1] },
          },
          action: createAction('SWAP', { 
            payload: { 
              arrayName: arrName, 
              swapIndices: [innerIndex, innerIndex + 1], 
              before, 
              after 
            } 
          }),
        });
      }
    }

    push({
      line: outerLoopLine || 1,
      executionLine: outerLoopLine || 1,
      phase: 'loop',
      eventType: 'LOOP_EXIT',
      description: `Outer pass ${outerIndex + 1} complete`,
      animationHint: 'loop_complete',
      stateDiff: { i: { from: outerIndex, to: outerIndex + 1 } },
      action: createAction('LOOP_EXIT', { payload: { pass: outerIndex } }),
    });
  }

  if (printLine) {
    state.result = createVariable('int[]', items, { isOutput: true });
    push({
      line: printLine,
      executionLine: printLine,
      phase: 'output',
      eventType: 'OUTPUT',
      description: `Print sorted array ${arrName}`,
      animationHint: 'console_print',
      stateDiff: { console: { from: null, to: items } },
      action: createAction('OUTPUT', { payload: { value: items } }),
    });
  }

  if (returnLine) {
    push({
      line: returnLine,
      executionLine: returnLine,
      phase: 'end',
      eventType: 'PROGRAM_END',
      description: 'Program finished successfully',
      animationHint: 'scene_end',
      stateDiff: { program: { from: 'running', to: 'finished' } },
      action: createAction('PROGRAM_END'),
    });
  }

  return {
    mode: 'legacy-bubblesort',
    shouldUseSyntheticTimeline: true,
    confidence: 0.85,
    summary: summarizePlan(steps),
    stepCount: steps.length,
    finalValue: items,
    steps,
  };
}

function detectGenericPlan(source, lines) {
  const steps = [];
  const state = {};
  let stepId = 1;

  const push = (payload) => {
    steps.push(createStep({
      ...payload,
      stepId,
      state,
    }));
    stepId += 1;
  };

  const executableLines = lines
    .map((line, index) => ({ line: line.trim(), lineNo: index + 1 }))
    .filter(({ line }) => line.length > 0 && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*') && line !== '{' && line !== '}');

  const firstExecutableLine = executableLines[0]?.lineNo || 1;

  push({
    line: firstExecutableLine,
    executionLine: firstExecutableLine,
    phase: 'setup',
    eventType: 'PROGRAM_START',
    description: 'Program started',
    animationHint: 'scene_intro',
    stateDiff: { program: { from: 'idle', to: 'running' } },
    action: createAction('PROGRAM_START'),
  });

  for (const entry of executableLines) {
    const line = entry.line;
    const lineNo = entry.lineNo;
    let eventType = 'LINE_EXECUTE';
    let animationHint = 'code_step';
    let description = line;

    if (/^for\s*\(/.test(line) || /^while\s*\(/.test(line)) {
      eventType = 'LOOP_ENTER';
      animationHint = 'loop_highlight';
      description = `Loop header: ${line}`;
    } else if (/^if\s*\(/.test(line) || /^else\b/.test(line) || /\bswitch\s*\(/.test(line)) {
      eventType = 'CONDITION_CHECK';
      animationHint = 'decision_branch';
      description = `Condition: ${line}`;
    } else if (/\breturn\b/.test(line)) {
      eventType = 'RETURN';
      animationHint = 'scene_end';
      description = `Return statement: ${line}`;
    } else if (/cout\s*<<|printf\s*\(|puts\s*\(/.test(line)) {
      eventType = 'OUTPUT';
      animationHint = 'console_print';
      description = `Output: ${line}`;
    } else if (/\b(push_back|emplace_back|insert|erase|push|pop)\b/.test(line)) {
      eventType = 'COLLECTION_MUTATION';
      animationHint = 'container_mutation';
      description = `Container mutation: ${line}`;
    } else if (/\w+\s*\=\s*[^=]/.test(line) && !/[<>!=]=/.test(line)) {
      eventType = 'ASSIGNMENT';
      animationHint = 'value_node_morph';
      description = `Assignment: ${line}`;
    } else if (/\+\+|--/.test(line)) {
      eventType = 'INCREMENT';
      animationHint = 'value_node_morph';
      description = `Increment/decrement: ${line}`;
    } else if (/\w+\s*\(.*\)/.test(line)) {
      eventType = 'FUNCTION_CALL';
      animationHint = 'call_transition';
      description = `Function call: ${line}`;
    }

    push({
      line: lineNo,
      executionLine: lineNo,
      phase: 'execute',
      eventType,
      description,
      animationHint,
      stateDiff: { cursor: { from: Math.max(1, lineNo - 1), to: lineNo } },
      action: createAction(eventType),
    });
  }

  const returnLine = extractReturnLine(lines);
  if (returnLine) {
    push({
      line: returnLine,
      executionLine: returnLine,
      phase: 'end',
      eventType: 'PROGRAM_END',
      description: 'Program finished',
      animationHint: 'scene_end',
      stateDiff: { program: { from: 'running', to: 'finished' } },
      action: createAction('PROGRAM_END'),
    });
  }

  return {
    mode: 'legacy-generic',
    shouldUseSyntheticTimeline: true,
    confidence: 0.55,
    summary: summarizePlan(steps),
    stepCount: steps.length,
    finalValue: null,
    steps,
  };
}

export function buildExecutionPlan(code) {
  return buildFallbackActionScript(code);
}