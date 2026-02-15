import * as path from '../base/path.ts';
import {
  adapterStubPlugin,
  getEsbuild,
  stopBackgroundCompiler,
} from '../build.ts';
import type { AppConfig } from './app-config.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { buildAssets, type BuildAssetsOptions } from './build-assets.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import { staticAssetsToJS } from '../system-assets/system-assets.ts';
import { getRuntime } from '../base/runtime/index.ts';
import type { OperatingSystem } from '../base/os.ts';
import { cli } from '../base/development.ts';
import { pathExists } from '../base/json-log/file-impl.ts';

function npxCmd(): string {
  return getRuntime().getOS() === 'windows' ? 'npx.cmd' : 'npx';
}

/**
 * Represents the target operating system for compilation.
 *
 * - 'mac': macOS operating system (maps to 'darwin' in OS-level APIs;
 *   conversion is handled by {@link targetFromOSArch})
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

/**
 * Code signing options for the compiled executable.
 * Used for macOS notarization and Windows code signing.
 */
export type SigningOptions = {
  /** macOS: Developer ID Application certificate name */
  identity?: string;
  /** macOS: Enable hardened runtime (-o runtime) */
  hardenedRuntime?: boolean;
  /** macOS: Path to entitlements file */
  entitlements?: string;
  /** macOS: Notarize after signing */
  notarize?: {
    keychainProfile: string;
    staple?: boolean;
  };
  /**
   * Windows code signing configuration.
   */
  windows?: {
    /** Path to certificate file (.pfx) for file-based signing */
    certFile?: string;
    /**
     * Password for the certificate file.
     * WARNING: Password is passed as a CLI argument and may be visible in
     * process listings. Prefer thumbprint-based signing via certificate store
     * for production.
     */
    certPassword?: string;
    /** SHA-1 thumbprint for certificate store signing */
    thumbprint?: string;
    /** Certificate store name (default: MY) */
    storeName?: string;
    /** RFC 3161 timestamp URL (e.g., http://timestamp.digicert.com) */
    timestampUrl?: string;
  };
};

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
   * Note: Cross-compilation is only supported for Deno builds.
   */
  os?: TargetOS;
  /**
   * The target CPU architecture for cross-compilation.
   * Note: Cross-compilation is only supported for Deno builds.
   */
  arch?: CPUArch;
  /**
   * Code signing options for the compiled executable.
   */
  signing?: SigningOptions;
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
 * This is a unified interface that auto-detects the runtime and uses the
 * appropriate compiler:
 * - Deno: Uses `deno compile` with cross-compilation support
 * - Node.js: Uses Single Executable Application (SEA) process
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
  if (!options.buildDir) {
    throw new Error('buildDir is required for compilation');
  }
  const runtime = getRuntime();
  let outputFile: string;
  if (runtime.id === 'deno') {
    outputFile = await compileDeno(options);
  } else if (runtime.id === 'node') {
    outputFile = await compileNodeSEA(options);
  } else {
    throw new Error(`Compilation not supported in runtime: ${runtime.id}`);
  }
  if (options.signing) {
    await signExecutable(outputFile, options.signing);
  }
}

/**
 * Bundles client assets and generates build info for embedding into executables.
 * Shared by both Deno and Node.js compile paths.
 */
async function bundleClientAssets(
  options: CompileOptions,
  runtime?: 'deno' | 'node',
  keepEsbuildAlive?: boolean,
): Promise<{ assetsJson: string; buildInfoJson: string }> {
  console.log('Bundling client code...');
  const bundlingStart = performance.now();
  const entryPoints = [
    { in: path.resolve(options.jsPath), out: APP_ENTRY_POINT },
  ];
  const minify = options.minify !== false;
  const buildAssetsOpts: BuildAssetsOptions = {
    runtime: runtime ?? 'deno',
    keepEsbuildAlive,
  };
  const assets = staticAssetsToJS(
    await buildAssets(
      undefined,
      entryPoints,
      { ...options, minify },
      buildAssetsOpts,
    ),
  );

  const configPath = runtime === 'node'
    ? (options.packageJson || path.join(getRuntime().getCWD(), 'package.json'))
    : (options.denoJson || path.join(getRuntime().getCWD(), 'deno.json'));
  if (!await pathExists(configPath)) {
    throw new Error(
      `Config file not found at "${configPath}". ` +
        `Provide ${
          runtime === 'node' ? 'packageJson' : 'denoJson'
        } or run from a directory containing one.`,
    );
  }
  const buildInfo = await generateBuildInfo(configPath);

  console.log(
    `Done. Bundling took ${
      ((performance.now() - bundlingStart) / 1000).toFixed(2)
    }sec`,
  );
  return {
    assetsJson: JSON.stringify(assets),
    buildInfoJson: JSON.stringify(buildInfo),
  };
}

/**
 * Compiles a GoatDB application using Deno's built-in compiler.
 * Supports cross-compilation to different OS/architecture targets.
 */
async function compileDeno(options: CompileOptions): Promise<string> {
  const resolvedEntry = path.resolve(options.serverEntry);
  if (!(await pathExists(resolvedEntry))) {
    throw new Error(`Server entry not found: ${resolvedEntry}`);
  }

  const targetOsArch = targetFromOSArch(options.os, options.arch);
  console.log(`Starting Deno compilation for ${targetOsArch}`);

  // keepEsbuildAlive defaults to false — esbuild self-terminates after bundling.
  const { assetsJson, buildInfoJson } = await bundleClientAssets(
    options,
    'deno',
  );

  const buildDir = path.resolve(options.buildDir!);
  try {
    await Deno.remove(buildDir, { recursive: true });
  } catch (_: unknown) {
    // Ignore
  }
  await Deno.mkdir(buildDir, { recursive: true });
  const assetsJsonPath = path.join(buildDir, 'staticAssets.json');
  const buildInfoJsonPath = path.join(buildDir, 'buildInfo.json');
  const outputFile = path.join(
    buildDir,
    `${options.outputName || 'app'}-${targetOsArch}`,
  );
  let success = false;
  try {
    await Deno.writeTextFile(assetsJsonPath, assetsJson);
    await Deno.writeTextFile(buildInfoJsonPath, buildInfoJson);
    console.log(`Compiling server executable...`);
    const compileStart = performance.now();
    const compileArgs = [
      'compile',
      '-A',
      '--no-check',
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
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Deno compilation failed. Run "deno ${
          compileArgs.join(' ')
        }" for diagnostics.\n${stderr}`,
      );
    }
    console.log(
      `Done. Compilation took ${
        ((performance.now() - compileStart) / 1000).toFixed(2)
      }sec. Binary placed at ${outputFile}`,
    );
    success = true;
  } finally {
    const cleanupPaths = [assetsJsonPath, buildInfoJsonPath];
    if (!success) {
      cleanupPaths.push(outputFile);
    }
    for (const p of cleanupPaths) {
      try {
        await Deno.remove(p);
      } catch (_: unknown) {
        // may not exist
      }
    }
  }

  return outputFile;
}

/**
 * SEA configuration file structure for Node.js Single Executable Applications.
 */
interface SEAConfig {
  main: string;
  output: string;
  disableExperimentalSEAWarning: boolean;
  useCodeCache: boolean;
  useSnapshot: boolean;
  assets?: Record<string, string>;
}

/**
 * Compiles a GoatDB application using Node.js Single Executable Application (SEA).
 *
 * SEA builds are multi-step:
 * 1. Bundle client assets (ESM for browser)
 * 2. Bundle server entry to CJS
 * 3. Generate SEA config
 * 4. Create SEA preparation blob
 * 5. Copy Node.js binary and inject blob
 * 6. Sign executable (macOS/Windows)
 *
 * Cross-compilation is not supported because Node.js binaries are
 * platform-specific (compiled C++). Unlike Deno's Rust-based cross-compiler,
 * Node.js SEA requires building on the target platform.
 *
 * @requires postject - Install with `npm install postject` (local or global)
 */
async function compileNodeSEA(options: CompileOptions): Promise<string> {
  const resolvedEntry = path.resolve(options.serverEntry);
  if (!(await pathExists(resolvedEntry))) {
    throw new Error(`Server entry not found: ${resolvedEntry}`);
  }

  const runtime = getRuntime();
  const osName = runtime.getOS();

  console.log(`Starting Node.js SEA compilation for ${osName}`);

  if (options.os || options.arch) {
    throw new Error(
      'Cross-compilation is not supported for Node.js SEA builds. ' +
        'Build targets the current platform only.',
    );
  }

  // Guard: prevent compiling from within a SEA binary (fail fast before
  // expensive bundling operations)
  let isSEA = false;
  try {
    // deno-lint-ignore no-eval
    const sea = eval("require('node:sea')");
    isSEA = typeof sea.isSea === 'function' && sea.isSea();
  } catch {
    // node:sea not available = not a SEA binary
  }
  if (isSEA) {
    throw new Error(
      'Cannot compile a Node.js SEA from within a SEA binary. ' +
        'Run compilation from a standard Node.js installation.',
    );
  }

  const buildDir = path.resolve(options.buildDir!);

  // Verify postject is available before starting expensive operations
  const postjectCheck = await cli(
    npxCmd(),
    '--no',
    'postject',
    '--help',
    { timeout: 30_000 },
  );
  if (postjectCheck.exitCode !== 0) {
    throw new Error(
      'postject is required for Node.js SEA builds but could not be found.\n' +
        'Install with: npm install postject\n' +
        `Details: ${postjectCheck.result}`,
    );
  }

  const compileStart = performance.now();
  // Clean and create build directory
  const fs = await import('node:fs/promises');
  try {
    await fs.rm(buildDir, { recursive: true });
  } catch (_: unknown) {
    // Ignore - directory may not exist
  }
  await fs.mkdir(buildDir, { recursive: true });

  // Intermediate file paths for cleanup
  const assetsJsonPath = path.join(buildDir, 'staticAssets.json');
  const buildInfoJsonPath = path.join(buildDir, 'buildInfo.json');
  const serverBundlePath = path.join(buildDir, 'server-bundle.cjs');
  const seaBlobPath = path.join(buildDir, 'sea-prep.blob');
  const seaConfigPath = path.join(buildDir, 'sea-config.json');
  const outputName = options.outputName || 'app';
  const execExt = osName === 'windows' ? '.exe' : '';
  const outputFile = path.join(buildDir, `${outputName}${execExt}`);

  let success = false;
  try {
    const { assetsJson, buildInfoJson } = await bundleClientAssets(
      options,
      'node',
      true,
    );
    await fs.writeFile(assetsJsonPath, assetsJson);
    await fs.writeFile(buildInfoJsonPath, buildInfoJson);

    // Bundle server entry to CJS
    console.log('Bundling server for SEA...');
    await bundleServerForSEA(options.serverEntry, serverBundlePath);

    // Generate SEA config
    console.log('Generating SEA configuration...');
    const seaConfig: SEAConfig = {
      main: serverBundlePath,
      output: seaBlobPath,
      disableExperimentalSEAWarning: true,
      useCodeCache: true,
      useSnapshot: false,
      assets: {
        'staticAssets.json': assetsJsonPath,
        'buildInfo.json': buildInfoJsonPath,
      },
    };
    await fs.writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2));

    // Generate SEA blob
    console.log('Generating SEA blob...');
    const seaResult = await cli(
      'node',
      '--experimental-sea-config',
      seaConfigPath,
      { cwd: buildDir, timeout: 120_000 },
    );
    if (seaResult.exitCode !== 0) {
      throw new Error(`Failed to generate SEA blob: ${seaResult.result}`);
    }

    // Copy Node.js binary
    console.log('Creating executable...');
    await fs.copyFile(runtime.getExecPath(), outputFile);
    if (osName !== 'windows') {
      await fs.chmod(outputFile, 0o755);
    }

    // Inject SEA blob using postject
    await injectBlob(outputFile, seaBlobPath, osName);
    success = true;
  } finally {
    try {
      await stopBackgroundCompiler();
    } catch {
      // Must not mask the original error
    }
    const cleanupPaths = [
      assetsJsonPath,
      buildInfoJsonPath,
      serverBundlePath,
      seaConfigPath,
      seaBlobPath,
    ];
    // Remove partial binary on failure
    if (!success) {
      cleanupPaths.push(outputFile);
    }
    for (const p of cleanupPaths) {
      try {
        await fs.rm(p);
      } catch (_: unknown) {
        // may not exist
      }
    }
  }

  console.log(
    `Done. Compilation took ${
      ((performance.now() - compileStart) / 1000).toFixed(2)
    }sec. Binary placed at ${outputFile}`,
  );
  return outputFile;
}

/**
 * Bundles the server entry point to CJS format for SEA embedding.
 */
async function bundleServerForSEA(
  entry: string,
  output: string,
): Promise<void> {
  const esbuild = await getEsbuild();
  // Fallback should track the minimum supported Node.js major version
  const nodeMajor = getRuntime().getSystemInfo().version?.split('.')[0] ||
    '20';
  const result = await esbuild.build({
    entryPoints: [path.resolve(entry)],
    plugins: [adapterStubPlugin(['deno', 'browser'])],
    bundle: true,
    platform: 'node',
    target: `node${nodeMajor}`,
    format: 'cjs',
    outfile: output,
    minify: true,
    define: { '__BUNDLE_TARGET__': '"node"' },
    // External packages:
    // - node:* - Node.js built-ins
    // - Build-time dependencies that shouldn't be in runtime bundle
    // Note: JSR packages (@std/*) are resolved from node_modules (via Deno's
    // nodeModulesDir setting) and bundled into the SEA binary.
    external: [
      'node:*',
      'esbuild', // Defense-in-depth: also hidden via eval() import
      '@luca/esbuild-deno-loader', // Deno-specific build plugin
      '@jsr/luca__esbuild-deno-loader', // JSR-imported version
    ],
    logLevel: 'warning',
  });
  if (result.errors.length > 0) {
    throw new Error(
      `Server bundle failed:\n${result.errors.map((e) => e.text).join('\n')}`,
    );
  }
}

/**
 * Injects the SEA blob into the executable using postject.
 * Handles platform-specific signing requirements.
 */
async function injectBlob(
  execPath: string,
  blobPath: string,
  osName: OperatingSystem,
): Promise<void> {
  const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

  if (osName === 'darwin') {
    // macOS: Remove existing signature before injection
    console.log('Removing macOS code signature for injection...');
    const removeResult = await cli('codesign', '--remove-signature', execPath, {
      timeout: 120_000,
    });
    if (removeResult.exitCode !== 0) {
      throw new Error(
        `Failed to remove macOS signature: ${removeResult.result}`,
      );
    }

    // Inject with macOS-specific segment
    const injectResult = await cli(
      npxCmd(),
      '--no',
      'postject',
      execPath,
      'NODE_SEA_BLOB',
      blobPath,
      '--sentinel-fuse',
      sentinelFuse,
      '--macho-segment-name',
      'NODE_SEA',
      { timeout: 120_000 },
    );
    if (injectResult.exitCode !== 0) {
      throw new Error(`postject failed: ${injectResult.result}`);
    }

    // Ad-hoc sign after injection
    console.log('Ad-hoc signing macOS executable...');
    const adHocResult = await cli('codesign', '--sign', '-', execPath, {
      timeout: 120_000,
    });
    if (adHocResult.exitCode !== 0) {
      throw new Error(
        `Failed to ad-hoc sign macOS executable: ${adHocResult.result}`,
      );
    }
  } else {
    // Linux/Windows: Standard postject
    const injectResult = await cli(
      npxCmd(),
      '--no',
      'postject',
      execPath,
      'NODE_SEA_BLOB',
      blobPath,
      '--sentinel-fuse',
      sentinelFuse,
      { timeout: 120_000 },
    );
    if (injectResult.exitCode !== 0) {
      throw new Error(`postject failed: ${injectResult.result}`);
    }
  }
}

/**
 * Signs the compiled executable for distribution.
 * Supports macOS codesign/notarization and Windows signtool.
 */
async function signExecutable(
  execPath: string,
  options: SigningOptions,
): Promise<void> {
  const runtime = getRuntime();
  const osName = runtime.getOS();

  if (!await pathExists(execPath)) {
    throw new Error(`Executable not found at "${execPath}". Cannot sign.`);
  }

  if (osName === 'darwin') {
    // macOS signing
    if (!options.identity && options.notarize) {
      throw new Error(
        'Notarization requires a Developer ID signing identity. ' +
          'Set the "identity" option to your Developer ID Application certificate name.',
      );
    }
    if (!options.identity) {
      console.warn(
        'Warning: No signing identity provided. Using ad-hoc signing (not suitable for distribution).',
      );
    }
    const identity = options.identity || '-'; // Ad-hoc if not specified
    const args = ['--sign', identity];

    if (options.hardenedRuntime) {
      args.push('-o', 'runtime');
    }
    if (options.entitlements) {
      if (!await pathExists(options.entitlements)) {
        throw new Error(
          `Entitlements file not found at "${options.entitlements}".`,
        );
      }
      args.push('--entitlements', options.entitlements);
    }
    // --force: replaces the ad-hoc signature applied after postject blob injection
    args.push('--force');
    if (identity !== '-') {
      args.push('--timestamp');
    }
    args.push(execPath);

    console.log('Signing macOS executable...');
    const signResult = await cli('codesign', ...args, { timeout: 120_000 });
    if (signResult.exitCode !== 0) {
      throw new Error(`Code signing failed: ${signResult.result}`);
    }

    // Notarization (optional)
    if (options.notarize) {
      console.log('Submitting for notarization...');
      const notarizeResult = await cli(
        'xcrun',
        'notarytool',
        'submit',
        execPath,
        '--keychain-profile',
        options.notarize.keychainProfile,
        '--wait',
        { timeout: 600_000 },
      );
      if (notarizeResult.exitCode !== 0) {
        throw new Error(`Notarization failed: ${notarizeResult.result}`);
      }

      // Staple by default unless explicitly disabled
      if (options.notarize.staple !== false) {
        console.log('Stapling notarization ticket...');
        const stapleResult = await cli('xcrun', 'stapler', 'staple', execPath, {
          timeout: 120_000,
        });
        if (stapleResult.exitCode !== 0) {
          console.warn(
            `Warning: Stapling failed. Binary is notarized but offline verification won't work: ${stapleResult.result}`,
          );
        }
      }
    }
  } else if (osName === 'windows') {
    const windowsOpts = options.windows;

    if (windowsOpts?.thumbprint) {
      // Thumbprint-based signing (certificate store)
      console.log('Signing Windows executable via certificate store...');
      const args = ['sign', '/fd', 'SHA256', '/sha1', windowsOpts.thumbprint];
      args.push('/s', windowsOpts.storeName || 'MY');
      if (windowsOpts.timestampUrl) {
        args.push('/tr', windowsOpts.timestampUrl, '/td', 'SHA256');
      }
      args.push(execPath);
      const signResult = await cli('signtool', ...args, { timeout: 120_000 });
      if (signResult.exitCode !== 0) {
        throw new Error(`Code signing failed: ${signResult.result}`);
      }
    } else if (windowsOpts?.certFile) {
      // File-based signing
      if (!await pathExists(windowsOpts.certFile)) {
        throw new Error(
          `Certificate file not found at "${windowsOpts.certFile}".`,
        );
      }
      console.log('Signing Windows executable via certificate file...');
      const args = ['sign', '/fd', 'SHA256', '/f', windowsOpts.certFile];
      if (windowsOpts.certPassword) {
        console.warn(
          'Warning: certPassword is passed as a CLI argument and may be visible in process listings. ' +
            'Prefer thumbprint-based signing via certificate store for production.',
        );
        args.push('/p', windowsOpts.certPassword);
      }
      if (windowsOpts.timestampUrl) {
        args.push('/tr', windowsOpts.timestampUrl, '/td', 'SHA256');
      }
      args.push(execPath);
      const signResult = await cli('signtool', ...args, { timeout: 120_000 });
      if (signResult.exitCode !== 0) {
        throw new Error(`Code signing failed: ${signResult.result}`);
      }
    } else {
      console.warn(
        'Warning: Signing requested for Windows but no certificate configuration provided. ' +
          'Set signing.windows.thumbprint or signing.windows.certFile.',
      );
    }
  } else {
    console.warn(
      `Warning: Code signing is not supported on ${osName}. The signing options will be ignored.`,
    );
  }
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
  const runtime = getRuntime();

  if (!os) {
    const currentOS = runtime.getOS();
    switch (currentOS) {
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
    const sysInfo = runtime.getSystemInfo();
    if (sysInfo.arch === 'arm64' || sysInfo.arch === 'aarch64') {
      arch = 'arm64';
    } else {
      if (sysInfo.arch !== 'x64' && sysInfo.arch !== 'x86_64') {
        console.warn(
          `Unknown architecture "${sysInfo.arch}", defaulting to x64`,
        );
      }
      arch = 'x64';
    }
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
      throw new Error(
        'Windows ARM64 is not supported as a Deno compilation target',
      );
  }
}
