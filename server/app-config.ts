/**
 * A configuration of a Single Page Application built on top GoatDB.
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
};
