import * as path from '@std/path';
import { prettyJSON } from '../base/common.ts';
import {
  FileImplGet,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';

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
async function applyGitIgnoreChanges(): Promise<void> {
  const ignorePath = path.join(FileImplGet().getCWD(), '.gitignore');
  let gitIgnore = await readTextFile(ignorePath) || '';
  for (const line of gitIgnore.split('\n')) {
    if (line.trim() === 'goat.link.json') {
      return;
    }
  }
  gitIgnore += '\n\n# GoatDB\ngoat.link.json\ndeno.json\n';
  await writeTextFile(ignorePath, gitIgnore);
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
async function revertGitIgnoreChanges(): Promise<void> {
  const ignorePath = path.join(FileImplGet().getCWD(), '.gitignore');
  const lines = (await readTextFile(ignorePath) || '').split('\n').filter(
    (line) => {
      line = line.trim();
      return !line.startsWith('# GoatDB') && line !== 'goat.link.json' &&
        line !== 'deno.json';
    },
  );
  await writeTextFile(ignorePath, lines.join('\n').trimEnd());
}

type DenoJson = {
  imports: Record<string, string>;
};

const goatEntryPoints = {
  '': 'mod.ts',
  '/react': 'react/hooks.ts',
  '/server': 'server/mod.ts',
  '/init': 'cli/init.ts',
  '/link': 'cli/link.ts',
} as const;

type GoatLinkJson = {
  imports: Record<string, string>;
  localGoatDBPath: string;
};

/**
 * Updates the deno.json file to use local GoatDB paths for development.
 *
 * This function:
 * 1. Reads the project's deno.json file
 * 2. Creates a backup of the original imports in goat.link.json
 * 3. Updates GoatDB imports to point to the local GoatDB directory
 * 4. Preserves any existing non-GoatDB imports
 * 5. Adds any missing GoatDB dependency imports from the local GoatDB's
 *    deno.json
 *
 * @param localGoatDBPath - Absolute or relative path to local GoatDB directory
 */
async function editDenoJsonForLocalPath(
  localGoatDBPath: string,
): Promise<void> {
  const denoJsonPath = path.join(FileImplGet().getCWD(), 'deno.json');
  const denoJson = JSON.parse(
    await readTextFile(denoJsonPath) || '{}',
  ) as DenoJson;
  // Find the GoatDB imports
  const originalProjectImports = denoJson['imports'];
  const projectImports = { ...originalProjectImports };
  // Load local GoatDB imports
  const goatDBDenoJson = JSON.parse(
    await readTextFile(path.join(localGoatDBPath, 'deno.json')) || '{}',
  ) as DenoJson;
  // Find imports that exist in both local project and local GoatDB
  const existingGoatDeps: Record<string, string> = {};
  for (const key of Object.keys(goatDBDenoJson['imports'])) {
    if (projectImports[key] !== undefined) {
      existingGoatDeps[key] = projectImports[key];
    }
  }
  // Edit deno.json imports to point at the local GoatDB
  for (const [key, subpath] of Object.entries(goatEntryPoints)) {
    projectImports['@goatdb/goatdb' + key] = path.join(
      localGoatDBPath,
      subpath,
    );
  }
  // Also include any GoatDB imports that are not already in the project
  for (const key of Object.keys(goatDBDenoJson['imports'])) {
    if (existingGoatDeps[key] === undefined) {
      projectImports[key] = goatDBDenoJson['imports'][key];
    }
  }
  // Write the backup file
  await writeTextFile(
    path.join(FileImplGet().getCWD(), 'goat.link.json'),
    JSON.stringify(
      {
        imports: originalProjectImports,
        localGoatDBPath,
      } as GoatLinkJson,
      null,
      2,
    ),
  );
  denoJson.imports = projectImports;
  // Write the updated deno.json
  await writeTextFile(denoJsonPath, prettyJSON(denoJson));
}

async function reverseDenoJsonEdits(): Promise<void> {
  const goatLinkJsonPath = path.join(FileImplGet().getCWD(), 'goat.link.json');
  const goatLinkJson = JSON.parse(
    await readTextFile(goatLinkJsonPath) || '{}',
  ) as GoatLinkJson;
  const denoJsonPath = path.join(FileImplGet().getCWD(), 'deno.json');
  const denoJson = JSON.parse(
    await readTextFile(denoJsonPath) || '{}',
  ) as DenoJson;
  denoJson.imports = goatLinkJson.imports;
  await writeTextFile(denoJsonPath, prettyJSON(denoJson) + '\n');
  await FileImplGet().remove(goatLinkJsonPath);
}

async function linkGoatDB(localGoatDBPath: string): Promise<void> {
  await applyGitIgnoreChanges();
  await editDenoJsonForLocalPath(localGoatDBPath);
}

async function unlinkGoatDB(): Promise<void> {
  await reverseDenoJsonEdits();
  await revertGitIgnoreChanges();
}

if (import.meta.main) {
  const cmd = Deno.args[0];
  if (cmd === undefined) {
    console.error(
      'Usage: unlink or link <local-goatdb-path>',
    );
    Deno.exit(1);
  }
  if (cmd === 'unlink') {
    await unlinkGoatDB();
  } else if (cmd === 'link') {
    const localGoatDBPath = Deno.args[1];
    if (localGoatDBPath === undefined) {
      console.error('Usage: link <local-goatdb-path>');
      Deno.exit(1);
    }
    await linkGoatDB(localGoatDBPath);
  } else {
    console.error('Usage: unlink or link <local-goatdb-path>');
    Deno.exit(1);
  }
}
