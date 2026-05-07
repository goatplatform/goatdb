import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';
import { normalizeBuildEntryPath } from '../build.ts';

export default function setupBuildTests(): void {
  // normalizeBuildEntryPath contract tests (input-driven, no OS gating)
  TEST(
    'Build',
    'normalizeBuildEntryPath canonicalizes drive-letter paths to file URLs',
    () => {
      assertEquals(
        normalizeBuildEntryPath('C:/Users/foo/entry.ts'),
        'file:///C:/Users/foo/entry.ts',
      );
      assertEquals(
        normalizeBuildEntryPath('D:/path/to/file.ts'),
        'file:///D:/path/to/file.ts',
      );
      assertEquals(normalizeBuildEntryPath('e:/foo'), 'file:///e:/foo');
    },
  );

  TEST(
    'Build',
    'normalizeBuildEntryPath preserves backslash semantics and escapes special characters',
    () => {
      const sep = '\\';
      const windowsPath =
        `C:${sep}Users${sep}foo${sep}dir#name${sep}entry file.ts`;
      assertEquals(
        normalizeBuildEntryPath(windowsPath),
        'file:///C:/Users/foo/dir%23name/entry%20file.ts',
      );
    },
  );

  TEST('Build', 'normalizeBuildEntryPath leaves POSIX absolute paths unchanged', () => {
    assertEquals(normalizeBuildEntryPath('/tmp/entry.ts'), '/tmp/entry.ts');
    assertEquals(
      normalizeBuildEntryPath('/home/user/project/foo.ts'),
      '/home/user/project/foo.ts',
    );
  });

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
    'normalizeBuildEntryPath leaves existing file URLs unchanged',
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

  TEST('Build', 'normalizeBuildEntryPath canonicalizes UNC paths to file URLs', () => {
    assertEquals(
      normalizeBuildEntryPath('\\\\server\\share\\file.ts'),
      'file://server/share/file.ts',
    );
    assertEquals(
      normalizeBuildEntryPath('//server/share/dir name/file#1.ts'),
      'file://server/share/dir%20name/file%231.ts',
    );
  });
}
