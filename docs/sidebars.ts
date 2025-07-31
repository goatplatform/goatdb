import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure
  docsSidebar: [
    // GETTING STARTED (Progressive onboarding)
    'index',
    'installation',
    'tutorial',
    
    // CORE CONCEPTS (Foundation knowledge)
    'concepts',
    'architecture',
    'schema',
    
    // PRACTICAL GUIDES (How-to documentation)
    'reading-and-writing-data',
    'query',
    'react',
    'repositories',
    'sessions',
    'authorization-rules',
    'sync',
    
    // ADVANCED TOPICS (Deep dives)
    'conflict-resolution',
    'commit-graph',
    'order-stamps',
    
    // API REFERENCE
    {
      type: 'category',
      label: 'API Reference',
      collapsed: true,
      items: [
        // Start with overview/index
        'api/index',
        
        // ESSENTIALS - Most commonly used APIs first
        {
          type: 'category',
          label: 'Essentials',
          collapsed: true,
          items: [
            'api/classes/goatdb',
            'api/classes/manageditem', 
            'api/classes/query',
            'api/classes/dataregistry',
          ],
        },
        
        // REACT INTEGRATION - Popular for frontend developers
        {
          type: 'category',
          label: 'React Integration',
          collapsed: true,
          items: [
            'api/functions-react',
            'api/interfaces/usequeryopts',
          ],
        },
        
        // CORE CLASSES - Organized by inheritance hierarchy
        {
          type: 'category',
          label: 'Core Classes',
          collapsed: true,
          items: [
            'api/classes/emitter',          // Base class first
            'api/classes/item',             // Data structures
            'api/classes/repository',       // Storage layer
          ],
        },
        
        // SERVER & DEPLOYMENT - For backend/production use
        {
          type: 'category',
          label: 'Server & Deployment',
          collapsed: true,
          items: [
            'api/classes/server',
            'api/functions-server',
          ],
        },
        
        // UTILITIES & HELPERS - Supporting functions
        {
          type: 'category',
          label: 'Utilities & Helpers',
          collapsed: true,
          items: [
            'api/functions-core',
            'api/classes/consolelogstream',
            'api/classes/jsonlogstream',
          ],
        },
        
        // INTERFACES & TYPES - Type definitions organized by domain
        {
          type: 'category',
          label: 'Interfaces & Types',
          collapsed: true,
          items: [
            {
              type: 'category',
              label: 'Core Types',
              collapsed: true,
              items: [
                'api/interfaces/coreobject',
                'api/interfaces/coreoptions',
                'api/interfaces/corevaluecloneopts',
                'api/interfaces/jsonobject',
                'api/interfaces/readonlyitem',
                'api/interfaces/readonlyjsonobject',
              ],
            },
            {
              type: 'category',
              label: 'Behaviors',
              collapsed: true,
              items: [
                'api/interfaces/comparable',
                'api/interfaces/equatable',
                'api/interfaces/clonable',
                'api/interfaces/encodable',
                'api/interfaces/encoder',
              ],
            },
            {
              type: 'category',
              label: 'System',
              collapsed: true,
              items: [
                'api/interfaces/buildinfo',
                'api/interfaces/logstream',
              ],
            },
          ],
        },
      ],
    },
    
    // REFERENCE & SUPPORT
    'benchmarks',
    'faq',
  ],
};

export default sidebars;
