import * as esbuild from 'npm:esbuild';
import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader';
import * as path from 'jsr:@std/path';

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
  return await esbuild.build({
    entryPoints: [
      {
        in: inputFile,
        out: outName,
      },
    ],
    plugins: [...denoPlugins()],
    outfile: outName,
    bundle: true,
    write: false,
    sourcemap: 'inline',
    logOverride: {
      'empty-import-meta': 'silent',
    },
  });
}

/**
 * Runs a pre-compiled esbuild result in Node.js environment.
 *
 * @param result - The esbuild BuildResult (output of compileForNodeWithEsbuild)
 * @param inspectBrk - Optional flag to enable Node.js inspector with break on start
 * @param env - Optional environment variables to set for the Node.js process
 * @returns A Promise that resolves to true if the Node.js process exits successfully, false otherwise
 */
export async function nodeRun(
  result: Awaited<ReturnType<typeof compileForNodeWithEsbuild>>,
  inspectBrk?: boolean,
  env?: Record<string, string>,
): Promise<boolean> {
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
      ...(env ? { env } : {}),
    });
    const nodeProcess = nodeCmd.spawn();
    const writer = nodeProcess.stdin.getWriter();
    await writer.write(result.outputFiles[0].contents);
    await writer.close();
    await nodeProcess.output();
    return (await nodeProcess.status).success;
  } catch (_: unknown) {
    return false;
  } finally {
    await esbuild.stop();
  }
}
