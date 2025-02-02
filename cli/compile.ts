import * as path from '@std/path';
import type { AppConfig } from '../mod.ts';
import {
  APP_ENTRY_POINT,
  staticAssetsToJS,
} from '../net/server/static-assets.ts';
import { buildAssets } from '../server/generate-static-assets.ts';
import { getGoatConfig } from '../server/config.ts';
import { generateBuildInfo } from '../server/build-info.ts';
import { notReached } from '../base/error.ts';

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

export type CompileOptions = AppConfig & ExecutableOptions;

export async function compile(options: CompileOptions): Promise<void> {
  const targetOsArch = targetFromOSArch(options.os, options.arch);
  console.log(
    `Starting compilation for ${targetFromOSArch()}`,
  );
  console.log(`Bundling assets...`);
  const entryPoints = [
    {
      in: path.resolve(options.jsPath),
      out: APP_ENTRY_POINT,
    },
  ];
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
        buildDir,
      ),
    ),
  );
  const workerTsPath = path.join(buildDir, 'file-worker.ts');
  await Deno.writeTextFile(workerTsPath, kFileWorkerCode);
  console.log(`Compiling...`);
  const outputFile = path.join(
    buildDir,
    `${options.outputName || 'app'}-${targetOsArch}`,
  );
  const compileArgs = [
    'compile',
    '-A',
    '--no-check',
    `--include=${workerTsPath}`,
    `--output=${outputFile}`,
  ];
  if (options.arch || options.os) {
    compileArgs.push(`--target=${denoTarget(options.os, options.arch)}`);
  }
  compileArgs.push(path.resolve(options.serverEntry));
  const compileLocalCmd = new Deno.Command(Deno.execPath(), {
    args: compileArgs,
  });
  const output = await compileLocalCmd.output();
  // Cleanup
  // try {
  //   await Deno.remove(assetsJsonPath);
  // } catch (_: unknown) {
  //   // Skip
  // }
  // try {
  //   await Deno.remove(buildInfoJsonPath);
  // } catch (_: unknown) {
  //   // Skip
  // }
  // try {
  //   await Deno.remove(workerTsPath);
  // } catch (_: unknown) {
  //   // Skip
  // }
  // Report result
  if (!output.success) {
    console.log('Compilation failed');
    console.error(new TextDecoder().decode(output.stdout));
    return;
  }
  console.log(`Done. Binary placed at ${outputFile}`);
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

const kFileWorkerCode =
  `import { jsonLogWorkerMain } from "@goatdb/goatdb/server";
jsonLogWorkerMain();
`;

export async function writeWorkerSkaffold(options: AppConfig): Promise<void> {
  const buildDir = path.resolve(options.buildDir);
  await Deno.mkdir(buildDir, { recursive: true });
  const workerTsPath = path.join(buildDir, 'file-worker.ts');
  await Deno.writeTextFile(workerTsPath, kFileWorkerCode);
}
