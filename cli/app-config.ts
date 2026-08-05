// IMPORTANT: This MUST remain `import type` — a runtime esbuild import would
// break Node.js SEA binaries (esbuild is lazy-loaded only inside build code).
import type { Plugin } from 'esbuild';

/**
 * A configuration of a Single Page Application built on top GoatDB.
 * @group Configuration
 */
export type AppConfig = {
  /**
   * The directory in which to perform the build process. Intermediate files as
   * well as the final binary will be placed there.
   */
  buildDir: string;
  /**
   * Path to the main js entry point for the client app. The server
   * automatically transpiles the client code for the browser code using
   * ESBuild.
   *
   * Supported files: .js .jsx .ts .tsx.
   * Accessible at `/app.js`
   */
  jsPath: string;
  /**
   * Path to the main HTML file for the app. If provided, all unknown paths
   * will be redirected to this HTML file.
   *
   * Accessible at `/index.html`.
   */
  htmlPath?: string;
  /**
   * Path to the main CSS file for the app.
   *
   * Bundled through esbuild — minified in production builds, processed by
   * `esbuildPlugins`, and `url()` references are emitted as content-hashed
   * assets under `/assets/`. CSS imported from client code is concatenated
   * after this stylesheet.
   *
   * Accessible at `/index.css`.
   */
  cssPath?: string;
  /**
   * Path to a directory containing static assets. If provided, all files under
   * it will be bundled into the application and be publicly accessible through
   * the web server.
   *
   * Accessible at `/assets/*`.
   */
  assetsPath?: string;
  /**
   * An optional filter function for filtering only selected files out of the
   * assets directory. The default implementation ignores files starting with
   * '.'.
   *
   * @param path Path of the asset file.
   * @returns `true` for the path to be included in the app, `false` for it to
   *          be skipped.
   */
  assetsFilter?: (path: string) => boolean;
  /**
   * Path to deno.json. Defaults to 'deno.json' inside the current directory.
   */
  denoJson?: string;
  /**
   * Path to package.json (Node.js). Defaults to 'package.json' inside the
   * current directory.
   */
  packageJson?: string;
  /**
   * If set to true, the output code bundle will be minified.
   */
  minify?: boolean;
  /**
   * Optional custom esbuild plugins. In Deno builds, plugins register after
   * GoatDB's adapter stubs and before its browser asset fallback and Deno
   * resolver/loader. Your `onResolve` handlers receive original specifiers,
   * while `onLoad` handlers can process resolved local files such as CSS before
   * those fallbacks. Applied by both compile() and startDebugServer() rebuilds.
   * The debug server watches only `watchDir`; esbuild `watchFiles`
   * and `watchDirs` do not expand that directory. Keep auxiliary inputs under
   * `watchDir` (or configure a common parent) so their changes rebuild.
   */
  esbuildPlugins?: Plugin[];
  /**
   * Application name. Extracted from the "name" field of the project's
   * deno.json or package.json.
   */
  appName?: string;
};
