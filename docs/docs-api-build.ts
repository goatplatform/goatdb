#!/usr/bin/env -S deno run -A
import { Application } from 'typedoc';
import { dirname, fromFileUrl, join } from '@std/path';
import { convertAnchorsToJsx, escapeMarkdownForMdx } from './mdx-escape.ts';

const SCRIPT_DIR = dirname(fromFileUrl(import.meta.url));
const ROOT_DIR = dirname(SCRIPT_DIR);
const API_DIR = join(SCRIPT_DIR, 'api-docs');

const INDEX_PAGE = `---
sidebar_position: 1
title: API Reference
---

# API Reference

Complete API documentation for GoatDB.

## Modules

- **[GoatDB](./GoatDB/)** — Core database API (GoatDB, ManagedItem, Query, Schema, etc.)
- **[GoatDB/Server](./GoatDB/Server/)** — HTTP server, endpoints, middleware
- **[GoatDB/Server/Build](./GoatDB/Server/Build/)** — Compilation and debug server
- **[GoatDB/React](./GoatDB/React/)** — React hooks (useDB, useItem, useQuery)
`;

// Labels and ordering for TypeDoc-generated category folders
const CATEGORY_META: Record<string, { label: string; position: number }> = {
  'classes': { label: 'Classes', position: 1 },
  'interfaces': { label: 'Interfaces', position: 2 },
  'type-aliases': { label: 'Type Aliases', position: 3 },
  'functions': { label: 'Functions', position: 4 },
  'enumerations': { label: 'Enumerations', position: 5 },
  'variables': { label: 'Variables', position: 6 },
};

// Ordering for module sub-folders (labels derived from folder name)
const MODULE_POSITIONS: Record<string, number> = {
  'React': 7,
  'Server': 8,
  'Build': 9,
};

async function writeCategoryFiles(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isDirectory) continue;
    const folderPath = `${dir}/${entry.name}`;
    const meta = CATEGORY_META[entry.name];
    const modulePos = MODULE_POSITIONS[entry.name];

    if (meta) {
      await Deno.writeTextFile(
        `${folderPath}/_category_.json`,
        JSON.stringify(meta, null, 2) + '\n',
      );
    } else if (modulePos !== undefined) {
      await Deno.writeTextFile(
        `${folderPath}/_category_.json`,
        JSON.stringify({ position: modulePos }, null, 2) + '\n',
      );
    }

    await writeCategoryFiles(folderPath);
  }
}

function injectSidebarLabel(text: string): string {
  if (text.startsWith('---')) return text;
  // Strip the "Class:", "Function:", etc. prefix from H1 headings to produce
  // clean sidebar labels. Generic brackets (requires useHTMLEncodedBrackets)
  // are also stripped when present.
  const h1Match = text.match(/^# .+?:\s+(.+?)(?:&lt;.+?&gt;)?\s*\n/);
  if (!h1Match) return text;
  const name = h1Match[1];
  return `---\nsidebar_label: "${name}"\n---\n\n${text}`;
}

async function main(): Promise<void> {
  console.log('Starting API documentation build...\n');

  const app = await Application.bootstrapWithPlugins({
    options: join(ROOT_DIR, 'typedoc.docs.json'),
  });

  const project = await app.convert();
  if (!project) {
    console.error('TypeDoc conversion failed');
    Deno.exit(1);
  }

  await app.generateOutputs(project);

  // Post-process generated markdown files:
  // Escape prose { } < so MDX doesn't interpret them as JSX/expressions
  let count = 0;
  async function processFiles(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        await processFiles(`${dir}/${entry.name}`);
      } else if (entry.name.endsWith('.md')) {
        count++;
        const path = `${dir}/${entry.name}`;
        let text = await Deno.readTextFile(path);
        // Inject sidebar_label for files with HTML-encoded generics in h1
        text = injectSidebarLabel(text);
        // Convert <a id> anchors to <Anchor id> JSX for MDX broken-link detection
        text = convertAnchorsToJsx(text);
        // Escape { } < outside fenced/inline code so MDX doesn't read them as
        // JSX/expressions (runs AFTER convertAnchorsToJsx so <Anchor> stays JSX)
        text = escapeMarkdownForMdx(text);
        await Deno.writeTextFile(path, text);
      }
    }
  }
  await processFiles(API_DIR);

  // Replace auto-generated index with custom API overview
  await Deno.writeTextFile(`${API_DIR}/index.md`, INDEX_PAGE);

  // Write _category_.json files for sidebar labels and ordering
  await writeCategoryFiles(`${API_DIR}/GoatDB`);

  console.log(`\nGenerated ${count} files in ${API_DIR}/`);
  console.log('API documentation build completed successfully!');
}

if (import.meta.main) {
  await main();
}
