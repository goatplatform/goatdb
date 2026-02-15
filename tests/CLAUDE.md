# GoatDB Testing Infrastructure

## Quick Start

- Run all tests: `deno task test`
- Debug specific test:
  `deno task test --suite=DatabaseFeature --test="should initialize" --deno-inspect-brk`
- Node.js only: `deno task test --runtime=node`

## Architecture Overview

The testing system is a custom, lightweight framework designed for
cross-platform compatibility:

- **Test runner**: @tests/run.ts - Orchestrates cross-platform execution
- **Test framework**: @tests/mod.ts - Provides TEST() function and TestSuite
  class
- **Entry point**: @tests/tests-entry.ts - Imports all test files
- **Node support**: @tests/node-run.ts - Handles TypeScript compilation for
  Node.js

### Key Design Principles

1. **No external dependencies** - Custom framework avoids third-party test
   runners
2. **Cross-platform** - Same tests run in Deno, Node.js, and browsers
3. **Sequential execution** - Tests run one at a time for consistency
4. **Resource management** - Automatic cleanup of temporary files/directories
5. **Simple API** - Just TEST() function and basic assertions
6. **Fast execution** - All tests run in single process

## Command Reference

### Basic Commands

| Command                               | Description                       |
| ------------------------------------- | --------------------------------- |
| `deno task test`                      | Run all tests in all environments |
| `deno task test --runtime=deno`       | Run tests in Deno only            |
| `deno task test --runtime=node`       | Run tests in Node.js only         |
| `deno test -A tests/specific.test.ts` | Run a specific test file directly |

### Debugging Commands

| Command              | Description                                  |
| -------------------- | -------------------------------------------- |
| `--deno-inspect-brk` | Attach Deno debugger (waits for debugger)    |
| `--node-inspect-brk` | Attach Node.js debugger (waits for debugger) |
| `--suite=NAME`       | Run only tests in specified suite            |
| `--test=NAME`        | Run only tests matching name                 |

### Environment Variables

| Variable       | Description                  |
| -------------- | ---------------------------- |
| `GOATDB_SUITE` | Filter to run specific suite |
| `GOATDB_TEST`  | Filter to run specific test  |

## Writing Tests

### CRITICAL: Setup Function Pattern

**MANDATORY STRUCTURE - All test files must follow exactly:**

```typescript
export default function setupMyTests() {
  TEST('suite', 'test-name', async (ctx: TestSuite) => {
    // test code here
  });
}
```

**BROKEN PATTERN - Never do this:**

```typescript
export default function setupMyTests() {
  // Empty function breaks test registration
}

TEST('suite', 'test', () => {}); // Outside setup = broken
```

**Rule: ALL TEST() calls must be inside the setup function.**

### Basic Test Structure

Every test file must:

1. Import TEST function from @tests/mod.ts
2. Import assertions from @tests/asserts.ts
3. Export a default `setup()` function that registers tests

See @tests/db.test.ts for a complete example of test structure.

### Available Assertions

All assertion functions are exported from @tests/asserts.ts:

- Boolean assertions: `assertTrue`, `assertFalse`
- Equality assertions: `assertEquals`, `assertNotEquals`
- Existence assertions: `assertExists`, `assertNotExists`
- Numeric comparisons: `assertLessThan`, `assertGreaterThan`, etc.
- Exception testing: `assertThrows`, `assertDoesNotThrow`
- Collection assertions: `expectToContain`

### Test Context Utilities

Each test receives a TestSuite context - see @tests/mod.ts:19-30 for available
methods:

- `tempDir(subPath?)` - Creates a temporary directory that's automatically
  cleaned up

## AI Agent Guidelines

**Test File Rules:**

1. **Setup function MUST contain all TEST() calls** - empty setup functions
   break registration
2. **Export setup as default** - `export default function setupX() { ... }`
3. **Import in tests-entry.ts** - Add `setupX()` call to main()
4. **Follow existing patterns** - Check similar test files first

**Common Failures:**

- Empty setup functions with TEST() calls outside
- Missing default export
- Setup function not called in tests-entry.ts

### When Adding Tests

1. **File placement**: Create test files in `/tests` with `.test.ts` suffix
2. **Export setup**: Every test file must export a default `setup()` function
3. **Descriptive names**: Use clear suite and test names that explain what's
   being tested
4. **Resource cleanup**: Always clean up resources in finally blocks
5. **Path format**: Remember GoatDB paths follow `/type/repo/item` format

### Test Organization

- Group related tests in the same suite name
- One concept per test - don't test multiple things
- Use consistent naming patterns across test files

### Common Test Patterns

#### Database Test Pattern

See @tests/db-trusted.test.ts:14-24 for database initialization tests. Key
points:

- Create database with `tempDir()` for isolation
- Always await `db.readyPromise()` before operations
- Clean up with `db.flushAll()` in finally block

#### Item Test Pattern

See @tests/db.test.ts:112-130 for item creation and update patterns:

- Use correct path format: `/type/repo/item`
- Register schemas before use
- Test both creation and updates separately

#### Query Test Pattern

See @tests/query.test.ts for comprehensive query examples:

- Create test data with known values
- Test predicates, sorting, and limit behavior
- Verify reactive updates work correctly

#### Schema Test Pattern

See @tests/cfds-validation.test.ts for schema validation examples:

- Test required fields enforcement
- Verify type checking works
- Check default values are applied

### Test Data Best Practices

1. **Use unique IDs**: Generate unique IDs for test items to avoid conflicts
2. **Minimal data**: Create only the data needed for the test
3. **Explicit values**: Don't rely on defaults unless testing defaults
4. **Clean state**: Each test should start with a clean database

## Troubleshooting

### Common Issues

#### Tests Hanging

- **Cause**: Unclosed database connections or pending promises
- **Solution**: Ensure all databases are closed with `await db.flushAll()` in
  finally blocks

#### Node.js Test Failures

- **Cause**: TypeScript compilation errors or Node.js compatibility issues
- **Solution**: Check console output for esbuild errors, ensure code is
  Node-compatible

#### Permission Errors

- **Cause**: Tests need file system access for temporary directories
- **Solution**: Run tests with appropriate permissions (`deno run -A`)

#### Flaky Tests

- **Cause**: Tests depending on timing or external state
- **Solution**: Tests run sequentially, but ensure no dependency on execution
  order

### Debug Tips

1. **Isolate problematic tests**:
   ```bash
   deno task test --test="exact test name"
   ```

2. **Add debug output**: Console.log statements are preserved in test output

3. **Use debugger**:
   ```bash
   # For VS Code debugging
   deno task test --deno-inspect-brk
   ```

4. **Check temp artifacts**: Look in `tests/temp/` for leftover test data

5. **Verify test is registered**:
   - Ensure test file is imported in @tests/tests-entry.ts
   - Check that `setup()` function is exported as default

### Performance Considerations

- Tests run sequentially to avoid race conditions
- Each test suite gets its own temp directory
- Database operations are in-memory with file persistence
- Large test data sets may impact performance

## Test Utilities Reference

### Creating Test Databases

The `createTestDB` helper is available in various test files. See
@tests/db.test.ts:10-20 for an example implementation.

### Generating Test Data

For ID generation patterns, see @tests/sync.test.ts where unique IDs are created
for test isolation.

### Test Schemas

Common test schemas are defined in:

- @tests/test-schemas.ts - Reusable schemas for testing
- Individual test files often define inline schemas for specific tests

## Integration with CI/CD

The test suite is designed to work seamlessly in CI environments:

- Exit codes: 0 for success, 1 for any test failure
- Console output: Clear pass/fail status for each test
- Timing information: Helps identify slow tests
- No interactive prompts: Fully automated execution

## Contributing Tests

When contributing new tests:

1. Follow existing patterns and naming conventions
2. Add your test file import to `tests-entry.ts`
3. Ensure tests pass in both Deno and Node.js
4. Keep tests focused and independent
5. Document any special setup or teardown requirements
6. Use meaningful assertion messages for debugging

Remember: Tests are documentation. Write them clearly so others (including AI
assistants) can understand the expected behavior.
