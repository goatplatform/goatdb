// Production build script
// Compiles the application into a standalone Node.js SEA executable
import { getRuntime } from '@goatdb/goatdb';
import { compile } from '@goatdb/goatdb/server/build';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const runtime = getRuntime();
  await compile({
    buildDir: 'build',
    // Use the SEA-compatible server entry for Node.js compilation
    serverEntry: 'server/server-sea.ts',
    jsPath: 'client/index.tsx',
    htmlPath: 'client/index.html',
    assetsPath: 'client/assets',
  });
  runtime.exit(0);
}

// Node.js ESM main detection (cross-platform)
if (
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((err) => {
    console.error(err);
    getRuntime().exit(1);
  });
}
