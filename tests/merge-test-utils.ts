/**
 * Shared schemas, registry, and helpers for merge/conflict resolution tests.
 */
import { Commit } from '../repo/commit.ts';
import { Item } from '../cfds/base/item.ts';
import { BloomFilter } from '../base/bloom.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { JSONCyclicalDecoder } from '../base/core-types/encoding/json.ts';
import { uniqueId } from '../base/common.ts';

// --- Schemas ---

export const kMergeTestSchemaV1 = {
  ns: 'merge-test',
  version: 1,
  fields: {
    title: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
  },
} as const;

export const kMergeTestSchemaV2 = {
  ns: 'merge-test',
  version: 2,
  fields: {
    title: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
    tags: { type: 'set', default: () => new Set() },
  },
  upgrade(data: Record<string, unknown>) {
    return { ...data, tags: data.tags ?? new Set() };
  },
};

export const kSetTestSchema = {
  ns: 'set-test',
  version: 1,
  fields: {
    name: { type: 'string', required: true },
    items: { type: 'set', default: () => new Set() },
  },
} as const;

export const kRichTextTestSchema = {
  ns: 'richtext-test',
  version: 1,
  fields: {
    body: { type: 'richtext' },
  },
} as const;

// --- Registry ---

export const kMergeTestRegistry = new DataRegistry();
kMergeTestRegistry.registerSchema(kMergeTestSchemaV1);
kMergeTestRegistry.registerSchema(kMergeTestSchemaV2);
kMergeTestRegistry.registerSchema(kSetTestSchema);
kMergeTestRegistry.registerSchema(kRichTextTestSchema);

// --- Test Domain Config ---

/**
 * Creates a minimal domain config for testing with dynamic port support.
 * Used by sync tests that need a Server + GoatDB client pair.
 */
export function createTestDomainConfig() {
  let actualPort = 0;
  return {
    domain: {
      resolveOrg: (orgId: string) => `http://localhost:${actualPort}/${orgId}`,
      resolveDomain: (url: string) => {
        try {
          const u = new URL(url);
          return u.hostname === 'localhost' ? 'test-org' : '';
        } catch {
          return '';
        }
      },
    },
    setPort: (p: number) => {
      actualPort = p;
    },
  };
}

// --- Helpers ---

export interface RawCommitOpts {
  session?: string;
  orgId?: string;
  key: string;
  schema: Schema;
  data: Record<string, any>;
  parents?: string[];
  timestamp?: number;
  mergeBase?: string;
  mergeLeader?: string;
}

/**
 * Constructs a frozen Commit with specified fields.
 * Uses BloomFilter.empty for ancestors (adequate for test graphs).
 */
export function createRawCommit(opts: RawCommitOpts): Commit {
  const item = new Item(
    {
      schema: opts.schema,
      data: opts.data as any,
    },
    kMergeTestRegistry,
  );
  return new Commit({
    session: opts.session ?? 'test-session',
    orgId: opts.orgId ?? 'test-org',
    key: opts.key,
    contents: item,
    parents: opts.parents ?? [],
    ancestorsFilter: BloomFilter.empty,
    // NOTE: In production, ancestorsCount is the total transitive ancestor count.
    // We use parent count here for simplicity; this is adequate for small test graphs
    // where commitsForKey.length dominates in commitIsHighProbabilityLeaf.
    ancestorsCount: opts.parents?.length ?? 0,
    timestamp: opts.timestamp,
    mergeBase: opts.mergeBase,
    mergeLeader: opts.mergeLeader,
  });
}

/**
 * Creates a commit that appears to come from a different connection.
 * This is needed for merge tests because createMergeRecord uses
 * filterLatestCommitsByConnection which deduplicates commits from
 * the same connection (keeping only the latest per connection).
 *
 * Serializes and deserializes with a unique `cid` field to simulate
 * a commit received from a remote peer.
 */
export function createRemoteCommit(opts: RawCommitOpts): Commit {
  const commit = createRawCommit(opts);
  const js = commit.toJS();
  // Override the connection ID to simulate a remote commit
  (js as any).cid = uniqueId();
  const decoder = JSONCyclicalDecoder.get(js);
  const remote = Commit.fromJS(
    opts.orgId ?? 'test-org',
    decoder,
    kMergeTestRegistry,
  );
  decoder.finalize();
  return remote;
}
