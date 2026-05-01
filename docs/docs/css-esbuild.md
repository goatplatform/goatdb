---
id: css-esbuild
title: CSS and esbuild
---

# CSS and esbuild

GoatDB builds browser CSS through esbuild. Import application styles from your
client entry point or components, and reserve `cssPath` for static CSS that must
be prepended before bundled styles.

## Global CSS

Import global styles from your client entry point:

```typescript
import './index.css';
```

Files ending in `.css` are bundled as global CSS. When the main app entry
imports CSS, GoatDB emits it at `/index.css`.

## CSS Modules

Use `.module.css` for component-scoped class names:

```typescript
import styles from './button.module.css';

export function Button() {
  return <button className={styles.primary}>Save</button>;
}
```

GoatDB passes `.module.css` files to esbuild's CSS Modules loader. The imported
object contains the generated class names, and the corresponding CSS is emitted
with the rest of the entry's stylesheet.

## Emitted Files

The main app entry emits:

| Asset | When it exists |
|---|---|
| `/app.js` | Always, for the browser JavaScript bundle |
| `/app.js.map` | Always, for the browser JavaScript source map |
| `/index.css` | Always after the app entry builds, even when empty |
| `/index.css.map` | Only when bundled CSS has source maps |

Secondary entries emit JavaScript and source maps at `/{entry}.js` and
`/{entry}.js.map`. If a secondary entry imports CSS, GoatDB also emits
`/{entry}.css` and, when source maps exist, `/{entry}.css.map`.

## `cssPath`

Use `cssPath` only for one static CSS file that must load before bundled styles,
such as resets, font faces, or vendor CSS:

```typescript
await compile({
  jsPath: './client/index.tsx',
  htmlPath: './client/index.html',
  buildDir: './build',
  cssPath: './client/reset.css',
});
```

GoatDB prepends `cssPath` into `/index.css` before CSS imported from JavaScript.
Because it is a raw static file, it does not add source map entries by itself.

Do not use `cssPath` for normal application CSS. Prefer imports:

```typescript
import './index.css';
import styles from './button.module.css';
```

## Static Assets

Files under `assetsPath` are served as static files under `/assets/*`.

CSS files in `assetsPath` are not bundled, transformed, or merged into
`/index.css`. Reference them directly from HTML or JavaScript only when you want
that separate static file behavior.

## Custom esbuild Plugins

Use `esbuildPlugins` when the client bundle needs custom resolution or loading.
Plugins run before GoatDB's fallback CSS loader, so they can rewrite CSS imports
or resolve package CSS.

**Deno** — return a filesystem path for `file` namespace resolutions:

```typescript
import { fromFileUrl } from '@std/path';
import type { BuildPluginLike } from '@goatdb/goatdb/server/build';

const normalizeCssPlugin: BuildPluginLike = {
  name: 'normalize-css',
  setup(build) {
    build.onResolve({ filter: /^normalize\.css$/ }, () => ({
      path: fromFileUrl(
        new URL('./vendor/normalize.css', import.meta.url),
      ),
      namespace: 'file',
    }));
  },
};
```

Do not pass `npm:` URLs to `fromFileUrl()`. If a Deno plugin resolves into the
`file` namespace, it must return a real file path.

**Node.js ESM** — use `createRequire` to resolve package CSS to a filesystem path:

```typescript
import { createRequire } from 'node:module';
import type { BuildPluginLike } from '@goatdb/goatdb/server/build';

const require = createRequire(import.meta.url);

const normalizeCssPlugin: BuildPluginLike = {
  name: 'normalize-css',
  setup(build) {
    build.onResolve({ filter: /^normalize\.css$/ }, () => ({
      path: require.resolve('normalize.css'),
      namespace: 'file',
    }));
  },
};
```

Use the plugin in a build:

```typescript
await compile({
  jsPath: './client/index.tsx',
  htmlPath: './client/index.html',
  buildDir: './build',
  esbuildPlugins: [normalizeCssPlugin],
});
```

Production `compile()` supports `esbuildPlugins` on Deno and Node.js. The
development `startDebugServer()` build pipeline is Deno-only, so its
`esbuildPlugins` hook is also Deno-only.
