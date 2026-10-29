import { readFile } from 'node:fs/promises';
import * as path from '../base/path.ts';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

async function readConfig(root: string, name: string) {
  const text = await readFile(path.resolve(root, name), 'utf8');
  const result = ts.parseConfigFileTextToJson(name, text);
  if (result.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(result.error.messageText, '\n'),
    );
  }
  return result.config;
}

function binSource(target: string): string {
  if (!target.startsWith('./dist/') || !target.endsWith('.js')) {
    throw new Error(`Unsupported npm bin target: ${target}`);
  }
  return target.slice('./dist/'.length, -3) + '.ts';
}

function assertEntries(label: string, expected: string[], actual: string[]) {
  const missing = expected.filter((entry) => !actual.includes(entry));
  const extra = actual.filter((entry) => !expected.includes(entry));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} entrypoint drift: missing [${missing}]; extra [${extra}]`,
    );
  }
}

async function publicEntries(root: string): Promise<string[]> {
  const manifest = await readConfig(root, 'package.json');
  return [
    ...Object.values(manifest.exports as Record<string, string>)
      .map((entry) => path.normalize(entry)),
    ...Object.values(manifest.bin as Record<string, string>).map(binSource),
  ];
}

export async function checkNpmEntrypoints(root: string): Promise<void> {
  const expected = await publicEntries(root);
  const { default: build } = await import(
    pathToFileURL(path.resolve(root, 'tsup.config.ts')).href
  );
  const config = await readConfig(root, 'tsconfig.npm.json');
  assertEntries('tsup', expected, Object.values(build.entry));
  assertEntries(
    'tsup output',
    expected,
    Object.keys(build.entry).map((s) => s + '.ts'),
  );
  assertEntries(
    'npm types',
    expected,
    config.include.filter((s: string) => s !== 'types/**/*.d.ts'),
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  path.equals(path.resolve(invokedPath), path.fromFileUrl(import.meta.url))
) {
  await checkNpmEntrypoints(path.resolve(process.argv[2] ?? '.'));
}
