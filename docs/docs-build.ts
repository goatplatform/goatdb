import { zip } from '@deno-library/compress';
import { dirname, fromFileUrl, join } from '@std/path';

const DOCS_DIR = dirname(fromFileUrl(import.meta.url));
const ROOT_DIR = dirname(DOCS_DIR);
const DOCUSAURUS_BUILD_DIR = join(DOCS_DIR, 'build');
const BUILD_DIR = join(ROOT_DIR, 'build', 'docs');
const BUILD_ARCHIVE = join(ROOT_DIR, 'build', 'docs.zip');
const NPM_COMMAND = Deno.build.os === 'windows' ? 'npm.cmd' : 'npm';

async function runNpmScript(script: string, ...args: string[]): Promise<void> {
  const child = new Deno.Command(NPM_COMMAND, {
    args: ['run', script, '--', ...args],
    cwd: DOCS_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
  const status = await child.status;
  if (!status.success) {
    throw new Error(`npm run ${script} failed with code ${status.code}`);
  }
}

async function removePath(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function prepareBuild(): Promise<void> {
  await Promise.all([
    removePath(DOCUSAURUS_BUILD_DIR),
    removePath(BUILD_DIR),
    removePath(BUILD_ARCHIVE),
  ]);
  await Deno.mkdir(dirname(BUILD_DIR), { recursive: true });
}

export async function buildDocs(): Promise<void> {
  await prepareBuild();
  await runNpmScript('build');
  await Deno.rename(DOCUSAURUS_BUILD_DIR, BUILD_DIR);
  await zip.compress(BUILD_DIR, BUILD_ARCHIVE, { excludeSrc: true });
  console.log(
    `Docs build completed successfully: ${BUILD_DIR} and ${BUILD_ARCHIVE}`,
  );
}

async function serveDocs(): Promise<void> {
  await runNpmScript('start');
}

if (import.meta.main) {
  const command = Deno.args[0];
  if (command === 'build') {
    await buildDocs();
  } else if (command === 'serve') {
    await serveDocs();
  } else {
    throw new Error('Usage: docs-build.ts <build|serve>');
  }
}
