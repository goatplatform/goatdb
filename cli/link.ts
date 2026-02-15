/**
 * This is a CLI used to link a local GoatDB development environment.
 * It handles configuration file management and Git integration for local
 * development.
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB/Link
 *
 * @description
 * The main responsibilities of this module are:
 *
 * 1. Managing the goat.link.json configuration file which contains local
 *    development settings
 * 2. Handling .gitignore entries to prevent committing local config files
 * 3. Setting up proper file paths and configurations for local development
 *
 * This allows developers to:
 * - Link their local GoatDB instance to development projects
 * - Maintain separate configurations between development and production
 * - Avoid accidentally committing development configurations
 *
 * @example
 *
 * Link a local GoatDB instance to a development project:
 * ```bash
 * deno run -A jsr:@goatdb/goatdb/link link <local-goatdb-path>
 * ```
 *
 * Unlink a local GoatDB instance from a development project:
 * ```bash
 * deno run -A jsr:@goatdb/goatdb/link unlink
 * ```
 */

import * as path from '../base/path.ts';
import { prettyJSON } from '../base/common.ts';
import { getRuntime } from '../base/runtime/index.ts';
import {
  FileImplGet,
  mkdir,
  pathExists,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import { exit } from '../base/process.ts';
import type { JSONValue } from '../base/interfaces.ts';

async function writeTextFileOrThrow(
  filePath: string,
  text: string,
): Promise<void> {
  if (!await writeTextFile(filePath, text)) {
    throw new Error(`Failed to write file: ${filePath}`);
  }
}

/**
 * Adds the GoatDB link configuration file to .gitignore if not already present.
 * This ensures the local link configuration isn't committed to version control.
 *
 * The function:
 * 1. Reads the current .gitignore file
 * 2. Checks if goat.link.json is already ignored
 * 3. If not present, appends it with a section header
 * 4. Writes the updated content back to .gitignore
 */
const GITIGNORE_MARKER_START = '# GoatDB link - start';
const GITIGNORE_MARKER_END = '# GoatDB link - end';

async function applyGitIgnoreChanges(
  projectType: 'deno' | 'node',
  cwd?: string,
): Promise<void> {
  const ignorePath = path.join(
    cwd ?? (await FileImplGet()).getCWD(),
    '.gitignore',
  );
  let gitIgnore = await readTextFile(ignorePath) || '';
  if (gitIgnore.includes(GITIGNORE_MARKER_START)) {
    return;
  }
  let entries = 'goat.link.json';
  if (projectType === 'deno') {
    entries += '\ndeno.json\nvendor/';
  } else if (projectType === 'node') {
    entries += '\npackage.json';
  }
  const sep = gitIgnore.length === 0 || gitIgnore.endsWith('\n') ? '' : '\n';
  gitIgnore +=
    `${sep}${GITIGNORE_MARKER_START}\n${entries}\n${GITIGNORE_MARKER_END}\n`;
  await writeTextFileOrThrow(ignorePath, gitIgnore);
}

/**
 * Removes the GoatDB link configuration entries from .gitignore.
 * This reverts the changes made by applyGitIgnoreChanges().
 *
 * The function:
 * 1. Reads the current .gitignore file
 * 2. Filters out the GoatDB section header and related entries
 * 3. Writes the cleaned content back to .gitignore
 */
async function revertGitIgnoreChanges(cwd?: string): Promise<void> {
  const ignorePath = path.join(
    cwd ?? (await FileImplGet()).getCWD(),
    '.gitignore',
  );
  const content = await readTextFile(ignorePath) || '';
  if (!content.includes(GITIGNORE_MARKER_START)) return;
  const lines = content.split('\n');
  const result: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.trim() === GITIGNORE_MARKER_START) {
      inBlock = true;
      continue;
    }
    if (line.trim() === GITIGNORE_MARKER_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) {
      result.push(line);
    }
  }
  await writeTextFileOrThrow(ignorePath, result.join('\n').trimEnd() + '\n');
}

type DenoJson = {
  imports: Record<string, string>;
  [key: string]: JSONValue;
};

export const goatEntryPoints = {
  '': 'mod.ts',
  '/react': 'react/hooks.ts',
  '/server': 'server.ts',
  '/server/build': 'server-build.ts',
  '/init': 'cli/init.ts',
  '/link': 'cli/link.ts',
} as const;

type GoatLinkJson = {
  imports?: Record<string, string>;
  dependencies?: Record<string, string>;
  injectedImportKeys?: string[];
  goatdbImportKeys?: string[];
  localGoatDBPath: string;
};

/**
 * Creates a symlink for local GoatDB development.
 * This allows deno compile to properly bundle local GoatDB sources.
 *
 * @param cwd - Current working directory of the project
 * @param localGoatDBPath - Path to local GoatDB directory
 */
async function createGoatDBSymlink(
  cwd: string,
  localGoatDBPath: string,
): Promise<void> {
  if (getRuntime().id !== 'deno') {
    throw new Error(
      'Symlink-based linking is only supported in Deno. ' +
        'Node.js projects use the file: protocol in package.json instead.',
    );
  }
  const vendorDir = path.join(cwd, 'vendor');
  const symlinkPath = path.join(vendorDir, 'goatdb');

  await mkdir(vendorDir);

  // Remove existing symlink if present
  const fileImpl = await FileImplGet();
  try {
    await fileImpl.remove(symlinkPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const isNotFound = msg.includes('ENOENT') ||
      (getRuntime().id === 'deno' && e instanceof Deno.errors.NotFound);
    if (!isNotFound) {
      throw e;
    }
  }

  // Create symlink to local GoatDB
  try {
    await Deno.symlink(path.resolve(cwd, localGoatDBPath), symlinkPath, {
      type: 'dir',
    });
  } catch (e: unknown) {
    const msg = (e as Error).message || '';
    if (msg.includes('requires elevated privileges') || msg.includes('1314')) {
      throw new Error(
        'Creating symlinks on Windows requires Developer Mode enabled or ' +
          'administrator privileges. Enable Developer Mode in Settings > ' +
          'Update & Security > For Developers.',
      );
    }
    throw e;
  }
}

/**
 * Removes the GoatDB symlink created for local development.
 *
 * @param cwd - Current working directory of the project
 */
async function removeGoatDBSymlink(cwd: string): Promise<void> {
  const symlinkPath = path.join(cwd, 'vendor', 'goatdb');
  const vendorDir = path.join(cwd, 'vendor');
  const fileImpl = await FileImplGet();

  try {
    await fileImpl.remove(symlinkPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const isNotFound = msg.includes('ENOENT') ||
      (getRuntime().id === 'deno' && e instanceof Deno.errors.NotFound);
    if (!isNotFound) {
      throw e;
    }
  }
  // Try to remove vendor dir only if empty (non-recursive)
  try {
    await fileImpl.remove(vendorDir);
  } catch (_: unknown) {
    // Not empty or doesn't exist — both fine
  }
}

/**
 * Updates the deno.json file to use local GoatDB paths for development.
 *
 * This function:
 * 1. Reads the project's deno.json file
 * 2. Creates a backup of the original imports in goat.link.json
 * 3. Creates a symlink in vendor/goatdb pointing to local GoatDB
 * 4. Updates GoatDB imports to use relative paths via the symlink
 * 5. Preserves any existing non-GoatDB imports
 * 6. Adds any missing GoatDB dependency imports from the local GoatDB's
 *    deno.json
 *
 * The symlink approach ensures that `deno compile` properly bundles the
 * local GoatDB sources instead of treating them as external runtime
 * dependencies.
 *
 * @param localGoatDBPath - Absolute or relative path to local GoatDB directory
 */
async function editDenoJsonForLocalPath(
  localGoatDBPath: string,
  cwd?: string,
): Promise<void> {
  cwd = cwd ?? (await FileImplGet()).getCWD();
  const denoJsonPath = path.join(cwd, 'deno.json');
  const denoJson = JSON.parse(
    await readTextFile(denoJsonPath) || '{}',
  ) as DenoJson;

  // Find the GoatDB imports
  const originalProjectImports = denoJson['imports'];
  const projectImports = { ...originalProjectImports };

  // Load local GoatDB imports
  const resolvedGoatDBPath = path.resolve(cwd, localGoatDBPath);
  const goatDBDenoJsonRaw = await readTextFile(
    path.join(resolvedGoatDBPath, 'deno.json'),
  );
  if (!goatDBDenoJsonRaw) {
    throw new Error(
      `Cannot find deno.json at ${localGoatDBPath}. Verify the path points to a GoatDB checkout.`,
    );
  }
  const goatDBDenoJson = JSON.parse(goatDBDenoJsonRaw) as DenoJson;

  if (goatDBDenoJson['name'] !== '@goatdb/goatdb') {
    throw new Error(
      `Local path at ${localGoatDBPath} does not appear to be GoatDB ` +
        `(deno.json name is "${
          goatDBDenoJson['name']
        }", expected "@goatdb/goatdb").`,
    );
  }

  if (!goatDBDenoJson['imports']) {
    throw new Error(
      `Local GoatDB deno.json at ${localGoatDBPath} is missing 'imports' field.`,
    );
  }

  // Create symlink to local GoatDB in vendor directory
  await createGoatDBSymlink(cwd, localGoatDBPath);
  try {
    // Find imports that exist in both local project and local GoatDB
    const existingGoatDeps: Record<string, string> = {};
    for (const key of Object.keys(goatDBDenoJson['imports'])) {
      if (projectImports[key] !== undefined) {
        existingGoatDeps[key] = projectImports[key];
      }
    }

    // Edit deno.json imports to point at the symlinked local GoatDB
    // Use relative paths so deno compile bundles them properly
    const goatdbImportKeys: string[] = [];
    for (const [key, subpath] of Object.entries(goatEntryPoints)) {
      const importKey = '@goatdb/goatdb' + key;
      projectImports[importKey] = './vendor/goatdb/' + subpath;
      goatdbImportKeys.push(importKey);
    }

    // Also include any GoatDB imports that are not already in the project
    const injectedImportKeys: string[] = [];
    for (const key of Object.keys(goatDBDenoJson['imports'])) {
      if (existingGoatDeps[key] === undefined) {
        projectImports[key] = goatDBDenoJson['imports'][key];
        injectedImportKeys.push(key);
      }
    }

    // Write the backup file
    await writeTextFileOrThrow(
      path.join(cwd, 'goat.link.json'),
      JSON.stringify(
        {
          imports: originalProjectImports || {},
          injectedImportKeys,
          goatdbImportKeys,
          localGoatDBPath,
        } as GoatLinkJson,
        null,
        2,
      ),
    );
    denoJson.imports = projectImports;

    // Write the updated deno.json
    await writeTextFileOrThrow(denoJsonPath, prettyJSON(denoJson) + '\n');
  } catch (e: unknown) {
    // Rollback: remove symlink and goat.link.json on failure
    await removeGoatDBSymlink(cwd);
    try {
      await (await FileImplGet()).remove(path.join(cwd, 'goat.link.json'));
    } catch (_: unknown) {
      // may not exist
    }
    throw e;
  }
}

async function reverseDenoJsonEdits(cwd?: string): Promise<void> {
  cwd = cwd ?? (await FileImplGet()).getCWD();
  const goatLinkJsonPath = path.join(cwd, 'goat.link.json');
  const goatLinkJson = JSON.parse(
    await readTextFile(goatLinkJsonPath) || '{}',
  ) as GoatLinkJson;
  const denoJsonPath = path.join(cwd, 'deno.json');
  const denoJson = JSON.parse(
    await readTextFile(denoJsonPath) || '{}',
  ) as DenoJson;
  if (!denoJson.imports) {
    await removeGoatDBSymlink(cwd);
    throw new Error(
      'deno.json is missing or corrupted (no imports field). ' +
        'Restore deno.json manually, then run unlink again.',
    );
  }
  if (!goatLinkJson.imports) {
    await removeGoatDBSymlink(cwd);
    throw new Error(
      'goat.link.json is corrupted: missing imports. Restore deno.json manually.',
    );
  }
  // Surgically undo only GoatDB-related changes, preserving user additions
  const currentImports = { ...denoJson.imports };
  // Remove all @goatdb/goatdb* keys added during linking
  const keysToRemove = goatLinkJson.goatdbImportKeys ||
    Object.keys(goatEntryPoints).map((k) => '@goatdb/goatdb' + k);
  for (const key of keysToRemove) {
    delete currentImports[key];
  }
  // Remove transitive dependencies injected during linking
  if (goatLinkJson.injectedImportKeys) {
    for (const key of goatLinkJson.injectedImportKeys) {
      delete currentImports[key];
    }
  }
  // Restore original values from backup
  for (const [key, value] of Object.entries(goatLinkJson.imports)) {
    currentImports[key] = value;
  }
  denoJson.imports = currentImports;
  await writeTextFileOrThrow(denoJsonPath, prettyJSON(denoJson) + '\n');

  // Remove the symlink created during linking
  await removeGoatDBSymlink(cwd);
}

/**
 * Updates the package.json file to use local GoatDB paths for development.
 *
 * This function:
 * 1. Reads the project's package.json file
 * 2. Creates a backup of the original dependencies in goat.link.json
 * 3. Updates @goatdb/goatdb dependency to point to local directory using file: protocol
 * 4. Writes the updated package.json
 *
 * @param localGoatDBPath - Absolute or relative path to local GoatDB directory
 */
async function editPackageJsonForLocalPath(
  localGoatDBPath: string,
  cwd?: string,
): Promise<void> {
  cwd = cwd ?? (await FileImplGet()).getCWD();

  // Resolve against project cwd so relative paths work correctly
  const resolvedGoatDBPath = path.resolve(cwd, localGoatDBPath);

  // Validate that localGoatDBPath is actually a GoatDB checkout
  const goatPkgPath = path.join(resolvedGoatDBPath, 'package.json');
  const goatPkgRaw = await readTextFile(goatPkgPath);
  if (!goatPkgRaw) {
    throw new Error(
      `Local GoatDB path at ${localGoatDBPath} does not contain a package.json.`,
    );
  }
  const goatPkg = JSON.parse(goatPkgRaw);
  if (goatPkg.name !== '@goatdb/goatdb') {
    throw new Error(
      `Local GoatDB path at ${localGoatDBPath} does not appear to be GoatDB ` +
        `(package.json name is "${goatPkg.name}", expected "@goatdb/goatdb").`,
    );
  }

  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = JSON.parse(await readTextFile(packageJsonPath) || '{}');

  // Backup original dependencies
  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }
  const originalDeps = { ...packageJson.dependencies };

  // Use file: protocol with absolute path. Relative paths break on macOS
  // where temp dirs are under /private/var but path.relative() computes
  // against the logical /var path, producing symlinks that don't resolve.
  packageJson.dependencies['@goatdb/goatdb'] = `file:${resolvedGoatDBPath}`;

  // Write backup
  await writeTextFileOrThrow(
    path.join(cwd, 'goat.link.json'),
    prettyJSON({ dependencies: originalDeps, localGoatDBPath } as GoatLinkJson),
  );

  // Write updated package.json
  try {
    await writeTextFileOrThrow(packageJsonPath, prettyJSON(packageJson) + '\n');
  } catch (e: unknown) {
    // Rollback: remove goat.link.json on failure
    try {
      await (await FileImplGet()).remove(path.join(cwd, 'goat.link.json'));
    } catch (_: unknown) {
      // may not exist
    }
    throw e;
  }

  console.log('Run `npm install` to resolve the local dependency.');
  console.log(
    'Note: package.json now contains a machine-specific absolute path. ' +
      'Do not commit this change.',
  );
}

async function reversePackageJsonEdits(cwd?: string): Promise<void> {
  cwd = cwd ?? (await FileImplGet()).getCWD();
  const goatLinkJsonPath = path.join(cwd, 'goat.link.json');
  const goatLinkJson = JSON.parse(
    await readTextFile(goatLinkJsonPath) || '{}',
  ) as GoatLinkJson;

  if (!goatLinkJson.dependencies) {
    throw new Error(
      'goat.link.json is corrupted: missing dependencies. Restore package.json manually.',
    );
  }
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = JSON.parse(await readTextFile(packageJsonPath) || '{}');
  // Surgically restore only the @goatdb/goatdb key, preserving user additions
  const currentDeps = { ...packageJson.dependencies };
  const originalGoatDep = goatLinkJson.dependencies['@goatdb/goatdb'];
  if (originalGoatDep !== undefined) {
    currentDeps['@goatdb/goatdb'] = originalGoatDep;
  } else {
    delete currentDeps['@goatdb/goatdb'];
  }
  packageJson.dependencies = currentDeps;

  await writeTextFileOrThrow(packageJsonPath, prettyJSON(packageJson) + '\n');
}

export async function linkGoatDB(
  localGoatDBPath: string,
  cwd?: string,
): Promise<void> {
  cwd = cwd ?? (await FileImplGet()).getCWD();

  const goatLinkJsonPath = path.join(cwd, 'goat.link.json');
  if (await pathExists(goatLinkJsonPath)) {
    throw new Error(
      'Already linked. Run unlink first before re-linking.',
    );
  }

  const denoJsonPath = path.join(cwd, 'deno.json');
  const packageJsonPath = path.join(cwd, 'package.json');

  if (await pathExists(denoJsonPath)) {
    await editDenoJsonForLocalPath(localGoatDBPath, cwd);
    try {
      await applyGitIgnoreChanges('deno', cwd);
    } catch (e: unknown) {
      try {
        await unlinkGoatDB(cwd);
      } catch (rollbackErr: unknown) {
        console.warn(
          'Warning: rollback failed after gitignore error. ' +
            'Project may be in an inconsistent state.',
          rollbackErr,
        );
      }
      throw e;
    }
  } else if (await pathExists(packageJsonPath)) {
    await editPackageJsonForLocalPath(localGoatDBPath, cwd);
    try {
      await applyGitIgnoreChanges('node', cwd);
    } catch (e: unknown) {
      try {
        await unlinkGoatDB(cwd);
      } catch (rollbackErr: unknown) {
        console.warn(
          'Warning: rollback failed after gitignore error. ' +
            'Project may be in an inconsistent state.',
          rollbackErr,
        );
      }
      throw e;
    }
  } else {
    throw new Error(
      'No deno.json or package.json found in ' + cwd,
    );
  }
}

export async function unlinkGoatDB(cwd?: string): Promise<void> {
  const fileImpl = await FileImplGet();
  cwd = cwd ?? fileImpl.getCWD();

  const goatLinkJsonPath = path.join(cwd, 'goat.link.json');
  if (!(await pathExists(goatLinkJsonPath))) {
    console.warn('No goat.link.json found — project is not linked.');
    return;
  }
  const goatLinkJson = JSON.parse(
    await readTextFile(goatLinkJsonPath) || '{}',
  ) as GoatLinkJson;

  // Detect project type from backup
  if (goatLinkJson.imports !== undefined) {
    await reverseDenoJsonEdits(cwd);
  } else if (goatLinkJson.dependencies !== undefined) {
    await reversePackageJsonEdits(cwd);
    console.log('Run `npm install` to restore the published dependency.');
  } else {
    throw new Error(
      'goat.link.json is corrupted: missing both imports and dependencies. ' +
        'Restore your configuration file manually.',
    );
  }

  await revertGitIgnoreChanges(cwd);

  // Delete goat.link.json last so it survives partial failures
  await fileImpl.remove(goatLinkJsonPath);
}

// Deno-only entry point (Deno.args not available on Node.js)
if (import.meta.main) {
  const cmd = Deno.args[0];
  if (cmd === undefined) {
    console.error(
      'Usage: unlink or link <local-goatdb-path>',
    );
    await exit(1);
  }
  if (cmd === 'unlink') {
    await unlinkGoatDB();
  } else if (cmd === 'link') {
    const localGoatDBPath = Deno.args[1];
    if (localGoatDBPath === undefined) {
      console.error('Usage: link <local-goatdb-path>');
      await exit(1);
    }
    await linkGoatDB(localGoatDBPath);
  } else {
    console.error('Usage: unlink or link <local-goatdb-path>');
    await exit(1);
  }
}
