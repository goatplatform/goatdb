import {
  getDenoPlugin,
  getEsbuild,
  stopBackgroundCompiler,
} from './build-dependencies.ts';
import type * as esbuild from 'esbuild';

/**
 * Compiles a TypeScript file using esbuild for execution in Node.js and returns the build result.
 *
 * @param inputFile - Path to the TypeScript file to compile
 * @param outName - Output file name (without extension)
 * @returns The esbuild BuildResult
 */
export async function compileForNodeWithEsbuild(
  inputFile: string,
  outName: string,
) {
  const esbuild = await getEsbuild();
  const denoPlugin = await getDenoPlugin();
  return await esbuild.build({
    entryPoints: [
      {
        in: inputFile,
        out: outName,
      },
    ],
    plugins: [denoPlugin() as unknown as esbuild.Plugin],
    outfile: outName,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    sourcemap: 'inline',
    external: [
      'nodemailer',
      'esbuild',
      '@deno/esbuild-plugin',
      '@jsr/deno__esbuild-plugin',
      'chokidar',
      'postject',
      // Deno-run-only browser dep: bundling it pulls playwright-core's
      // uninstalled optional packages (chromium-bidi, electron, bufferutil,
      // utf-8-validate, kerberos) and fails the Node bundle.
      'playwright',
    ],
    banner: {
      // Aliased to __createRequire__ to avoid potential naming conflicts with
      // npm packages that also declare `createRequire` in their bundle headers.
      js:
        "import { createRequire as __createRequire__ } from 'node:module';const require = __createRequire__(import.meta.url);globalThis.require = require;",
    },
    logOverride: {
      'empty-import-meta': 'silent',
      'direct-eval': 'silent',
    },
  });
}

/** Result of running the esbuild bundle in Node.js. */
export interface NodeRunResult {
  readonly success: boolean;
  readonly code: number;
}

/**
 * Runs a pre-compiled esbuild result in Node.js environment.
 *
 * @param result - The esbuild BuildResult (output of compileForNodeWithEsbuild)
 * @param inspectBrk - Optional flag to enable Node.js inspector with break on start
 * @param env - Optional environment variables to set for the Node.js process
 * @returns The process outcome with its exit code. `code` is -1 when the
 *          process could not be started or collected.
 */
export async function nodeRun(
  result: Awaited<ReturnType<typeof compileForNodeWithEsbuild>>,
  inspectBrk?: boolean,
  env?: Record<string, string>,
): Promise<NodeRunResult> {
  try {
    const nodeCmd = new Deno.Command('node', {
      stdin: 'piped',
      stdout: 'inherit',
      stderr: 'inherit',
      ...(inspectBrk
        ? {
          args: ['--inspect-brk'],
        }
        : {}),
      env: {
        NODE_NO_WARNINGS: '1',
        ...env,
      },
    });
    const nodeProcess = nodeCmd.spawn();
    const writer = nodeProcess.stdin.getWriter();
    await writer.write(result.outputFiles![0].contents);
    await writer.close();
    const status = await nodeProcess.output();
    return { success: status.success, code: status.code };
  } catch (error: unknown) {
    // Never hide a spawn/collection failure: the caller reports the exit code.
    console.error('Node.js process failed:', error);
    return { success: false, code: -1 };
  } finally {
    await stopBackgroundCompiler();
  }
}
