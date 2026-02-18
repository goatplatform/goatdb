---
id: schema
title: Schema
sidebar_position: 6
slug: /schema
---

# GoatDB Schemas

Schemas in GoatDB solve three critical problems for distributed applications: **data validation**, **automatic conflict resolution**, and **seamless migrations**. Unlike traditional databases where schemas live in the database, GoatDB schemas are TypeScript objects compiled into your application, giving you type safety and zero-latency validation.

## Quick Start

Import the [DataRegistry](/api/GoatDB/classes/DataRegistry) and define your schema:

```typescript
import { DataRegistry } from '@goatdb/goatdb';

// 1. Define your schema
const kSchemaTask = {
  ns: 'task',
  version: 1,
  fields: {
    title: {
      type: 'string',
      required: true,
    },
    completed: {
      type: 'boolean',
      default: () => false,
    },
    tags: {
      type: 'set',
      default: () => new Set<string>(),  // Empty typed set
    },
  },
} as const;

// 2. Register the schema
DataRegistry.default.registerSchema(kSchemaTask);

// 3. Use it in your database
const task = db.create('/data/tasks/task-123', kSchemaTask, {
  title: 'Learn GoatDB schemas',
  tags: new Set(['tutorial', 'database']),
});

// TypeScript knows the field types automatically
task.set('completed', true);  // ✅ Type-safe
task.set('completed', 'yes'); // ❌ TypeScript error
```

## Core Concepts

### Schemas Are Conflict Resolution Strategies

When two users edit the same [document](/docs/concepts#item) simultaneously, GoatDB automatically resolves conflicts based on your schema's [field types](/api/GoatDB/type-aliases/FieldDef):

```typescript
// User A adds a tag while User B adds a different tag
userA.get('tags').add('urgent');
userB.get('tags').add('meeting');

// After sync: tags = Set(['urgent', 'meeting'])
// Sets automatically merge by taking the union
```

### Schemas Enable Safe Migrations

When you need to change your data structure, schemas provide a clear upgrade path:

```typescript
// Version 2: Add due dates and rename fields
const kSchemaTaskV2 = {
  ns: 'task',
  version: 2,
  fields: {
    title: { type: 'string', required: true },
    isCompleted: { type: 'boolean', default: () => false },
    dueDate: { type: 'date' },
    tags: {
      type: 'set',
      default: () => new Set<string>(),
    },
  },
  upgrade: (data) => {
    // Migrate from v1 to v2
    data.set('isCompleted', data.get('completed'));
    data.delete('completed');
    return data;
  },
} as const;
```

### Schemas Are Compile-Time Contracts

Schemas exist only in your application code—they're not stored in the database. This means:
- Zero network overhead for schema information
- Full TypeScript integration and IntelliSense
- Compile-time validation of field access
- Different app versions can coexist during rollouts

## The Data Registry

The DataRegistry manages schema versions and coordinates upgrades across your application:

```typescript
// Access the default registry
const registry = DataRegistry.default;

// Register multiple schema versions
registry.registerSchema(kSchemaTaskV1);
registry.registerSchema(kSchemaTaskV2);

// GoatDB automatically uses the latest version for new items
// and upgrades old items when they're accessed
```

### Why Registration Is Required

Registration serves three purposes:

1. **Version Resolution**: Determines which schema version to use for each item
2. **Upgrade Coordination**: Ensures upgrade functions run in the correct order
3. **Conflict Resolution Setup**: Configures field-specific merge strategies

## Defining Schemas

### Basic Structure

Each [schema](/api/GoatDB/type-aliases/Schema) requires a namespace, version, and [field definitions](/api/GoatDB/type-aliases/SchemaFieldsDef):

```typescript
export const kSchemaMessage = {
  ns: 'message',      // Namespace - groups related items
  version: 1,         // Version number - must be consecutive
  fields: {
    sender: {
      type: 'string',
      required: true,
    },
    content: {
      type: 'string',
      required: true,
    },
    timestamp: {
      type: 'date',
      default: () => new Date(),
    },
  },
} as const;

// Generate TypeScript type for use in components
type MessageType = typeof kSchemaMessage;
```

### Field Configuration

Each [field definition](/api/GoatDB/type-aliases/FieldDef) accepts these options:

```typescript
{
  type: 'string' | 'number' | 'boolean' | 'date' | 'set' | 'map' | 'richtext',
  required?: boolean,           // Validation fails if missing
  default?: (item) => value,    // Auto-populate when created
  validate?: (value) => boolean // Custom validation logic
}
```

### Advanced Example

```typescript
const kSchemaProject = {
  ns: 'project',
  version: 1,
  fields: {
    name: {
      type: 'string',
      required: true,
      validate: (name) => name.length >= 3,
    },
    members: {
      type: 'set',
      default: () => new Set<string>(),  // Set<string> of user IDs
    },
    metadata: {
      type: 'map',
      default: () => new Map<string, string>(), // Map<string, string> of tags and values
    },
    description: {
      type: 'richtext',
    },
    budget: {
      type: 'number',
      default: () => 0,
    },
    isArchived: {
      type: 'boolean',
      default: () => false,
    },
  },
} as const;
```

## Conflict Resolution Deep Dive

Understanding how different [field types](/api/GoatDB/type-aliases/SchemaDataType) resolve conflicts is crucial for designing robust schemas.

### Primitive Types (string, number, boolean, date)

**Strategy**: Any Write Wins (last write takes precedence)

```typescript
// Initial state
item.set('title', 'Original Title');

// Concurrent edits
userA.set('title', 'Title A');  // timestamp: 100ms
userB.set('title', 'Title B');  // timestamp: 150ms

// Result: 'Title B' (latest timestamp wins)
```

**Use when**: Fields that represent single values where [conflicts](/docs/conflict-resolution) are rare or latest value is preferred.

### Sets

**Strategy**: Union-based merging (additions win over deletions)

```typescript
// Schema with CoreValue set
const kSchemaWithTags = {
  ns: 'item',
  version: 1,
  fields: {
    tags: {
      type: 'set',
      default: () => new Set<string>(),  // Can hold any CoreValue
    },
  },
} as const;

// Base state
item.set('tags', new Set(['work']));

// Concurrent changes
userA.get('tags').add('urgent');     // Adds 'urgent' string
userB.get('tags').delete('work');    // Tries to delete 'work'
userB.get('tags').add({ type: 'priority', value: 'high' }); // Adds object

// Result: Set(['work', 'urgent', { type: 'priority', value: 'high' }])
// - Additions always succeed
// - Deletions only work on elements from the base version
```

**Use when**: Collections where additions are more important than deletions (tags, permissions, feature flags).

### Maps

**Strategy**: Key-level merging (additions/edits win over deletions)

```typescript
// Schema with CoreValue map
const kSchemaWithMetadata = {
  ns: 'item',
  version: 1,
  fields: {
    metadata: {
      type: 'map',
      default: () => new Map<string, CoreValue>(),  // Values can be any CoreValue
    },
  },
} as const;

// Base state
item.set('metadata', new Map([['priority', 'low']]));

// Concurrent changes
userA.get('metadata').set('priority', 'high');  // Edit existing string
userA.get('metadata').set('assignee', { name: 'alice', id: 123 }); // Add object
userB.get('metadata').delete('priority');       // Try to delete
userB.get('metadata').set('tags', new Set(['urgent', 'review'])); // Add Set

// Result: Map([
//   ['priority', 'high'],      // Edit won over deletion
//   ['assignee', { name: 'alice', id: 123 }], // Object addition succeeded
//   ['tags', Set(['urgent', 'review'])]       // Set addition succeeded
// ])
```

**Use when**: Key-value data where updates are more important than removals (settings, attributes, properties).

### Rich Text

**Strategy**: Tree-based document structure with intelligent conflict resolution

```typescript
import { initRichText, plaintextToTree } from '@goatdb/goatdb/cfds/richtext/tree';

// Schema with typed default
const kSchemaWithRichText = {
  ns: 'document',
  version: 1,
  fields: {
    content: {
      type: 'richtext',
      default: () => initRichText(),  // Empty RichText document
    },
  },
} as const;

// Initial document state
const doc = db.create('/data/docs/doc-123', kSchemaWithRichText, {
  content: {
    root: {
      children: [
        {
          tagName: 'p',
          children: [{ text: 'Hello world' }],
        },
      ],
    },
  },
});

// User A changes the text content
const userAContent = {
  root: {
    children: [
      {
        tagName: 'p',
        children: [{ text: 'Hello beautiful world' }],  // Added "beautiful"
      },
    ],
  },
};
userA_doc.set('content', userAContent);

// User B changes the structure 
const userBContent = {
  root: {
    children: [
      {
        tagName: 'h1',  // Changed paragraph to heading
        children: [{ text: 'Hello world' }],
      },
    ],
  },
};
userB_doc.set('content', userBContent);

// Merged result: Both changes preserved
const mergedResult = {
  root: {
    children: [
      {
        tagName: 'h1',  // User B's structural change
        children: [{ text: 'Hello beautiful world' }],  // User A's text change
      },
    ],
  },
};
```

**Use when**: Collaborative document editing where preserving all contributions and document structure is important.

## Schema Versioning & Migrations

### Creating New Versions

```typescript
// V1: Basic task
const kSchemaTaskV1 = {
  ns: 'task',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
  },
} as const;

// V2: Add priority and rename fields
const kSchemaTaskV2 = {
  ns: 'task',
  version: 2,
  fields: {
    title: { type: 'string', required: true },    // Renamed from 'text'
    completed: { type: 'boolean', default: () => false }, // Renamed from 'done'
    priority: { 
      type: 'string', 
      default: () => 'medium',
      validate: (p) => ['low', 'medium', 'high'].includes(p),
    },
  },
  upgrade: (data) => {
    // Migrate from V1 to V2
    data.set('title', data.get('text'));
    data.set('completed', data.get('done'));
    data.delete('text');
    data.delete('done');
    return data;
  },
} as const;
```

### Upgrade Function Rules

1. **Sequential Only**: Upgrade functions migrate from the immediately previous version
2. **Automatic Chaining**: GoatDB applies multiple upgrades automatically (V1→V2→V3)
3. **Data Transformation**: Modify the data object to match the new schema

```typescript
// Multi-step upgrade example
upgrade: (data, schema) => {
  // Complex data transformation
  const oldFormat = data.get('complexField');
  const newFormat = transformComplexData(oldFormat);
  
  data.set('newComplexField', newFormat);
  data.delete('complexField');
  
  return data;
}
```

### Registration Best Practices

```typescript
// Group related schemas together
export function registerProjectSchemas(
  registry: DataRegistry = DataRegistry.default
): void {
  // Register in version order (optional but recommended)
  registry.registerSchema(kSchemaProjectV1);
  registry.registerSchema(kSchemaProjectV2);
  registry.registerSchema(kSchemaTaskV1);
  registry.registerSchema(kSchemaTaskV2);
}

// Call during app initialization
registerProjectSchemas();
```

## Field Types Reference

### String

```typescript
{
  type: 'string',
  required?: boolean,
  default?: () => string,
  validate?: (value: string) => boolean
}
```

**Conflict Resolution**: Any Write Wins  
**Use Cases**: Names, descriptions, IDs, text content

### Number

```typescript
{
  type: 'number',
  required?: boolean,
  default?: () => number,
  validate?: (value: number) => boolean
}
```

**Conflict Resolution**: Any Write Wins  
**Use Cases**: Configuration values, thresholds, limits, quantities

### Boolean

```typescript
{
  type: 'boolean',
  required?: boolean,
  default?: () => boolean,
  validate?: (value: boolean) => boolean
}
```

**Conflict Resolution**: Any Write Wins  
**Use Cases**: Flags, toggles, binary states

### Date

```typescript
{
  type: 'date',
  required?: boolean,
  default?: () => Date,
  validate?: (value: Date) => boolean
}
```

**Conflict Resolution**: Any Write Wins  
**Use Cases**: Timestamps, deadlines, creation dates

### Set

```typescript
{
  type: 'set',
  required?: boolean,
  default?: () => Set<CoreValue>,
  validate?: (value: Set<CoreValue>) => boolean
}
```

**Conflict Resolution**: Union-based (additions win)  
**Use Cases**: Tags, permissions, categories, flags  
**CoreValue Types**: Primitives (string, number, boolean, Date), Arrays, Objects, nested Sets/Maps, and custom classes

**Best Practice**: Always provide a typed default to avoid undefined values:
```typescript
// Simple string set
tags: {
  type: 'set',
  default: () => new Set<string>(),
}

// Complex object set
shapes: {
  type: 'set',
  default: () => new Set<{id: string, type: string, x: number, y: number}>(),
}

// Mixed type set (any CoreValue)
mixedData: {
  type: 'set',
  default: () => new Set<CoreValue>(),  // Can contain strings, numbers, objects, etc.
}
```

### Map

```typescript
{
  type: 'map',
  required?: boolean,
  default?: () => Map<string, CoreValue>,
  validate?: (value: Map<string, CoreValue>) => boolean
}
```

**Conflict Resolution**: Key-level merging (additions/edits win)  
**Use Cases**: Settings, metadata, attributes, properties  
**CoreValue Types**: Values can be any CoreValue - primitives, Arrays, Objects, nested Sets/Maps, custom classes

**Best Practice**: Always provide a typed default to avoid undefined values:
```typescript
// Simple string-to-string map
metadata: {
  type: 'map',
  default: () => new Map<string, string>(),
}

// Map with complex object values
userProfiles: {
  type: 'map',
  default: () => new Map<string, {name: string, preferences: Set<string>}>(),
}

// Mixed value map (any CoreValue)
configuration: {
  type: 'map', 
  default: () => new Map<string, CoreValue>(),  // Values can be strings, numbers, objects, arrays, etc.
}
```

### Rich Text

```typescript
{
  type: 'richtext',
  required?: boolean,
  default?: () => RichText,
  validate?: (value: RichText) => boolean
}
```

**Document Structure**: Hierarchical tree with ElementNode and TextNode types:

```typescript
// RichText document structure
const document = {
  root: {
    children: [
      {
        tagName: 'h1',
        children: [{ text: 'Project Overview' }]
      },
      {
        tagName: 'p',
        children: [
          { text: 'This project includes ' },
          { 
            tagName: 'span',
            text: 'critical features',
            bold: true,
            italic: true
          },
          { text: ' for collaboration.' }
        ]
      },
      {
        tagName: 'ul',
        children: [
          {
            tagName: 'li',
            children: [{ text: 'Real-time editing' }]
          }
        ]
      }
    ]
  },
  pointers: new Set([
    {
      key: 'user-123',
      type: 'focus',
      node: textNodeRef,
      offset: 5,
      dir: 0
    }
  ])
}
```

**Supported Elements**:
- **Block Elements**: `p` (paragraph), `h1`-`h6` (headings)
- **Lists**: `ul` (unordered), `ol` (ordered), `li` (list items)
- **Tables**: `table`, `tr` (rows), `td` (cells)
- **Text Formatting**: `span` nodes with `bold`, `italic`, `underline`, `strike` properties
- **Links**: `a` nodes with `href` attributes
- **References**: `ref` nodes for internal links and external references
- **Media**: `img` nodes with `src`, `object` nodes for embedded content

**Working with RichText**: Uses standard GoatDB [item API](/api/GoatDB/classes/ManagedItem):

```typescript
import { initRichText, plaintextToTree } from '@goatdb/goatdb/cfds/richtext/tree';

// Get current content
const currentContent = doc.get('content');

// Set new content (manual tree construction)
const newContent = {
  root: {
    children: [
      {
        tagName: 'p',
        children: [
          { text: 'Hello ' },
          { tagName: 'span', text: 'world', bold: true },
        ],
      },
    ],
  },
};
doc.set('content', newContent);

// Convert from plain text
const richTextFromPlain = { root: plaintextToTree('Simple text content') };
doc.set('content', richTextFromPlain);
```

**Conflict Resolution**: Tree-based intelligent merging  
**Use Cases**: Documents, comments, collaborative content  
**API**: Uses standard [item.set()](/api/GoatDB/classes/ManagedItem#set) and [item.get()](/api/GoatDB/classes/ManagedItem#get) - no special RichText methods
