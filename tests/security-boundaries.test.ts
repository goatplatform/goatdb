/**
 * Security boundary tests.
 *
 * Each test verifies a specific security invariant — if the guarded check
 * were removed from source code, the corresponding test here must fail.
 */
import { TEST } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { Server } from '../net/server/server.ts';
import {
  generateSession,
  signCommit,
  verifyCommit,
} from '../db/session.ts';
import { assertEquals, assertTrue, assertExists } from './asserts.ts';
import {
  createRawCommit,
  createTestDomainConfig,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import * as path from '../base/path.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { Edit } from '../cfds/base/edit.ts';
import { Commit } from '../repo/commit.ts';
import { BloomFilter } from '../base/bloom.ts';

function createDeltaCommit(opts: {
  orgId?: string;
  key: string;
  baseCommitId: string;
  parents?: string[];
}): Commit {
  return new Commit({
    session: 'test-session',
    orgId: opts.orgId ?? 'test-org',
    key: opts.key,
    contents: {
      base: opts.baseCommitId,
      edit: new Edit({ changes: [], srcChecksum: 'x', dstChecksum: 'x' }),
    },
    parents: opts.parents ?? [],
    ancestorsFilter: BloomFilter.empty,
    ancestorsCount: opts.parents?.length ?? 0,
  });
}

// Schema and registry shared across tests
const TestSchema = {
  ns: 'sec-test',
  version: 1,
  fields: {
    title: { type: 'string', required: true },
    value: { type: 'number', default: () => 0 },
  },
} as const;

export default function setup(): void {
  // ---------------------------------------------------------------------------
  // Authorization boundary: write rejection
  // Guards: repo.ts verifyCommits() authorizer check
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'rejects unauthorized writes in untrusted mode',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema);
      // Only sessions owned by 'allowed-user' may write to /sec/protected
      registry.registerAuthRule('/sec/protected', (info) => {
        return info.session.owner === 'allowed-user';
      });

      const db = new GoatDB({
        path: await ctx.tempDir('sec-auth-write'),
        orgId: 'test-org',
        trusted: false,
        registry,
      });

      try {
        await db.readyPromise();
        const repo = await db.open('/sec/protected');

        // Root can write (root always bypasses auth)
        const item = db.create('/sec/protected', TestSchema, {
          title: 'root-item',
        });
        assertExists(item);
        await db.flush('/sec/protected');

        // Create a second session that is NOT allowed
        const unauthorizedSession = await generateSession('evil-user');
        const trustPool = await db.getTrustPool();
        trustPool.addSessionUnsafe(unauthorizedSession);

        // Create a signed commit from the unauthorized session
        const rawCommit = createRawCommit({
          session: unauthorizedSession.id,
          orgId: 'test-org',
          key: 'unauthorized-item',
          schema: TestSchema,
          data: { title: 'should-be-rejected' },
        });
        const signedCommit = await signCommit(unauthorizedSession, rawCommit);

        // Attempt to persist — should be rejected by authorizer
        const persisted = await repo.persistCommits([signedCommit]);
        assertEquals(
          persisted.length,
          0,
          'Unauthorized commits must be rejected',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Authorization boundary: read filtering
  // Guards: repo.ts commits() read auth filter
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'rejects unauthorized reads in untrusted mode',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema);
      // Deny all reads for non-root
      registry.registerAuthRule('/sec/private', () => false);

      const db = new GoatDB({
        path: await ctx.tempDir('sec-auth-read'),
        orgId: 'test-org',
        trusted: false,
        registry,
      });

      try {
        await db.readyPromise();
        await db.open('/sec/private');

        // Root creates items (root bypasses auth)
        db.create('/sec/private', TestSchema, { title: 'secret-1' });
        db.create('/sec/private', TestSchema, { title: 'secret-2' });
        await db.flush('/sec/private');

        // A non-root session should see zero commits
        const otherSession = await generateSession('reader');
        const trustPool = await db.getTrustPool();
        trustPool.addSessionUnsafe(otherSession);

        const repo = db.repository('/sec/private')!;
        const visibleCommits = Array.from(repo.commits(otherSession));
        assertEquals(
          visibleCommits.length,
          0,
          'Non-authorized session must see zero commits',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Authorization boundary: trusted mode bypass
  // Guards: repo.ts verifyCommits() trusted shortcut
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'trusted mode bypasses authorization',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema);
      // Deny everything
      registry.registerAuthRule('/sec/trusted-test', () => false);

      const db = new GoatDB({
        path: await ctx.tempDir('sec-trusted'),
        orgId: 'test-org',
        trusted: true,
        registry,
      });

      try {
        await db.readyPromise();
        await db.open('/sec/trusted-test');

        // In trusted mode, even a deny-all rule should be bypassed
        const item = db.create('/sec/trusted-test', TestSchema, {
          title: 'trusted-item',
        });
        assertExists(item);
        await db.flush('/sec/trusted-test');
        assertEquals(db.count('/sec/trusted-test'), 1);
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Sync authentication: missing signature
  // Guards: sync.ts X-Goat-Sig header check
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'sync rejects requests without signature',
    async (ctx) => {
      const serverPath = await ctx.tempDir('sec-sync-nosig');
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema);
      const { domain, setPort } = createTestDomainConfig();
      const buildInfo = await generateBuildInfo(
        path.join((await FileImplGet()).getCWD(), 'deno.json'),
      );

      const server = new Server<Schema>({
        path: serverPath,
        orgId: 'test-org',
        port: 0,
        registry,
        buildInfo,
        domain,
      });

      try {
        await server.start();
        assertExists(server.port);
        setPort(server.port);

        // POST to batch-sync endpoint WITHOUT X-Goat-Sig header
        const resp = await fetch(
          `http://localhost:${server.port}/batch-sync`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ path: '/sec/repo', msg: {} }]),
          },
        );

        assertTrue(
          resp.status === 400 || resp.status === 403,
          `Expected 400 or 403 for unsigned request, got ${resp.status}`,
        );
      } finally {
        await server.stop();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Sync authentication: invalid signature
  // Guards: auth.ts verifyRequestSignature check
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'sync rejects invalid signature',
    async (ctx) => {
      const serverPath = await ctx.tempDir('sec-sync-badsig');
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema);
      const { domain, setPort } = createTestDomainConfig();
      const buildInfo = await generateBuildInfo(
        path.join((await FileImplGet()).getCWD(), 'deno.json'),
      );

      const server = new Server<Schema>({
        path: serverPath,
        orgId: 'test-org',
        port: 0,
        registry,
        buildInfo,
        domain,
      });

      try {
        await server.start();
        assertExists(server.port);
        setPort(server.port);

        // POST with a garbage signature
        const resp = await fetch(
          `http://localhost:${server.port}/batch-sync`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goat-Sig': 'totally-invalid-signature-data',
            },
            body: JSON.stringify([{ path: '/sec/repo', msg: {} }]),
          },
        );

        assertTrue(
          resp.status >= 400,
          `Expected error status for invalid signature, got ${resp.status}`,
        );
      } finally {
        await server.stop();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Commit signature verification
  // Guards: session.ts TrustPool.verify()
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'server rejects unsigned commits',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(kMergeTestSchemaV1);

      const db = new GoatDB({
        path: await ctx.tempDir('sec-unsigned'),
        orgId: 'test-org',
        trusted: false,
        registry,
      });

      try {
        await db.readyPromise();
        const repo = await db.open('/sec/unsigned');

        // Create an unsigned commit (createRawCommit produces no signature)
        const unsignedCommit = createRawCommit({
          session: 'unknown-session-id',
          orgId: 'test-org',
          key: 'unsigned-item',
          schema: kMergeTestSchemaV1,
          data: { title: 'unsigned' },
        });

        // Attempt to persist — TrustPool.verify should reject it
        const persisted = await repo.persistCommits([unsignedCommit]);
        assertEquals(
          persisted.length,
          0,
          'Unsigned commits must be rejected by TrustPool.verify',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Session expiry
  // Guards: session.ts verifyData() timestamp-vs-expiration check
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'expired session signature is rejected by verifyCommit',
    async () => {
      // Create a session that expired 1ms ago
      const expiredSession = await generateSession('expired-user', -1);

      // Sign a commit now — the signature timestamp exceeds the expiration
      const rawCommit = createRawCommit({
        session: expiredSession.id,
        orgId: 'test-org',
        key: 'expired-item',
        schema: kMergeTestSchemaV1,
        data: { title: 'post-expiry' },
      });
      const signedCommit = await signCommit(expiredSession, rawCommit);

      // verifyCommit must reject because sig.timestamp > session.expiration
      const valid = await verifyCommit(expiredSession, signedCommit);
      assertTrue(!valid, 'Commit signed after session expiry must be rejected');
    },
  );

  // ---------------------------------------------------------------------------
  // Schema namespace enforcement
  // Guards: repo.ts persistCommits namespace filter
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'persistCommits rejects wrong namespace',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema); // ns = 'sec-test'
      registry.registerSchema(kMergeTestSchemaV1); // ns = 'merge-test'

      const db = new GoatDB({
        path: await ctx.tempDir('sec-namespace'),
        orgId: 'test-org',
        trusted: true, // Skip auth so we isolate namespace check
        registry,
      });

      try {
        await db.readyPromise();
        // Open repo that only allows 'sec-test' namespace
        const repo = await db.open('/sec/ns-test', {
          allowedNamespaces: ['sec-test'],
        });

        // Commit with the wrong namespace should be filtered
        const wrongNsCommit = createRawCommit({
          orgId: 'test-org',
          key: 'wrong-ns-item',
          schema: kMergeTestSchemaV1, // ns = 'merge-test', not allowed
          data: { title: 'wrong namespace' },
        });

        const persisted = await repo.persistCommits([wrongNsCommit]);
        assertEquals(
          persisted.length,
          0,
          'Commits with disallowed namespace must be rejected',
        );

        // Commit with null namespace must also be rejected (guards the
        // typeof bug fix at repo.ts persistCommits)
        const nullNsCommit = createRawCommit({
          orgId: 'test-org',
          key: 'null-ns-item',
          schema: { ns: null, version: 0, fields: {} },
          data: {},
        });
        const nullResult = await repo.persistCommits([nullNsCommit]);
        assertEquals(
          nullResult.length,
          0,
          'Commits with null namespace must be rejected',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Null namespace rejection without allowedNamespaces (Path B)
  // Guards: repo.ts persistCommits `c.scheme?.ns !== null` filter
  // Regression: the original `typeof c.scheme?.ns !== null` was always truthy
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'persistCommits rejects null namespace without allowedNamespaces',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema);

      const db = new GoatDB({
        path: await ctx.tempDir('sec-ns-pathb'),
        orgId: 'test-org',
        trusted: true, // Skip auth so we isolate namespace check
        registry,
      });

      try {
        await db.readyPromise();
        // Open repo WITHOUT allowedNamespaces — exercises Path B
        const repo = await db.open('/sec/ns-pathb');

        const nullNsCommit = createRawCommit({
          orgId: 'test-org',
          key: 'null-ns-item',
          schema: { ns: null, version: 0, fields: {} },
          data: {},
        });

        const persisted = await repo.persistCommits([nullNsCommit]);
        assertEquals(
          persisted.length,
          0,
          'Commits with null namespace must be rejected even without allowedNamespaces',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Delta commit namespace bypass
  // Guards: repo.ts resolveCommitNs + persistCommits namespace filter
  // ---------------------------------------------------------------------------
  TEST(
    'SecurityBoundaries',
    'persistCommits resolves delta commit namespace from base chain',
    async (ctx) => {
      const registry = new DataRegistry();
      registry.registerSchema(TestSchema); // ns = 'sec-test'
      registry.registerSchema(kMergeTestSchemaV1); // ns = 'merge-test'

      const db = new GoatDB({
        path: await ctx.tempDir('sec-ns-delta'),
        orgId: 'test-org',
        trusted: true, // Skip auth so we isolate namespace check
        registry,
      });

      try {
        await db.readyPromise();
        const repo = await db.open('/sec/ns-delta', {
          allowedNamespaces: ['sec-test'],
        });

        // 1. Persist a full commit with allowed namespace
        const fullCommit = createRawCommit({
          orgId: 'test-org',
          key: 'item-1',
          schema: TestSchema, // ns = 'sec-test'
          data: { title: 'base' },
        });
        const base = await repo.persistCommits([fullCommit]);
        assertEquals(base.length, 1, 'Full commit with allowed ns accepted');

        // 2. Delta referencing the persisted commit — should resolve ns and pass
        const goodDelta = createDeltaCommit({
          key: 'item-1',
          baseCommitId: fullCommit.id,
          parents: [fullCommit.id],
        });
        const goodResult = await repo.persistCommits([goodDelta]);
        assertEquals(
          goodResult.length,
          1,
          'Delta with resolvable allowed ns must be accepted',
        );

        // 3. Delta with unresolvable base — should be rejected
        const badDelta = createDeltaCommit({
          key: 'item-1',
          baseCommitId: 'nonexistent-commit-id',
        });
        const badResult = await repo.persistCommits([badDelta]);
        assertEquals(
          badResult.length,
          0,
          'Delta with unresolvable base must be rejected',
        );

        // 4. Same-batch: full commit + delta arrive together
        const batchFull = createRawCommit({
          orgId: 'test-org',
          key: 'item-2',
          schema: TestSchema,
          data: { title: 'batch-base' },
        });
        const batchDelta = createDeltaCommit({
          key: 'item-2',
          baseCommitId: batchFull.id,
          parents: [batchFull.id],
        });
        const batchResult = await repo.persistCommits([
          batchFull,
          batchDelta,
        ]);
        assertEquals(
          batchResult.length,
          2,
          'Same-batch full + delta chain must both be accepted',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
