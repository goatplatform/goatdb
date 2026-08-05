---
id: commit-graph
title: Commit Graph
sidebar_position: 11
slug: /commit-graph
---

import CommitGraphIllustration from
'@site/src/components/diagrams/CommitGraphIllustration';

# Commit Graph

The underlying data structure powering GoatDB is a commit graph. If you've ever
worked with a Distributed Version Control System (DVCS) like Git, this concept
should feel quite familiar. However, unlike some DVCS, GoatDB's commit graph is
**append-only**, meaning that commits can only be added, not deleted. Notably,
an append-only commit graph is a type of
[Conflict-Free Replicated Data Structure (CRDT)](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type),
which contributes to GoatDB's scalability and performance. The commit graph acts
as a logical clock similar to
[Merkle-CRDTs](https://research.protocol.ai/publications/merkle-crdts-merkle-dags-meet-crdts/psaras2020.pdf),
thus ensuring
[Causal Consistency](https://en.wikipedia.org/wiki/Causal_consistency) in the
presence of offline editing.

Simply put, all data creation and editing operations in GoatDB append new
commits to the replicated commit graph. The commit graph is then synchronized in
the background with the server.

In secure mode (default), each commit in the graph is [signed](/docs/sessions)
with the session's private key. This enables verification that commits were
created by authorized sessions and that each commit edited only what was
allowed, effectively enforcing permissions retroactively. A commit that appears
to perform unauthorized modifications is simply ignored. Trusted mode disables
signing, verification, authorization, and provenance.

Because the graph is append-only and every commit is signed, it doubles as an
audit trail for delegated work — you can always verify which session wrote what,
including actions taken by agents.

The length of the commit graph—that is, how much history is retained—determines
the maximum supported offline period, subject to the availability of authorized
replicas and configured retention policies. For example, if configured to retain
two weeks of history, clients can go offline for up to two weeks and still
rejoin and merge their offline edits.

<CommitGraphIllustration />

## Creation Process

When creating a new commit, a GoatDB instance follows the procedure below:

1. Capture the state of the data in a commit format.
2. Apply [delta compression](#delta-compression).
3. Sign the result with the session's private key.
4. Write the new commit to the replicated graph.

## Ancestor Pointers

In addition to its direct parents, each commit stores references to K ancestors
further up the commit history. These ancestor pointers serve two purposes:

1. **Bridging sync gaps.** The [bloom-filter sync protocol](/docs/sync) may
   temporarily miss consecutive commits, creating gaps in the local graph.
   Ancestor pointers let the system see past these gaps. A commit that appears
   in another commit's ancestor list is recognized as part of the graph and is
   not treated as a leaf — even if its direct parent link is missing locally.

2. **Merge base discovery.** When resolving conflicts, the
   [LCA algorithm](/docs/conflict-resolution#merge-base-selection) walks both
   parent and ancestor links to find a common base commit. If a parent is
   missing, the search can jump through ancestor pointers instead of stalling.

The probability of missing K consecutive commits during sync is approximately
FPR^K, where FPR is the bloom filter's false-positive rate. With GoatDB's
minimum FPR cap of 0.001, gaps larger than three commits are extremely unlikely.
See the [synchronization page](/docs/sync) for the full analysis.

## Delta Compression

Like any other compression strategy, delta compression usually reduces the size
of the data, but not always. Consider, for example, the case of deleting an
entire document. Attempting to delta-compress it would result in the entire
original document being encoded as the delta, whereas storing the actual empty
document would obviously be more compact. Additionally, reading a
delta-compressed commit incurs a small performance penalty, as the system needs
to reapply the patches.

To balance these processes, GoatDB's implementation first computes a
delta-compressed commit and then compares it with the original full snapshot
commit. Only if the delta representation is smaller than a predetermined, fixed
threshold will it be used; otherwise, the full snapshot will be chosen instead.

Intuitively, one might be tempted to compute deltas from the previous commit,
potentially creating a long chain of delta commits. This approach hurts read
performance since, to decompress the latest commit, the system must first
decompress all of its ancestors. Instead, GoatDB computes deltas relative to
**the last known full commit**.

For example, consider the chain of commits:

```
A < B < C
```

Here, `A` is a full snapshot, while `B` and `C` are delta-compressed. `B`
computes its patches relative to `A`, and `C` also computes its patches relative
to `A`. This ensures that when reading delta-compressed commits, the reader
needs to consider only one other commit. Because this base commit is likely
shared by other delta-compressed commits, it is a good candidate for caching.

Another potential issue with delta compression is the loss of the base version.
If the base version is lost or corrupted, the entire chain of dependent commits
becomes unreadable. To mitigate this risk, GoatDB probabilistically creates a full snapshot commit with approximately 1 in 20 probability per commit, even if delta compression would otherwise be more efficient. This increases the system's reliability by avoiding long chains of delta-compressed commits, at the cost of minimal performance overhead.
