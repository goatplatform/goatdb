/**
 * Copies the CLI scaffolds into the npm build output.
 *
 * WHY: `bootstrapProject` resolves templates relative to the bundled bin
 * (`dist/cli/templates`). tsup does not copy static files, so without this step
 * the published npm CLI cannot scaffold a project.
 *
 * WHY the destination is removed first: the copy replaces the template tree.
 * Merging into an existing tree would keep deleted or renamed source files in
 * the build output and ship them in the npm tarball.
 */
import { cpSync, rmSync } from 'node:fs';
import { resolve } from '../base/path.ts';
import { log } from '../logging/log.ts';

const root = process.cwd();
const source = resolve(root, 'cli/templates');
const destination = resolve(root, 'dist/cli/templates');

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
log({ severity: 'INFO', message: `Copied CLI templates to ${destination}` });
