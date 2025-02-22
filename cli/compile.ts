import * as path from '@std/path';
import type { AppConfig } from '../mod.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { buildAssets } from '../server/generate-static-assets.ts';
import { getGoatConfig } from '../server/config.ts';
import { generateBuildInfo } from '../server/build-info.ts';
import { notReached } from '../base/error.ts';
import { staticAssetsToJS } from '../system-assets/system-assets.ts';

export type TargetOS = 'mac' | 'linux' | 'windows';
export type CPUArch = 'x64' | 'aar64';

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

export type CompileOptions =
  & ExecutableOptions
  & AppConfig;

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
      getGoatConfig().version,
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
    arch = Deno.build.arch === 'aarch64' ? 'aar64' : 'x64';
  }
  return `${os}-${arch}`;
}

export function denoTarget(os?: TargetOS, arch?: CPUArch): string {
  const target: OSArchTarget = targetFromOSArch(os, arch);
  switch (target) {
    case 'mac-x64':
      return 'x86_64-apple-darwin';

    case 'mac-aar64':
      return 'aarch64-apple-darwin';

    case 'linux-x64':
      return 'x86_64-unknown-linux-gnu';

    case 'linux-aar64':
      return 'aarch64-unknown-linux-gnu';

    case 'windows-x64':
      return 'x86_64-pc-windows-msvc';

    case 'windows-aar64':
      notReached(`Unsupported target: ${target}`);
  }
}
