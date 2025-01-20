import yargs from 'yargs';
import * as path from '@std/path';
import { defaultAssetsBuild } from './generate-static-assets.ts';
import { VCurrent } from '../base/version-number.ts';
import { getRepositoryPath } from '../base/development.ts';
import { tuple4ToString } from '../base/tuple.ts';
import { type BuildChannel, generateBuildInfo } from './build-info.ts';

export type TargetOS = 'mac' | 'linux' | 'windows';
export type CPUArch = 'x64' | 'aar64';

interface BuildSpec {
  os?: TargetOS;
  channel?: BuildChannel;
  arch?: CPUArch;
}

async function hashFile(
  inputFilePath: string,
  outputFilePath?: string,
): Promise<void> {
  const file = await Deno.readFile(inputFilePath);
  console.log(`Generating SHA-512 checksum for ${inputFilePath}...`);
  const checksum = await crypto.subtle.digest('SHA-512', file);
  if (outputFilePath === undefined) {
    outputFilePath = inputFilePath + '.sha512';
  }
  try {
    await Deno.remove(outputFilePath, { recursive: true });
  } catch (_: unknown) {
    //
  }
  await Deno.writeFile(outputFilePath, new Uint8Array(checksum));
  console.log(`Checksum written successfully to ${outputFilePath}`);
}

async function build(repoPath: string, spec: BuildSpec): Promise<void> {
  console.log(
    `Generating ${target} executable for ${linux ? 'linux' : Deno.build.os}...`,
  );
  const fileName = outputFileName(target, linux, channel);
  const outputDir = path.join(repoPath, 'build');
  const binaryOutputPath = path.join(outputDir, fileName);
  Deno.chdir(repoPath);
  const compileArgs = [
    'compile',
    '-A',
    '--lock-write',
    '--no-check',
    // '--v8-flags=--predictable',
    '--allow-read',
    '--allow-env',
    '--allow-run',
    '--allow-sys',
    '--allow-write',
    '--allow-net',
    `--output=${binaryOutputPath}`,
    // '--include',
    // path.join('.', 'server', 'sqlite3-worker.ts'),
  ];
  if (linux) {
    compileArgs.push('--target=x86_64-unknown-linux-gnu');
  }
  if (target === 'server') {
    // compileArgs.push('--unstable');
    // compileArgs.push('--allow-ffi');
    compileArgs.push(path.join(repoPath, 'server', 'run-server.ts'));
  } else {
    compileArgs.push(
      path.join(repoPath, 'server-control', 'server-control.ts'),
    );
  }
  const compileLocalCmd = new Deno.Command('deno', {
    args: compileArgs,
  });
  const output = await compileLocalCmd.output();
  if (!output.success) {
    console.log('Build failed');
    return;
  }
}

function colorForChannel(channel: BuildChannel): string {
  switch (channel) {
    case 'alpha':
      return 'blue';

    case 'beta':
      return 'green';

    case 'release':
      return 'red';
  }
}

async function main(): Promise<void> {
  const args: BuildSpec = yargs(Deno.args)
    .option('upload', {
      type: 'boolean',
      default: false,
      description:
        'Whether or not to upload the resulting binaries to S3 for release',
    })
    .option('linux', {
      type: 'boolean',
      default: false,
      description: `If supplied, will generate x64 linux build rather than ${Deno.build.os} build`,
    })
    .option('both', {
      type: 'boolean',
      default: false,
      description: `If supplied, will build both server and control binaries`,
    })
    .option('beta', {
      type: 'boolean',
      default: false,
      description: `If supplied, will generate beta channel build`,
    })
    .option('release', {
      type: 'boolean',
      default: false,
      description: `If supplied, will generate release channel build`,
    })
    .parse();

  let channel: BuildChannel = 'alpha';
  if (args?.beta === true) {
    channel = 'beta';
  } else if (args?.release === true) {
    channel = 'release';
  }
  if (args?.upload === true && args?.linux === true) {
    console.log(
      `%cUpdating %c${channel}%c channel...`,
      'color: default',
      `color: ${colorForChannel(channel)}`,
      'color: default',
    );
    if (channel === 'beta') {
      alert('Press enter to start');
    } else if (channel === 'release') {
      if (!confirm('Are you sure?')) {
        return;
      }
    }
  }

  console.log(`Building based on version ${tuple4ToString(VCurrent)}`);
  const repoPath = await getRepositoryPath();
  const buildDirPath = path.join(repoPath, 'build');
  try {
    await Deno.remove(buildDirPath, { recursive: true });
  } catch (_: unknown) {}
  await Deno.mkdir(buildDirPath, { recursive: true });
  const controlBuild = args?.control === true;
  if (!controlBuild) {
    await defaultAssetsBuild();
  }

  await Deno.writeTextFile(
    path.join(buildDirPath, 'build-info.json'),
    JSON.stringify(generateBuildInfo(channel)),
  );
  if (args?.both === true) {
    await Promise.all([
      build(repoPath, args?.linux === true, 'server', channel),
      build(repoPath, args?.linux === true, 'control', channel),
    ]);
  } else {
    await build(
      repoPath,
      args?.linux === true,
      controlBuild ? 'control' : 'server',
      channel,
    );
  }
}

if (import.meta.main) {
  main();
}
