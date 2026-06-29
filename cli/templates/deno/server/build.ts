// Production build script
import { getRuntime } from '@goatdb/goatdb';
import { compile } from '@goatdb/goatdb/server/build';

async function main(): Promise<void> {
  const runtime = getRuntime();
  await compile({
    buildDir: 'build',
    serverEntry: 'server/server.ts',
    jsPath: 'client/index.tsx',
    htmlPath: 'client/index.html',
    assetsPath: 'client/assets',
    // Cross-compile: deno run -A server/build.ts --target=x86_64-pc-windows-msvc
    // os: "linux",
    // arch: "arm64",
  });
  runtime.exit(0);
}

if (getRuntime().isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    getRuntime().exit(1);
  });
}
