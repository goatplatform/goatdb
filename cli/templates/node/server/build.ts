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
  });
  process.exit();
}

// Node.js ESM main detection
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
