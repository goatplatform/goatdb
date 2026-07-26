import denoConfig from './deno.json' with { type: 'json' };
import packageConfig from './package.json' with { type: 'json' };

const exports = {
  '.': { import: './dist/mod.js', types: './dist/mod.d.ts' },
  './react': {
    import: './dist/react/hooks.js',
    types: './dist/react/hooks.d.ts',
  },
  './server': { import: './dist/server.js', types: './dist/server.d.ts' },
  './server/email': {
    import: './dist/server/email.js',
    types: './dist/server/email.d.ts',
  },
  './server/build': {
    import: './dist/server-build.js',
    types: './dist/server-build.d.ts',
  },
  './link': { import: './dist/cli/link.js', types: './dist/cli/link.d.ts' },
};

const packageForNpm = {
  ...packageConfig,
  version: denoConfig.version,
  exports,
};
await Deno.writeTextFile(
  './package.json',
  JSON.stringify(packageForNpm, null, 2) + '\n',
);
