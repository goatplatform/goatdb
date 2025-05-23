# GoatDB Test Framework

## Introduction

GoatDB uses a custom, lightweight test framework designed for reliability,
speed, and cross-platform compatibility. This framework ensures that GoatDB
works consistently across Deno, Node.js, and browser environments, with minimal
overhead and no external dependencies. All tests run sequentially in a single
process, making debugging straightforward and guaranteeing consistent state
between tests. Automatic resource cleanup and simple APIs make it easy to write,
run, and maintain tests.

### Key benefits:

- **Reliability:** Consistent results across all supported platforms.
- **Debuggability:** Easy to trace and debug failures due to sequential
  execution.
- **Portability:** No reliance on external test runners or assertion libraries.
- **Performance:** Fast execution and automatic cleanup of temporary resources.

### Running the Tests:

```bash
deno task test
```

## Key Features

- **Test Suites:** Tests are organized into named suites, each grouping related
  test cases.
- **Test Context:** Each test receives a context object with utilities (e.g.,
  for creating and cleaning up temporary directories).
- **Simple API:** Tests are registered using a single `TEST(suite, name, fn)`
  function.
- **Automatic Cleanup:** Temporary resources are managed and cleaned up
  automatically after each suite.
- **Flexible Execution:** Tests can be run in Deno, Node.js, or both, with CLI
  options to filter by suite or test name.

## How It Works

### 1. Defining Tests

- Each test file exports a `setup` function that registers tests using the
  `TEST` function.
- The context (`ctx`) passed to each test function is the `TestSuite` instance
  itself, providing suite-level utilities (such as `tempDir`).
- Example:
  ```ts
  import { TEST } from './mod.ts';

  export default function setupMyFeatureTests() {
    TEST('MyFeature', 'should do something', async (ctx) => {
      // Test implementation
    });
  }
  ```

### 2. Organizing Suites

- Tests are grouped by suite name (first argument to `TEST`).
- Each suite manages its own temporary directory, shared by all its tests.

### 3. Running Tests

- The main entry point (`tests/tests-entry.ts`) calls all setup functions to
  register tests.
- The test runner (`tests/mod.ts`) executes all suites or a filtered subset,
  logging results and timings.
- CLI options (see `tests/run.ts`) allow running specific suites, tests, or
  environments.

### 4. Assertions

- Custom assertion utilities (`tests/asserts.ts`) provide basic checks
  (`assertTrue`, `assertEquals`, etc.) that throw on failure, compatible with
  all supported environments.

## Example Test File Structure

```ts
import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';

export default function setup() {
  TEST('ExampleSuite', 'example test', () => {
    assertEquals(1 + 1, 2);
  });
}
```

### Accessing Temporary Directories

You can use the `ctx.tempDir()` utility in your tests to get a path to a
temporary directory unique to the suite. This is useful for creating files or
directories that should be automatically cleaned up after the suite runs.

```ts
import { TEST } from './mod.ts';
import { assertTrue } from './asserts.ts';
import { exists, writeTextFile } from 'jsr:@std/fs';

export default function setup() {
  TEST('TempDirSuite', 'can write to temp dir', async (ctx) => {
    const tempPath = await ctx.tempDir('myfile.txt');
    await writeTextFile(tempPath, 'hello!');
    assertTrue(await exists(tempPath));
  });
}
```
