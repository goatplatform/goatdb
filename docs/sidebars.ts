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
        
        // SCHEMA & TYPES - Core type system
        {
          type: 'category',
          label: 'Schema & Types',
          collapsed: true,
          items: [
            'api/types/schema',
            'api/types/fielddef',
            'api/types/schemafieldsdef',
            'api/types/schemadatatype',
            'api/types/schemafield',
            'api/types/fieldvalue',
            'api/functions-schema',
          ],
        },

        // COMPREHENSIVE API REFERENCE - All interfaces, types, and remaining classes
        {
          type: 'category',
          label: 'Database & Configuration',
          collapsed: true,
          items: [
            'api/interfaces/dbinstanceconfig',
            'api/interfaces/coreoptions',
            'api/interfaces/session',
            'api/interfaces/ownedsession',
            'api/interfaces/encodedsession',
            'api/interfaces/encodedownedsession',
            'api/interfaces/repositoryconfig',
            'api/interfaces/repostorage',
            'api/classes/memrepostorage',
            'api/types/dbmode',
            'api/types/dbreadystate',
            'api/types/openoptions',
            'api/functions-session',
          ],
        },
        {
          type: 'category',
          label: 'Rich Text System',
          collapsed: true,
          items: [
            // Core rich text types
            'api/interfaces/richtextvalue',
            'api/interfaces/elementnode',
            'api/interfaces/textnode',
            'api/interfaces/nodewithdirection',
            'api/interfaces/richtext',
            'api/interfaces/point',
            'api/interfaces/pointer',
            'api/types/treenode',
            'api/types/pointertype',
            'api/types/markupelement',
            'api/types/markupnode',
            // Rich text elements
            'api/interfaces/paragraphnode',
            'api/interfaces/header1node',
            'api/interfaces/header2node',
            'api/interfaces/header3node',
            'api/interfaces/header4node',
            'api/interfaces/header5node',
            'api/interfaces/header6node',
            'api/interfaces/orderedlistnode',
            'api/interfaces/unorderedlistnode',
            'api/interfaces/listitemnode',
            'api/interfaces/tablenode',
            'api/interfaces/tablerownode',
            'api/interfaces/tablecellnode',
            'api/interfaces/spannode',
            'api/interfaces/hyperlinknode',
            'api/interfaces/imagenode',
            'api/interfaces/objectnode',
            'api/interfaces/inlinetasknode',
            'api/interfaces/mentionelement',
            'api/interfaces/refnode',
            'api/interfaces/refmarker',
            'api/functions-tree',
          ],
        },
        {
          type: 'category',
          label: 'Query System',
          collapsed: true,
          items: [
            'api/classes/querypersistence',
            'api/interfaces/querycache',
            'api/interfaces/encodedquerycache',
            'api/interfaces/querypersistencestorage',
            'api/types/queryconfig',
            'api/types/querysource',
            'api/types/queryevent',
            'api/types/predicate',
            'api/types/predicateinfo',
            'api/types/sortdescriptor',
            'api/types/sortinfo',
            'api/functions-query',
          ],
        },
        {
          type: 'category',
          label: 'Repository & Commits',
          collapsed: true,
          items: [
            'api/classes/commit',
            'api/interfaces/commitconfig',
            'api/interfaces/commitdecoderconfig',
            'api/interfaces/commitgraph',
            'api/interfaces/commitserializeoptions',
            'api/interfaces/encodedrepocache',
            'api/types/commitcontents',
            'api/types/commitresolver',
            'api/types/repositoryevent',
            'api/types/eventnewcommit',
            'api/types/eventnewcommitsync',
            'api/types/eventdocumentchanged',
            'api/types/eventuserchanged',
            'api/types/syncresult',
            'api/functions-commit',
          ],
        },
        {
          type: 'category',
          label: 'Core Type System',
          collapsed: true,
          items: [
            // Core interfaces
            'api/interfaces/coreobject',
            'api/interfaces/corevaluecloneopts',
            'api/interfaces/jsonobject',
            'api/interfaces/readonlyitem',
            'api/interfaces/readonlyjsonobject',
            // Core types
            'api/types/corevalue',
            'api/types/concretecorevalue',
            'api/types/corearray',
            'api/types/coredictionary', 
            'api/types/coreclassobject',
            'api/types/coreset',
            'api/types/corekey',
            'api/types/readonlycoreobject',
            'api/types/readonlycorearray',
            'api/types/readonlydecodedarray',
            'api/types/readonlydecodedobject',
            // JSON types
            'api/types/jsonvalue',
            'api/types/jsonarray',
            'api/types/readonlyjsonvalue',
            'api/types/readonlyjsonarray',
            'api/types/encodedjsonvalue',
            'api/functions-core',
          ],
        },
        {
          type: 'category',
          label: 'Encoding & Serialization',
          collapsed: true,
          items: [
            // Classes
            'api/classes/baseencoder',
            'api/classes/jsonbaseencoder',
            'api/classes/checksumencoder',
            'api/classes/md5checksum',
            'api/classes/murmur3checksum',
            // Interfaces
            'api/interfaces/encodable',
            'api/interfaces/encoder',
            'api/interfaces/decodable',
            'api/interfaces/decoder',
            'api/interfaces/checksumencoderopts',
            'api/interfaces/constructordecoderconfig',
            'api/interfaces/encodedencodable',
            'api/interfaces/encodedchange',
            'api/interfaces/encodeddate',
            'api/interfaces/encodedset',
            'api/interfaces/encodedbloomfilter',
            'api/interfaces/serializevaluetypeoptions',
            // Types
            'api/types/decodablekey',
            'api/types/decodedvalue',
            'api/types/entry',
            'api/functions-base-encoder',
          ],
        },
        {
          type: 'category',
          label: 'Change Tracking & Diffs',
          collapsed: true,
          items: [
            'api/classes/change',
            'api/interfaces/changevalueconfig',
            'api/interfaces/deltacontents',
            'api/interfaces/doccontents',
            'api/interfaces/ivaluetypeoperations',
            'api/interfaces/valuetypeoptions',
            'api/types/changetype',
            'api/types/valuetype',
          ],
        },
        {
          type: 'category',
          label: 'Bloom Filters & Indexing',
          collapsed: true,
          items: [
            'api/classes/bloomfilter',
            'api/interfaces/bloomfilterdecoderconfig',
            'api/interfaces/bloomfilteroptions',
            'api/interfaces/murmur3opts',
            'api/interfaces/signature',
          ],
        },
        {
          type: 'category',
          label: 'Server & Networking',
          collapsed: true,
          items: [
            'api/interfaces/serveroptions',
            'api/interfaces/serverservices',
            'api/interfaces/middleware',
            'api/interfaces/endpoint',
            'api/types/debugserveroptions',
            'api/types/livereloadoptions',
            'api/types/domainconfig',
            'api/types/emailbuilder',
            'api/types/emailinfo',
            'api/types/autocreateuserinfo',
          ],
        },
        {
          type: 'category',
          label: 'Build & Deployment',
          collapsed: true,
          items: [
            'api/interfaces/buildinfo',
            'api/types/builderinfo',
            'api/types/compileoptions',
            'api/types/executableoptions',
            'api/types/cpuarch',
            'api/types/targetos',
            'api/functions-build-info',
          ],
        },
        {
          type: 'category',
          label: 'Authentication & Security',
          collapsed: true,
          items: [
            'api/classes/trustpool',
            'api/types/appconfig',
            'api/types/authconfig',
            'api/types/authrule',
            'api/types/authruleinfo',
            'api/types/authop',
            'api/types/schematypesession',
            'api/types/schematypeuserstats',
            'api/types/schemavaluewithoptional',
          ],
        },
        {
          type: 'category',
          label: 'Timers & Scheduling',
          collapsed: true,
          items: [
            'api/classes/basetimer',
            'api/classes/basedynamictimer',
            'api/classes/simpletimer',
            'api/classes/microtasktimer',
            'api/classes/nexteventloopcycletimer',
            'api/classes/easeinexpotimer',
            'api/classes/easeinoutsinetimer',
            'api/interfaces/timer',
            'api/interfaces/timercallback',
          ],
        },
        {
          type: 'category',
          label: 'Utilities & Behaviors',
          collapsed: true,
          items: [
            'api/interfaces/comparable',
            'api/interfaces/equatable',
            'api/interfaces/clonable',
            'api/interfaces/logstream',
            'api/types/iterablefilterfunc',
            'api/types/objfieldsfilterfunc',
            'api/types/propswithpath',
            'api/types/useitemopts',
            'api/functions-common',
            'api/functions-index',
            'api/functions-model',
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
