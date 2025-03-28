import * as path from '@std/path';
import type { AppConfig } from '../mod.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { buildAssets } from '../server/generate-static-assets.ts';
import { generateBuildInfo } from '../server/build-info.ts';
import { notReached } from '../base/error.ts';
import { staticAssetsToJS } from '../system-assets/system-assets.ts';

/**
 * Represents the target operating system for compilation.
 *
 * - 'mac': macOS operating system
 * - 'linux': Linux operating system
 * - 'windows': Windows operating system
 */
export type TargetOS = 'mac' | 'linux' | 'windows';
/**
 * Represents the CPU architecture for compilation.
 *
 * - 'x64': 64-bit x86 architecture (Intel/AMD)
 * - 'arm64': 64-bit ARM architecture (Apple Silicon, ARM-based servers)
 */
export type CPUArch = 'x64' | 'arm64';

/**
 * Represents a combined target of operating system and CPU architecture.
 *
 * Format is "{os}-{arch}" such as "mac-arm64" or "linux-x64".
 *
 * This type is used to specify the complete target platform for compilation.
 */
export type OSArchTarget = `${TargetOS}-${CPUArch}`;

export type ExecutableOptions = {
  /**
   * Path to main server entry file.
   */
  serverEntry: string;
  /**
   * Where to place the resulting executable.
   * Default: "app".
   */
  outputName?: string;
  /**
   * The target OS for cross-compilation.
   */
  os?: TargetOS;
  /**
   * The target CPU architecture for cross-compilation.
   */
  arch?: CPUArch;
};

/**
 * Options for compiling a GoatDB application into a standalone executable.
 *
 * This combines executable build options with application configuration.
 *
 * @example
 * ```typescript
 * await compile({
 *   serverEntry: "./server/main.ts",
 *   outputName: "my-app",
 *   os: "linux",
 *   arch: "x64",
 *   // App config options
 *   htmlPath: "./public/index.html",
 *   jsPath: "./client/index.tsx",
 *   buildDir: "./build"
 * });
 * ```
 */
export type CompileOptions =
  & ExecutableOptions
  & AppConfig;

/**
 * Compiles a GoatDB application into a standalone executable.
 *
 * This function performs the following steps:
 * 1. Bundles client-side code (JS/TS/TSX) into a single JavaScript file
 * 2. Processes static assets (HTML, CSS, images, etc.)
 * 3. Generates build information
 * 4. Compiles the server entry point into a native executable for the target
 *    platform
 *
 * @param options Configuration options for the compilation process
 * @returns A Promise that resolves when compilation is complete
 *
 * @example
 * ```typescript
 * await compile({
 *   serverEntry: "./server/main.ts",
 *   outputName: "my-app",
 *   os: "linux",
 *   arch: "x64",
 *   htmlPath: "./public/index.html",
 *   jsPath: "./client/index.tsx",
 *   buildDir: "./build"
 * });
 * ```
 */
export async function compile(options: CompileOptions): Promise<void> {
  const targetOsArch = targetFromOSArch(options.os, options.arch);
  console.log(
    `Starting compilation for ${targetOsArch}`,
  );
  console.log(`Bundling client code...`);
  const bundlingStart = performance.now();
  const entryPoints = [
    {
      in: path.resolve(options.jsPath),
      out: APP_ENTRY_POINT,
    },
  ];
  // Default to minified code for executable builds
  if (options.minify !== false) {
    options.minify = true;
  }
  const assets = staticAssetsToJS(
    await buildAssets(
      undefined,
      entryPoints,
      options,
    ),
  );
  const buildDir = path.resolve(options.buildDir);
  try {
    await Deno.remove(buildDir, { recursive: true });
  } catch (_: unknown) {
    // Ignore
  }
  await Deno.mkdir(buildDir, { recursive: true });
  const assetsJsonPath = path.join(buildDir, 'staticAssets.json');
  await Deno.writeTextFile(assetsJsonPath, JSON.stringify(assets));
  const buildInfoJsonPath = path.join(buildDir, 'buildInfo.json');
  await Deno.writeTextFile(
    buildInfoJsonPath,
    JSON.stringify(
      await generateBuildInfo(
        options.denoJson || path.join(Deno.cwd(), 'deno.json'),
      ),
    ),
  );
  console.log(
    `Done. Bundling took ${
      ((performance.now() - bundlingStart) / 1000).toFixed(2)
    }sec`,
  );
  console.log(`Compiling server executable...`);
  const compileStart = performance.now();
  // const workerTsPath = path.join(buildDir, 'file-worker.ts');
  // await Deno.writeTextFile(workerTsPath, kFileWorkerCode);
  // console.log(`Compiling...`);
  const outputFile = path.join(
    buildDir,
    `${options.outputName || 'app'}-${targetOsArch}`,
  );
  const compileArgs = [
    'compile',
    '-A',
    '--no-check',
    // `--include=${
    //   path.join(
    //     await getDependencyURL(options.denoJson),
    //     'base/json-log/json-log-worker-entry.ts',
    //   )
    // }`,
    `--output=${outputFile}`,
  ];
  if (options.arch || options.os) {
    compileArgs.push(`--target=${denoTarget(options.os, options.arch)}`);
  }
  if (options.denoJson) {
    compileArgs.push(`--config=${options.denoJson}`);
  }
  compileArgs.push(path.resolve(options.serverEntry));
  const compileLocalCmd = new Deno.Command(Deno.execPath(), {
    args: compileArgs,
  });
  const output = await compileLocalCmd.output();
  // Report result
  if (!output.success) {
    console.log('Compilation failed');
    console.info(`For diagnostics run "deno ${compileArgs.join(' ')}"`);
    console.error(new TextDecoder().decode(output.stdout));
    return;
  }
  console.log(
    `Done. Compilation took ${
      ((performance.now() - compileStart) / 1000).toFixed(2)
    }sec. Binary placed at ${outputFile}`,
  );
}

/**
 * Converts OS and architecture parameters to a standardized target format.
 *
 * @param os The target operating system. If not provided, defaults to the
 *           current OS.
 * @param arch The target CPU architecture. If not provided, defaults to the
 *             current architecture.
 * @returns A standardized string in the format "{os}-{arch}" representing the
 *          target platform.
 */
export function targetFromOSArch(os?: TargetOS, arch?: CPUArch): OSArchTarget {
  if (!os) {
    switch (Deno.build.os) {
      case 'darwin':
        os = 'mac';
        break;

      case 'windows':
        os = 'windows';
        break;

      default:
        os = 'linux';
        break;
    }
  }
  if (!arch) {
    arch = Deno.build.arch === 'aarch64' ? 'arm64' : 'x64';
  }
  return `${os}-${arch}`;
}

/**
 * Converts GoatDB OS and architecture parameters to Deno's target format.
 *
 * @param os The target operating system. If not provided, defaults to the
 *           current OS.
 * @param arch The target CPU architecture. If not provided, defaults to the
 *             current architecture.
 * @returns A standardized string in Deno's target format (e.g.,
 *          'x86_64-apple-darwin') that can be used with Deno's compilation
 *          tools.
 * @throws Error when an unsupported target is specified.
 */
export function denoTarget(os?: TargetOS, arch?: CPUArch): string {
  const target: OSArchTarget = targetFromOSArch(os, arch);
  switch (target) {
    case 'mac-x64':
      return 'x86_64-apple-darwin';

    case 'mac-arm64':
      return 'aarch64-apple-darwin';

    case 'linux-x64':
      return 'x86_64-unknown-linux-gnu';

    case 'linux-arm64':
      return 'aarch64-unknown-linux-gnu';

    case 'windows-x64':
      return 'x86_64-pc-windows-msvc';

    case 'windows-arm64':
      notReached(`Unsupported target: ${target}`);
  }
}
