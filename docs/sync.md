---
permalink: /sync/
layout: default
title: Synchronization
nav_order: 10
---

<script
  src="https://cdn.mathjax.org/mathjax/latest/MathJax.js?config=TeX-AMS-MML_HTMLorMML"
  type="text/javascript"
></script>

# Synchronization Protocol

At the heart of GoatDB lies a [distributed commit graph](/commit-graph). This
graph must be synchronized across all peers in the network to converge into a
single version of truth.

## Background

[Git's reconciliation protocol](https://martin.kleppmann.com/2020/12/02/bloom-filter-hash-graph-sync.html)
addresses this problem by traversing the commit graph over multiple
request-response cycles, sending any missing commits until a common ancestor is
identified. However, this process often involves several round trips, making it
unsuitable for real-time collaboration.

Martin Kleppmann and his team
[published](https://martin.kleppmann.com/2020/12/02/bloom-filter-hash-graph-sync.html)
an optimization to Git's traditional approach. They introduced a preprocessing
stage before the reconciliation protocol to reduce round trips. This stage
involves exchanging a [Bloom Filter](https://en.wikipedia.org/wiki/Bloom_filter)
to detect probable missing commits. However, this method still requires running
the full reconciliation algorithm after processing the initial Bloom Filter.

GoatDB's synchronization approach differs. It repeatedly exchanges Bloom Filters
and commits between peers without relying on additional protocols. By adjusting
the filter size and the number of iterations, the protocol ensures all peers
converge to an identical commit graph.

## Bloom Filter Synchronization

GoatDB's synchronization process is agnostic of the history it syncs. It treats
the data as two abstract maps of random strings and opaque data objects (commits
and their IDs). Since the [commit graph](/commit-graph) is append-only,
previously incorporated commits are immutable and cannot be edited
retroactively. Any "edit" involves appending a new commit to the graph.

Let's delve into how Bloom Filters work internally. Assume a 2-bit filter where
one bit is on, and the other is off: `BF=[0, 1]`. This filter has a 50%
false-positive rate (FPR), meaning if a value maps to the `0` bit, it is
guaranteed not to be in the filter. However, if it maps to the `1` bit, the
value might be present, or the bit might be turned on due to a collision—hence
the false positive.

In this context, the Bloom Filter represents a set of members (commits in the
graph). By identifying which members are absent, each peer can determine with
100% certainty which specific commits are missing on the other side and send
them over. Due to false positives, some missing values will be overlooked. For
example, with an FPR of 4 (25% false positive), about 25% of missing values
won't be sent initially.

Repeating the process with different hash functions generates a new Bloom
Filter, which misses a different subset of commits. By iterating this process
enough times, all values are eventually covered. Importantly, the graph
structure is transparent to this algorithm. The protocol is stateless, and each
iteration re-examines the entire history. Each successive iteration includes
values received in previous iterations, significantly reducing the number of
misses. For instance:

- Peer `A` has 200 entries.
- Peer `B` has 100 entries (100 present, 100 missing).
- Using FPR = 4:

  1. Iteration 1 misses 100 × 0.25 = 25 entries.
  2. Iteration 2 misses 25 × 0.25 = 6.25 entries.
  3. Iteration 3 misses 6.25 × 0.25 = ~1.56 entries.
  4. …

This iterative process guarantees convergence.

To bound the process, GoatDB uses the following relationship:

$$\text{cycles} = 2 \cdot \log_{\text{fpr}}(\max(M, N))$$

This formula allows the system to trade increased overhead for reduced latency
or vice versa.

## Example of Synchronization

Here is an example of how synchronization works between two peers:

### Initial State

- **Peer A:** Commits: `C1`, `C2`, `C3` (missing `C4`).
- **Peer B:** Commits: `C1`, `C2`, `C4` (missing `C3`).

### Synchronization Steps

1. **Step 1:**

   - **Peer A** creates a Bloom Filter based on its commit IDs (`C1`, `C2`,
     `C3`) and sends it to **Peer B**.
   - **Peer B** checks the Bloom Filter against its own commit IDs (`C1`, `C2`,
     `C4`) identifies `C4` as missing with 100% certainty.

2. **Step 2:**

   - **Peer B** creates a Bloom Filter based on its commit IDs (`C1`, `C2`,
     `C4`) and sends it to **Peer A** alongside `C4` which was identified as
     missing in **Step 1**.
   - **Peer A** receives `C4`. It then checks the Bloom Filter against its own
     commit IDs (`C1`, `C2`, `C3`, `C4`) identifies `C3` as missing with 100%
     certainty.

3. **Step 3:**
   - **Peer A** repeats **Step 1** except now it also sends over `C3` which was
     identified as missing in **Step 2**.

At this point, both **Peer A** and **Peer B** have identical commit graphs:
`C1`, `C2`, `C3`, `C4`.

## Dealing with Partitions

The protocol described above may miss a subset of commits during each iteration.
This can be problematic in sparse graphs or when there is little to no
collaboration, resulting in a linear commit history. In such cases, a single
missed commit can create a partition in the graph, temporarily splitting it into
two disjoint subgraphs with separate leaves.

If this partition occurs, merging the two leaves could inadvertently undo
changes from one or both parts of the graph. To prevent this, every commit
stores a reference to K ancestors further up the graph. Since the Bloom Filter
may randomly miss some commits, the probability of missing `K` consecutive
commits is approximately `FPR^K`. By capping the Bloom Filter's false positive
rate at a minimum of `0.001`, we ensure that a gap larger than three commits is
extremely unlikely—occurring roughly once every 32 years (assuming one sync
iteration per second).

{: .note }

> The partition handling mechanism described above is currently a work in
> progress and has not yet been fully implemented in the codebase. The current
> implementation uses a combination of older heuristics (including strict commit
> ordering and explicit parent references) which are being phased out in favor
> of this more robust probabilistic approach.

## Real-World Performance

GoatDB's synchronization prioritizes consistency over speed. In typical deployments, expect **700-1000ms application-perceived latency** between peers.

This latency reflects several architectural components:

- **Sync scheduling:** 200ms polling intervals with 300-1500ms adaptive cycles
- **Protocol overhead:** Multiple HTTP round-trips for Bloom filter convergence
- **Processing time:** Commit validation, serialization, and storage operations

For applications requiring sub-100ms synchronization, consider the planned Server-Sent Events optimization or evaluate whether GoatDB's consistency guarantees align with your performance requirements.
