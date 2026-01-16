import { createHttpServer } from "@goatdb/goatdb/server";
import { GoatDB } from "@goatdb/goatdb";
import { registerSchemas } from "../common/schema.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Arguments {
  path?: string;
  port?: number;
  info?: boolean;
}

// Production server - https://goatdb.dev/docs/server
/**
 * This is the main server entry point for Node.js. Edit it to include any
 * custom setup as needed.
 *
 * The build.ts script is responsible for compiling this entry point script
 * into a production bundle.
 *
 * TODO: Add custom routes and middleware below
 */
async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option("port", {
      type: "number",
      default: 8080,
      description: "Port to run the server on"
    })
    .option("path", {
      type: "string",
      default: join(__dirname, "../server-data"),
      description: "Path to server data directory"
    })
    .option("info", {
      alias: "i",
      type: "boolean",
      description: "Print technical information"
    })
    .help()
    .argv as Arguments;

  registerSchemas();

  if (args.info) {
    console.log("GoatDB Node.js Server v1.0.0");
    console.log("Node.js version:", process.version);
    console.log("Platform:", process.platform, process.arch);
    process.exit(0);
  }

  const db = new GoatDB({
    path: args.path!,
  });

  await db.readyPromise();

  const server = createHttpServer();

  // Production request handler
  const handler = async (req: any, info: any): Promise<Response> => {
    const url = new URL(req.url);

    // Add your production routes here
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    return new Response('GoatDB Server', {
      headers: { 'Content-Type': 'text/plain' }
    });
  };

  await server.start(handler, args.port!);
  console.log(`🚀 GoatDB server running at http://localhost:${args.port}`);
}

// Node.js ESM main detection
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}