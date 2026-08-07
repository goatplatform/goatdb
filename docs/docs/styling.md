---
id: styling
title: Customize Client Styling
---

GoatDB builds one stylesheet at `/index.css`. Use
[`cssPath`](/api/GoatDB/type-aliases/AppConfig#property-csspath) for base styles
and import component or generated styles from the
[`jsPath`](/api/GoatDB/type-aliases/AppConfig#property-jspath) client entry
point. These [AppConfig](/api/GoatDB/type-aliases/AppConfig) options apply to
both [compile()](</api/GoatDB/Server/Build/functions/compile>) and
[startDebugServer()](</api/GoatDB/Server/Build/functions/startDebugServer>).

## Start with CSS files

The generated project already configures
[`cssPath`](/api/GoatDB/type-aliases/AppConfig#property-csspath) as
`./client/index.css`. Keep shared tokens and global rules there, then import
styles close to the component that needs them:

```css title="client/index.css"
:root {
  color-scheme: dark;
  --accent: #c6f578;
}
```

```tsx title="client/index.tsx"
import './app.css';
```

```css title="client/app.css"
.app {
  color: var(--accent);
}
```

GoatDB concatenates CSS into `/index.css` in this order:

1. [`cssPath`](/api/GoatDB/type-aliases/AppConfig#property-csspath) base stylesheet.
2. CSS imported by [`jsPath`](/api/GoatDB/type-aliases/AppConfig#property-jspath), including transitive imports.
3. CSS from remaining entry chunks, in entry order.

Later rules therefore override earlier rules at equal CSS specificity. Import a
component stylesheet from that component when its rules should override the
base stylesheet.

## Add generated CSS with a plugin

Pass an [EsbuildPlugin](https://esbuild.github.io/plugins/) through
[`esbuildPlugins`](/api/GoatDB/type-aliases/AppConfig) when styles come from a
generator or a non-CSS source. This example supplies a
virtual theme stylesheet; replace its `contents` with your generator output.

```typescript title="server/build.ts"
import {
  compile,
  type EsbuildPlugin,
} from '@goatdb/goatdb/server/build';

const themePlugin: EsbuildPlugin = {
  name: 'theme',
  setup(build) {
    build.onResolve({ filter: /^virtual:theme$/ }, () => ({
      path: 'theme',
      namespace: 'goatdb-theme',
    }));
    build.onLoad({ filter: /.*/, namespace: 'goatdb-theme' }, () => ({
      contents: ':root { --accent: #c6f578; }',
      loader: 'css',
    }));
  },
};

await compile({
  serverEntry: './server/server.ts',
  jsPath: './client/index.tsx',
  htmlPath: './client/index.html',
  cssPath: './client/index.css',
  buildDir: './build',
  esbuildPlugins: [themePlugin],
});
```

Import the virtual stylesheet from the client entry point so esbuild includes
it in `/index.css`:

```tsx title="client/index.tsx"
import 'virtual:theme';
```

GoatDB registers adapter stubs first, then user plugins, its asset fallback,
and finally the Deno resolver/loader. A plugin can therefore resolve an
original specifier and load its CSS before GoatDB's fallbacks handle it. Pass
the same
[`esbuildPlugins`](/api/GoatDB/type-aliases/AppConfig) array to
[startDebugServer()](</api/GoatDB/Server/Build/functions/startDebugServer>)
to use the identical pipeline during development.

## Bundle images and fonts referenced by CSS

Use local relative paths in CSS. Esbuild emits each referenced file under
`/assets/` with a content-hashed name and rewrites the final CSS URL.

```css title="client/app.css"
.logo {
  background-image: url('./logo.svg');
}
```

:::caution Behavior change
`cssPath` is now processed by esbuild (previously it was copied verbatim into
`/index.css`). Relative `url()` targets must exist on disk at build time — they
are bundled and content-hashed, so references to files served from other routes
(e.g. `assetsPath`) no longer resolve.
:::

Do not point `url()` at a file made available through
[`assetsPath`](/api/GoatDB/type-aliases/AppConfig#property-assetspath). Those
files are served separately, while CSS `url()` inputs must exist locally for
esbuild to bundle them. A missing CSS asset fails the build instead of becoming
a browser 404.

## Debug and inspect output

[compile()](</api/GoatDB/Server/Build/functions/compile>) minifies CSS by
default; pass [`minify`](/api/GoatDB/type-aliases/AppConfig#property-minify) as
`false` when readable output is required.
[startDebugServer()](</api/GoatDB/Server/Build/functions/startDebugServer>)
rebuilds the same CSS pipeline without production minification. CSS source maps
are served at `/index.css.map`: a single CSS chunk keeps its own flat map with
the URL rewritten to `index.css.map`. When multiple chunks are concatenated,
the map is an indexed source map (Source Map v3 `sections` format): each chunk's
map is embedded verbatim and positioned at its start line in the concatenation,
so rules from every chunk resolve to their authored sources.

The debug server watches only
[`watchDir`](/api/GoatDB/Server/Build/type-aliases/LiveReloadOptions#property-watchdir)
(the current directory by default). `watchFiles` and `watchDirs` returned by an
esbuild plugin do not expand that watcher. Keep generator inputs beneath
[`watchDir`](/api/GoatDB/Server/Build/type-aliases/LiveReloadOptions#property-watchdir),
or set it to their common parent.

## Verify a styling change

1. Run `deno task dev` or `npm run dev` and inspect `/index.css` in the browser.
2. Confirm a CSS `url()` was rewritten to a hashed `/assets/` URL.
3. In browser devtools, confirm `/index.css.map` maps a rule to its authored
   stylesheet.
4. Run the production build to catch missing CSS assets and minification-only
   issues.
