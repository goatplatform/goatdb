import * as path from '@std/path';
import { prettyJSON } from '../base/common.ts';
// Steps:
// 1. Copy project template (including deno.json and .gitignore)
// 2. Run deno add for the following dependencies:
//    * jsr:@std/path
//    * jsr:@goatdb/goatdb
//    * npm:esbuild
//    * jsr:@luca/esbuild-deno-loader
//    * npm:react@19.0.0
//    * npm:react-dom@19.0.0/client
//    * npm:yargs@17.7.2
// 7. Create .gitignore or suggest user to edit it if already exists

const cssScaffold = ``;
const htmlScaffold = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>The GOAT App</title>
    <link rel="stylesheet" href="/index.css" />
    <link rel="icon" sizes="192x192" href="/assets/favicon.png" type="image/png" />
  </head>
  <body class="layout-column">
    <div id="root"></div>
    <script src="/app.js"></script>
  </body>
</html>`;
const tsxScaffold = `// deno-lint-ignore no-unused-vars
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/app.tsx';
import { registerSchemas } from '../schema.ts';

registerSchemas();

const domNode = document.getElementById('root')!;

const root = createRoot(domNode);
root.render(<App />);
`;

const gitignoreScaffold = `node_modules
.DS_Store
server-data`;

const appTsxScaffold = `// @deno-types="npm:@types/react"
import React from 'react';
import { useDBReady } from '@goatdb/goatdb/react';

export function Contents() {
  return <div>Hello World</div>;
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
`;

const devSeverScaffold = `import { startDebugServer } from '@goatdb/goatdb/server';
import { registerSchemas } from './schema.ts';

async function main(): Promise<void> {
  registerSchemas();
  await startDebugServer({
    path: './server-data',
    jsPath: './scaffold/index.tsx',
    htmlPath: './scaffold/index.html',
    cssPath: './scaffold/index.css',
    assetsPath: './assets',
    watchDir: './',
  });
}

if (import.meta.main) main();
`;

const denoJsonScaffold = {
  compilerOptions: {
    lib: ['dom', 'dom.iterable', 'dom.asynciterable', 'deno.ns'],
    jsx: 'precompile',
  },
  tasks: {
    debug: 'deno run -A debug-server.ts',
  },
};

const schemaScaffold = `import { SchemaManager } from '@goatdb/goatdb';

export const kSchemaTask = {
  ns: 'task',
  version: 1,
  fields: {
    text: {
      type: 'string',
      default: () => '',
    },
    done: {
      type: 'boolean',
      default: () => false,
    },
  },
} as const;
export type SchemaTypeTask = typeof kSchemaTask;

export function registerSchemas(): void {
  SchemaManager.default.register(kSchemaTask);
}
`;

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (_: unknown) {
    return false;
  }
}

async function writeTextFileIfNotExists(
  filePath: string,
  text: string,
): Promise<void> {
  if (!(await pathExists(filePath))) {
    await Deno.writeTextFile(filePath, text);
  }
}

function extractDependencyName(dep: string): string {
  const colonIdx = dep.indexOf(':');
  dep = colonIdx > 0 ? dep.substring(colonIdx + 1) : dep;
  const atIdx = dep.indexOf('@');
  return atIdx > 0 ? dep.substring(0, atIdx) : dep;
}

async function installDependency(dep: string): Promise<void> {
  const denoJson = JSON.parse(
    await Deno.readTextFile(path.join(Deno.cwd(), 'deno.json')),
  );
  const imports: Record<string, string> = denoJson['imports'] || {};
  const depName = extractDependencyName(dep);
  if (!Object.hasOwn(imports, depName)) {
    await new Deno.Command('deno', {
      args: ['add', dep],
      stdout: 'inherit',
      stderr: 'inherit',
    }).output();
  }
}

async function bootstrapProject(): Promise<void> {
  // await Deno.mkdir(projectDir, { recursive: true });
  const projectDir = Deno.cwd();
  console.log(`Setting up project scaffold...`);
  const scaffoldDir = path.join(projectDir, 'scaffold');
  await Deno.mkdir(scaffoldDir, { recursive: true });
  await writeTextFileIfNotExists(
    path.join(scaffoldDir, 'index.css'),
    cssScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(scaffoldDir, 'index.html'),
    htmlScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(scaffoldDir, 'index.tsx'),
    tsxScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(projectDir, '.gitignore'),
    gitignoreScaffold,
  );
  const srcDir = path.join(projectDir, 'src');
  await Deno.mkdir(srcDir, { recursive: true });
  await writeTextFileIfNotExists(path.join(srcDir, 'app.tsx'), appTsxScaffold);
  await writeTextFileIfNotExists(
    path.join(projectDir, 'debug-server.ts'),
    devSeverScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(projectDir, 'deno.json'),
    prettyJSON(denoJsonScaffold),
  );
  await writeTextFileIfNotExists(
    path.join(projectDir, 'schema.ts'),
    schemaScaffold,
  );
  console.log(`Installing dependencies...`);
  await installDependency('jsr:@goatdb/goatdb');
  await installDependency('jsr:@std/path');
  await installDependency('npm:react@19.0.0');
  await installDependency('npm:react-dom@19.0.0/client');
  await installDependency('npm:yargs@17.7.2');
  console.log('Done');
}

if (import.meta.main) bootstrapProject();
