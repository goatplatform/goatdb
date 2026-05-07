import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { getRepositoryPath } from '../base/git-root.ts';
import * as path from '../base/path.ts';

interface SourceMapV3 {
  version: number;
  sources: string[];
}

export default function setupBuildDenoTests(): void {
  TEST(
    'Build',
    'buildSysAssetsBundle emits a parseable JS worker bundle',
    async () => {
      const { buildSysAssetsBundle } = await import(
        '../system-assets/build-sys-assets.ts'
      );
      const assets = await buildSysAssetsBundle();
      const jsAsset = assets['/system-assets/json-log-worker.js'];
      assertExists(jsAsset, 'worker JS asset must be generated');
      assertEquals(
        jsAsset.contentType,
        'text/javascript',
        'worker JS must have text/javascript content type',
      );

      const js = new TextDecoder().decode(jsAsset.data);
      assertTrue(
        js.length > 0,
        'worker JS bundle must not be empty',
      );
      new Function(js);
    },
  );

  TEST(
    'Build',
    'buildSysAssetsBundle includes all expected assets',
    async () => {
      const { buildSysAssetsBundle } = await import(
        '../system-assets/build-sys-assets.ts'
      );
      const assets = await buildSysAssetsBundle();

      const expectedAssets = [
        '/system-assets/json-log-worker.js',
        '/system-assets/json-log-worker.js.map',
      ];

      for (const assetPath of expectedAssets) {
        assertExists(
          assets[assetPath],
          `expected asset ${assetPath} must be present`,
        );
      }
    },
  );

  TEST(
    'Build',
    'buildSysAssetsBundle emits a worker source map with clean source paths',
    async () => {
      const { buildSysAssetsBundle } = await import(
        '../system-assets/build-sys-assets.ts'
      );
      const assets = await buildSysAssetsBundle();
      const mapAsset = assets['/system-assets/json-log-worker.js.map'];
      assertExists(mapAsset, 'worker source map asset must be generated');
      assertEquals(
        mapAsset.contentType,
        'application/json',
        'source map must have application/json content type',
      );

      const mapJson = new TextDecoder().decode(mapAsset.data);
      const map = JSON.parse(mapJson) as SourceMapV3;

      assertEquals(map.version, 3, 'source map must be version 3');
      assertTrue(
        Array.isArray(map.sources),
        'source map must expose a sources array',
      );
      assertTrue(
        map.sources.length > 0,
        'source map must reference at least one source',
      );

      // Verify no duplicated directory segments that would indicate broken path resolution
      // e.g. "../base/base/tuple.ts" or "../logging/logging/log.ts"
      const duplicatedDirPattern =
        /\/(base\/base|logging\/logging|json-log\/json-log)\//;
      assertTrue(
        map.sources.every((s) => !duplicatedDirPattern.test(s)),
        'source map must not duplicate directory segments',
      );

      // Verify the worker entry point is referenced
      assertTrue(
        map.sources.some((s) => s.includes('json-log-worker-entry')),
        'source map must reference the worker entry source',
      );
    },
  );

  TEST(
    'Build',
    'buildSysAssets JSON exactly matches the committed assets.json',
    async () => {
      const { buildSysAssetsJSON } = await import(
        '../system-assets/build-sys-assets.ts'
      );

      const repoPath = await getRepositoryPath();
      const committedJson = await Deno.readTextFile(
        path.join(repoPath, 'system-assets', 'assets.json'),
      );
      const generatedJson = await buildSysAssetsJSON();

      JSON.parse(committedJson) as Record<string, unknown>;
      JSON.parse(generatedJson) as Record<string, unknown>;
      assertEquals(
        generatedJson,
        committedJson,
        'generated assets.json must exactly match the committed file',
      );
    },
  );
}
