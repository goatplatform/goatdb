import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure
  docsSidebar: [
    // GETTING STARTED (Progressive onboarding)
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
        // Start with overview
        'api/index',

        // ESSENTIALS - Most commonly used APIs
        {
          type: 'category',
          label: 'Essentials',
          collapsed: false,
          items: [
            'api/classes/goatdb',
            'api/classes/manageditem',
            'api/classes/query',
            'api/classes/dataregistry',
          ],
        },

        // CORE CLASSES
        {
          type: 'category',
          label: 'Core Classes',
          collapsed: true,
          items: [
            'api/classes/emitter',
            'api/classes/item',
            'api/classes/repository',
            'api/classes/consolelogstream',
            'api/classes/jsonlogstream',
          ],
        },

        // SERVER & DEPLOYMENT
        {
          type: 'category',
          label: 'Server & Deployment',
          collapsed: true,
          items: [
            'api/classes/server',
            'api/interfaces/serveroptions',
            'api/interfaces/serverservices',
            'api/functions-server',
            'api/types/domainconfig',
            'api/types/appconfig',
            'api/types/compileoptions',
            'api/types/debugserveroptions',
            'api/types/executableoptions',
            'api/types/livereloadoptions',
            'api/types/cpuarch',
            'api/types/targetos',
            'api/types/emailbuilder',
            'api/types/emailinfo',
          ],
        },

        // REACT INTEGRATION
        {
          type: 'category',
          label: 'React Integration',
          collapsed: true,
          items: [
            'api/functions-react',
            'api/interfaces/usequeryopts',
            'api/types/useitemopts',
            'api/types/propswithpath',
          ],
        },

        // CORE INTERFACES & TYPES
        {
          type: 'category',
          label: 'Core Interfaces & Types',
          collapsed: true,
          items: [
            // Essential interfaces
            'api/interfaces/dbinstanceconfig',
            'api/interfaces/coreobject',
            'api/interfaces/coreoptions',
            'api/types/queryconfig',
            'api/interfaces/jsonobject',
            'api/interfaces/readonlyitem',
            'api/interfaces/readonlyjsonobject',
            'api/interfaces/logstream',
            'api/interfaces/buildinfo',

            // Behavioral interfaces
            'api/interfaces/comparable',
            'api/interfaces/equatable',
            'api/interfaces/clonable',
            'api/interfaces/encodable',
            'api/interfaces/encoder',

            // Core value types
            'api/types/corevalue',
            'api/types/concretecorevalue',
            'api/types/corearray',
            'api/types/coredictionary',
            'api/types/coreclassobject',
            'api/types/coreset',
            'api/types/corekey',
            'api/types/readonlycoreobject',
            'api/types/readonlycorearray',

            // Database types
            'api/types/dbreadystate',
          ],
        },

        // SCHEMA & VALIDATION
        {
          type: 'category',
          label: 'Schema & Validation',
          collapsed: true,
          items: [
            'api/types/schema',
            'api/types/fielddef',
            'api/types/fieldvalue',
            'api/types/schemadatatype',
            'api/types/schemafield',
            'api/types/schemafieldsdef',
            'api/types/schemanulltype',
            'api/types/schemaoptionalfields',
            'api/types/schemarequiredfields',
            'api/types/schematypesession',
            'api/types/schematypeuserstats',
            'api/types/schemavaluewithoptional',
          ],
        },

        // AUTHENTICATION & AUTHORIZATION
        {
          type: 'category',
          label: 'Authentication & Authorization',
          collapsed: true,
          items: [
            'api/classes/trustpool',
            'api/types/authconfig',
            'api/types/authop',
            'api/types/authrule',
            'api/types/authruleinfo',
          ],
        },

        // UTILITIES & HELPERS
        {
          type: 'category',
          label: 'Utilities & Helpers',
          collapsed: true,
          items: [
            'api/functions-core',
            'api/interfaces/corevaluecloneopts',
            'api/types/iterablefilterfunc',
            'api/types/objfieldsfilterfunc',
          ],
        },
      ],
    },

    // REFERENCE & SUPPORT
    'benchmarks',
    'faq',
    'contributing',
  ],
};

export default sidebars;
