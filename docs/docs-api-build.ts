#!/usr/bin/env -S deno run -A
import { Application } from 'typedoc';
import { dirname, fromFileUrl, join } from '@std/path';

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

function escapeLineBraces(line: string): string {
  let result = '';
  let codeDelimLen = 0; // 0 = not in inline code
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') {
      // Count consecutive backticks to handle multi-backtick delimiters
      let count = 1;
      while (i + count < line.length && line[i + count] === '`') count++;
      if (codeDelimLen === 0) {
        codeDelimLen = count;
      } else if (count >= codeDelimLen) {
        codeDelimLen = 0;
      }
      result += line.slice(i, i + count);
      i += count - 1;
    } else if (
      codeDelimLen === 0 &&
      ch === '{' &&
      (i === 0 || line[i - 1] !== '\\')
    ) {
      result += '\\{';
    } else if (
      codeDelimLen === 0 &&
      ch === '}' &&
      (i === 0 || line[i - 1] !== '\\')
    ) {
      result += '\\}';
    } else {
      result += ch;
    }
  }
  return result;
}

function escapeBracesOutsideCodeFences(text: string): string {
  const lines = text.split('\n');
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (!inCodeFence) {
      lines[i] = escapeLineBraces(lines[i]);
    }
  }
  return lines.join('\n');
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

function convertAnchorsToJsx(text: string): string {
  // Replace <a id="..."></a> with <Anchor id="..."/> so MDX processes them
  // as JSX components (uppercase) rather than raw HTML (lowercase).
  return text.replace(/<a id="([^"]*?)"><\/a>/g, '<Anchor id="$1"/>');
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
  // Escape { and } so MDX doesn't interpret them as JSX expressions
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
        // Escape braces outside fenced code blocks for MDX compatibility
        text = escapeBracesOutsideCodeFences(text);
        // Convert <a id> anchors to <Anchor id> JSX for MDX broken-link detection
        text = convertAnchorsToJsx(text);
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
