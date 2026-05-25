import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';
import {
  basename,
  dirname,
  extname,
  fromFileUrl,
  isAbsolute,
  isFileUrlPath,
  isUncPathRaw,
  join,
  normalize,
  resolve,
  toAbsolutePath,
  toFileUrl,
} from '../base/path.ts';
import { assertThrows } from './asserts.ts';

export default function setupPathTests(): void {
  // normalize tests
  TEST('Path', 'normalize handles empty string', () => {
    assertEquals(normalize(''), '.');
  });

  TEST('Path', 'normalize handles single dot', () => {
    assertEquals(normalize('.'), '.');
  });

  TEST('Path', 'normalize handles double dots', () => {
    assertEquals(normalize('./foo/../bar'), 'bar');
    assertEquals(normalize('/foo/../bar'), '/bar');
    assertEquals(normalize('foo/bar/../baz'), 'foo/baz');
  });

  TEST('Path', 'normalize converts backslashes', () => {
    assertEquals(normalize('foo\\bar\\baz'), 'foo/bar/baz');
    assertEquals(normalize('C:\\Users\\foo'), 'C:/Users/foo');
    assertEquals(normalize('\\foo\\bar'), '/foo/bar');
  });

  TEST('Path', 'normalize collapses multiple slashes', () => {
    assertEquals(normalize('foo//bar///baz'), 'foo/bar/baz');
    assertEquals(normalize('/foo//bar'), '/foo/bar');
  });

  TEST('Path', 'normalize preserves UNC root semantics', () => {
    assertEquals(normalize('//server/share/file.ts'), '//server/share/file.ts');
    assertEquals(
      normalize('//server/share/../other/file.ts'),
      '//server/share/other/file.ts',
    );
    assertEquals(
      normalize('//server/share/foo/../../other/file.ts'),
      '//server/share/other/file.ts',
    );
    assertEquals(
      normalize('\\\\server\\share\\file.ts'),
      '//server/share/file.ts',
    );
  });

  // isUncPathRaw tests
  TEST('Path', 'isUncPathRaw detects UNC paths with both slash forms', () => {
    assertEquals(isUncPathRaw('//server/share/file.ts'), true);
    assertEquals(isUncPathRaw('\\\\server\\share\\file.ts'), true);
    assertEquals(isUncPathRaw('//host'), true);
  });

  TEST('Path', 'isUncPathRaw rejects non-UNC paths', () => {
    assertEquals(isUncPathRaw('/absolute/path'), false);
    assertEquals(isUncPathRaw('C:/path'), false);
    assertEquals(isUncPathRaw('relative/path'), false);
    assertEquals(isUncPathRaw(''), false);
    assertEquals(isUncPathRaw('///triple'), false);
  });

  // dirname tests
  TEST('Path', 'dirname extracts directory', () => {
    assertEquals(dirname('/foo/bar/baz.txt'), '/foo/bar');
    assertEquals(dirname('foo/bar'), 'foo');
    assertEquals(dirname('foo'), '.');
    assertEquals(dirname('/foo'), '/');
  });

  TEST('Path', 'dirname handles backslashes', () => {
    assertEquals(dirname('foo\\bar\\baz'), 'foo/bar');
    assertEquals(dirname('C:\\Users\\foo'), 'C:/Users');
  });

  TEST('Path', 'dirname handles trailing slash', () => {
    assertEquals(dirname('/foo/bar/'), '/foo');
  });

  // basename tests
  TEST('Path', 'basename extracts filename', () => {
    assertEquals(basename('/foo/bar/baz.txt'), 'baz.txt');
    assertEquals(basename('foo/bar'), 'bar');
    assertEquals(basename('foo'), 'foo');
  });

  TEST('Path', 'basename strips extension', () => {
    assertEquals(basename('/foo/bar/baz.txt', '.txt'), 'baz');
    assertEquals(basename('foo.js', '.js'), 'foo');
  });

  TEST('Path', 'basename handles backslashes', () => {
    assertEquals(basename('foo\\bar\\baz.txt'), 'baz.txt');
  });

  TEST('Path', 'basename handles trailing slash', () => {
    assertEquals(basename('/foo/bar/'), 'bar');
  });

  // extname tests
  TEST('Path', 'extname extracts extension', () => {
    assertEquals(extname('foo.txt'), '.txt');
    assertEquals(extname('foo.bar.baz'), '.baz');
    assertEquals(extname('/path/to/file.js'), '.js');
  });

  TEST('Path', 'extname returns empty for no extension', () => {
    assertEquals(extname('foo'), '');
    assertEquals(extname('/path/to/file'), '');
  });

  TEST('Path', 'extname handles hidden files', () => {
    assertEquals(extname('.hidden'), '');
    assertEquals(extname('.hidden.txt'), '.txt');
  });

  TEST('Path', 'extname handles backslashes', () => {
    assertEquals(extname('foo\\bar.txt'), '.txt');
  });

  // join tests
  TEST('Path', 'join combines paths', () => {
    assertEquals(join('foo', 'bar', 'baz'), 'foo/bar/baz');
    assertEquals(join('/foo', 'bar'), '/foo/bar');
    assertEquals(join('foo', '/bar'), 'foo/bar');
  });

  TEST('Path', 'join handles empty segments', () => {
    assertEquals(join('foo', '', 'bar'), 'foo/bar');
    assertEquals(join('', 'foo', 'bar'), 'foo/bar');
  });

  TEST('Path', 'join normalizes result', () => {
    assertEquals(join('foo', '../bar'), 'bar');
    assertEquals(join('foo', './bar'), 'foo/bar');
  });

  // isAbsolute tests
  TEST('Path', 'isAbsolute detects absolute paths', () => {
    assertEquals(isAbsolute('/foo'), true);
    assertEquals(isAbsolute('/'), true);
  });

  TEST('Path', 'isAbsolute detects relative paths', () => {
    assertEquals(isAbsolute('foo'), false);
    assertEquals(isAbsolute('./foo'), false);
    assertEquals(isAbsolute('../foo'), false);
    assertEquals(isAbsolute(''), false);
  });

  TEST('Path', 'isAbsolute handles Windows drive letters', () => {
    assertEquals(isAbsolute('C:/Users'), true);
    assertEquals(isAbsolute('C:\\Users'), true);
    assertEquals(isAbsolute('d:/foo'), true);
    assertEquals(isAbsolute('D:\\bar\\baz'), true);
  });

  // resolve tests
  TEST('Path', 'resolve combines absolute and relative paths', () => {
    assertEquals(resolve('/foo', 'bar'), '/foo/bar');
    assertEquals(resolve('/foo', 'bar', 'baz'), '/foo/bar/baz');
    assertEquals(resolve('/foo', '../bar'), '/bar');
  });

  TEST('Path', 'resolve uses rightmost absolute path', () => {
    assertEquals(resolve('/foo', '/bar', 'baz'), '/bar/baz');
    assertEquals(resolve('foo', '/bar'), '/bar');
  });

  // toAbsolutePath tests
  TEST('Path', 'toAbsolutePath returns absolute paths unchanged', () => {
    assertEquals(toAbsolutePath('/foo/bar'), '/foo/bar');
    assertEquals(toAbsolutePath('/'), '/');
  });

  TEST('Path', 'toAbsolutePath converts relative to absolute', () => {
    const result = toAbsolutePath('foo/bar');
    assertEquals(isAbsolute(result), true);
    assertEquals(result.endsWith('foo/bar'), true);
  });

  // isFileUrlPath tests
  TEST('Path', 'isFileUrlPath detects file:// URLs', () => {
    assertEquals(isFileUrlPath('file:///path'), true);
    assertEquals(isFileUrlPath('file:///C:/path'), true);
    assertEquals(isFileUrlPath('file://server/share'), true);
    assertEquals(isFileUrlPath('file://'), true);
  });

  TEST('Path', 'isFileUrlPath rejects non-file paths', () => {
    assertEquals(isFileUrlPath('/absolute/path'), false);
    assertEquals(isFileUrlPath('C:/path'), false);
    assertEquals(isFileUrlPath('https://example.com'), false);
    assertEquals(isFileUrlPath(''), false);
    assertEquals(isFileUrlPath('file:/x'), false); // single slash — not file://
    assertEquals(isFileUrlPath('FILE:///path'), false); // case-sensitive: scheme must be lowercase
  });

  // fromFileUrl tests
  TEST('Path', 'fromFileUrl converts Unix file URLs', () => {
    assertEquals(fromFileUrl('file:///path/to/file'), '/path/to/file');
    assertEquals(fromFileUrl('file:///'), '/');
    assertEquals(fromFileUrl('file:///foo/bar/baz.txt'), '/foo/bar/baz.txt');
  });

  TEST('Path', 'toFileUrl converts Unix absolute paths', () => {
    assertEquals(toFileUrl('/path/to/file').href, 'file:///path/to/file');
    assertEquals(
      toFileUrl('/path/with spaces/and#hash').href,
      'file:///path/with%20spaces/and%23hash',
    );
  });

  TEST('Path', 'toFileUrl converts Windows absolute paths', () => {
    const sep = '\\';
    const windowsPath =
      `C:${sep}Users${sep}foo${sep}dir#name${sep}entry file.ts`;
    assertEquals(toFileUrl('C:/Users/foo').href, 'file:///C:/Users/foo');
    assertEquals(
      toFileUrl(windowsPath).href,
      'file:///C:/Users/foo/dir%23name/entry%20file.ts',
    );
  });

  TEST('Path', 'toFileUrl throws for relative paths', () => {
    assertThrows(() => toFileUrl('foo/bar'));
    assertThrows(() => toFileUrl('../foo/bar'));
  });

  TEST('Path', 'toFileUrl converts UNC absolute paths', () => {
    assertEquals(
      toFileUrl('\\\\server\\share\\file').href,
      'file://server/share/file',
    );
    assertEquals(
      toFileUrl('//server/share/dir name/file#1').href,
      'file://server/share/dir%20name/file%231',
    );
  });

  TEST('Path', 'toFileUrl rejects invalid UNC paths', () => {
    assertThrows(() => toFileUrl('\\\\server'));
    assertThrows(() => toFileUrl('//server'));
  });

  TEST('Path', 'fromFileUrl converts Windows file URLs', () => {
    assertEquals(fromFileUrl('file:///C:/Users/foo'), 'C:/Users/foo');
    assertEquals(
      fromFileUrl('file:///D:/path/to/file.txt'),
      'D:/path/to/file.txt',
    );
  });

  TEST('Path', 'fromFileUrl converts UNC file URLs', () => {
    assertEquals(
      fromFileUrl('file://server/share/file.txt'),
      '//server/share/file.txt',
    );
    assertEquals(
      fromFileUrl('file://server/share/dir%20name/file%231.txt'),
      '//server/share/dir name/file#1.txt',
    );
  });

  TEST('Path', 'fromFileUrl treats localhost as local', () => {
    assertEquals(fromFileUrl('file://localhost/path'), '/path');
    assertEquals(
      fromFileUrl('file://localhost/C:/Users/foo'),
      'C:/Users/foo',
    );
  });

  TEST('Path', 'fromFileUrl handles URL objects', () => {
    const url = new URL('file:///path/to/file');
    assertEquals(fromFileUrl(url), '/path/to/file');
  });

  TEST('Path', 'fromFileUrl decodes encoded characters', () => {
    assertEquals(
      fromFileUrl('file:///path/with%20spaces'),
      '/path/with spaces',
    );
    assertEquals(fromFileUrl('file:///path/%E2%9C%93'), '/path/\u2713');
  });

  TEST('Path', 'fromFileUrl throws for non-file protocols', () => {
    assertThrows(() => fromFileUrl('https://example.com/path'));
    assertThrows(() => fromFileUrl('http://localhost/path'));
  });

  // toFileUrl/fromFileUrl roundtrip invariants
  TEST('Path', 'toFileUrl and fromFileUrl roundtrip correctly', () => {
    assertEquals(fromFileUrl(toFileUrl('/path/to/file').href), '/path/to/file');
    assertEquals(
      fromFileUrl(toFileUrl('/path/with spaces').href),
      '/path/with spaces',
    );
    assertEquals(
      fromFileUrl(toFileUrl('/path/with#hash').href),
      '/path/with#hash',
    );
    assertEquals(
      fromFileUrl(toFileUrl('C:/Users/foo').href),
      'C:/Users/foo',
    );
    assertEquals(
      fromFileUrl(toFileUrl('C:/path/with spaces/and#hash').href),
      'C:/path/with spaces/and#hash',
    );
    assertEquals(
      fromFileUrl(toFileUrl('\\\\server\\share\\dir name\\file#1').href),
      '//server/share/dir name/file#1',
    );
  });
}
