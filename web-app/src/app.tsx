import React, { useRef } from 'react';
import { useDB, useDBReady, useItem, useQuery } from '../../react/db.tsx';
import { kSchemaTask, type SchemaTypeTask } from './schemas.ts';
import setupSchemas from './schemas.ts';
import { coreValueCompare } from '../../base/core-types/comparable.ts';

// This is only temporary. In the near future schemas will be auto-registered
// without an explicity call.
setupSchemas();

export function Header() {
  const db = useDB();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input type="text" ref={ref}></input>
      <button
        onClick={() => {
          // Create a new task at the tasks repository. It'll automatically
          // trigger the query below and update the list
          db.create('/data/tasks', kSchemaTask, {
            text: ref.current!.value,
          });
        }}
      >
        Add
      </button>
    </div>
  );
}

export type TaskItemProps = {
  path: string;
};
export function TaskItem({ path }: TaskItemProps) {
  // By calling the useItem() hook we ensure this component will rerender
  // whenever our task changes.
  const task = useItem<SchemaTypeTask>(path);
  return (
    <input
      type="text"
      value={task.get('text')}
      // Updating the item automatically triggers remote updates in realtime
      onChange={(event) => task.set('text', event.target.value)}
    />
  );
}

export function Contents() {
  // Open a query that fetches all tasks sorted by their texts.
  // The hook will automatically trigger a re-render when changes are made
  // either locally or by remote users.
  const query = useQuery({
    schema: kSchemaTask,
    source: '/data/tasks',
    sortDescriptor: ({ left, right }) =>
      coreValueCompare(left.get('text'), right.get('text')),
    // When set to true, the query will update with intermittent results as it
    // scans its source resulting in a more responsive UI
    showIntermittentResults: true,
  });
  return (
    <div>
      <Header />
      {query.results().map(({ path }) => (
        <div key={path}>
          <TaskItem path={path} />
        </div>
      ))}
    </div>
  );
}

export function App() {
  const ready = useDBReady();
  // Handle initial loading phase
  if (ready === 'loading') {
    return <div>Loading...</div>;
  }
  if (ready === 'error') {
    return <div>Error! Please reload the page.</div>;
  }
  // Once  loaded, continue to the contents of the app
  return <Contents />;
}
