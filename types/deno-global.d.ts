// Minimal Deno global stub for cross-runtime source files compiled under
// tsup/Node.js. npm consumers never run on Deno; we only need TypeScript
// to accept Deno.* in both value positions (Deno.serve()) and type positions
// (variable: Deno.HttpServer).
//
// Using `declare namespace` (not `declare const`) so it works as a type
// namespace for annotations like `private _server?: Deno.HttpServer`.
declare namespace Deno {
  // ---- Common types used in type-annotation positions ----
  type HttpServer = any;
  type ServeHandlerInfo = any;
  type CommandOptions = any;
  type ChildProcess = any;
  type FsFile = any;
  type SeekMode = any;
  type InspectOptions = any;

  // ---- Constructable classes ----
  class Command {
    constructor(command: string, options?: any);
    output(): Promise<any>;
    spawn(): any;
  }

  // ---- Runtime values ----
  const args: readonly string[];
  const pid: number;
  const mainModule: string;
  function execPath(): string;
  function exit(code?: number): never;
  function cwd(): string;
  function hostname(): string;
  function stat(path: string): Promise<any>;
  function lstat(path: string): Promise<any>;
  function readDir(path: string): AsyncIterable<any>;
  function readFile(path: string, options?: any): Promise<Uint8Array>;
  function readTextFile(path: string, options?: any): Promise<string>;
  function writeTextFile(path: string, data: string, options?: any): Promise<void>;
  function writeFileSync(path: string, data: Uint8Array, options?: any): void;
  function copyFile(from: string, to: string): Promise<void>;
  function remove(path: string, options?: any): Promise<void>;
  function mkdir(path: string, options?: any): Promise<void>;
  function makeTempDir(options?: any): Promise<string>;
  function open(path: string, options?: any): Promise<any>;
  function symlink(oldpath: string, newpath: string, options?: any): Promise<void>;
  function watchFs(paths: string | string[], options?: any): any;
  function addSignalListener(signal: string, handler: () => void): void;
  function serve(...args: any[]): any;

  const env: {
    get(key: string): string | undefined;
    toObject(): Record<string, string>;
    [key: string]: any;
  };

  const build: {
    os: string;
    arch: string;
    target: string;
    vendor: string;
    env?: string | null;
    [key: string]: any;
  };

  const version: {
    deno: string;
    typescript: string;
    v8: string;
    [key: string]: any;
  };

  const stdout: {
    write(data: Uint8Array): Promise<number>;
    [key: string]: any;
  };

  namespace errors {
    class NotFound extends Error {}
    class PermissionDenied extends Error {}
    class ConnectionReset extends Error {}
    class ConnectionAborted extends Error {}
  }

  // SeekMode enum values
  namespace SeekMode {
    const Start: 0;
    const Current: 1;
    const End: 2;
  }

  // Allow test registration (Deno.test)
  function test(...args: any[]): void;
}
