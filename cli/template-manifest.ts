/**
 * Template path contract shared by the scaffold and its tests.
 *
 * WHY: npm pack drops dotfiles. Templates use plain names (`gitignore`,
 * `npmrc`) and the scaffold restores the leading dot. One map keeps both
 * consumers from drifting when a source is renamed.
 */

export type TemplateRuntime = 'deno' | 'node';

/**
 * Key: template source path relative to `cli/templates`.
 * Value: generated project path relative to the target directory.
 */
export const kTemplateDotfileTargets: Readonly<Record<string, string>> = {
  'shared/gitignore': '.gitignore',
  'node/npmrc': '.npmrc',
};

/** Resolves a template source path to its generated project path. */
export function templateTargetPath(
  sourceRelative: string,
  runtime: TemplateRuntime,
): string {
  const dotfileTarget = kTemplateDotfileTargets[sourceRelative];
  if (dotfileTarget !== undefined) {
    return dotfileTarget;
  }
  const prefix = sourceRelative.startsWith('shared/')
    ? 'shared/'
    : `${runtime}/`;
  if (!sourceRelative.startsWith(prefix)) {
    throw new Error(
      `Template path outside shared/ and ${runtime}/: ${sourceRelative}`,
    );
  }
  return sourceRelative.slice(prefix.length);
}
