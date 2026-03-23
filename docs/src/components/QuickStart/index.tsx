import React from 'react';
import CodeBlock from '@theme/CodeBlock';
import styles from './styles.module.css';

const STEP1 = `const AgentMemorySchema = {
  ns: 'agent-memory',
  version: 1,
  fields: {
    observation: { type: 'string', required: true },
    confidence:  { type: 'number', default: () => 0.5 },
    source:      { type: 'string', required: true },
    recordedAt:  { type: 'date',   default: () => new Date() }
  }
} as const;

// Create a memory item — source identifies which agent wrote it
const mem = db.create('/data/memories/pref-1', AgentMemorySchema, {
  observation: 'User prefers concise responses',
  confidence: 0.9,
  source: 'preference-agent'
});`;

const STEP2 = `// Warm query runs in microseconds — data is already in memory
const memories = db.query({
  source: '/data/memories',
  schema: AgentMemorySchema,
  predicate: ({ item }) => item.get('confidence') > 0.7,
  sortBy: 'recordedAt'
});

// In React: const memories = useQuery(db, { source: '/data/memories', ... });
// Results auto-update when data changes
for (const mem of memories.results()) {
  console.log(mem.get('observation'));
}`;

const STEP3 = `// Agent A — offline, updates confidence
mem.set('confidence', 0.95);

// Agent B — offline, same item, updates observation
mem.set('observation', 'User prefers bullet points over paragraphs');

// Both reconnect — GoatDB merges automatically.
// Result: confidence = 0.95, observation = 'User prefers bullet points...'`;

const STEP4 = `// Every write is signed automatically with Ed25519
const task = db.create('/data/tasks/plan-1', TaskSchema, {
  title: 'Analyze Q4 metrics',
  assignedTo: 'analytics-agent',
  status: 'pending'
});
task.set('status', 'complete');

// Verify which agent wrote what, cryptographically
task.commit.session; // Ed25519 session that signed this commit`;

interface Step {
  num: number;
  title: string;
  description: string;
  code?: string;
  lang?: string;
}

const STEPS: Step[] = [
  {
    num: 1,
    title: 'Define & create',
    description:
      'TypeScript schemas. No SQL, no migrations, no ORM. The source field lets you track which agent instance wrote each memory.',
    code: STEP1,
    lang: 'typescript',
  },
  {
    num: 2,
    title: 'Query live',
    description:
      'After the first scan, queries update incrementally — no re-query, no polling. In React, wrap any query with useQuery() for automatic re-renders on data changes — no useEffect, no subscriptions, no cleanup. Same predicate API on Deno, Node.js, and the browser.',
    code: STEP2,
    lang: 'typescript',
  },
  {
    num: 3,
    title: 'It just syncs',
    description:
      'Concurrent agents, multiple devices, offline edits — everything merges automatically with Git-style three-way merge. No conflict-resolution code to write.',
    code: STEP3,
    lang: 'typescript',
  },
  {
    num: 4,
    title: 'Signed by default',
    description:
      'Every commit is cryptographically signed with Ed25519. Verify which agent wrote what, build audit trails, or enforce authorization — without trusting the server.',
    code: STEP4,
    lang: 'typescript',
  },
];

export default function QuickStart(): React.JSX.Element {
  return (
    <section className={styles.quickstart} id='quickstart'>
      <div className='container'>
        <div className={styles.quickstartHeader}>
          <h2>Four steps. That&apos;s the whole API.</h2>
          <p>
            Define, query, sync, verify. No migrations. No ORM. No glue code.
          </p>
        </div>

        <div className={styles.steps}>
          {STEPS.map((step) => (
            <div key={step.num} className={styles.step}>
              <div className={styles.stepMeta}>
                <span className={styles.stepNumber}>{step.num}</span>
                <div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepDescription}>{step.description}</p>
                </div>
              </div>
              {step.code && (
                <CodeBlock language={step.lang}>{step.code}</CodeBlock>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
