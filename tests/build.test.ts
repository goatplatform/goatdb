import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';
import { normalizeEntryForDeno } from '../build.ts';

export default function setupBuildTests(): void {
  // normalizeEntryForDeno contract tests (input-driven, no OS gating)
  TEST(
    'Build',
    'normalizeEntryForDeno converts drive-letter paths to file URLs',
    () => {
      assertEquals(
        normalizeEntryForDeno('C:/Users/foo/entry.ts'),
        'file:///C:/Users/foo/entry.ts',
      );
      assertEquals(
        normalizeEntryForDeno('D:/path/to/file.ts'),
        'file:///D:/path/to/file.ts',
      );
      assertEquals(normalizeEntryForDeno('e:/foo'), 'file:///e:/foo');
    },
  );

  TEST(
    'Build',
    'normalizeEntryForDeno handles backslashes and special characters',
    () => {
      const sep = '\\';
      const windowsPath =
        `C:${sep}Users${sep}foo${sep}dir#name${sep}entry file.ts`;
      assertEquals(
        normalizeEntryForDeno(windowsPath),
        'file:///C:/Users/foo/dir%23name/entry%20file.ts',
      );
    },
  );

  TEST('Build', 'normalizeEntryForDeno returns Unix paths unchanged', () => {
    assertEquals(normalizeEntryForDeno('/tmp/entry.ts'), '/tmp/entry.ts');
    assertEquals(
      normalizeEntryForDeno('/home/user/project/foo.ts'),
      '/home/user/project/foo.ts',
    );
  });

  TEST(
    'Build',
    'normalizeEntryForDeno returns relative paths unchanged',
    () => {
      assertEquals(normalizeEntryForDeno('./entry.ts'), './entry.ts');
      assertEquals(normalizeEntryForDeno('entry.ts'), 'entry.ts');
      assertEquals(normalizeEntryForDeno('../foo/bar.ts'), '../foo/bar.ts');
    },
  );

  TEST(
    'Build',
    'normalizeEntryForDeno returns existing file URLs unchanged',
    () => {
      assertEquals(
        normalizeEntryForDeno('file:///home/user/entry.ts'),
        'file:///home/user/entry.ts',
      );
      assertEquals(
        normalizeEntryForDeno('file:///C:/Users/foo/entry.ts'),
        'file:///C:/Users/foo/entry.ts',
      );
    },
  );

  TEST('Build', 'normalizeEntryForDeno converts UNC paths to file URLs', () => {
    assertEquals(
      normalizeEntryForDeno('\\\\server\\share\\file.ts'),
      'file://server/share/file.ts',
    );
    assertEquals(
      normalizeEntryForDeno('//server/share/dir name/file#1.ts'),
      'file://server/share/dir%20name/file%231.ts',
    );
  });
}
