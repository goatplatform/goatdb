import * as path from '@std/path';
import * as esbuild from 'esbuild';
import { denoPlugins } from '@luca/esbuild-deno-loader';
import type { ReadonlyJSONObject } from '../base/interfaces.ts';

export type AppConfig = {
  schema: string;
  schemaSetupTs: () => Promise<void>;
  js: string;
  html?: string;
  css?: string;
  assets?: string;
};

export async function loadAppConfig(path: string): Promise<AppConfig> {
  return parseAppConfig(JSON.parse(await Deno.readTextFile(path)), path);
}

export async function parseAppConfig(
  json: ReadonlyJSONObject,
  configPath: string,
): Promise<AppConfig> {
  const baseDir = path.dirname(configPath);
  if (typeof json.js !== 'string') {
    throw new Error('Invalid "js" field');
  }
  if (typeof json.html !== 'string' && typeof json.html !== 'undefined') {
    throw new Error('Invalid "html" field');
  }
  if (typeof json.css !== 'string' && typeof json.css !== 'undefined') {
    throw new Error('Invalid "css" field');
  }
  if (typeof json.assets !== 'string' && typeof json.assets !== 'undefined') {
    throw new Error('Invalid "assets" field');
  }
  // Create a schema setup function
  if (typeof json.schema !== 'string') {
    throw new Error(`Invalid schema field: ${json.schema}`);
  }
  // let code = '';
  // for (const f of schemaFiles) {
  //   code += `// ${f}\n`;
  //   code += await Deno.readTextFile(path.join(baseDir, f as string));
  //   code += '\n\n';
  // }

  return {
    js: path.join(baseDir, json.js),
    html: json.html ? path.join(baseDir, json.html) : undefined,
    css: json.css ? path.join(baseDir, json.css) : undefined,
    assets: json.assets ? path.join(baseDir, json.assets) : undefined,
    schema: json.schema,
    schemaSetupTs: async () => {
      console.log(
        'Loading schema from ' + path.join(baseDir, json.schema as string),
      );
      const r = await import(path.join(baseDir, json.schema as string));
      console.log(r);
    },
  };
}

const JSR_URL = Deno.env.get('JSR_URL') ?? 'https://jsr.io';

function createESBuildGoatPlugin(): esbuild.Plugin {
  return {
    name: 'goatdb',
    setup(build) {
      build.onResolve({ filter: /@goatdb\/goatdb/ }, (args) => {
        return {
          path: new URL('./@goatdb/goatdb', JSR_URL).toString(),
        };
      });
    },
  };
}

async function compileSchemaSetup(
  tsCode: string,
  ext: string,
  denoConfigPath: string,
): Promise<() => void> {
  const result = await esbuild.build({
    stdin: {
      contents: tsCode,
      loader: ext === '.tsx' ? 'tsx' : 'ts',
    },
    plugins: [
      createESBuildGoatPlugin(),
      ...denoPlugins() /*...denoPlugins({ configPath: denoConfigPath })*/,
    ],
    bundle: true,
    write: false,
  });
  return new Function(result.outputFiles[0].text) as () => void;
}
