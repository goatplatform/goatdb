/**
 * Unit tests for the TUI progress tracking module.
 *
 * Tests Task state machine, ProgressManager, and aggregation logic.
 * These tests run without actually rendering to stdout (disabled ProgressManager).
 */

import { TEST } from './mod.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { Task, ProgressManager } from '../shared/progress.ts';

export default function setupProgressTests(): void {
  // ==========================================================================
  // Task State Machine Tests
  // ==========================================================================

  TEST('Progress', 'Task initial state is pending', () => {
    const task = new Task('t1', 'Test Task', 10);
    assertEquals(task.status, 'pending');
    assertEquals(task.current, 0);
  });

  TEST('Progress', 'Task transitions pending to running on first update', () => {
    const task = new Task('t1', 'Test Task', 10);
    assertEquals(task.status, 'pending');
    task.update(5);
    assertEquals(task.status, 'running');
    assertEquals(task.current, 5);
  });

  TEST('Progress', 'Task stays running on subsequent updates', () => {
    const task = new Task('t1', 'Test Task', 10);
    task.update(3);
    assertEquals(task.status, 'running');
    task.update(7);
    assertEquals(task.status, 'running');
    assertEquals(task.current, 7);
  });

  TEST('Progress', 'Task complete transitions to done', () => {
    const task = new Task('t1', 'Test Task', 10);
    task.update(5);
    task.complete('done');
    assertEquals(task.status, 'done');
    // current should be set to total on done completion
    assertEquals(task.current, 10);
  });

  TEST('Progress', 'Task complete transitions to failed', () => {
    const task = new Task('t1', 'Test Task', 10);
    task.update(5);
    task.complete('failed');
    assertEquals(task.status, 'failed');
    // current stays at last value for failed
    assertEquals(task.current, 5);
  });

  TEST('Progress', 'Task update stores message', () => {
    const task = new Task('t1', 'Test Task', 10);
    assertEquals(task.message, '');
    task.update(5, 'processing');
    assertEquals(task.message, 'processing');
    task.update(7, 'finishing');
    assertEquals(task.message, 'finishing');
  });

  TEST('Progress', 'Task update preserves message when undefined', () => {
    const task = new Task('t1', 'Test Task', 10);
    task.update(5, 'initial');
    assertEquals(task.message, 'initial');
    task.update(7); // no message param
    assertEquals(task.message, 'initial');
  });

  // ==========================================================================
  // Task Progress Clamping Tests (I-001)
  // ==========================================================================

  TEST('Progress', 'Task clamps negative current to 0', () => {
    const task = new Task('t1', 'Test Task', 10);
    // Should clamp -5 to 0 and warn
    task.update(-5);
    assertEquals(task.current, 0);
  });

  TEST('Progress', 'Task clamps current above total', () => {
    const task = new Task('t1', 'Test Task', 10);
    // Should clamp 15 to 10 and warn
    task.update(15);
    assertEquals(task.current, 10);
  });

  TEST('Progress', 'Task allows valid range values', () => {
    const task = new Task('t1', 'Test Task', 10);
    task.update(0);
    assertEquals(task.current, 0);
    task.update(5);
    assertEquals(task.current, 5);
    task.update(10);
    assertEquals(task.current, 10);
  });

  TEST('Progress', 'Task with null total allows any current', () => {
    const task = new Task('t1', 'Indeterminate', null);
    task.update(-5);
    assertEquals(task.current, -5); // no clamping for indeterminate
    task.update(1000);
    assertEquals(task.current, 1000);
  });

  // ==========================================================================
  // Task Aggregation Tests
  // ==========================================================================

  TEST('Progress', 'aggregatedProgress returns own progress without children', () => {
    const tasks = new Map<string, Task>();
    const task = new Task('t1', 'Test Task', 10);
    task.update(5);
    tasks.set('t1', task);

    const progress = task.aggregatedProgress(tasks);
    assertEquals(progress, 0.5);
  });

  TEST('Progress', 'aggregatedProgress returns null for indeterminate task', () => {
    const tasks = new Map<string, Task>();
    const task = new Task('t1', 'Indeterminate', null);
    tasks.set('t1', task);

    const progress = task.aggregatedProgress(tasks);
    assertEquals(progress, null);
  });

  TEST('Progress', 'aggregatedProgress returns 1 for zero total', () => {
    const tasks = new Map<string, Task>();
    const task = new Task('t1', 'Empty', 0);
    tasks.set('t1', task);

    const progress = task.aggregatedProgress(tasks);
    assertEquals(progress, 1);
  });

  TEST('Progress', 'aggregatedProgress sums children', () => {
    const tasks = new Map<string, Task>();
    const parent = new Task('p1', 'Parent', 4, null, 0);
    const child1 = new Task('c1', 'Child1', 2, 'p1', 1);
    const child2 = new Task('c2', 'Child2', 2, 'p1', 1);

    parent.addChild('c1');
    parent.addChild('c2');
    child1.update(2); // 2/2 = 100%
    child2.update(1); // 1/2 = 50%

    tasks.set('p1', parent);
    tasks.set('c1', child1);
    tasks.set('c2', child2);

    // Aggregated: (2 + 1) / (2 + 2) = 3/4 = 0.75
    const progress = parent.aggregatedProgress(tasks);
    assertEquals(progress, 0.75);
  });

  TEST('Progress', 'aggregatedProgress returns completion ratio when some children indeterminate', () => {
    const tasks = new Map<string, Task>();
    const parent = new Task('p1', 'Parent', 4, null, 0);
    const child1 = new Task('c1', 'Child1', 2, 'p1', 1);
    const child2 = new Task('c2', 'Child2', null, 'p1', 1); // indeterminate

    parent.addChild('c1');
    parent.addChild('c2');
    child1.update(2);
    child1.complete('done'); // Mark as done

    tasks.set('p1', parent);
    tasks.set('c1', child1);
    tasks.set('c2', child2);

    // With indeterminate children, returns ratio of completed children
    // child1 is done, child2 is pending -> 1/2 = 0.5
    const progress = parent.aggregatedProgress(tasks);
    assertEquals(progress, 0.5);
  });

  // ==========================================================================
  // Task Hierarchy Tests (I-002, I-003)
  // ==========================================================================

  TEST('Progress', 'Task depth 0 when no parent', () => {
    const task = new Task('t1', 'Root', 10, null, 0);
    assertEquals(task.depth, 0);
    assertEquals(task.parentId, null);
  });

  TEST('Progress', 'Task stores parentId and depth', () => {
    const task = new Task('t1', 'Child', 10, 'parent1', 2);
    assertEquals(task.depth, 2);
    assertEquals(task.parentId, 'parent1');
  });

  TEST('Progress', 'Task addChild maintains children array', () => {
    const parent = new Task('p1', 'Parent', 10);
    assertEquals(parent.children.length, 0);
    parent.addChild('c1');
    parent.addChild('c2');
    assertEquals(parent.children.length, 2);
    assertTrue(parent.children.includes('c1'));
    assertTrue(parent.children.includes('c2'));
  });

  // ==========================================================================
  // ProgressManager Tests
  // ==========================================================================

  TEST('Progress', 'ProgressManager create returns unique TaskIds', () => {
    const pm = new ProgressManager(false); // disabled to avoid output
    const id1 = pm.create('Task 1', 10);
    const id2 = pm.create('Task 2', 10);
    assertTrue(id1 !== id2);
    assertTrue(id1.startsWith('task-'));
    assertTrue(id2.startsWith('task-'));
  });

  TEST('Progress', 'ProgressManager create with parent establishes hierarchy', () => {
    const pm = new ProgressManager(false);
    const parentId = pm.create('Parent', 10);
    const childId = pm.create('Child', 5, parentId);

    const tasks = pm.getTasks();
    const parent = tasks.get(parentId)!;
    const child = tasks.get(childId)!;

    assertTrue(parent.children.includes(childId));
    assertEquals(child.parentId, parentId);
    assertEquals(parent.depth, 0);
    assertEquals(child.depth, 1);
  });

  TEST('Progress', 'ProgressManager create throws for nonexistent parent', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.create('Orphan', 10, 'nonexistent-parent');
    });
  });

  TEST('Progress', 'ProgressManager update modifies task', () => {
    const pm = new ProgressManager(false);
    const id = pm.create('Task', 10);

    pm.update(id, 5, 'halfway');

    const task = pm.getTasks().get(id)!;
    assertEquals(task.current, 5);
    assertEquals(task.message, 'halfway');
    assertEquals(task.status, 'running');
  });

  TEST('Progress', 'ProgressManager update throws for unknown task', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.update('nonexistent', 5);
    });
  });

  TEST('Progress', 'ProgressManager complete transitions task', () => {
    const pm = new ProgressManager(false);
    const id = pm.create('Task', 10);
    pm.update(id, 5);
    pm.complete(id, 'done');

    const task = pm.getTasks().get(id)!;
    assertEquals(task.status, 'done');
    assertEquals(task.current, 10); // set to total on done
  });

  TEST('Progress', 'ProgressManager complete throws for unknown task', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.complete('nonexistent');
    });
  });

  // ==========================================================================
  // ProgressManager Depth Limit Tests
  // ==========================================================================

  TEST('Progress', 'ProgressManager enforces MAX_DEPTH of 10', () => {
    const pm = new ProgressManager(false);

    // Create chain of 11 levels (depth 0-10, which is the max)
    let currentId = pm.create('Level 0', 1);
    for (let i = 1; i <= 10; i++) {
      currentId = pm.create(`Level ${i}`, 1, currentId);
    }

    // Depth 11 exceeds MAX_DEPTH=10, should throw
    assertThrows(() => {
      pm.create('Level 11 - Too Deep', 1, currentId);
    });
  });

  // ==========================================================================
  // ProgressManager Task Limit Tests
  // ==========================================================================

  TEST('Progress', 'ProgressManager enforces MAX_TASKS of 1000', () => {
    const pm = new ProgressManager(false);

    // Create 1000 tasks (at limit)
    for (let i = 0; i < 1000; i++) {
      pm.create(`Task ${i}`, 1);
    }

    // 1001st task should throw
    assertThrows(() => {
      pm.create('Task 1001 - Over Limit', 1);
    });
  });

  // ==========================================================================
  // ProgressManager Roots Tests (I-005)
  // ==========================================================================

  TEST('Progress', 'ProgressManager tracks roots correctly', () => {
    const pm = new ProgressManager(false);
    const root1 = pm.create('Root 1', 5);
    const root2 = pm.create('Root 2', 5);
    const child1 = pm.create('Child 1', 2, root1);

    const roots = pm.getRoots();

    assertTrue(roots.includes(root1));
    assertTrue(roots.includes(root2));
    assertTrue(!roots.includes(child1));
    assertEquals(roots.length, 2);
  });

  // ==========================================================================
  // ProgressManager Input Validation Tests
  // ==========================================================================

  TEST('Progress', 'ProgressManager create throws for empty title', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.create('', 10);
    });
  });

  TEST('Progress', 'ProgressManager create throws for whitespace-only title', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.create('   ', 10);
    });
  });

  TEST('Progress', 'ProgressManager create throws for zero total', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.create('Task', 0);
    });
  });

  TEST('Progress', 'ProgressManager create throws for negative total', () => {
    const pm = new ProgressManager(false);
    assertThrows(() => {
      pm.create('Task', -5);
    });
  });

  TEST('Progress', 'ProgressManager create allows null total (indeterminate)', () => {
    const pm = new ProgressManager(false);
    const id = pm.create('Indeterminate Task', null);
    assertTrue(id.startsWith('task-'));
  });
}
