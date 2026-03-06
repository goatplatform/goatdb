import React from 'react';
import CodeBlock from '@theme/CodeBlock';
import styles from './styles.module.css';

const STEP1 = `const TodoSchema = {
  ns: 'todo',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
    createdAt: { type: 'date', default: () => new Date() }
  }
} as const;

const todo = db.create('/data/todos/task1', TodoSchema, {
  text: 'Review pull requests'
});
todo.set('done', true);`;

const STEP2 = `function TodoList() {
  const todos = useQuery({
    source: '/data/todos',
    schema: TodoSchema,
    predicate: ({ item }) => !item.get('done'),
    sortBy: 'createdAt'
  });

  return todos.results().map(todo => (
    <TodoItem key={todo.path} path={todo.path} />
  ));
}`;

const STEP4 = `const task = db.create('/data/tasks/plan-1', TaskSchema, {
  title: 'Analyze Q4 metrics',
  status: 'pending',
  assignedAgent: session.id
});
task.set('status', 'complete');`;

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
    description: 'Declare your schema and write data locally — no await, no round trips.',
    code: STEP1,
    lang: 'typescript',
  },
  {
    num: 2,
    title: 'Query live',
    description: 'React hooks that re-render whenever data changes, from any peer.',
    code: STEP2,
    lang: 'tsx',
  },
  {
    num: 3,
    title: 'It just syncs',
    description:
      'Offline edits, concurrent users, multiple devices — changes merge automatically using Git-style three-way merge. Sets and maps combine additions from all peers. No conflict dialogs. Ever.',
  },
  {
    num: 4,
    title: 'Built for AI agents',
    description:
      'Give agents resilient state that follows them across devices. From cloud to edge — one cryptographically signed data layer.',
    code: STEP4,
    lang: 'typescript',
  },
];

export default function QuickStart(): React.JSX.Element {
  return (
    <section className={styles.quickstart}>
      <div className='container'>
        <div className={styles.quickstartHeader}>
          <h2>Start building in seconds</h2>
          <p>Everything you need to build collaborative, offline-capable apps.</p>
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
