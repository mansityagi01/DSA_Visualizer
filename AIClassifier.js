import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIClassifier {
  constructor() {
    // Initialize Gemini API - in production, use environment variable
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyBfPtiYOJ5RRMqOrn59HY7S7e1F0_Yfpm0';
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Defer creating the model until classify() to avoid throwing in constructor
    this.model = null;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.aiAvailable = true; // will be set to false if model init fails
    this._modelsListCached = null;
    
    // Visual archetype mapping for different data structures 
    this.archetypeMap = {
      'ARRAY': {
        mesh: 'trainCoaches',
        layout: 'linear',
        animation: 'slideTransition',
        physics: 'rigid',
        errorStyle: 'explosion'
      },
      'LINKED_LIST': {
        mesh: 'capsuleChain',
        layout: 'serpentine',
        animation: 'flowingChain',
        physics: 'rope',
        errorStyle: 'chainBreak'
      },
      'STACK': {
        mesh: 'plateStack',
        layout: 'vertical',
        animation: 'stackPop',
        physics: 'balanced',
        errorStyle: 'towerCollapse'
      },
      'QUEUE': {
        mesh: 'conveyorBelt',
        layout: 'horizontal',
        animation: 'beltFlow',
        physics: 'continuous',
        errorStyle: 'jammedBelt'
      },
      'BINARY_TREE': {
        mesh: 'organicTree',
        layout: 'hierarchical',
        animation: 'growingBranches',
        physics: 'swaying',
        errorStyle: 'fallingLeaves'
      },
      'GRAPH': {
        mesh: 'forceDirectedNodes',
        layout: 'forceDirected3D',
        animation: 'springPhysics',
        physics: 'magneticNodes',
        errorStyle: 'nodeExplosion'
      },
      'HASH_TABLE': {
        mesh: 'bucketGrid',
        layout: 'grid',
        animation: 'hashScatter',
        physics: 'floating',
        errorStyle: 'collisionSparks'
      },
      'TRIE': {
        mesh: 'letterTree',
        layout: 'radialTree',
        animation: 'letterFlow',
        physics: 'lightweight',
        errorStyle: 'letterScatter'
      },
      'HEAP': {
        mesh: 'pyramid',
        layout: 'pyramidal',
        animation: 'bubbleUpDown',
        physics: 'weighted',
        errorStyle: 'pyramidCrumble'
      },
      'WATER_JUG': {
        mesh: 'glassJugs',
        layout: 'side-by-side',
        animation: 'liquidFlow',
        physics: 'fluidSimulation',
        errorStyle: 'waterSpill'
      }
    };
  }

  async listAndSelectModel() {
    // Try to list available models and pick one that supports generateContent
    if (!this.genAI) return null;
    if (this._modelsListCached) return this._modelsListCached;

    try {
      if (typeof this.genAI.listModels === 'function') {
        const resp = await this.genAI.listModels();
        const models = resp && resp.models ? resp.models : resp;
        if (Array.isArray(models) && models.length) {
          // Prefer models that include "gemini" in the id, otherwise pick first that seems generative
          let pick = models.find(m => (m.name || m.model || m.id || '').toLowerCase().includes('gemini'))
                    || models.find(m => (m.supportedMethods && m.supportedMethods.includes('generateContent')))
                    || models[0];
          const modelId = pick.name || pick.model || pick.id || pick;
          this._modelsListCached = modelId;
          return modelId;
        }
      }
    } catch (e) {
      console.warn('Could not list models from Gemini API:', e && e.message);
    }

    return null;
  }

  /**
   * Classify C++ code using Gemini AI to determine data structure and visualization strategy
   * @param {string} code - The C++ source code to analyze
   * @returns {Promise<Object>} Classification result with visualization metadata
   */
  async classify(code) {
    const prompt = `
You are an expert C++ algorithm analyzer and 3D visualization architect. Analyze the following C++ code and return a JSON object with EXACT structure (no markdown, no code blocks, pure JSON):

CODE TO ANALYZE:
\`\`\`cpp
${code}
\`\`\`

RETURN FORMAT (strict JSON):
{
  "dataStructure": "ARRAY|LINKED_LIST|STACK|QUEUE|BINARY_TREE|GRAPH|HASH_TABLE|TRIE|HEAP|WATER_JUG|CUSTOM",
  "algorithm": "Name of the algorithm (e.g., BFS, DFS, QuickSort, Dijkstra, etc.)",
  "visualArchetype": "trainCoaches|capsuleChain|forceDirectedNodes|organicTree|etc.",
  "complexity": {
    "time": "O(...)",
    "space": "O(...)"
  },
  "metadata": {
    "hasPointers": true|false,
    "hasRecursion": true|false,
    "hasLoops": true|false,
    "maxDepth": number (estimated max depth for trees/recursion),
    "nodeCount": number (estimated number of nodes/elements),
    "edgeCount": number (for graphs),
    "isProblemSolving": true|false (is this a specific algorithm problem like Water Jug?),
    "keyVariables": ["var1", "var2", ...] (main variables to track),
    "criticalLines": [5, 12, 18] (line numbers with important state changes),
    "errorProne": ["arrayBounds", "nullPointer", "stackoverflow", "overflow"] (potential error types)
  },
  "visualizationHints": {
    "cameraAngle": "top|side|isometric|dynamic",
    "colorScheme": "vibrant|pastel|neon|monochrome",
    "animationSpeed": "slow|medium|fast",
    "showConnections": true|false,
    "highlightCriticalPath": true|false
  }
}

CLASSIFICATION RULES:
1. If code contains arrays or vectors → ARRAY
2. If code has Node* pointers with next/prev → LINKED_LIST
3. If code uses push/pop on one end → STACK
4. If code uses push/pop on different ends → QUEUE
5. If code has TreeNode with left/right children → BINARY_TREE
6. If code has adjacency lists/matrices with multiple connections → GRAPH
7. If code has hash functions or unordered_map → HASH_TABLE
8. If code has character-based tree (words/prefixes) → TRIE
9. If code mentions "heap" or has parent-child index math → HEAP
10. If code mentions "jug" or "water" or "pour" → WATER_JUG

Be precise and return ONLY the JSON object.
`;

    try {
      if (this.aiAvailable && !this.model) {
        try {
          // try configured model first
          this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (initErr) {
          console.warn('⚠️ Gemini model init failed for', this.modelName, initErr && initErr.message);
          // try listing available models and select one
          const sel = await this.listAndSelectModel();
          if (sel) {
            try {
              this.model = this.genAI.getGenerativeModel({ model: sel });
              this.modelName = sel;
              console.log('✅ Switched to model', sel);
            } catch (e2) {
              console.warn('Could not init model from list:', e2 && e2.message);
              this.aiAvailable = false;
              return this.fallbackClassification(code);
            }
          } else {
            this.aiAvailable = false;
            return this.fallbackClassification(code);
          }
        }
      }

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Clean up response (remove markdown code blocks if present)
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/```\n?/g, '');
      }
      
      const classification = JSON.parse(cleanedText);
      
      // Enrich with archetype data
      const archetype = this.archetypeMap[classification.dataStructure] || this.archetypeMap['ARRAY'];
      classification.visualArchetype = archetype;
      
      console.log('🤖 AI Classification Result:', JSON.stringify(classification, null, 2));
      
      return classification;
      
    } catch (error) {
      console.error('❌ AI Classification Error:', error && (error.message || String(error)));
      // Disable AI for this session and fall back to heuristics immediately
      this.aiAvailable = false;
      return this.fallbackClassification(code);
    }
  }

  /**
   * Fallback classification using regex heuristics (if Gemini API fails)
   */
  fallbackClassification(code) {
    let dataStructure = 'ARRAY';
    let algorithm = 'Unknown';
    
    // Heuristic detection
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
    
    // Algorithm detection
    if (/bfs|breadth.*first/i.test(code)) algorithm = 'BFS';
    else if (/dfs|depth.*first/i.test(code)) algorithm = 'DFS';
    else if (/quicksort|quick.*sort/i.test(code)) algorithm = 'QuickSort';
    else if (/mergesort|merge.*sort/i.test(code)) algorithm = 'MergeSort';
    else if (/dijkstra/i.test(code)) algorithm = 'Dijkstra';
    else if (/binary.*search/i.test(code)) algorithm = 'Binary Search';
    
    const archetype = this.archetypeMap[dataStructure];
    
    return {
      dataStructure,
      algorithm,
      visualArchetype: archetype,
      complexity: {
        time: 'O(n)',
        space: 'O(1)'
      },
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
        errorProne: ['arrayBounds', 'nullPointer']
      },
      visualizationHints: {
        cameraAngle: 'isometric',
        colorScheme: 'vibrant',
        animationSpeed: 'medium',
        showConnections: true,
        highlightCriticalPath: false
      }
    };
  }

  /**
   * Analyze runtime errors and suggest visual error representation
   */
  classifyError(errorType, errorMessage, line) {
    const errorVisuals = {
      'SEGFAULT': {
        animation: 'pointerCrashExplosion',
        particles: 'confetti',
        sound: 'crash',
        message: '💥 Oops! Segmentation Fault - Pointer went wild!',
        color: '#FF4444'
      },
      'OUT_OF_BOUNDS': {
        animation: 'arrayBoundaryCollision',
        particles: 'sparks',
        sound: 'bonk',
        message: '🚧 Index Out of Bounds - Stay within the lines!',
        color: '#FF9944'
      },
      'STACK_OVERFLOW': {
        animation: 'stackCollapse',
        particles: 'fallingBlocks',
        sound: 'collapse',
        message: '📚 Stack Overflow - Too much recursion!',
        color: '#9944FF'
      },
      'NULL_POINTER': {
        animation: 'voidSuction',
        particles: 'swirl',
        sound: 'whoosh',
        message: '🕳️ Null Pointer - Pointing to nothing!',
        color: '#444444'
      },
      'DIVISION_BY_ZERO': {
        animation: 'universeImplosion',
        particles: 'blackhole',
        sound: 'implode',
        message: '∞ Division by Zero - Math broke!',
        color: '#FF44FF'
      },
      'OVERFLOW': {
        animation: 'waterSpill',
        particles: 'waterDroplets',
        sound: 'splash',
        message: '💧 Overflow - The cup runneth over!',
        color: '#4444FF'
      }
    };

    return errorVisuals[errorType] || errorVisuals['SEGFAULT'];
  }
}