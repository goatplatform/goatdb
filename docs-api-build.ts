#!/usr/bin/env -S deno run -A

import { cli } from './base/development.ts';
import * as path from 'jsr:@std/path';
import { ensureDir } from 'jsr:@std/fs';
import { processModule, ModuleConfig } from './docs/build/typedoc.ts';
import { buildInheritanceMap } from './docs/build/inheritance.ts';
import { 
  generateClassDoc, 
  generateInterfaceDoc, 
  generateFunctionsDoc, 
  generateReactFunctionsDoc 
} from './docs/build/doc-generators.ts';
import { escapeMDX, sanitizeFilename } from './docs/build/doc-utils.ts';

const API_DOCS_DIR = path.join('docs', 'docs', 'api');

/**
 * Cleans existing API documentation
 */
async function cleanApiDocs(): Promise<void> {
  console.log('Cleaning existing API documentation...');
  await cli('rm', '-rf', API_DOCS_DIR);
  await ensureDir(API_DOCS_DIR);
  await ensureDir(path.join(API_DOCS_DIR, 'classes'));
  await ensureDir(path.join(API_DOCS_DIR, 'interfaces'));
}

/**
 * Generates the API index page with module organization
 */
async function generateIndexPage(modules: { [key: string]: any }): Promise<void> {
  console.log('Generating API index page...');
  
  let content = `---
sidebar_position: 1
title: API Reference
hide_table_of_contents: false
---

# API Reference

Complete API documentation for GoatDB, automatically generated from TypeScript source code.

`;

  // Generate sections for each module
  for (const [moduleName, data] of Object.entries(modules)) {
    if (!data.classes.length && !data.interfaces.length && !data.functions.length) continue;
    
    content += `## ${moduleName} APIs\n\n`;
    
    // Classes
    if (data.classes.length > 0) {
      content += '### Classes\n\n';
      content += '| Class | Description |\n';
      content += '|-------|-------------|\n';
      for (const cls of data.classes) {
        const desc = escapeMDX(cls.comment?.summary?.map((s: any) => s.text).join('').split('\n')[0] || 'No description');
        const filename = sanitizeFilename(cls.name);
        content += `| [${cls.name}](./classes/${filename}) | ${desc} |\n`;
      }
      content += '\n';
    }

    // Functions
    if (data.functions.length > 0) {
      content += '### Functions\n\n';
      content += '| Function | Description |\n';
      content += '|----------|-------------|\n';
      for (const fn of data.functions) {
        const desc = escapeMDX(fn.comment?.summary?.map((s: any) => s.text).join('').split('\n')[0] || 'No description');
        const moduleFile = moduleName.toLowerCase();
        content += `| [\`${fn.name}()\`](./functions-${moduleFile}#${fn.name.toLowerCase()}) | ${desc} |\n`;
      }
      content += '\n';
    }

    // Interfaces
    if (data.interfaces.length > 0) {
      content += '### Interfaces\n\n';
      content += '| Interface | Description |\n';
      content += '|-----------|-------------|\n';
      for (const iface of data.interfaces) {
        const desc = escapeMDX(iface.comment?.summary?.map((s: any) => s.text).join('').split('\n')[0] || 'No description');
        const filename = sanitizeFilename(iface.name);
        content += `| [${iface.name}](./interfaces/${filename}) | ${desc} |\n`;
      }
      content += '\n';
    }
  }

  // Always add React APIs section (manually maintained)
  content += `## React APIs

React hooks for state management

### Functions

| Function | Description |
|----------|-------------|
| [\`useDB()\`](./functions-react#usedb) | Opens a local DB, creating it if necessary. Once opened, the DB is available as a react context. |
| [\`useItem()\`](./functions-react#useitem) | This hook monitors changes to a specific item, triggering a re-render whenever the item's state changes. |
| [\`useDBReady()\`](./functions-react#usedbready) | A hook for monitoring the DB's loading process. The hook triggers whenever the loading process changes its state. |
| [\`useQuery()\`](./functions-react#usequery) | Creates a new query or retrieves an existing one. |

### Type Aliases

| Type | Description |
|------|-------------|
| \`UseItemOpts\` | Options for the useItem hook. |
| \`DBReadyState\` | Represents the state of the loading process. |
| \`UseQueryOpts\` | Options for the useQuery hook. |
| \`PropsWithPath\` | Convenience props type for components that accept a DB path as input. |

## Navigation Tips

- Use the sidebar to browse by category: Classes, Interfaces, and Functions
- Use <kbd>Ctrl</kbd>+<kbd>K</kbd> to search for specific APIs
- Click on type references to jump to their definitions
- Examples are provided in multiple tabs for different use cases

## Key Classes to Know

- **[GoatDB](./classes/goatdb)** - Main database class for managing repositories and data
- **[ManagedItem](./classes/manageditem)** - High-level interface for working with individual items
- **[Query](./classes/query)** - Live view over repositories with real-time updates
- **[DataRegistry](./classes/dataregistry)** - Schema registry for type safety
`;

  await Deno.writeTextFile(path.join(API_DOCS_DIR, 'index.mdx'), content);
}

/**
 * Main function to build API documentation
 */
export async function buildApiDocs(): Promise<void> {
  console.log('Building simplified API documentation...');
  
  // Clean existing docs
  await cleanApiDocs();
  
  // Define modules to process
  const modules: ModuleConfig[] = [
    { path: 'mod.ts', name: 'Core', description: 'Core GoatDB APIs' },
    { path: 'server/mod.ts', name: 'Server', description: 'Server APIs for running GoatDB servers' },
    { path: 'react/hooks.ts', name: 'React', description: 'React hooks for state management' },
  ];
  
  const moduleData: { [key: string]: any } = {};
  let allClasses: any[] = [];
  
  // Process each module with TypeDoc
  for (const module of modules) {
    try {
      const reflections = await processModule(module.path);
      
      if (reflections.classes.length === 0 && reflections.interfaces.length === 0 && reflections.functions.length === 0) {
        console.warn(`No reflections found in ${module.path}`);
        continue;
      }
      
      console.log(`Found ${reflections.classes.length} classes, ${reflections.interfaces.length} interfaces, ${reflections.functions.length} functions in ${module.name}`);
      
      moduleData[module.name] = reflections;
      allClasses = allClasses.concat(reflections.classes);
      
    } catch (error) {
      console.warn(`Failed to process ${module.path}: ${(error as Error).message}`);
    }
  }
  
  if (Object.keys(moduleData).length === 0) {
    throw new Error('No modules processed successfully');
  }
  
  // Build dynamic inheritance map from all classes
  const inheritanceMap = buildInheritanceMap(allClasses);
  console.log(`Built inheritance map for ${inheritanceMap.size} classes`);
  
  // Generate index page
  await generateIndexPage(moduleData);
  
  // Generate documentation for each module
  for (const [moduleName, data] of Object.entries(moduleData)) {
    // Generate class documentation
    for (const cls of data.classes) {
      await generateClassDoc(cls, inheritanceMap);
    }
    
    // Generate interface documentation
    for (const iface of data.interfaces) {
      await generateInterfaceDoc(iface);
    }
    
    // Generate functions documentation
    if (data.functions.length > 0) {
      await generateFunctionsDoc(data.functions, moduleName.toLowerCase());
    }
  }
  
  // Ensure React functions documentation exists
  const reactFunctionsPath = path.join(API_DOCS_DIR, 'functions-react.mdx');
  try {
    await Deno.stat(reactFunctionsPath);
    console.log('✅ React functions documentation already exists');
  } catch {
    console.log('📝 Creating React functions documentation...');
    await generateReactFunctionsDoc();
    console.log('✅ React functions documentation created');
  }
  
  console.log('✅ Simplified API documentation generated successfully!');
  console.log(`📁 Output directory: ${API_DOCS_DIR}`);
}

if (import.meta.main) {
  try {
    await buildApiDocs();
  } catch (error) {
    console.error('❌ Error generating API documentation:', error);
    Deno.exit(1);
  }
}