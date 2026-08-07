import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

// Docs dependencies come from `deno task docs:install` (npm ci); fail with an
// actionable message when they are missing (e.g. fresh clone).
let ts;
try {
  ts = (await import('typescript')).default;
} catch {
  process.stderr.write(
    'docs/node_modules missing - run: deno task docs:install\n',
  );
  process.exit(1);
}

const docsDir = join(import.meta.dirname, 'docs');
const rootDir = join(import.meta.dirname, '..');
const llmsPath = join(rootDir, 'llms.txt');
// Markdown links terminate before `)` and `#`; keeping them out makes route checks match
// the URL rather than link punctuation.
const docsUrlPattern = /https:\/\/goatdb\.dev\/docs\/[^\s)#]+/g;
const validationPattern = /(?:^|\s)validate=([^\s]*)(?=\s|$)/;
const validationModes = new Set(['module', 'object-member', 'off']);
const validatedLanguages = new Set(['ts', 'tsx', 'typescript']);

function sourceLine(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function relativePath(path) {
  return relative(rootDir, path);
}

function markdownFiles() {
  return readdirSync(docsDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(docsDir, name));
}

function explicitSlug(text) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  return frontmatter?.[1].match(/^slug:\s*([^\s#]+)\s*$/m)?.[1];
}

function collectSlugs(files, errors) {
  const slugs = new Set();
  for (const file of files) {
    // Docusaurus derives the route from the filename when no slug is set.
    const slug = explicitSlug(readFileSync(file, 'utf8')) ??
      `/${basename(file, '.md')}`;
    if (slugs.has(slug)) {
      errors.push(`${relativePath(file)}: duplicate slug ${slug}`);
    }
    slugs.add(slug);
  }
  return slugs;
}

function validateLlmsUrls(slugs, errors) {
  const text = readFileSync(llmsPath, 'utf8');
  for (const match of text.matchAll(docsUrlPattern)) {
    const route = new URL(match[0]).pathname.slice('/docs'.length).replace(
      /\/$/,
      '',
    );
    if (slugs.has(route)) continue;
    const line = sourceLine(text, match.index);
    errors.push(
      `${relativePath(llmsPath)}:${line}: unknown docs route ${route}`,
    );
  }
}

function fence(line) {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return undefined;
  return { char: match[1][0], length: match[1].length, info: match[2].trim() };
}

function parseCode(code, mode, language) {
  const prefix = mode === 'object-member' ? 'const value = {\n' : '';
  const suffix = mode === 'object-member' ? '\n};' : '';
  const scriptKind = language === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    'snippet.ts',
    prefix + code + suffix,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  return { source, wrapperOffset: mode === 'object-member' ? 1 : 0 };
}

function diagnosticError(source, diagnostic, file, line, wrapperOffset) {
  const diagnosticLine = sourceLine(source.text, diagnostic.start ?? 0);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  return `${file}:${line + diagnosticLine - wrapperOffset - 1}: ${message}`;
}

function reportDiagnostics(code, mode, language, file, line, errors) {
  const { source, wrapperOffset } = parseCode(code, mode, language);
  for (const diagnostic of source.parseDiagnostics) {
    errors.push(diagnosticError(source, diagnostic, file, line, wrapperOffset));
  }
}

function closeFence(open, current) {
  return current?.char === open.char && current.length >= open.length;
}

function validationMode(info, file, line, errors) {
  const match = info.match(validationPattern);
  if (!match) return undefined;
  const mode = match[1];
  if (validationModes.has(mode)) return mode;
  errors.push(`${relativePath(file)}:${line}: unknown validation mode ${mode}`);
}

function openFence(current, index, file, errors) {
  const language = current.info.split(/\s+/)[0];
  // TS fences are validated by default; `validate=off` opts out (pseudo-code).
  const mode = validationMode(current.info, file, index + 1, errors) ??
    (validatedLanguages.has(language) ? 'module' : undefined);
  return { ...current, mode, language, code: [], line: index + 2 };
}

function reportFence(open, file, errors) {
  if (open.mode === 'off') return;
  reportDiagnostics(
    open.code.join('\n'),
    open.mode,
    open.language,
    relativePath(file),
    open.line,
    errors,
  );
}

function validateFences(file, errors) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let open;
  for (let index = 0; index < lines.length; index++) {
    const current = fence(lines[index]);
    if (!open && current) open = openFence(current, index, file, errors);
    else if (open && closeFence(open, current)) {
      if (open.mode) reportFence(open, file, errors);
      open = undefined;
    } else if (open?.mode) open.code.push(lines[index]);
  }
  if (open?.mode) {
    errors.push(`${relativePath(file)}:${open.line}: unclosed validated fence`);
  }
}

function main() {
  const errors = [];
  const files = markdownFiles();
  validateLlmsUrls(collectSlugs(files, errors), errors);
  for (const file of files) validateFences(file, errors);
  if (errors.length) throw new Error(errors.join('\n'));
}

try {
  main();
  process.stdout.write('Documentation content validation passed.\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
