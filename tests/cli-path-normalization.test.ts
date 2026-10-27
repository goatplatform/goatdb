/** Synthetic `deno info --json` coverage for Windows paths. The real payload
 * is OS-specific, so normalize synthetic payloads on every platform. */

import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { denoInfoProjectRoot, parseDenoInfo } from './cli-template-utils.ts';

const kWindowsPayload = JSON.stringify({
  roots: ['file:///C:/proj/client/index.tsx'],
  modules: [
    {
      specifier: 'file:///C:/proj/vendor/goatdb/mod.ts',
      local: 'C:\\proj\\vendor\\goatdb\\mod.ts',
    },
    {
      specifier: 'file:///C:/proj/client/index.tsx',
      local: 'C:\\proj\\client\\index.tsx',
    },
  ],
  npmPackages: {},
});

const kWindowsShortNamePayload = JSON.stringify({
  roots: [
    'file:///C:/Users/RUNNER~1/AppData/Local/Temp/test-CLI-Compile/compile-e2e/client/index.tsx',
  ],
  modules: [{
    specifier:
      'file:///C:/Users/RUNNER~1/AppData/Local/Temp/test-CLI-Compile/compile-e2e/vendor/goatdb/mod.ts',
    local:
      'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\test-CLI-Compile\\compile-e2e\\vendor\\goatdb\\mod.ts',
  }],
  npmPackages: {},
});

export default function setupCliPathNormalizationTests(): void {
  TEST('Path', 'deno info local paths are POSIX-normalized', () => {
    const info = parseDenoInfo(kWindowsPayload);
    assertEquals(info.modules[0].local, 'C:/proj/vendor/goatdb/mod.ts');
    assertEquals(info.modules[0].local!.includes('\\'), false);
  });

  TEST('Path', 'deno info local paths use semantic containment', () => {
    const vendorRoot = path.join('C:/proj', 'vendor/goatdb');
    const [local, client] = parseDenoInfo(kWindowsPayload).modules.map((m) =>
      m.local
    );
    assertTrue(local !== undefined && path.isWithin(vendorRoot, local));
    assertEquals(
      client !== undefined && path.isWithin(vendorRoot, client),
      false,
    );
  });

  TEST('Path', 'deno info graph root preserves Windows 8.3 spelling', () => {
    const info = parseDenoInfo(kWindowsShortNamePayload);
    const vendorRoot = path.join(
      denoInfoProjectRoot(info, 'client/index.tsx'),
      'vendor/goatdb',
    );
    assertEquals(
      vendorRoot,
      'C:/Users/RUNNER~1/AppData/Local/Temp/test-CLI-Compile/compile-e2e/vendor/goatdb',
    );
    assertTrue(path.isWithin(vendorRoot, info.modules[0].local!));
  });

  TEST(
    'Path',
    'deno info normalizes Windows payloads and rejects non-JSON',
    () => {
      const payload = JSON.stringify({
        roots: ['file:///c:/proj/client/index.tsx'],
        modules: [{
          specifier: 'file:///c:/proj/vendor/goatdb/mod.ts',
          local: 'c:\\proj/vendor\\goatdb/mod.ts',
        }],
        npmPackages: {},
      });
      const local = parseDenoInfo(payload).modules[0].local!;
      assertEquals(local, 'c:/proj/vendor/goatdb/mod.ts');
      assertTrue(path.isWithin('C:/proj/vendor/goatdb', local));
      let threw = false;
      try {
        parseDenoInfo('no json here');
      } catch {
        threw = true;
      }
      assertTrue(threw);
    },
  );
}
