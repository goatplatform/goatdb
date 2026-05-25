import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';
import * as path from '../base/path.ts';
import { isBrowser } from '../base/common.ts';
import { normalizeBuildEntryPath, resolveBuildEntryPath } from '../build.ts';

export default function setupBuildTests(): void {
  // normalizeBuildEntryPath contract tests (input-driven, no OS gating)
  TEST(
    'Build',
    'normalizeBuildEntryPath normalizes drive-letter paths to forward slashes',
    () => {
      assertEquals(
        normalizeBuildEntryPath('C:/Users/foo/entry.ts'),
        'C:/Users/foo/entry.ts',
      );
      assertEquals(
        normalizeBuildEntryPath('D:\\path\\to\\file.ts'),
        'D:/path/to/file.ts',
      );
      assertEquals(normalizeBuildEntryPath('e:/foo'), 'e:/foo');
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath converts backslashes in drive-letter paths',
    () => {
      const windowsPath = 'C:\\Users\\foo\\dir#name\\entry file.ts';
      assertEquals(
        normalizeBuildEntryPath(windowsPath),
        'C:/Users/foo/dir#name/entry file.ts',
      );
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath leaves POSIX absolute paths unchanged',
    () => {
      assertEquals(normalizeBuildEntryPath('/tmp/entry.ts'), '/tmp/entry.ts');
      assertEquals(
        normalizeBuildEntryPath('/home/user/project/foo.ts'),
        '/home/user/project/foo.ts',
      );
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath leaves relative paths unchanged',
    () => {
      assertEquals(normalizeBuildEntryPath('./entry.ts'), './entry.ts');
      assertEquals(normalizeBuildEntryPath('entry.ts'), 'entry.ts');
      assertEquals(normalizeBuildEntryPath('../foo/bar.ts'), '../foo/bar.ts');
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath preserves existing file URL specifiers',
    () => {
      assertEquals(
        normalizeBuildEntryPath('file:///home/user/entry.ts'),
        'file:///home/user/entry.ts',
      );
      assertEquals(
        normalizeBuildEntryPath('file:///C:/Users/foo/entry.ts'),
        'file:///C:/Users/foo/entry.ts',
      );
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath canonicalizes UNC paths to file URLs',
    () => {
      assertEquals(
        normalizeBuildEntryPath('\\\\server\\share\\file.ts'),
        'file://server/share/file.ts',
      );
      assertEquals(
        normalizeBuildEntryPath('//server/share/dir name/file#1.ts'),
        'file://server/share/dir%20name/file%231.ts',
      );
    },
  );

  TEST(
    'Build',
    'resolveBuildEntryPath resolves relative inputs to absolute paths',
    () => {
      // On POSIX, normalizeBuildEntryPath is identity for absolute paths, so this
      // verifies the resolve step without a platform-specific normalisation result.
      assertEquals(
        resolveBuildEntryPath('./tests/build.test.ts'),
        path.resolve('./tests/build.test.ts'),
      );
    },
  );

  if (!isBrowser()) {
    TEST(
      'Build',
      'resolveBuildEntryPath decodes local file URLs to native paths',
      () => {
        assertEquals(
          resolveBuildEntryPath('file:///C:/Users/foo/entry.ts'),
          'C:/Users/foo/entry.ts',
        );
        assertEquals(
          resolveBuildEntryPath('file:///tmp/entry.ts'),
          '/tmp/entry.ts',
        );
      },
    );
  }

  TEST(
    'Build',
    'resolveBuildEntryPath preserves UNC entry specifiers without corruption',
    () => {
      // UNC inputs must retain their host/share boundary instead of flattening
      // into a local POSIX-looking path.
      assertEquals(
        resolveBuildEntryPath('//server/share/file.ts'),
        'file://server/share/file.ts',
      );
      assertEquals(
        resolveBuildEntryPath('\\\\server\\share\\file.ts'),
        'file://server/share/file.ts',
      );
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath preserves UNC file:// URLs unchanged',
    () => {
      // normalizeBuildEntryPath treats existing file:// specifiers as already
      // canonical build-entry input.
      assertEquals(
        normalizeBuildEntryPath('file://server/share/file.ts'),
        'file://server/share/file.ts',
      );
    },
  );

  TEST(
    'Build',
    'resolveBuildEntryPath handles Windows drive-letter paths',
    () => {
      assertEquals(
        resolveBuildEntryPath('C:/Users/foo/entry.ts'),
        'C:/Users/foo/entry.ts',
      );
      assertEquals(
        resolveBuildEntryPath('C:\\Users\\foo\\entry.ts'),
        'C:/Users/foo/entry.ts',
      );
    },
  );

  TEST(
    'Build',
    'resolveBuildEntryPath handles POSIX absolute paths',
    () => {
      assertEquals(
        resolveBuildEntryPath('/tmp/entry.ts'),
        '/tmp/entry.ts',
      );
      assertEquals(
        resolveBuildEntryPath('/home/user/project/foo.ts'),
        '/home/user/project/foo.ts',
      );
    },
  );

  TEST('Build', 'normalizeBuildEntryPath handles edge cases', () => {
    // Empty string falls through all branches unchanged
    assertEquals(normalizeBuildEntryPath(''), '');
    // Mixed separators in drive-letter path
    assertEquals(
      normalizeBuildEntryPath('C:/Users\\foo/file.ts'),
      'C:/Users/foo/file.ts',
    );
    // Existing file:// specifiers are preserved; decoding happens in resolveBuildEntryPath.
    assertEquals(
      normalizeBuildEntryPath('file://localhost/path/to/file'),
      'file://localhost/path/to/file',
    );
  });

  if (!isBrowser()) {
    TEST(
      'Build',
      'resolveBuildEntryPath preserves UNC file:// URL identity',
      () => {
        assertEquals(
          resolveBuildEntryPath('file://server/share/file.ts'),
          'file://server/share/file.ts',
        );
      },
    );
  }
}
