/**
 * Central registry of all test setup functions.
 *
 * This module consolidates test imports and registration order in a single
 * location, eliminating duplication between tests-entry-server.ts and
 * worker-runner.ts.
 *
 * Test execution order is optimized for developer feedback speed:
 * Run fast tests first so developers get immediate pass/fail results,
 * then progressively run slower tests (test pyramid principle).
 */

import setupUntrusted from './db-untrusted.test.ts';
import setupTrusted from './db-trusted.test.ts';
import setupDBTrustedServer from './db-trusted-server.test.ts';
import setupItemPath from './item-path.ts';
import setupAssertsTests from './asserts.test.ts';
import setupOrderstamp from './orderstamp-expose.test.ts';
import setupSchemaRuntimeKeys from './schema-runtime-keys.test.ts';
import setupGoatHeadersTests, {
  setupGoatRequestNodeTests,
  setupGoatRequestWebTests,
} from './goat-request.test.ts';
import setupSession from './session.test.ts';
import setupCommit from './commit.test.ts';
import setupBinaryEncoding from './binary-encoding.test.ts';
import setupServerArchitectureTest from './server-architecture.test.ts';
import setupStaticAssetsEndpointTest from './static-assets-endpoint.test.ts';
import setupBrowserRunnerTests from './browser-runner.test.ts';
import setupFileImplTests from './file-impl.test.ts';
import setupFileWatcherUnitTests, {
  setupFileWatcherDenoTests,
  setupFileWatcherNativeNodeTests,
  setupFileWatcherTests,
} from './file-watcher.test.ts';
import setupJsonLogFormats from './json-log-formats.test.ts';
import setupJsonLogFormatsServer from './json-log-formats-server.test.ts';
import setupNodeHttpServerTests from './node-http-server.test.ts';
import setupHealthCheckEndpointTest from './health-check-endpoint.test.ts';
import setupMinimalSync from './minimal-client-server-sync.test.ts';
import setupE2ELatency from './e2e-latency.test.ts';
import setupClusterLatency from './cluster-latency.test.ts';
import setupCliInitTests, {
  setupCliInitBuildTests,
  setupCliInitNodeTests,
} from './cli-init.test.ts';
import { setupCliEntrypointDenoTests } from './cli-entrypoints.test.ts';
import setupCliCompileTests, {
  setupCliCompileDenoTests,
  setupCliCompileNodeTests,
} from './cli-compile.test.ts';
import setupPathTests from './path.test.ts';
import setupBuildTests, { setupBuildServerTests } from './build.test.ts';
import setupRuntimeTests, {
  setupRuntimeDenoTests,
  setupRuntimeNodeTests,
} from './runtime.test.ts';
import setupEmailServiceTests, {
  setupEmailServiceServerTests,
} from './email-service.test.ts';
import setupProgressTests from './progress.test.ts';
import setupSystemInfoTests from './system-info.test.ts';
import setupTestUtilsTests from './test-utils.test.ts';
import setupTestRunnerTests, {
  setupPlaywrightPinningTests,
  setupTestRunnerBrowserCliTests,
  setupTestRunnerDenoTests,
} from './test-runner.test.ts';
import { getEnvVar } from '../base/os.ts';
import setupMergeAdjList from './merge-adjlist.test.ts';
import setupMergeBloom from './merge-bloom.test.ts';
import setupBloomFPR from './bloom-fpr.test.ts';
import setupShardFormat from './shard-format.test.ts';
import setupAncestorLeafDetection from './ancestor-leaf-detection.test.ts';
import setupMergeLCA from './merge-lca.test.ts';
import setupMergeRecord from './merge-record.test.ts';
import setupMergeCorruption from './merge-corruption.test.ts';
import setupMergeRebase from './merge-rebase.test.ts';
import setupMergeEdgeCases from './merge-edge-cases.test.ts';
import setupMergeLeader from './merge-leader.test.ts';
import setupMergeConcurrency from './merge-concurrency.test.ts';
import setupMergeCache from './merge-cache.test.ts';
import setupAncestors from './ancestors.test.ts';
import setupSyncMessageMissing from './sync-message-missing.test.ts';
import setupSyncConvergence from './sync-convergence.test.ts';
import setupMergeRichText from './merge-richtext.test.ts';
import setupMergeConvergence from './merge-convergence.test.ts';
import setupMergeSync from './merge-sync.test.ts';
import setupSecurityBoundaries from './security-boundaries.test.ts';
import setupLiveQuery from './live-query.test.ts';
import setupWriteFailure from './write-failure.test.ts';
import setupBuildDenoTests from './build-deno.test.ts';
import { setupGitHooksDenoTests } from './githooks.test.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { TestsRunner } from './mod.ts';

let _registrationPromise: Promise<void> | undefined;
let _registrationCallCount = 0;

/**
 * Registers all test suites with the default TestsRunner.
 *
 * Order is optimized for fast feedback:
 * 1. FAST UNIT TESTS (0-1ms) - Pure logic, no I/O
 * 2. COMPONENT TESTS (0-50ms) - Single components
 * 3. INTEGRATION TESTS (100-500ms) - Multiple components, file I/O
 * 4. SYNC INTEGRATION TESTS (1-2s) - Network operations
 * 5. HEAVY E2E TESTS (10-30s) - Full system tests
 */
export function registerAllTests(): Promise<void> {
  // Cache the promise permanently so concurrent callers share one run.
  // A rejection permanently poisons the cache — registration failures are
  // fatal programming errors that retrying cannot recover from.
  _registrationPromise ??= registerAllTestsImpl();
  return _registrationPromise;
}

async function registerAllTestsImpl(): Promise<void> {
  _registrationCallCount++;

  // FAST UNIT TESTS (0-1ms each) - Pure logic, no I/O
  setupAssertsTests(); // Assertion utility correctness
  setupOrderstamp(); // Utility functions for distributed timestamps
  setupSchemaRuntimeKeys(); // Built-in runtime schema fields and key typing
  setupItemPath(); // Path validation and parsing logic
  setupPathTests(); // Cross-platform path utilities
  setupBuildTests(); // Build utility contracts (normalizeBuildEntryPath, etc.)
  if (getRuntime().id !== 'browser') {
    setupBuildServerTests(); // File URL decoding needs server filesystem APIs
  }
  setupFileWatcherUnitTests(); // File watcher path-filtering logic (pure logic, no I/O)
  if (getRuntime().id === 'deno') {
    setupBuildDenoTests(); // Deno-only build coverage that imports Deno-only modules
  }
  setupBrowserRunnerTests(); // Pure browser logging helpers shared across runtimes
  setupRuntimeTests(); // Runtime abstraction layer invariants
  setupTestUtilsTests(); // Shared test helper wrappers
  setupEmailServiceTests(); // Cross-runtime email service contracts
  if (getRuntime().id !== 'browser') {
    setupEmailServiceServerTests(); // Default nodemailer path needs server package resolution
  }
  if (getRuntime().id === 'deno') {
    setupRuntimeDenoTests(); // Deno-only runtime tests (signals, unsupported browser opening)
  }
  if (getRuntime().id === 'node') {
    setupRuntimeNodeTests(); // Node-only runtime tests (signals, unsupported browser opening)
  }
  setupProgressTests(); // TUI progress tracking - Task state machine, aggregation
  if (getRuntime().id !== 'browser') {
    setupSystemInfoTests(); // Env override fallback and warning taxonomy
  }
  setupTestRunnerTests(); // Test filtering and no-match error behavior
  if (getRuntime().id === 'deno') {
    setupTestRunnerDenoTests(); // Deno-only runner registration/cache coverage
    if (getEnvVar('GOATDB_REQUIRE_PLAYWRIGHT') === 'true') {
      setupTestRunnerBrowserCliTests(); // Browser CLI coverage; requires Playwright/browser tooling in the spawned child process
    }
    setupPlaywrightPinningTests(); // CI workflow Playwright pin sync (Deno-only, reads workflow file)
    setupGitHooksDenoTests(); // Git hook contracts: staged TS type-checking and path handling
  }
  setupHealthCheckEndpointTest(); // Simple HTTP endpoint check
  setupMergeAdjList(); // Adjacency list data structure
  setupMergeBloom(); // Bloom filter operations
  setupBloomFPR(); // Bloom filter false-positive rate verification
  setupShardFormat(); // Shard file format read/write primitives
  setupAncestorLeafDetection(); // Ancestor edges and leaf detection via AdjacencyList

  // COMPONENT TESTS (0-50ms each) - Single components with minimal dependencies
  setupBinaryEncoding(); // Binary commit format encoding roundtrip
  setupCommit(); // Core commit/versioning logic
  setupSession(); // Authentication and session management
  setupSecurityBoundaries(); // Security boundary invariants (auth, sync, signatures)
  setupGoatHeadersTests(); // Shared header abstraction contracts
  if (getRuntime().id === 'deno') {
    setupGoatRequestWebTests(); // Request wrapper over the native Request implementation
  }
  if (getRuntime().id === 'node') {
    setupGoatRequestNodeTests(); // Request wrapper over Node-style incoming requests
  }
  setupCliInitTests(); // CLI scaffolding functionality
  if (getRuntime().id === 'deno') {
    setupCliEntrypointDenoTests(); // Deno-only CLI entrypoint exit behavior
  }
  if (getRuntime().id === 'node') {
    setupCliInitNodeTests(); // Node-only scaffold template assertions
  }
  if (getRuntime().id !== 'browser') {
    setupCliInitBuildTests(); // Full build of scaffolded project (needs esbuild)
  }
  setupMergeLCA(); // Lowest Common Ancestor / merge base
  setupMergeRecord(); // Record merge and schema upgrade
  setupMergeCorruption(); // Corruption detection via checksums
  setupMergeRebase(); // Rebase operations
  setupMergeEdgeCases(); // Edge cases (compareCommitsDesc bug, etc.)
  setupMergeLeader(); // Leader election for merge
  setupMergeConcurrency(); // Concurrent merge guards
  setupMergeCache(); // Cache invalidation after mutations
  setupAncestors(); // Commit ancestor field behavior
  setupSyncMessageMissing(); // SyncMessage missing-commit detection
  setupSyncConvergence(); // Multi-round sync convergence simulation
  if (getRuntime().id !== 'browser') {
    setupFileImplTests(); // FileImpl abstraction on server runtimes with filesystem APIs
  }
  setupJsonLogFormats(); // JSONLog storage format — browser-compatible roundtrip, dedup, large payload
  if (getRuntime().id !== 'browser') {
    setupJsonLogFormatsServer(); // Corruption recovery and format fallback (filesystem I/O)
  }

  // INTEGRATION TESTS (100-500ms each) - Multiple components, file I/O
  if (getRuntime().id === 'deno') {
    setupFileWatcherDenoTests(); // Deno.watchFs smoke coverage
  }
  if (getRuntime().id === 'node') {
    setupFileWatcherTests(); // Polling watcher tests (~500ms each)
    setupFileWatcherNativeNodeTests(); // Runtime-selected Node watcher coverage
  }
  setupLiveQuery(); // Live query membership updates on ManagedItem edits
  setupWriteFailure(); // WriteFailure event after 3 consecutive I/O failures
  setupTrusted(); // Database operations in trusted mode — browser-compatible
  if (getRuntime().id !== 'browser') {
    setupDBTrustedServer(); // Cross-session query cache and DB reopen persistence
  }
  setupUntrusted(); // Database operations in untrusted mode
  await setupServerArchitectureTest(); // Server initialization and configuration
  if (getRuntime().id === 'node') {
    setupNodeHttpServerTests(); // Node.js HTTP server integration
  }
  setupStaticAssetsEndpointTest(); // File serving and asset management
  setupMergeRichText(); // Rich text merge operations
  setupMergeConvergence(); // CRDT convergence properties

  // SYNC INTEGRATION TESTS (1-2s each) - Network operations, client-server
  setupMinimalSync(); // Basic client-server synchronization
  setupMergeSync(); // Merge behavior during sync

  // HEAVY END-TO-END TESTS (10-30s each) - Full system, network latency, multi-node
  if (getRuntime().id !== 'browser') {
    setupCliCompileTests(); // CLI compilation (includes E2E compile test)
  }
  if (getRuntime().id === 'node') {
    setupCliCompileNodeTests(); // Node-only: SEA, signing, buildAssets enforcement
  }
  if (getRuntime().id === 'deno') {
    setupCliCompileDenoTests(); // Deno-only: CSS bundling, node runner, cli timeout
  }
  setupE2ELatency(); // Client-to-client sync latency measurement
  setupClusterLatency(); // Multi-server cluster sync performance
}

export function getRegistrationCallCount(): number {
  return _registrationCallCount;
}

/**
 * Note: calls registerAllTests(), which populates TestsRunner.default as a
 * side-effect. Safe for concurrent callers due to promise caching.
 */
export async function countMatchingTests(
  suite?: string,
  test?: string,
): Promise<number> {
  await registerAllTests();
  return TestsRunner.default.getTestCount(suite, test).testCount;
}
