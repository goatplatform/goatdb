import { assertEquals } from './asserts.ts';
import { TEST } from './mod.ts';
import {
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathIsValid,
  itemPathJoin,
  itemPathNormalize,
} from '../db/path.ts';

export default function setup(): void {
  TEST('ItemPath', 'itemPath function', (ctx) => {
    // Test basic path creation
    assertEquals(itemPath('sys', 'repo1', 'item1'), '/sys/repo1/item1');

    // Test with embed
    assertEquals(
      itemPath('user', 'repo2', 'item2', 'embed1'),
      '/user/repo2/item2/embed1',
    );

    // Test with different repo types
    assertEquals(itemPath('data', 'repo3', 'item3'), '/data/repo3/item3');
    assertEquals(itemPath('events', 'repo4', 'item4'), '/events/repo4/item4');
  });

  TEST('ItemPath', 'itemPathGetPart function', (ctx) => {
    const path = '/sys/repo1/item1/embed1';

    // Test extracting each part
    assertEquals(itemPathGetPart(path, 'type'), 'sys');
    assertEquals(itemPathGetPart(path, 'repo'), 'repo1');
    assertEquals(itemPathGetPart(path, 'item'), 'item1');
    assertEquals(itemPathGetPart(path, 'embed'), 'embed1');

    // Test with undefined path
    assertEquals(itemPathGetPart(undefined, 'type'), undefined);

    // Test with incomplete path
    assertEquals(itemPathGetPart('/sys', 'repo'), undefined);
    assertEquals(itemPathGetPart('/sys/repo1', 'embed'), undefined);
  });

  TEST('ItemPath', 'itemPathGetRepoId function', (ctx) => {
    // Test basic repo ID extraction
    assertEquals(itemPathGetRepoId('/sys/repo1/item1'), '/sys/repo1');
    assertEquals(itemPathGetRepoId('/user/repo2/item2/embed1'), '/user/repo2');

    // Test with non-normalized paths
    assertEquals(itemPathGetRepoId('sys/repo1/item1'), '/sys/repo1');
    assertEquals(itemPathGetRepoId('/sys/repo1/item1/'), '/sys/repo1');
  });

  TEST('ItemPath', 'itemPathNormalize function', (ctx) => {
    // Test already normalized paths
    assertEquals(itemPathNormalize('/sys/repo1/item1'), '/sys/repo1/item1');

    // Test paths needing normalization
    assertEquals(itemPathNormalize('sys/repo1/item1'), '/sys/repo1/item1');
    assertEquals(itemPathNormalize('/sys/repo1/item1/'), '/sys/repo1/item1');

    // Test with embed
    assertEquals(
      itemPathNormalize('/sys/repo1/item1/embed1'),
      '/sys/repo1/item1/embed1',
    );
  });

  TEST('ItemPath', 'itemPathJoin function', (ctx) => {
    // Test basic path joining
    assertEquals(itemPathJoin('/sys/repo1', 'item1'), '/sys/repo1/item1');

    // Test with trailing/leading slashes
    assertEquals(itemPathJoin('/sys/repo1/', '/item1'), '/sys/repo1/item1');
    assertEquals(itemPathJoin('/sys/repo1', 'item1/'), '/sys/repo1/item1/');
    assertEquals(itemPathJoin('/sys/repo1/', '/item1/'), '/sys/repo1/item1/');

    // Test joining with embed
    assertEquals(
      itemPathJoin('/sys/repo1/item1', 'embed1'),
      '/sys/repo1/item1/embed1',
    );
  });

  TEST('ItemPath', 'itemPathIsValid function', (ctx) => {
    // Test valid paths
    assertEquals(itemPathIsValid('/sys/repo1/item1'), true);
    assertEquals(itemPathIsValid('/user/repo-1/item_1'), true);
    assertEquals(itemPathIsValid('/data/repo1/item1/embed1'), true);

    // Test invalid paths
    assertEquals(itemPathIsValid('/sys/REPO1/item1'), false); // uppercase
    assertEquals(itemPathIsValid('/sys/repo#1/item1'), false); // invalid character
    assertEquals(itemPathIsValid('/sys/repo1/item1/embed1/extra'), false); // too many components
    assertEquals(itemPathIsValid(''), false); // empty path
    assertEquals(itemPathIsValid('/sys/repo 1/item1'), false); // space
  });
}
