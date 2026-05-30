import { resolveBuildEntryPath } from '../build.ts';
import { log } from '../logging/log.ts';

// Minimal esbuild Plugin type — avoids static npm import that would trigger
// @deno/loader WASM initialization in Worker contexts.
interface EsbuildPlugin {
  name: string;
  setup: (build: Record<string, unknown>) => void | Promise<void>;
}

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
  return esbuildModule!;
}

async function getDenoPlugin(): Promise<
  typeof import('@deno/esbuild-plugin').denoPlugin
> {
  if (!denoPluginModule) {
    const specifier = '@deno/esbuild-plugin';
    denoPluginModule = await import(specifier);
  }
  return denoPluginModule!.denoPlugin;
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
        in: resolveBuildEntryPath(inputFile),
        out: outName,
      },
    ],
    plugins: [denoPlugin() as unknown as EsbuildPlugin],
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

/** Timeout for Node.js subprocess execution (matching Deno worker timeout). */
const NODE_RUN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Races `promise` against a timeout. If the timeout fires first, calls
 * `onTimeout` (for cleanup like killing a subprocess) and then rejects with
 * the timeout error. Returns the original promise's resolution if it wins.
 *
 * @internal — exported for testing only; not part of the public API.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // Must not prevent the timeout rejection from executing.
      }
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export interface NodeRunResult {
  success: boolean;
  exitCode: number;
  stderrText: string;
}

async function forwardAndCaptureStream(
  stream: ReadableStream<Uint8Array> | null,
  onChunk?: (text: string) => void,
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
      const text = decoder.decode(value, { stream: true });
      captured += text;
      onChunk?.(text);
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
  let nodeProcess: Deno.ChildProcess | undefined;
  let stderrPromise: Promise<string> | undefined;
  let stderrText = '';
  let didTimeout = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
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
    nodeProcess = nodeCmd.spawn();
    const child = nodeProcess;
    stderrPromise = forwardAndCaptureStream(nodeProcess.stderr, (text) => {
      stderrText += text;
    });
    const writer = nodeProcess.stdin.getWriter();
    await writer.write(result.outputFiles![0].contents);
    await writer.close();

    // WHY: timeout must not leave a live child behind while the parent moves
    // on to later tests; wait for process teardown before returning failure.
    const status = await raceWithTimeout(
      nodeProcess.status,
      NODE_RUN_TIMEOUT_MS,
      () => {
        didTimeout = true;
        log({
          severity: 'WARNING',
          message:
            'Node.js subprocess timed out while executing `node` — sending SIGTERM',
        });
        try {
          child.kill('SIGTERM');
        } catch {
          // Process may already have exited.
        }
        // SIGKILL fallback: if SIGTERM doesn't terminate, force kill after 2s.
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Process may already have exited.
          }
        }, 2_000);
      },
    );
    stderrText = await stderrPromise;
    return {
      success: status.success,
      exitCode: status.code,
      stderrText,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (didTimeout && nodeProcess) {
      await nodeProcess.status.catch(() => undefined);
      if (killTimer !== undefined) clearTimeout(killTimer);
    }
    const capturedStderr = await stderrPromise?.catch(() => stderrText) ??
      stderrText;
    return {
      success: false,
      exitCode: -1,
      stderrText: capturedStderr
        ? `${message}\n${capturedStderr}`.trim()
        : message,
    };
  } finally {
    if (killTimer !== undefined) clearTimeout(killTimer);
    await esbuildModule?.stop();
    // Keep the cache alive for subsequent calls.
  }
}
