import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildFallbackActionScript } from './codeActionScript.js';

export class AIClassifier {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    this.model = null;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.aiAvailable = Boolean(this.genAI);
    this._modelsListCached = null;

    this.archetypeMap = {
      ARRAY: { mesh: 'trainCoaches', layout: 'linear', animation: 'slideTransition', physics: 'rigid', errorStyle: 'explosion' },
      LINKED_LIST: { mesh: 'capsuleChain', layout: 'serpentine', animation: 'flowingChain', physics: 'rope', errorStyle: 'chainBreak' },
      STACK: { mesh: 'plateStack', layout: 'vertical', animation: 'stackPop', physics: 'balanced', errorStyle: 'towerCollapse' },
      QUEUE: { mesh: 'conveyorBelt', layout: 'horizontal', animation: 'beltFlow', physics: 'continuous', errorStyle: 'jammedBelt' },
      BINARY_TREE: { mesh: 'organicTree', layout: 'hierarchical', animation: 'growingBranches', physics: 'swaying', errorStyle: 'fallingLeaves' },
      GRAPH: { mesh: 'forceDirectedNodes', layout: 'forceDirected3D', animation: 'springPhysics', physics: 'magneticNodes', errorStyle: 'nodeExplosion' },
      HASH_TABLE: { mesh: 'bucketGrid', layout: 'grid', animation: 'hashScatter', physics: 'floating', errorStyle: 'collisionSparks' },
      TRIE: { mesh: 'letterTree', layout: 'radialTree', animation: 'letterFlow', physics: 'lightweight', errorStyle: 'letterScatter' },
      HEAP: { mesh: 'pyramid', layout: 'pyramidal', animation: 'bubbleUpDown', physics: 'weighted', errorStyle: 'pyramidCrumble' },
      WATER_JUG: { mesh: 'glassJugs', layout: 'side-by-side', animation: 'liquidFlow', physics: 'fluidSimulation', errorStyle: 'waterSpill' },
      CUSTOM: { mesh: 'scriptBoard', layout: 'freeform', animation: 'keywordFlow', physics: 'none', errorStyle: 'scriptError' },
    };
  }

  async listAndSelectModel() {
    if (!this.genAI) return null;
    if (this._modelsListCached) return this._modelsListCached;

    try {
      if (typeof this.genAI.listModels === 'function') {
        const response = await this.genAI.listModels();
        const models = response?.models || response;
        if (Array.isArray(models) && models.length > 0) {
          const pick = models.find((model) => String(model.name || model.model || model.id || '').toLowerCase().includes('gemini'))
            || models.find((model) => model?.supportedMethods?.includes('generateContent'))
            || models[0];
          const modelId = pick.name || pick.model || pick.id || pick;
          this._modelsListCached = modelId;
          return modelId;
        }
      }
    } catch (error) {
      console.warn('Could not list models from Gemini API:', error?.message || error);
    }

    return null;
  }

  async classify(code) {
    if (!this.genAI) return this.fallbackClassification(code);

    const prompt = [
      'You are an expert C++ algorithm analyzer. Return ONLY JSON with this exact structure:',
      '{',
      '  "dataStructure": "ARRAY|LINKED_LIST|STACK|QUEUE|BINARY_TREE|GRAPH|HASH_TABLE|TRIE|HEAP|WATER_JUG|CUSTOM",',
      '  "algorithm": "name",',
      '  "visualArchetype": "trainCoaches|capsuleChain|forceDirectedNodes|organicTree|etc.",',
      '  "complexity": { "time": "O(...)", "space": "O(...)" },',
      '  "metadata": {',
      '    "hasPointers": true,',
      '    "hasRecursion": false,',
      '    "hasLoops": true,',
      '    "maxDepth": 0,',
      '    "nodeCount": 0,',
      '    "edgeCount": 0,',
      '    "isProblemSolving": false,',
      '    "keyVariables": [],',
      '    "criticalLines": [],',
      '    "errorProne": []',
      '  },',
      '  "visualizationHints": {',
      '    "cameraAngle": "top|side|isometric|dynamic",',
      '    "colorScheme": "vibrant|pastel|neon|monochrome",',
      '    "animationSpeed": "slow|medium|fast",',
      '    "showConnections": true,',
      '    "highlightCriticalPath": false',
      '  }',
      '}',
      'Analyze this C++ code:',
      '```cpp',
      code,
      '```',
    ].join('\n');

    try {
      if (!this.model) {
        try {
          this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (initError) {
          const selected = await this.listAndSelectModel();
          if (!selected) {
            this.aiAvailable = false;
            return this.fallbackClassification(code);
          }
          this.model = this.genAI.getGenerativeModel({ model: selected });
          this.modelName = selected;
        }
      }

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      let text = response.text().trim();

      if (text.startsWith('```json')) {
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (text.startsWith('```')) {
        text = text.replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(text);
      const archetype = this.archetypeMap[parsed.dataStructure] || this.archetypeMap.ARRAY;
      parsed.visualArchetype = archetype;
      return parsed;
    } catch (error) {
      console.error('❌ AI Classification Error:', error?.message || error);
      this.aiAvailable = false;
      return this.fallbackClassification(code);
    }
  }

  async generateActionScript(code) {
    const fallback = () => buildFallbackActionScript(code);
    if (!this.genAI) return fallback();

    const prompt = [
      'You are a C++ code execution script generator.',
      'Generate a COMPLETE step-by-step execution script for this C++ code.',
      'Return ONLY valid JSON with NO extra text.',
      '',
      'CRITICAL RULES:',
      '1. Track EVERY executable line in the exact order it runs',
      '2. For array declarations, emit ARRAY_CREATE then ARRAY_INSERT for each element',
      '3. For variable declarations, emit VARIABLE_CREATE with initial value',
      '4. For loops:',
      '   - Emit LOOP_ENTER when loop starts',
      '   - Emit LOOP_ITERATION for EACH iteration with current values',
      '   - For summation: include running sum value for each iteration',
      '   - For sorting: include comparison and swap if needed',
      '   - Emit LOOP_EXIT when loop completes',
      '5. For variable updates: emit VARIABLE_UPDATE with old and new values',
      '6. For swaps: emit SWAP with exact indices and before/after array snapshots',
      '7. For output: emit OUTPUT with the values being printed',
      '8. Emit PROGRAM_END at the end',
      '',
      'JSON Structure:',
      '{',
      '  "mode": "ai-generated",',
      '  "confidence": 0.95,',
      '  "summary": { "ARRAY_CREATE": 1, "LOOP_ITERATION": 6, ... },',
      '  "steps": [',
      '    {',
      '      "stepId": 1,',
      '      "line": 11,',
      '      "executionLine": 11,',
      '      "phase": "setup|loop|mutation|output|end",',
      '      "eventType": "PROGRAM_START|ARRAY_CREATE|ARRAY_INSERT|VARIABLE_CREATE|LOOP_ENTER|LOOP_ITERATION|VARIABLE_UPDATE|SWAP|OUTPUT|PROGRAM_END",',
      '      "description": "Clear description of what happens",',
      '      "action": {',
      '        "keyword": "spawn|spawn-array|push|iterate|morph|swap|print|finish",',
      '        "motion": "value_pop|container_spawn|container_push|pointer_slide|value_morph|swap_lift|console_print|scene_end",',
      '        "target": "program|array|variable|loop|console",',
      '        "payload": {',
      '          "varName": "sum",',
      '          "value": 5,',
      '          "index": 0,',
      '          "before": [5,2,8],',
      '          "after": [2,5,8],',
      '          "swapIndices": [0,1]',
      '        }',
      '      },',
      '      "stateDiff": {',
      '        "sum": { "from": 0, "to": 5 },',
      '        "i": { "from": null, "to": 0 }',
      '      },',
      '      "fullState": {',
      '        "arr": { "type": "int[]", "value": [{id:"arr-0-5",index:0,value:5},...], "isArray": true },',
      '        "sum": { "type": "int", "value": 5 },',
      '        "i": { "type": "int", "value": 0 }',
      '      }',
      '    }',
      '  ]',
      '}',
      '',
      'EXAMPLE for: int arr[] = {5,2,8}; int sum = 0; for(int i=0; i<3; i++) sum += arr[i];',
      '',
      'Step 1: PROGRAM_START',
      'Step 2: ARRAY_CREATE for arr',
      'Step 3: ARRAY_INSERT arr[0]=5',
      'Step 4: ARRAY_INSERT arr[1]=2',
      'Step 5: ARRAY_INSERT arr[2]=8',
      'Step 6: VARIABLE_CREATE sum=0',
      'Step 7: LOOP_ENTER i=0',
      'Step 8: LOOP_ITERATION i=0, sum=5 (after sum+=arr[0])',
      'Step 9: LOOP_ITERATION i=1, sum=7 (after sum+=arr[1])',
      'Step 10: LOOP_ITERATION i=2, sum=15 (after sum+=arr[2])',
      'Step 11: LOOP_EXIT',
      'Step 12: OUTPUT sum=15',
      'Step 13: PROGRAM_END',
      '',
      'Now generate the execution script for this code:',
      '```cpp',
      code,
      '```',
    ].join('\n');

    try {
      if (!this.model) {
        try {
          this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (initError) {
          const selected = await this.listAndSelectModel();
          if (!selected) {
            this.aiAvailable = false;
            return fallback();
          }
          this.model = this.genAI.getGenerativeModel({ model: selected });
          this.modelName = selected;
        }
      }

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      let text = response.text().trim();

      if (text.startsWith('```json')) {
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (text.startsWith('```')) {
        text = text.replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        console.warn('⚠️ AI returned empty steps, using fallback');
        return fallback();
      }
      
      parsed.mode = parsed.mode || 'ai-generated';
      parsed.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.85;
      parsed.summary = parsed.summary || {};
      
      console.log(`✅ AI generated ${parsed.steps.length} execution steps`);
      return parsed;
    } catch (error) {
      console.error('❌ Action script generation failed:', error?.message || error);
      this.aiAvailable = false;
      return fallback();
    }
  }

  fallbackClassification(code) {
    let dataStructure = 'ARRAY';
    let algorithm = 'Unknown';

    if (/struct\s+Node.*\*next/i.test(code)) dataStructure = 'LINKED_LIST';
    else if (/struct\s+TreeNode.*\*left.*\*right/i.test(code)) dataStructure = 'BINARY_TREE';
    else if (/vector.*push_back|int\s+\w+\[\]/i.test(code)) dataStructure = 'ARRAY';
    else if (/stack<|\.push\(.*\.pop\(/i.test(code)) dataStructure = 'STACK';
    else if (/queue<|\.push\(.*\.front\(/i.test(code)) dataStructure = 'QUEUE';
    else if (/adjacency|graph|edge/i.test(code)) dataStructure = 'GRAPH';
    else if (/unordered_map|hash/i.test(code)) dataStructure = 'HASH_TABLE';
    else if (/trie|prefix/i.test(code)) dataStructure = 'TRIE';
    else if (/heap|priority_queue/i.test(code)) dataStructure = 'HEAP';
    else if (/jug|water|pour/i.test(code)) dataStructure = 'WATER_JUG';

    if (/bfs|breadth.*first/i.test(code)) algorithm = 'BFS';
    else if (/dfs|depth.*first/i.test(code)) algorithm = 'DFS';
    else if (/quicksort|quick.*sort/i.test(code)) algorithm = 'QuickSort';
    else if (/mergesort|merge.*sort/i.test(code)) algorithm = 'MergeSort';
    else if (/dijkstra/i.test(code)) algorithm = 'Dijkstra';
    else if (/binary.*search/i.test(code)) algorithm = 'Binary Search';

    const archetype = this.archetypeMap[dataStructure] || this.archetypeMap.ARRAY;
    return {
      dataStructure,
      algorithm,
      visualArchetype: archetype,
      complexity: { time: 'O(n)', space: 'O(1)' },
      metadata: {
        hasPointers: /\*/.test(code),
        hasRecursion: /\w+\s*\([^)]*\)\s*\{[^}]*\1\s*\(/i.test(code),
        hasLoops: /for\s*\(|while\s*\(/i.test(code),
        maxDepth: 10,
        nodeCount: 20,
        edgeCount: 0,
        isProblemSolving: false,
        keyVariables: [],
        criticalLines: [],
        errorProne: ['arrayBounds', 'nullPointer'],
      },
      visualizationHints: {
        cameraAngle: 'isometric',
        colorScheme: 'vibrant',
        animationSpeed: 'medium',
        showConnections: true,
        highlightCriticalPath: false,
      },
    };
  }

  classifyError(errorType) {
    const errorVisuals = {
      SEGFAULT: { animation: 'pointerCrashExplosion', particles: 'confetti', sound: 'crash', message: '💥 Oops! Segmentation Fault - Pointer went wild!', color: '#FF4444' },
      OUT_OF_BOUNDS: { animation: 'arrayBoundaryCollision', particles: 'sparks', sound: 'bonk', message: '🚧 Index Out of Bounds - Stay within the lines!', color: '#FF9944' },
      STACK_OVERFLOW: { animation: 'stackCollapse', particles: 'fallingBlocks', sound: 'collapse', message: '📚 Stack Overflow - Too much recursion!', color: '#9944FF' },
      NULL_POINTER: { animation: 'voidSuction', particles: 'swirl', sound: 'whoosh', message: '🕳️ Null Pointer - Pointing to nothing!', color: '#444444' },
      DIVISION_BY_ZERO: { animation: 'universeImplosion', particles: 'blackhole', sound: 'implode', message: '∞ Division by Zero - Math broke!', color: '#FF44FF' },
      OVERFLOW: { animation: 'waterSpill', particles: 'waterDroplets', sound: 'splash', message: '💧 Overflow - The cup runneth over!', color: '#4444FF' },
    };

    return errorVisuals[errorType] || errorVisuals.SEGFAULT;
  }
}