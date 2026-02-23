import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    mod: 'mod.ts',
    'react/hooks': 'react/hooks.ts',
    server: 'server.ts',
    'server-build': 'server-build.ts',
    'cli/init': 'cli/init.ts',
    'cli/link': 'cli/link.ts',
  },
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  target: 'node24',
  platform: 'node',
  clean: true,
  tsconfig: 'tsconfig.node.json',
  // Keep all @goatdb/*, @std/* deps external (they're in package.json)
  external: [/^@goatdb\//, /^@std\//],
});
