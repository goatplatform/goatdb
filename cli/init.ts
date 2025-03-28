/**
 * This is a CLI used to initialize a new GoatDB project skaffold.
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB/Init
 */
import * as path from '@std/path';
import { prettyJSON } from '../base/common.ts';
import type { JSONObject } from '../base/interfaces.ts';
import { coreValueEquals } from '../base/core-types/equals.ts';

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
import { App } from './app.tsx';
import { registerSchemas } from '../common/schema.ts';

registerSchemas();

const domNode = document.getElementById('root')!;

const root = createRoot(domNode);
root.render(<App />);
`;

const gitignoreScaffold = `node_modules
.DS_Store
server-data
build`;

const appTsxScaffold = `// @deno-types="@types/react"
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

const devSeverScaffold =
  `import { startDebugServer } from "@goatdb/goatdb/server";
import { registerSchemas } from "../common/schema.ts";

async function main(): Promise<void> {
  registerSchemas();
  await startDebugServer({
    buildDir: "build",
    path: "server-data",
    jsPath: "client/index.tsx",
    htmlPath: "client/index.html",
    cssPath: "client/index.css",
    assetsPath: "client/assets",
    watchDir: ".",
  });
}

if (import.meta.main) main();
`;

const denoJsonScaffold = {
  compilerOptions: {
    lib: ['dom', 'dom.iterable', 'dom.asynciterable', 'deno.ns'],
  },
  tasks: {
    debug: 'deno run -A server/debug-server.ts',
    build: 'deno run -A server/build.ts',
    clean: 'rm -r server-data',
  },
  version: '0.0.1',
};

const schemaScaffold = `import { DataRegistry } from '@goatdb/goatdb';

/**
 * A schema defines the structure of items that can be stored in the DB.
 * Adding a new schema involves these 3 steps:
 *
 * 1. Define a new const schema definition.
 *    Tip: Remember the as const in the end.
 *
 *    export const kSchemaMyItem = {
 *      ns: 'MyItem',
 *      version: 1,
 *      fields: {
 *        title: {
 *          type: 'string',
 *          default: () => 'Untitled',
 *        },
 *        value: {
 *          type: 'number',
 *          required: true,
 *        },
 *      },
 *    } as const;
 *
 * 2. Define a utility type for this const.
 *
 *    export type SchemaMyItem = typeof kSchemaMyItem;
 *
 * 3. Edit the registerSchemas() function at the bottom of this file and
 *    include a call to manager.register().
 *
 *    manager.register(kSchemaMyItem);
 */
export const kSchemaMyItem = {
  ns: 'MyItem',
  version: 1,
  fields: {
    title: {
      type: 'string',
      default: () => 'Untitled',
    },
    value: {
      type: 'number',
      required: true,
    },
  },
} as const;
export type SchemaMyItem = typeof kSchemaMyItem;

// ====== Add new schemas here ====== //

/**
 * This is the main registration function for all schemas in this project.
 * It gets called from both the client and the server code so they agree on the
 * same schemas.
 *
 * @param registry The registry to register with.
 *                 Uses {@link DataRegistry.default} if not provided.
 */
export function registerSchemas(
  registry: DataRegistry = DataRegistry.default,
): void {
  registry.registerSchema(kSchemaMyItem);
}
`;

const serverSkaffold = `import yargs from "yargs";
import * as path from "@std/path";
import { Server, staticAssetsFromJS } from "@goatdb/goatdb/server";
import { BuildInfo, prettyJSON } from "@goatdb/goatdb";
import { registerSchemas } from "../common/schema.ts";
// These imported files will be automatically generated during compilation
import encodedStaticAsses from "../build/staticAssets.json" with {
  type: "json",
};
import kBuildInfo from "../build/buildInfo.json" with { type: "json" };

interface Arguments {
  path?: string;
  version?: boolean;
  info?: boolean;
}

/**
 * This is the main server entry point. Edit it to include any custom setup
 * as needed.
 *
 * The build.ts script is responsible for compiling this entry point script
 * into a self contained executable.
 */
async function main(): Promise<void> {
  const buildInfo: BuildInfo = kBuildInfo as BuildInfo;
  const args: Arguments = yargs(Deno.args)
    .command(
      "<path>",
      "Start the server at the specified path",
    )
    .version(buildInfo.appVersion)
    .option("info", {
      alias: "i",
      desc: "Print technical information",
      type: "boolean",
    })
    .help()
    .parse();
  registerSchemas();
  if (args.info) {
    console.log(buildInfo.appName + " v" + buildInfo.appVersion);
    console.log(prettyJSON(buildInfo));
    Deno.exit();
  }
  const server = new Server({
    staticAssets: staticAssetsFromJS(encodedStaticAsses),
    path: args.path || path.join(Deno.cwd(), "server-data"),
    buildInfo,
  });
  await server.start();
}

if (import.meta.main) main();
`;

const buildSkaffold = `import { compile } from "@goatdb/goatdb/server";

async function main(): Promise<void> {
  await compile({
    buildDir: "build",
    serverEntry: "server/server.ts",
    jsPath: "client/index.tsx",
    htmlPath: "client/index.html",
    cssPath: "client/index.css",
    assetsPath: "client/assets",
    // Edit the following fields for cross compilation
    // os: "linux",
    // arch: "aar64",
  });
  Deno.exit();
}

if (import.meta.main) main();
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

async function mergeDenoJson(denoJsonPath: string): Promise<void> {
  let denoJson: JSONObject;
  try {
    denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
  } catch (_: unknown) {
    denoJson = {};
  }
  const initial = { ...denoJson };
  // Merge all root level fields
  for (const [field, value] of Object.entries(denoJsonScaffold)) {
    if (!Object.hasOwn(denoJson, field)) {
      denoJson[field] = value;
    }
  }
  // Merge individual tasks
  denoJson.tasks = {
    ...denoJsonScaffold.tasks,
    ...(denoJson.tasks as JSONObject),
  };
  // Update the file if it changed
  if (!coreValueEquals(initial, denoJson)) {
    await Deno.writeTextFile(denoJsonPath, prettyJSON(denoJson));
  }
}

async function bootstrapProject(): Promise<void> {
  // await Deno.mkdir(projectDir, { recursive: true });
  const projectDir = Deno.cwd();
  console.log(`Setting up project scaffold...`);
  const clientDir = path.join(projectDir, 'client');
  await Deno.mkdir(clientDir, { recursive: true });
  await writeTextFileIfNotExists(
    path.join(clientDir, 'index.css'),
    cssScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(clientDir, 'index.html'),
    htmlScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(clientDir, 'index.tsx'),
    tsxScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(projectDir, '.gitignore'),
    gitignoreScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(clientDir, 'app.tsx'),
    appTsxScaffold,
  );
  const serverDir = path.join(projectDir, 'server');
  await Deno.mkdir(serverDir, { recursive: true });
  await writeTextFileIfNotExists(
    path.join(serverDir, 'debug-server.ts'),
    devSeverScaffold,
  );
  await writeTextFileIfNotExists(
    path.join(serverDir, 'server.ts'),
    serverSkaffold,
  );
  await writeTextFileIfNotExists(
    path.join(serverDir, 'build.ts'),
    buildSkaffold,
  );
  const commonDir = path.join(projectDir, 'common');
  await Deno.mkdir(commonDir, { recursive: true });
  await writeTextFileIfNotExists(
    path.join(commonDir, 'schema.ts'),
    schemaScaffold,
  );
  await mergeDenoJson(
    path.join(projectDir, 'deno.json'),
  );
  console.log(`Installing dependencies...`);
  await installDependency('jsr:@goatdb/goatdb');
  await installDependency('jsr:@std/path');
  await installDependency('npm:react@19.0.0');
  await installDependency('npm:react-dom@19.0.0/client');
  await installDependency('npm:yargs@17.7.2');
  await installDependency('npm:@types/react@19.0.8');
  console.log('Done');
}

if (import.meta.main) bootstrapProject();
