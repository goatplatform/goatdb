// Production build script
import { compile } from "@goatdb/goatdb/server";

async function main(): Promise<void> {
  await compile({
    buildDir: "build",
    serverEntry: "server/server.ts",
    jsPath: "client/index.tsx",
    htmlPath: "client/index.html",
    cssPath: "client/index.css",
    assetsPath: "client/assets",
    // Cross-compile: deno run -A server/build.ts --target=x86_64-pc-windows-msvc
    // os: "linux",
    // arch: "aar64",
  });
  Deno.exit();
}

if (import.meta.main) main();