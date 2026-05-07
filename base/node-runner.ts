import type * as esbuild from 'esbuild';

// Lazy-load build-time dependencies so this module stays safe as a transitive
// import inside runtime bundles that never call the build path.
let esbuildModule: typeof import('esbuild') | undefined;
let denoPluginModule:
  | typeof import('@deno/esbuild-plugin')
  | undefined;

async function getEsbuild(): Promise<typeof import('esbuild')> {
  if (!esbuildModule) {
    const specifier = 'esbuild';
    esbuildModule = await import(specifier);
  }
  return esbuildModule;
}

async function getDenoPlugin(): Promise<
  typeof import('@deno/esbuild-plugin').denoPlugin
> {
  if (!denoPluginModule) {
    const specifier = '@deno/esbuild-plugin';
    denoPluginModule = await import(specifier);
  }
  return denoPluginModule.denoPlugin;
}

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

export interface NodeRunResult {
  success: boolean;
  exitCode: number;
  stderrText: string;
}

async function forwardAndCaptureStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) {
    return '';
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let captured = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      captured += decoder.decode(value, { stream: true });
      await Deno.stderr.write(value);
    }
    captured += decoder.decode();
    return captured;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Runs a pre-compiled esbuild result in Node.js environment.
 *
 * @param result - The esbuild BuildResult (output of compileForNodeWithEsbuild)
 * @param inspectBrk - Optional flag to enable Node.js inspector with break on start
 * @param env - Optional environment variables to set for the Node.js process
 * @returns Structured execution result including exit status and captured stderr text
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
      stderr: 'piped',
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
    const stderrPromise = forwardAndCaptureStream(nodeProcess.stderr);
    const writer = nodeProcess.stdin.getWriter();
    await writer.write(result.outputFiles![0].contents);
    await writer.close();
    const status = await nodeProcess.status;
    const stderrText = await stderrPromise;
    return {
      success: status.success,
      exitCode: status.code,
      stderrText,
    };
  } catch (error: unknown) {
    return {
      success: false,
      exitCode: -1,
      stderrText: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await esbuildModule?.stop();
    esbuildModule = undefined;
  }
}
