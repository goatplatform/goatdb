import React, { useRef, useState } from 'react';
import { useDB, useDBReady, useItem, useQuery } from '../../react/db.tsx';
import { kSchemaTask, type SchemaTypeTask } from './schemas.ts';
import setupSchemas from './schemas.ts';

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
  // Updating the item automatically triggers remote updates in realtime
  return (
    <div>
      <input
        type="checkbox"
        checked={task.get('done')}
        onChange={(event) => task.set('done', event.target.checked)}
      />
      <input
        type="text"
        value={task.get('text')}
        onChange={(event) => task.set('text', event.target.value)}
      />
      <button
        onClick={() => {
          task.isDeleted = true;
        }}
      >
        Delete
      </button>
    </div>
  );
}

export function Contents() {
  const [showChecked, setShowChecked] = useState(true);
  // Open a query that fetches all tasks sorted by their texts.
  // The hook will automatically trigger a re-render when changes are made
  // either locally or by remote users.
  const query = useQuery({
    schema: kSchemaTask,
    source: '/data/tasks',
    // Predicate and sort descriptor are expressed as plain functions. GoatDB
    // will automatically re-evaluate the query when the function changes.
    sortDescriptor: ({ left, right }) =>
      left.get('text').localeCompare(right.get('text')),
    // Wheen feeding a predicate with external state, use the optional ctx value
    predicate: ({ item, ctx }) => !item.get('done') || ctx.showChecked,
    // When set to true, the query will update with intermittent results as it
    // scans its source resulting in a more responsive UI
    showIntermittentResults: true,
    ctx: {
      showChecked,
    },
  });
  return (
    <div>
      <Header />
      <div>
        <span>Show Checked</span>
        <input
          type="checkbox"
          checked={showChecked}
          onChange={(event) => setShowChecked(event.target.checked)}
        />
      </div>
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
