import clsx from 'clsx';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import styles from './styles.module.css';

export default function QuickStart(): JSX.Element {
  return (
    <section className={styles.quickstart}>
      <div className="container">
        <div className={styles.quickstartHeader}>
          <h2>Start building in seconds</h2>
          <p>Everything you need to build collaborative, offline-capable apps.</p>
        </div>
        
        <Tabs defaultValue="basic" className={styles.codeTabs}>
            <TabItem value="basic" label="Define & Store" default>
              <CodeBlock language="typescript">
{`// Define your data structure
const TodoSchema = {
  ns: 'todo',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
    createdAt: { type: 'date', default: () => new Date() }
  }
} as const;

// Create a todo - it's instantly available
const todo = db.create('/data/todos/task1', TodoSchema, {
  text: 'Review pull requests'
});

// Update it - changes are immediate
todo.set('done', true);

// Delete it - no await needed
todo.isDeleted = true;`}
              </CodeBlock>
            </TabItem>
            
            <TabItem value="react" label="React Integration">
              <CodeBlock language="tsx">
{`// Your UI stays in sync automatically
function TodoList() {
  // This query updates when ANY peer makes changes
  const todos = useQuery({
    source: '/data/todos',
    schema: TodoSchema,
    predicate: ({ item }) => !item.get('done'),
    sortBy: 'createdAt'
  });

  return todos.results().map(todo => (
    <TodoItem key={todo.path} path={todo.path} />
  ));
}

function TodoItem({ path }: { path: string }) {
  // This hook gives you a live, editable object
  const todo = useItem(path);
  
  return (
    <label>
      <input
        type="checkbox"
        checked={todo?.get('done') ?? false}
        onChange={(e) => todo?.set('done', e.target.checked)}
      />
      {todo?.get('text')}
    </label>
  );
}`}
              </CodeBlock>
            </TabItem>
            
            <TabItem value="sync" label="Multiplayer">
              <CodeBlock language="typescript">
{`// Collaborative whiteboard with automatic merging
const WhiteboardSchema = {
  ns: 'whiteboard',
  version: 1,
  fields: {
    title: { type: 'string', required: true },
    shapes: { type: 'set' },        // Merge-friendly set
    connectedUsers: { type: 'map' }, // Merge-friendly map
    tags: { type: 'set' }
  }
} as const;

// User A draws a circle (on laptop)
const board = db.item('/data/whiteboards/brainstorm');
board.set('shapes', board.get('shapes').add({
  id: 'circle-1',
  type: 'circle',
  x: 100, y: 200
}));

// User B draws a square at same time (on tablet, offline)
board.set('shapes', board.get('shapes').add({
  id: 'square-1', 
  type: 'square',
  x: 150, y: 250
}));

// Both users add different tags simultaneously
// User A: board.set('tags', board.get('tags').add('urgent'));
// User B: board.set('tags', board.get('tags').add('design'));

// When they sync:
// ✅ Both shapes appear - no overwrites
// ✅ Both tags are present: Set {'urgent', 'design'}
// ✅ Cursor positions update in real-time via the map
// ✅ No conflict dialogs - additions always win

// The magic: Sets and maps merge like Git branches - intelligently combining changes.
// Unlike last-write-wins, everyone's additions are preserved.`}
              </CodeBlock>
            </TabItem>
          </Tabs>
      </div>
    </section>
  );
}