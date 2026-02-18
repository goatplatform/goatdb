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
    'server-logic',

    // ADVANCED TOPICS (Deep dives)
    'conflict-resolution',
    'commit-graph',
    'order-stamps',

    // REFERENCE & SUPPORT
    'benchmarks',
    'faq',
    'contributing',
  ],
};

export default sidebars;
