import * as esbuild from 'npm:esbuild';
import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader';
import * as path from 'jsr:@std/path';

/**
 * Compiles and runs a TypeScript file in Node.js environment.
 *
 * This function uses esbuild to compile the TypeScript file into JavaScript,
 * then pipes the compiled output directly to a Node.js process. It handles
 * bundling dependencies and generating inline sourcemaps for better debugging.
 *
 * @param inputFile - Path to the TypeScript file to run
 * @param inspectBrk - Optional flag to enable Node.js inspector with break on
 *                     start
 * @param env - Optional environment variables to set for the Node.js process
 * @returns A Promise that resolves to true if the Node.js process exits
 *          successfully, false otherwise
 */
export async function nodeRun(
  inputFile: string,
  inspectBrk?: boolean,
  env?: Record<string, string>,
): Promise<boolean> {
  inputFile = path.resolve(Deno.cwd(), inputFile);
  const outName = path.basename(inputFile).replace('.ts', '');
  const entryPoints = [
    {
      in: inputFile,
      out: outName,
    },
  ];

  try {
    const result = await esbuild.build({
      entryPoints,
      plugins: [...denoPlugins()],
      outfile: outName,
      bundle: true,
      write: false,
      sourcemap: 'inline',
      logOverride: {
        'empty-import-meta': 'silent',
      },
    });
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
