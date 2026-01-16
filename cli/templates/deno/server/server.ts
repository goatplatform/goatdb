import yargs from "yargs";
import * as path from "node:path";
import { prettyJSON } from "@goatdb/goatdb";
import { Server, staticAssetsFromJS, type BuildInfo } from "@goatdb/goatdb/server";
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

// Production server - https://goatdb.dev/docs/server
/**
 * This is the main server entry point. Edit it to include any custom setup
 * as needed.
 *
 * The build.ts script is responsible for compiling this entry point script
 * into a self contained executable.
 *
 * TODO: Add custom routes and middleware below
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