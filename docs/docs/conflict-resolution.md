---
id: conflict-resolution
title: Conflict Resolution
sidebar_position: 9
slug: /conflict-resolution
---


# Conflict Resolution

Whenever a peer in the network detects more than one differing value at the
leaves of the [commit graph](/docs/commit-graph), it performs a
[three-way merge](https://en.wikipedia.org/wiki/Merge_(version_control)#Three-way_merge)
to resolve the conflict. Internally, a conflict-free patch function is used
temporarily during the merge process.

## CRDTs

[Conflict-Free Replicated Data Structures (CRDTs)](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type)
were designed to enable concurrent editing without centralized synchronization,
making them particularly well-suited for conflict resolution. While
[CRDTs](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type)
elegantly resolve conflicts, they are often difficult to scale due to their
tendency to inspect the entire history to produce the latest value.

[GoatDB](/) overcomes the traditional scaling challenges of CRDTs by restricting
their usage to the context of a
[three-way merge](https://en.wikipedia.org/wiki/Merge_(version_control)#Three-way_merge).
During a merge, the base version is first transformed into a short-lived
[CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type).
Changes computed by the diff function are then applied to the generated
[CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type).
Finally, the resulting output from the
[CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) is
captured and saved as the commit's contents, while the
[CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) itself
is discarded. This approach ensures that the CRDT's changeset is limited to the
scope of a single
[three-way merge](https://en.wikipedia.org/wiki/Merge_(version_control)#Three-way_merge).

## Exploiting Three-Way Merge

While early implementations of [GoatDB](/) utilized a short-lived
[CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) for
merging conflicts, a more efficient approach was developed for the specific
context of
[three-way merges](https://en.wikipedia.org/wiki/Merge_(version_control)#Three-way_merge).

First, consider the core principle behind the
[Logoot CRDT](https://inria.hal.science/inria-00432368/document):
**continuity**. Logoot's innovation lies in abandoning fixed indexes in favor of
treating them as continuous identifiers. For example, starting with the value
"ABC":

```
Value:  A B C
        - - -
Index:  0 1 2
```

If Peer P1 changes the value to "BCY," it would traditionally be represented as:

```
Value:  B C Y
        - - -
Index:  0 1 2

Changes: [-A, 0], [+Y, 2]
```

Simultaneously, if Peer P2 changes "ABC" to "ABX," it would traditionally be
represented as:

```
Value:  A B X
        - - -
Index:  0 1 2

Changes: [-C, 2], [+X, 2]
```

Using fixed indexes, removing "A" at index 0 affects how subsequent changes are
interpreted. However,
[Logoot](https://inria.hal.science/inria-00432368/document) resolves this by
treating indexes as continuous identifiers. [GoatDB](/) supplements this idea
with the following rules:

- Deletions can only apply to values that exist in the base version.
- Insertions can only occur between values in the base version.

Revisiting the example, the updates become:

### Base Version

```
Value:    A   B   C
        - - - - - - -
Index:  0 1 2 3 4 5 6
```

### Peer P1

```
Value:        B   C Y
        - - - - - - -
Index:  0 1 2 3 4 5 6

Changes: [-A, 1], [+Y, 6]
```

### Peer P2

```
Value:    A   B     X
        - - - - - - -
Index:  0 1 2 3 4 5 6

Changes: [-C, 5], [+X, 6]
```

Now, there is a single insertion conflict at index 6. To resolve this,
[GoatDB](/) employs four resolution strategies, all of which rely on an
external, predefined order agreed upon by all peers in the network. In the
current implementation, we use the random IDs of the commits to establish a
global order. The resolution strategies are as follows:

1. **Either**: Select one of the conflicting changes based on the predefined
   order. The result could be "BY" or "BX."
2. **Both**: Include both changes, resulting in either "BYX" or "BXY."
3. **Merged**: Globally order the changes and compute a union diff. For
   instance, if "Y" and "X" are replaced with "cat" and "hat" respectively, the
   changes ["+cat", 6] and ["+hat", 6] resolve to "chat" (or "hcat" depending on
   the order). The final result could be "Bchat" or "Bhcat."
4. **Timestamp-based**: Select the change with the latest timestamp (aka **Last
   Write Wins**). This strategy works well when all parties have relatively
   synchronized clocks, but may lead to unexpected results if clocks are
   significantly skewed.

:::tip

Timestamp-based resolution is not fair and may lead to starvation in some cases,
where changes from parties with slower clocks are consistently ignored. It is
especially suited for environments where clocks are tightly synchronized, such
as within a data center, and less appropriate for real-time collaboration
sessions between different clients.

This approach ensures efficient conflict resolution tailored to the requirements
of a
[three-way merge](https://en.wikipedia.org/wiki/Merge_(version_control)#Three-way_merge)
while maintaining scalability and performance.
