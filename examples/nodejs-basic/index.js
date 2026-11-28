#!/usr/bin/env node

import { DataRegistry, GoatDB } from '@goatdb/goatdb';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define a task schema
const taskSchema = {
  ns: 'task',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
    priority: { type: 'string', default: () => 'medium' },
    tags: { type: 'set', default: () => new Set() },
  },
};

// Register the schema
DataRegistry.default.registerSchema(taskSchema);

async function main() {
  // Initialize database
  const db = new GoatDB({
    path: join(__dirname, 'data'),
  });

  await db.readyPromise();
  console.log('🐐 GoatDB initialized');

  // Create sample tasks
  const task1 = db.create('/data/todos/task-1', taskSchema, {
    text: 'Learn GoatDB basics',
    priority: 'high',
  });

  const task2 = db.create('/data/todos/task-2', taskSchema, {
    text: 'Build Node.js app',
    priority: 'medium',
  });

  db.create('/data/todos/task-3', taskSchema, {
    text: 'Write documentation',
    done: true,
  });

  // Query incomplete tasks
  const incompleteTasks = db.query({
    source: '/data/todos',
    schema: taskSchema,
    predicate: ({ item }) => !item.get('done'),
  });

  console.log('📋 Incomplete tasks:', incompleteTasks.results().length);

  // Update a task
  task1.set('done', true);
  console.log('✅ Marked task as complete');

  // Set up reactive query
  incompleteTasks.onResultsChanged(() => {
    console.log(
      '🔄 Tasks updated:',
      incompleteTasks.results().length,
      'remaining',
    );
  });

  // Make changes to see reactive updates
  setTimeout(() => task2.set('done', true), 1000); // Show reactive update after 1s
  setTimeout(() => {
    db.create('/data/todos/task-4', taskSchema, {
      text: 'Test reactive queries',
      priority: 'high',
    });
  }, 2000); // Add new task after 2s to demonstrate reactivity

  // Clean shutdown after demo
  setTimeout(async () => {
    console.log('🧹 Cleaning up...');
    await db.flushAll(); // Ensure all changes are written to disk
    await db.close(); // Close the whole database
    process.exit(0);
  }, 3000); // Allow 3s for demo before cleanup
}

main().catch(console.error);
