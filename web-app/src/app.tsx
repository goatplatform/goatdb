import React, { useRef } from 'react';
import { createUseStyles } from 'react-jss';
import { useDB, useDBReady, useQuery } from '../../react/db.tsx';
import { kSchemaTask } from './schemas.ts';
import setupSchemas from './schemas.ts';
import { coreValueCompare } from '../../base/core-types/comparable.ts';

setupSchemas();

const useAppStyles = createUseStyles({
  app: {},
  task: {
    border: '1px solid black',
  },
});

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

export function Contents() {
  const styles = useAppStyles();
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
      {query.results().map(({ key, item }) => (
        <div key={key} className={styles.task}>
          {item.get('text')}
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
