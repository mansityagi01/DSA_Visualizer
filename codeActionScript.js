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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toLines(code) {
  return String(code || '').replace(/\r\n/g, '\n').split('\n');
}

function isExecutableLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  if (trimmed === '{' || trimmed === '}') return false;
  return !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.startsWith('#pragma');
}

function lineNumber(lines, predicate) {
  for (let index = 0; index < lines.length; index += 1) {
    if (predicate(lines[index], index)) return index + 1;
  }
  return null;
}

function lineForPattern(lines, pattern) {
  return lineNumber(lines, (line) => pattern.test(line));
}

function createItemId(name, index, value) {
  return `${name}-${index}-${String(value).replace(/\s+/g, '-')}`;
}

function createArrayItems(name, values) {
  return values.map((value, index) => ({ id: createItemId(name, index, value), index, value }));
}

function createScalar(type, value, extra = {}) {
  return { type, value, ...extra };
}

function createAction(eventType, overrides = {}) {
  const base = ACTION_KEYWORDS[eventType] || ACTION_KEYWORDS.UNKNOWN;
  return { keyword: base.keyword, motion: base.motion, target: base.target, trigger: base.keyword, ...overrides };
}

function createStep({ stepId, line, executionLine, phase, eventType, description, state, stateDiff, action, keywords = [], durationMs = DEFAULT_DURATION_MS }) {
  return {
    stepId,
    line,
    executionLine: executionLine ?? line,
    phase,
    eventType,
    description,
    action: action || createAction(eventType),
    keywords: keywords.length > 0 ? keywords : [ACTION_KEYWORDS[eventType]?.keyword || 'step'],
    stateDiff,
    fullState: clone(state),
    durationMs,
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

function extractArrays(source) {
  const results = [];
  const patterns = [
    /vector\s*<\s*int\s*>\s*(\w+)\s*=\s*\{([^}]*)\}\s*;/gm,
    /int\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}\s*;/gm,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const values = match[2]
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value));
      if (values.length > 0) {
        results.push({ name: match[1], values, kind: pattern.source.includes('vector') ? 'vector<int>' : 'int[]' });
      }
    }
  }

  return results;
}

function detectBubbleSort(source) {
  return /arr\s*\[\s*j\s*\]\s*>\s*arr\s*\[\s*j\s*\+\s*1\s*\]/m.test(source) || /swap\s*\(/m.test(source);
}

function detectSummation(source) {
  return /\w+\s*\+=\s*\w+\[\s*\w+\s*\]/m.test(source) || /sum\s*\+=\s*arr\s*\[\s*i\s*\]/m.test(source) || /total\s*\+=/m.test(source);
}

function buildProgramStart(state, lines, steps, stepId) {
  const sourceLine = lineForPattern(lines, /using\s+namespace\s+std\s*;/m) || 1;
  steps.push(createStep({
    stepId: stepId.value++,
    line: sourceLine,
    executionLine: sourceLine,
    phase: 'setup',
    eventType: 'PROGRAM_START',
    description: 'Program started',
    state,
    stateDiff: { program: { from: 'idle', to: 'running' } },
    action: createAction('PROGRAM_START', { keyword: 'start', motion: 'scene_intro', target: 'program' }),
  }));
}

function buildProgramEnd(state, lines, steps, stepId) {
  const returnLine = lineForPattern(lines, /return\s+0\s*;/m) || lines.length;
  steps.push(createStep({
    stepId: stepId.value++,
    line: returnLine,
    executionLine: returnLine,
    phase: 'end',
    eventType: 'PROGRAM_END',
    description: 'Program finished successfully',
    state,
    stateDiff: { program: { from: 'running', to: 'finished' } },
    action: createAction('PROGRAM_END', { keyword: 'finish', motion: 'scene_end', target: 'program' }),
  }));
}

function buildSummationScript(source, lines, arrays) {
  const state = {};
  const steps = [];
  const stepId = { value: 1 };
  const array = arrays[0];
  const sumName = (source.match(/(?:int|long|double|float|auto)\s+(\w+)\s*=\s*0\s*;/m)?.[1]) || 'sum';
  const loopLine = lineForPattern(lines, /for\s*\(/m) || 1;
  const arrayLine = array ? lineForPattern(lines, new RegExp(`(?:vector\\s*<\\s*int\\s*>|int)\\s+${array.name}`)) || 1 : 1;
  const sumPattern = new RegExp(`(?:int|long|double|float|auto)\\s+${sumName}\\s*=\\s*0\\s*;`, 'm');
  const sumLine = lineForPattern(lines, sumPattern) || arrayLine;
  const printLine = lineForPattern(lines, /cout\s*<</m) || lines.length;

  if (array) {
    state[array.name] = createScalar(array.kind, createArrayItems(array.name, array.values), { isArray: true, itemKind: 'number' });
  }
  state[sumName] = createScalar('int', 0);

  buildProgramStart(state, lines, steps, stepId);

  if (array) {
    steps.push(createStep({
      stepId: stepId.value++,
      line: arrayLine,
      executionLine: arrayLine,
      phase: 'setup',
      eventType: 'ARRAY_CREATE',
      description: `Create ${array.kind} ${array.name}`,
      state,
      stateDiff: { [array.name]: { from: null, to: state[array.name].value } },
      action: createAction('ARRAY_CREATE', { keyword: 'spawn-array', motion: 'container_spawn', target: 'array', payload: { name: array.name } }),
    }));

    array.values.forEach((value, index) => {
      steps.push(createStep({
        stepId: stepId.value++,
        line: arrayLine,
        executionLine: arrayLine,
        phase: 'setup',
        eventType: 'ARRAY_INSERT',
        description: `Insert ${value} into ${array.name}[${index}]`,
        state,
        stateDiff: { [array.name]: { op: 'insert', index, value } },
        action: createAction('ARRAY_INSERT', { keyword: 'push', motion: 'container_push', target: 'array', payload: { name: array.name, index, value } }),
      }));
    });
  }

  steps.push(createStep({
    stepId: stepId.value++,
    line: sumLine,
    executionLine: sumLine,
    phase: 'setup',
    eventType: 'VARIABLE_CREATE',
    description: `Create variable ${sumName} = 0`,
    state,
    stateDiff: { [sumName]: { from: null, to: 0 } },
    action: createAction('VARIABLE_CREATE', { keyword: 'spawn', motion: 'value_pop', target: 'variable', payload: { name: sumName, value: 0 } }),
  }));

  steps.push(createStep({
    stepId: stepId.value++,
    line: loopLine,
    executionLine: loopLine,
    phase: 'loop',
    eventType: 'LOOP_ENTER',
    description: 'Enter accumulation loop',
    state,
    stateDiff: { loop: { from: 'idle', to: 'entered' } },
    action: createAction('LOOP_ENTER', { keyword: 'loop-enter', motion: 'loop_ring', target: 'loop' }),
  }));

  let runningSum = 0;
  const values = array ? array.values : [];
  values.forEach((value, index) => {
    state.i = createScalar('int', index);
    state.currentValue = createScalar('int', value);

    steps.push(createStep({
      stepId: stepId.value++,
      line: loopLine,
      executionLine: loopLine,
      phase: 'loop',
      eventType: 'LOOP_ITERATION',
      description: `Iteration ${index + 1}: accessing ${array.name}[${index}] = ${value}`,
      state,
      stateDiff: { i: { from: index === 0 ? null : index - 1, to: index }, currentValue: { from: null, to: value } },
      action: createAction('LOOP_ITERATION', { keyword: 'iterate', motion: 'pointer_slide', target: 'loop', payload: { index, value, arrayName: array.name } }),
    }));

    const previous = runningSum;
    runningSum += value;
    state[sumName] = createScalar('int', runningSum);

    steps.push(createStep({
      stepId: stepId.value++,
      line: loopLine,
      executionLine: loopLine,
      phase: 'loop',
      eventType: 'VARIABLE_UPDATE',
      description: `${sumName} = ${previous} + ${value} = ${runningSum}`,
      state,
      stateDiff: { [sumName]: { from: previous, to: runningSum } },
      action: createAction('VARIABLE_UPDATE', { keyword: 'morph', motion: 'value_morph', target: 'variable', payload: { name: sumName, previous, value, result: runningSum } }),
    }));
  });

  steps.push(createStep({
    stepId: stepId.value++,
    line: loopLine,
    executionLine: loopLine,
    phase: 'loop',
    eventType: 'LOOP_EXIT',
    description: 'Loop complete',
    state,
    stateDiff: { loop: { from: 'entered', to: 'complete' } },
    action: createAction('LOOP_EXIT', { keyword: 'loop-exit', motion: 'loop_settle', target: 'loop' }),
  }));

  if (printLine) {
    state.console = createScalar('output', runningSum, { isOutput: true });
    steps.push(createStep({
      stepId: stepId.value++,
      line: printLine,
      executionLine: printLine,
      phase: 'output',
      eventType: 'OUTPUT',
      description: `Print sum = ${runningSum}`,
      state,
      stateDiff: { console: { from: null, to: runningSum } },
      action: createAction('OUTPUT', { keyword: 'print', motion: 'console_print', target: 'console', payload: { value: runningSum } }),
    }));
  }

  buildProgramEnd(state, lines, steps, stepId);

  return {
    mode: 'fallback-summation',
    shouldUseSyntheticTimeline: true,
    confidence: 0.85,
    summary: summarizePlan(steps),
    finalValue: runningSum,
    stepCount: steps.length,
    steps,
  };
}

function buildBubbleSortScript(source, lines, arrays) {
  const state = {};
  const steps = [];
  const stepId = { value: 1 };
  const array = arrays[0];
  const arrName = array ? array.name : 'arr';
  const outerLoopLine = lineForPattern(lines, /for\s*\(.*arr\.size\(\)\s*-/m) || lineForPattern(lines, /for\s*\(.*i.*<.*n.*\)/m) || 1;
  const innerLoopLine = lineForPattern(lines, /for\s*\(.*j.*<.*arr\.size\(\)\s*-/m) || outerLoopLine;
  const compareLine = lineForPattern(lines, /arr\s*\[\s*j\s*\]\s*>\s*arr\s*\[\s*j\s*\+\s*1\s*\]/m) || innerLoopLine;
  const swapLine = lineForPattern(lines, /temp\s*=\s*arr\s*\[\s*j\s*\]/m) || compareLine;
  const printLine = lineForPattern(lines, /cout\s*<</m) || lines.length;

  const items = createArrayItems(arrName, array ? array.values : []);
  state[arrName] = createScalar('int[]', items, { isArray: true, itemKind: 'number' });

  buildProgramStart(state, lines, steps, stepId);

  steps.push(createStep({
    stepId: stepId.value++,
    line: lineForPattern(lines, new RegExp(`(?:vector\\s*<\\s*int\\s*>|int)\\s+${arrName}`)) || outerLoopLine,
    executionLine: lineForPattern(lines, new RegExp(`(?:vector\\s*<\\s*int\\s*>|int)\\s+${arrName}`)) || outerLoopLine,
    phase: 'setup',
    eventType: 'ARRAY_CREATE',
    description: `Create array ${arrName}`,
    state,
    stateDiff: { [arrName]: { from: null, to: items } },
    action: createAction('ARRAY_CREATE', { keyword: 'spawn-array', motion: 'container_spawn', target: 'array', payload: { name: arrName } }),
  }));

  for (let outerIndex = 0; outerIndex < items.length - 1; outerIndex += 1) {
    state.i = createScalar('int', outerIndex);
    steps.push(createStep({
      stepId: stepId.value++,
      line: outerLoopLine,
      executionLine: outerLoopLine,
      phase: 'loop',
      eventType: 'LOOP_ENTER',
      description: `Outer pass ${outerIndex + 1}`,
      state,
      stateDiff: { i: { from: outerIndex === 0 ? null : outerIndex - 1, to: outerIndex } },
      action: createAction('LOOP_ENTER', { keyword: 'loop-enter', motion: 'loop_ring', target: 'loop', payload: { pass: outerIndex } }),
    }));

    for (let innerIndex = 0; innerIndex < items.length - outerIndex - 1; innerIndex += 1) {
      const left = items[innerIndex].value;
      const right = items[innerIndex + 1].value;
      state.j = createScalar('int', innerIndex);
      state.comparison = createScalar('bool', left > right);

      steps.push(createStep({
        stepId: stepId.value++,
        line: innerLoopLine,
        executionLine: compareLine,
        phase: 'loop',
        eventType: 'LOOP_ITERATION',
        description: `Compare ${arrName}[${innerIndex}]=${left} and ${arrName}[${innerIndex + 1}]=${right}`,
        state,
        stateDiff: { j: { from: innerIndex === 0 ? null : innerIndex - 1, to: innerIndex }, comparison: { from: null, to: left > right } },
        action: createAction('LOOP_ITERATION', { keyword: 'iterate', motion: 'pointer_slide', target: 'array', payload: { leftIndex: innerIndex, rightIndex: innerIndex + 1, left, right, arrayName: arrName } }),
      }));

      if (left > right) {
        const before = clone(state[arrName].value);
        const after = clone(before);
        [after[innerIndex], after[innerIndex + 1]] = [after[innerIndex + 1], after[innerIndex]];
        after.forEach((item, index) => {
          item.index = index;
        });
        state[arrName] = createScalar('int[]', after, { isArray: true, itemKind: 'number' });
        state.swapped = createScalar('bool', true);

        steps.push(createStep({
          stepId: stepId.value++,
          line: swapLine,
          executionLine: swapLine,
          phase: 'mutation',
          eventType: 'SWAP',
          description: `Swap ${arrName}[${innerIndex}] and ${arrName}[${innerIndex + 1}]`,
          state,
          stateDiff: { [arrName]: { from: before, to: after, swap: [innerIndex, innerIndex + 1] } },
          action: createAction('SWAP', { keyword: 'swap', motion: 'swap_lift', target: 'array', payload: { arrayName: arrName, swapIndices: [innerIndex, innerIndex + 1], before, after } }),
        }));
      }
    }

    steps.push(createStep({
      stepId: stepId.value++,
      line: outerLoopLine,
      executionLine: outerLoopLine,
      phase: 'loop',
      eventType: 'LOOP_EXIT',
      description: `Outer pass ${outerIndex + 1} complete`,
      state,
      stateDiff: { i: { from: outerIndex, to: outerIndex + 1 } },
      action: createAction('LOOP_EXIT', { keyword: 'loop-exit', motion: 'loop_settle', target: 'loop', payload: { pass: outerIndex } }),
    }));
  }

  if (printLine) {
    state.console = createScalar('output', clone(state[arrName].value), { isOutput: true });
    steps.push(createStep({
      stepId: stepId.value++,
      line: printLine,
      executionLine: printLine,
      phase: 'output',
      eventType: 'OUTPUT',
      description: `Print sorted ${arrName}`,
      state,
      stateDiff: { console: { from: null, to: state[arrName].value } },
      action: createAction('OUTPUT', { keyword: 'print', motion: 'console_print', target: 'console', payload: { value: state[arrName].value } }),
    }));
  }

  buildProgramEnd(state, lines, steps, stepId);

  return {
    mode: 'fallback-bubblesort',
    shouldUseSyntheticTimeline: true,
    confidence: 0.9,
    summary: summarizePlan(steps),
    finalValue: clone(state[arrName].value),
    stepCount: steps.length,
    steps,
  };
}

function buildGenericScript(source, lines, arrays) {
  const state = {};
  const steps = [];
  const stepId = { value: 1 };
  const executable = lines.map((line, index) => ({ line: line.trim(), lineNo: index + 1 })).filter(({ line }) => isExecutableLine(line));

  if (arrays[0]) {
    state[arrays[0].name] = createScalar(arrays[0].kind, createArrayItems(arrays[0].name, arrays[0].values), { isArray: true, itemKind: 'number' });
  }

  buildProgramStart(state, lines, steps, stepId);

  for (const entry of executable) {
    let eventType = 'LINE_EXECUTE';
    let description = entry.line;
    let action = createAction('LINE_EXECUTE');

    if (/^for\s*\(|^while\s*\(/.test(entry.line)) {
      eventType = 'LOOP_ENTER';
      description = `Loop header: ${entry.line}`;
      action = createAction('LOOP_ENTER', { keyword: 'loop-enter', motion: 'loop_ring', target: 'loop' });
    } else if (/^if\s*\(|^else\b|^switch\s*\(/.test(entry.line)) {
      eventType = 'CONDITION_CHECK';
      description = `Condition: ${entry.line}`;
      action = createAction('CONDITION_CHECK', { keyword: 'branch', motion: 'branch_split', target: 'condition' });
    } else if (/\breturn\b/.test(entry.line)) {
      eventType = 'RETURN';
      description = `Return: ${entry.line}`;
      action = createAction('RETURN', { keyword: 'return', motion: 'call_stack_pop', target: 'callstack' });
    } else if (/cout\s*<<|printf\s*\(|puts\s*\(/.test(entry.line)) {
      eventType = 'OUTPUT';
      description = `Output: ${entry.line}`;
      action = createAction('OUTPUT', { keyword: 'print', motion: 'console_print', target: 'console' });
    } else if (/\b(push_back|emplace_back|insert|erase|push|pop)\b/.test(entry.line)) {
      eventType = 'COLLECTION_MUTATION';
      description = `Collection mutation: ${entry.line}`;
      action = createAction('COLLECTION_MUTATION', { keyword: 'mutate', motion: 'container_mutation', target: 'collection' });
    } else if (/\+\+|--/.test(entry.line)) {
      eventType = 'INCREMENT';
      description = `Increment/decrement: ${entry.line}`;
      action = createAction('INCREMENT', { keyword: 'increment', motion: 'value_bounce', target: 'variable' });
    } else if (/\w+\s*\(.*\)/.test(entry.line)) {
      eventType = 'FUNCTION_CALL';
      description = `Function call: ${entry.line}`;
      action = createAction('FUNCTION_CALL', { keyword: 'call', motion: 'call_stack_push', target: 'callstack' });
    } else if (/[A-Za-z_]\w*\s*=\s*[^=]/.test(entry.line) && !/[<>!=]=/.test(entry.line)) {
      eventType = 'ASSIGNMENT';
      description = `Assignment: ${entry.line}`;
      action = createAction('ASSIGNMENT', { keyword: 'assign', motion: 'value_morph', target: 'variable' });
    }

    steps.push(createStep({
      stepId: stepId.value++,
      line: entry.lineNo,
      executionLine: entry.lineNo,
      phase: 'execute',
      eventType,
      description,
      state,
      stateDiff: { cursor: { from: Math.max(1, entry.lineNo - 1), to: entry.lineNo } },
      action,
    }));
  }

  const returnLine = lineForPattern(lines, /return\s+0\s*;/m);
  if (returnLine) {
    buildProgramEnd(state, lines, steps, stepId);
  }

  return {
    mode: 'fallback-generic',
    shouldUseSyntheticTimeline: true,
    confidence: 0.58,
    summary: summarizePlan(steps),
    finalValue: null,
    stepCount: steps.length,
    steps,
  };
}

export function buildFallbackActionScript(code) {
  const source = String(code || '');
  const lines = toLines(source);
  const arrays = extractArrays(source);

  if (detectBubbleSort(source) && arrays.length > 0) {
    return buildBubbleSortScript(source, lines, arrays);
  }

  if (detectSummation(source) && arrays.length > 0) {
    return buildSummationScript(source, lines, arrays);
  }

  return buildGenericScript(source, lines, arrays);
}

export function buildActionKeywords() {
  return clone(ACTION_KEYWORDS);
}