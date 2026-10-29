import { TEST } from './mod.ts';
import {
  assertEquals,
  assertThrows,
  assertThrowsInstanceOf,
} from './asserts.ts';
import * as path from '../base/path.ts';

function table<T>(rows: readonly T[], run: (row: T) => void): void {
  for (const row of rows) run(row);
}

export default function setupPathTests(): void {
  TEST(
    'Path',
    'normalize handles empty, dotted, repeated, and rooted paths',
    () => {
      table<readonly [string, string]>([
        ['', '.'],
        ['.', '.'],
        ['./foo/../bar', 'bar'],
        ['/foo/../bar', '/bar'],
        ['foo/bar/../baz', 'foo/baz'],
        ['foo\\bar\\baz', 'foo/bar/baz'],
        ['C:\\Users\\foo', 'C:/Users/foo'],
        ['\\foo\\bar', '/foo/bar'],
        ['foo//bar///baz', 'foo/bar/baz'],
        ['/foo//bar', '/foo/bar'],
        ['C:\\', 'C:/'],
        ['C:\\Users\\foo\\', 'C:/Users/foo'],
        ['\\\\fileserver\\share\\dir', '//fileserver/share/dir'],
      ], ([input, want]) => assertEquals(path.normalize(input), want, input));
    },
  );

  TEST('Path', 'dirname extracts directory across path families', () => {
    table<readonly [string, string]>([
      ['/foo/bar/baz.txt', '/foo/bar'],
      ['foo/bar', 'foo'],
      ['foo', '.'],
      ['/foo', '/'],
      ['foo\\bar\\baz', 'foo/bar'],
      ['C:\\Users\\foo', 'C:/Users'],
      ['/foo/bar/', '/foo'],
      ['//server/share/dir/file', '//server/share/dir'],
      ['//server/share/dir/sub/file.txt', '//server/share/dir/sub'],
      ['//server/share/file.txt', '//server/share'],
      ['//server/share/dir/', '//server/share'],
      ['//server/share', '//server/share'],
      ['\\\\server\\share\\dir\\file', '//server/share/dir'],
    ], ([input, want]) => assertEquals(path.dirname(input), want, input));
  });

  TEST('Path', 'basename extracts, strips, and normalizes', () => {
    table<readonly [string, string]>([
      ['/foo/bar/baz.txt', 'baz.txt'],
      ['foo/bar', 'bar'],
      ['foo', 'foo'],
      ['foo\\bar\\baz.txt', 'baz.txt'],
      ['/foo/bar/', 'bar'],
    ], ([input, want]) => assertEquals(path.basename(input), want, input));
    assertEquals(path.basename('/foo/bar/baz.txt', '.txt'), 'baz');
    assertEquals(path.basename('foo.js', '.js'), 'foo');
  });

  TEST('Path', 'extname extracts extensions across path families', () => {
    table<readonly [string, string]>([
      ['foo.txt', '.txt'],
      ['foo.bar.baz', '.baz'],
      ['/path/to/file.js', '.js'],
      ['foo', ''],
      ['/path/to/file', ''],
      ['.hidden', ''],
      ['.hidden.txt', '.txt'],
      ['foo\\bar.txt', '.txt'],
    ], ([input, want]) => assertEquals(path.extname(input), want, input));
  });

  TEST('Path', 'join combines, skips empty segments, and normalizes', () => {
    table<readonly [readonly string[], string]>(
      [
        [['foo', 'bar', 'baz'], 'foo/bar/baz'],
        [['/foo', 'bar'], '/foo/bar'],
        [['foo', '/bar'], 'foo/bar'],
        [['/', 'a', 'b'], '/a/b'],
        [['foo', '', 'bar'], 'foo/bar'],
        [['', 'foo', 'bar'], 'foo/bar'],
        [['foo', '../bar'], 'bar'],
        [['foo', './bar'], 'foo/bar'],
      ],
      ([parts, want]) =>
        assertEquals(path.join(...parts), want, parts.join('|')),
    );
  });

  TEST('Path', 'isAbsolute and isRoot classify paths', () => {
    table<readonly [string, boolean]>([
      ['/foo', true],
      ['/', true],
      ['C:/Users', true],
      ['C:\\Users', true],
      ['d:/foo', true],
      ['D:\\bar\\baz', true],
      ['foo', false],
      ['./foo', false],
      ['../foo', false],
      ['', false],
    ], ([input, want]) => assertEquals(path.isAbsolute(input), want, input));
    table<readonly [string, boolean]>([
      ['/', true],
      ['C:/', true],
      ['//server/share', true],
      ['/data', false],
      ['C:/data', false],
      ['data', false],
    ], ([input, want]) => assertEquals(path.isRoot(input), want, input));
  });

  TEST('Path', 'resolve and toAbsolutePath turn inputs into paths', () => {
    table<readonly [readonly string[], string]>(
      [
        [['/foo', 'bar'], '/foo/bar'],
        [['/foo', 'bar', 'baz'], '/foo/bar/baz'],
        [['/foo', '../bar'], '/bar'],
        [['/', 'a', 'b'], '/a/b'],
        [['/foo', '/bar', 'baz'], '/bar/baz'],
        [['foo', '/bar'], '/bar'],
      ],
      ([parts, want]) =>
        assertEquals(path.resolve(...parts), want, parts.join('|')),
    );
    assertEquals(path.toAbsolutePath('/foo/bar'), '/foo/bar');
    assertEquals(path.toAbsolutePath('/'), '/');
    const absolute = path.toAbsolutePath('foo/bar');
    assertEquals(path.isAbsolute(absolute), true);
    assertEquals(absolute.endsWith('foo/bar'), true);
  });

  TEST('Path', 'fromFileUrl converts and validates file URLs', () => {
    table<readonly [string, string]>([
      ['file:///path/to/file', '/path/to/file'],
      ['file:///', '/'],
      ['file:///foo/bar/baz.txt', '/foo/bar/baz.txt'],
      ['file:///C:/Users/foo', 'C:/Users/foo'],
      ['file:///D:/path/to/file.txt', 'D:/path/to/file.txt'],
      ['file:///path/with%20spaces', '/path/with spaces'],
      ['file:///path/%E2%9C%93', '/path/\u2713'],
    ], ([input, want]) => assertEquals(path.fromFileUrl(input), want, input));
    assertEquals(
      path.fromFileUrl(new URL('file:///path/to/file')),
      '/path/to/file',
    );
    assertThrows(() => path.fromFileUrl('https://example.com/path'));
    assertThrows(() => path.fromFileUrl('http://localhost/path'));
  });

  TEST('Path', 'toFileUrl converts and validates paths', () => {
    table<readonly [string, string]>([
      ['/Users/foo/bar', 'file:///Users/foo/bar'],
      ['/', 'file:///'],
      ['C:/Users/foo', 'file:///C:/Users/foo'],
      ['d:/path/to/file.txt', 'file:///d:/path/to/file.txt'],
      ['C:\\Users\\foo', 'file:///C:/Users/foo'],
      [
        '\\\\fileserver\\shared folder\\entry.ts',
        'file://fileserver/shared%20folder/entry.ts',
      ],
      ['C:/goat#44?/100%/entry.ts', 'file:///C:/goat%2344%3F/100%25/entry.ts'],
    ], ([input, want]) => assertEquals(path.toFileUrl(input), want, input));
    assertEquals(
      path.fromFileUrl('file://fileserver/shared%20folder/entry.ts'),
      '//fileserver/shared folder/entry.ts',
    );
    assertEquals(
      path.fromFileUrl('file:///C:/goat%2344%3F/100%25/entry.ts'),
      'C:/goat#44?/100%/entry.ts',
    );
    for (const relative of ['foo/bar', './foo', '../foo', '']) {
      assertThrowsInstanceOf(() => path.toFileUrl(relative), TypeError);
    }
  });

  TEST('Path', 'parsePath normalizes once at ingress', () => {
    table<readonly [string, string]>([
      ['C:\\proj\\vendor\\goatdb', 'C:/proj/vendor/goatdb'],
      ['foo/./bar/../baz', 'foo/baz'],
      ['/foo//bar/', '/foo/bar'],
    ], ([input, want]) => assertEquals(path.parsePath(input), want, input));
  });

  TEST('Path', 'equals, relative, and isWithin implement the contract', () => {
    table<readonly [string, string, boolean]>([
      ['/foo/bar/', '/foo/bar', true],
      ['C:\\Foo\\Bar', 'c:/foo/bar', true],
      ['//Host/Share/a', '//host/share/A', true],
      ['/foo', 'C:/foo', false],
      ['C:/foo', '/foo', false],
      ['/Foo', '/foo', false],
      ['C:/foo', 'D:/foo', false],
    ], ([a, b, want]) => {
      assertEquals(path.equals(a, b), want, `${a} ${b}`);
      assertEquals(path.equals(b, a), want, `${b} ${a}`);
    });
    table<readonly [string, string, string]>(
      [
        ['/a/b', '/a/b/c', 'c'],
        ['/a/b/c', '/a/b', '..'],
        ['/a', '/a', ''],
        ['.', 'a', 'a'],
        ['a', '.', '..'],
        ['/a', '/b/c', '../b/c'],
        ['C:/Proj', 'c:/proj/vendor', 'vendor'],
        ['C:/a', 'D:/b', 'D:/b'],
      ],
      ([from, to, want]) =>
        assertEquals(path.relative(from, to), want, `${from} ${to}`),
    );
    table<readonly [string, string, boolean]>(
      [
        ['/vendor/goatdb', '/vendor/goatdb', true],
        ['/vendor/goatdb', '/vendor/goatdb/mod.ts', true],
        ['/vendor/goatdb/', '/vendor/goatdb/mod.ts', true],
        ['/vendor', '/vendor/goatdb/mod.ts', true],
        ['C:\\vendor\\goatdb', 'c:/vendor/goatdb/mod.ts', true],
        [
          '//fileserver/share/goatdb',
          '\\\\fileserver\\share\\goatdb\\mod.ts',
          true,
        ],
        ['/a/b', '/a/b/./c', true],
        ['/', '/a', true],
        ['/vendor/goatdb', '/vendor/goatdb-other', false],
        ['/vendor/goatdb', '/vendor', false],
        ['/vendor/goatdb', '/other/goatdb', false],
        ['C:/vendor/goatdb', 'D:/vendor/goatdb', false],
        ['/a/b', '/a/b/../c', false],
        ['/a/b', '/a/b\\..\\c', false],
        ['/a/b', '', false],
        ['/', '//server/share/a', false],
      ],
      ([parent, child, want]) =>
        assertEquals(path.isWithin(parent, child), want, `${parent} ${child}`),
    );
  });

  TEST('Path', 'path outputs never contain backslashes', () => {
    const outputs = [
      path.normalize('C:\\a\\b'),
      path.dirname('C:\\a\\b'),
      path.join('C:\\a', 'b'),
      path.resolve('C:\\a', 'b'),
      path.toAbsolutePath('C:\\a\\b'),
      path.relative('C:\\a', 'C:\\a\\b'),
      path.parsePath('//server\\share\\a'),
    ];
    for (const output of outputs) {
      assertEquals(output.includes('\\'), false, output);
    }
  });
}
