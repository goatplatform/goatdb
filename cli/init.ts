/**
 * This is a CLI used to initialize a new GoatDB project scaffold.
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB/Init
 */
import * as path from '../base/path.ts';
import { isDeno, isNode } from '../base/common.ts';
import { pathExists, copyFile, mkdir, getCWD } from '../base/json-log/file-impl.ts';
import { cli } from '../base/development.ts';

/**
 * Returns the path to the templates directory.
 * Uses import.meta.url with fallback for bundled environments.
 */
async function getTemplateDir(): Promise<string> {
  // Primary: relative to module (works for direct Deno/Node ESM execution)
  const primaryPath = path.join(
    path.dirname(path.fromFileUrl(import.meta.url)),
    'templates'
  );

  if (await pathExists(primaryPath)) {
    return primaryPath;
  }

  // Fallback: relative to CWD (works when bundled/eval'd via esbuild)
  // When bundled with esbuild and run via stdin, import.meta.url
  // becomes synthetic and doesn't point to the original source.
  const cwd = await getCWD();
  return path.join(cwd, 'cli', 'templates');
}

/**
 * Copy a file from template directory to destination if it doesn't already exist
 */
async function copyTemplateFile(
  templateDir: string,
  templatePath: string,
  destPath: string,
  targetDir: string
): Promise<void> {
  const fullDestPath = path.join(targetDir, destPath);
  if (await pathExists(fullDestPath)) {
    return; // Don't overwrite existing files
  }

  const srcPath = path.join(templateDir, templatePath);
  await mkdir(path.dirname(fullDestPath));
  await copyFile(srcPath, fullDestPath);
}


async function installDenoDependency(spec: string, targetDir: string): Promise<void> {
  const result = await cli('deno', 'add', spec, { cwd: targetDir });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to install dependency ${spec}`);
  }
}

/**
 * Options for bootstrapProject.
 */
export interface BootstrapOptions {
  /** Target directory for the project (defaults to CWD) */
  targetDir?: string;
  /** Skip dependency installation (useful for testing) */
  skipDependencies?: boolean;
}

export async function bootstrapProject(options?: BootstrapOptions | string): Promise<void> {
  // Support legacy string argument for backwards compatibility
  const opts: BootstrapOptions = typeof options === 'string'
    ? { targetDir: options }
    : options || {};

  const projectDir = opts.targetDir || await getCWD();
  const runtime = isDeno() ? 'deno' : 'node';

  // Resolve template directory with fallback for bundled environments
  const templateDir = await getTemplateDir();

  // Validate template directory exists
  if (!(await pathExists(templateDir))) {
    throw new Error(
      `Template directory not found at ${templateDir}. ` +
      `Ensure GoatDB is properly installed.`
    );
  }

  // Copy shared template files (identical for both platforms)
  await copyTemplateFile(templateDir, 'shared/client/index.html', 'client/index.html', projectDir);
  await copyTemplateFile(templateDir, 'shared/client/index.css', 'client/index.css', projectDir);
  await copyTemplateFile(templateDir, 'shared/.gitignore', '.gitignore', projectDir);

  // Copy runtime-specific template files
  await copyTemplateFile(templateDir, `${runtime}/client/index.tsx`, 'client/index.tsx', projectDir);
  await copyTemplateFile(templateDir, `${runtime}/client/app.tsx`, 'client/app.tsx', projectDir);
  await copyTemplateFile(templateDir, `${runtime}/common/schema.ts`, 'common/schema.ts', projectDir);
  await copyTemplateFile(templateDir, `${runtime}/server/debug-server.ts`, 'server/debug-server.ts', projectDir);
  await copyTemplateFile(templateDir, `${runtime}/server/server.ts`, 'server/server.ts', projectDir);
  await copyTemplateFile(templateDir, `${runtime}/server/build.ts`, 'server/build.ts', projectDir);

  // Copy configuration files based on runtime
  if (isDeno()) {
    await copyTemplateFile(templateDir, 'deno/deno.json', 'deno.json', projectDir);
    if (!opts.skipDependencies) {
      await installDenoDependency('jsr:@goatdb/goatdb', projectDir);
      await installDenoDependency('jsr:@std/path', projectDir);
      await installDenoDependency('npm:react@19.0.0', projectDir);
      await installDenoDependency('npm:react-dom@19.0.0/client', projectDir);
      await installDenoDependency('npm:yargs@17.7.2', projectDir);
      await installDenoDependency('npm:@types/react@19.0.8', projectDir);
    }
  } else if (isNode()) {
    await copyTemplateFile(templateDir, 'node/package.json', 'package.json', projectDir);
    await copyTemplateFile(templateDir, 'node/tsconfig.json', 'tsconfig.json', projectDir);
    await copyTemplateFile(templateDir, 'node/.npmrc', '.npmrc', projectDir);

    if (!opts.skipDependencies) {
      const result = await cli('npm', 'install', { cwd: projectDir });
      if (result.exitCode !== 0) {
        console.warn('npm install failed:', result.result);
      }
    }
  }

}

// Handle main execution for both Deno and Node.js (ESM-compatible)
function checkIsMainModule(): boolean {
  if (typeof (import.meta as { main?: boolean }).main === 'boolean') {
    return (import.meta as { main: boolean }).main;
  }
  // Node.js: compare import.meta.url with process.argv[1]
  if (isNode() && process.argv[1]) {
    const scriptUrl = `file://${process.argv[1]}`;
    return import.meta.url === scriptUrl;
  }
  return false;
}

if (checkIsMainModule()) {
  (async () => {
    try {
      // Get optional target directory from CLI arguments
      let targetDir: string | undefined;
      if (isDeno()) {
        targetDir = Deno.args[0];
      } else if (isNode()) {
        targetDir = process.argv[2]; // [0]=node, [1]=script, [2]=first arg
      }

      await bootstrapProject(targetDir);
    } catch (error) {
      console.error('Error during project initialization:', error);
      if (isDeno()) {
        Deno.exit(1);
      } else {
        process.exit(1);
      }
    }
  })();
}
