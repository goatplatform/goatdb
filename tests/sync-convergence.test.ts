import { TEST } from './mod.ts';
import { assertTrue } from './asserts.ts';
import {
  createRawCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { Commit } from '../repo/commit.ts';
import { SyncMessage } from '../net/message.ts';
import { BloomFilter } from '../base/bloom.ts';

type Peer = Map<string, Commit>;

/**
 * Builds a SyncMessage from a local peer's commits given the remote peer's bloom filter.
 */
function buildMessage(
  local: Peer,
  peerFilter: BloomFilter | undefined,
): SyncMessage {
  const entries: [string, Commit][] = Array.from(local.entries());
  return SyncMessage.build(
    peerFilter,
    entries,
    local.size,
    0,
    5,
    'test-org',
    kMergeTestRegistry,
  );
}

/**
 * Builds a bloom filter that covers all commit IDs in the peer's map.
 */
function buildFilter(peer: Peer): BloomFilter {
  const msg = SyncMessage.build(
    undefined,
    Array.from(peer.entries()),
    peer.size,
    0,
    5,
    'test-org',
    kMergeTestRegistry,
    false,
  );
  return msg.filter;
}

/**
 * Simulates one symmetric sync round: both peers exchange simultaneously.
 * Returns whether full convergence was reached after the round.
 */
function syncRound(a: Peer, b: Peer): void {
  // Capture filters before the round (symmetric / simultaneous)
  const filterA = buildFilter(a);
  const filterB = buildFilter(b);

  // Each peer builds its message using the OTHER peer's filter
  const msgFromA = buildMessage(a, filterB);
  const msgFromB = buildMessage(b, filterA);

  // Apply received values
  for (const commit of msgFromA.values) {
    b.set(commit.id, commit);
  }
  for (const commit of msgFromB.values) {
    a.set(commit.id, commit);
  }
}

function converged(a: Peer, b: Peer): boolean {
  if (a.size !== b.size) return false;
  for (const id of a.keys()) {
    if (!b.has(id)) return false;
  }
  return true;
}

function makeCommits(count: number, keyPrefix: string): Peer {
  const peer: Peer = new Map();
  for (let i = 0; i < count; i++) {
    const commit = createRawCommit({
      key: `${keyPrefix}-${i}`,
      schema: kMergeTestSchemaV1,
      data: { title: `${keyPrefix}-${i}`, count: i },
    });
    peer.set(commit.id, commit);
  }
  return peer;
}

export default function setup() {
  TEST('SyncConvergence', 'two peers converge in <=5 rounds', (_ctx) => {
    const a = makeCommits(50, 'peer-a');
    const b = makeCommits(50, 'peer-b');

    let rounds = 0;
    while (!converged(a, b)) {
      syncRound(a, b);
      rounds++;
      assertTrue(
        rounds <= 5,
        `Expected convergence in <=5 rounds, took ${rounds}`,
      );
    }
    assertTrue(converged(a, b), 'Peers did not converge');
  });

  TEST('SyncConvergence', 'single round for small disjoint sets', (_ctx) => {
    const a = makeCommits(5, 'small-a');
    const b = makeCommits(5, 'small-b');

    syncRound(a, b);

    assertTrue(
      converged(a, b),
      'Expected convergence in exactly 1 round for small disjoint sets',
    );
  });

  TEST('SyncConvergence', 'convergence from empty peer', (_ctx) => {
    const a = makeCommits(10, 'full');
    const b: Peer = new Map();

    syncRound(a, b);

    assertTrue(
      converged(a, b),
      'Expected convergence in 1 round when one peer is empty',
    );
  });
}
