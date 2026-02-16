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
import setupItemPath from './item-path.ts';
import setupOrderstamp from './orderstamp-expose.test.ts';
import setupGoatRequestTest from './goat-request.test.ts';
import setupSession from './session.test.ts';
import setupCommit from './commit.test.ts';
import setupServerArchitectureTest from './server-architecture.test.ts';
import setupStaticAssetsEndpointTest from './static-assets-endpoint.test.ts';
import setupHealthCheckEndpointTest from './health-check-endpoint.test.ts';
import setupMinimalSync from './minimal-client-server-sync.test.ts';
import setupE2ELatency from './e2e-latency.test.ts';
import setupClusterLatency from './cluster-latency.test.ts';
import setupCliInitTests from './cli-init.test.ts';
import setupCliCompileTests from './cli-compile.test.ts';
import setupPathTests from './path.test.ts';
import setupRuntimeTests from './runtime.test.ts';
import setupProgressTests from './progress.test.ts';
import setupMergeAdjList from './merge-adjlist.test.ts';
import setupMergeBloom from './merge-bloom.test.ts';
import setupMergeLCA from './merge-lca.test.ts';
import setupMergeRecord from './merge-record.test.ts';
import setupMergeCorruption from './merge-corruption.test.ts';
import setupMergeRebase from './merge-rebase.test.ts';
import setupMergeEdgeCases from './merge-edge-cases.test.ts';
import setupMergeLeader from './merge-leader.test.ts';
import setupMergeConcurrency from './merge-concurrency.test.ts';
import setupMergeCache from './merge-cache.test.ts';
import setupMergeRichText from './merge-richtext.test.ts';
import setupMergeConvergence from './merge-convergence.test.ts';
import setupMergeSync from './merge-sync.test.ts';

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
export async function registerAllTests(): Promise<void> {
  // FAST UNIT TESTS (0-1ms each) - Pure logic, no I/O
  setupOrderstamp(); // Utility functions for distributed timestamps
  setupItemPath(); // Path validation and parsing logic
  setupPathTests(); // Cross-platform path utilities
  setupRuntimeTests(); // Runtime abstraction layer invariants
  setupProgressTests(); // TUI progress tracking - Task state machine, aggregation
  setupHealthCheckEndpointTest(); // Simple HTTP endpoint check
  setupMergeAdjList(); // Adjacency list data structure
  setupMergeBloom(); // Bloom filter operations

  // COMPONENT TESTS (0-50ms each) - Single components with minimal dependencies
  setupCommit(); // Core commit/versioning logic
  setupSession(); // Authentication and session management
  setupGoatRequestTest(); // HTTP request processing
  setupCliInitTests(); // CLI scaffolding functionality
  setupMergeLCA(); // Lowest Common Ancestor / merge base
  setupMergeRecord(); // Record merge and schema upgrade
  setupMergeCorruption(); // Corruption detection via checksums
  setupMergeRebase(); // Rebase operations
  setupMergeEdgeCases(); // Edge cases (compareCommitsDesc bug, etc.)
  setupMergeLeader(); // Leader election for merge
  setupMergeConcurrency(); // Concurrent merge guards
  setupMergeCache(); // Cache invalidation after mutations

  // INTEGRATION TESTS (100-500ms each) - Multiple components, file I/O
  setupTrusted(); // Database operations in trusted mode
  setupUntrusted(); // Database operations in untrusted mode
  await setupServerArchitectureTest(); // Server initialization and configuration
  setupStaticAssetsEndpointTest(); // File serving and asset management
  setupMergeRichText(); // Rich text merge operations
  setupMergeConvergence(); // CRDT convergence properties

  // SYNC INTEGRATION TESTS (1-2s each) - Network operations, client-server
  setupMinimalSync(); // Basic client-server synchronization
  setupMergeSync(); // Merge behavior during sync

  // HEAVY END-TO-END TESTS (10-30s each) - Full system, network latency, multi-node
  setupCliCompileTests(); // CLI compilation (includes E2E compile test)
  setupE2ELatency(); // Client-to-client sync latency measurement
  setupClusterLatency(); // Multi-server cluster sync performance
}
