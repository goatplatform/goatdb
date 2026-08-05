---
id: benchmarks
title: Benchmarks
sidebar_position: 8
slug: /benchmarks
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import '../src/css/benchmark-tables.css';

# GoatDB Benchmarks

:::info[Run provenance]

All numbers on this page come from a single benchmark run on 2026-07-31, on an
Apple M4 Pro (arm64, 24GB RAM, NVMe SSD) running macOS (Darwin 25.5.0), with
Deno 2.9.1, Node.js v24.14.1, and headless Chrome 149. Reproduce with
`deno task bench:json && deno task bench:update-docs` — every table below is
regenerated from that run's JSON output.

:::

## Shared State for Humans and Agents

Modern applications have more than humans at the keyboard. AI agents, tools, and
background services read and write the same live state as the people they work
alongside. That workload sets the requirements these benchmarks measure:

- **Latency** — a human editing a document and an agent reacting to that edit
  both need in-process, low-microsecond reads (~2μs measured here). A network
  round-trip per interaction breaks the feedback loop for both.
- **Live updates** — agents and UIs alike subscribe to state changes rather than
  polling for them, so reactive query refresh is on the critical path.
- **Provenance** — when many actors write to shared state,
  [signed commits](/docs/sessions) let you verify which session wrote what, at a
  signing cost worth measuring.

GoatDB is designed for this workload: an embedded database with built-in sync
where each participant — human or agent — works against a full local replica of
each repository it has opened and is authorized to sync. The taxonomy below
shows where that design sits relative to the databases it
draws from, and the sections after it compare GoatDB head-to-head with SQLite —
the only other embedded database that runs across server, browser, and edge.

Traditional databases fall into two camps. **Remote databases** (PostgreSQL,
Redis) store data on a server — every read and every write pays a network
round-trip, which dominates the operation. **Embedded databases** (SQLite)
eliminate the network by running in-process — point reads measured here take
~13μs — but they offer no sync, no collaboration, and no per-write signed
provenance (SQLite can be encrypted at rest via extensions such as SQLCipher;
what it lacks is tamper-evident authorship of each individual write).

GoatDB is a third option: its memory model mirrors how desktop apps handle
files. When your app opens a [repository](/docs/repositories), that repository's
full dataset loads into memory — like a word processor opening a document. After
that one-time cost, reads complete in ~2μs with no network hop and no disk I/O.
The app explicitly controls which repositories are in memory by opening and
closing them, the same way users open and close files. Explicit user
interactions — opening a project, switching a workspace, loading a document —
map directly to `db.open()` and `db.closeRepo()` calls, so the startup cost is
expected and bounded. [Sync](/docs/sync),
[structural merge](/docs/conflict-resolution), and
[secure-mode cryptographic signing](/docs/sessions) run entirely in the
background. The network never appears in your hot path.

The table below places GoatDB alongside the databases it draws from.

|                     | GoatDB                                                                                              | SQLite                       | Redis                           | PostgreSQL                   |
| ------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------- | ---------------------------- |
| **Category**        | Embedded, memory-first, syncing                                                                     | Embedded, local-only         | Remote, in-memory               | Remote, disk-based           |
| **Read latency**    | ~2μs (memory lookup, measured)                                                                      | ~13μs (FFI + B-tree, measured) | Network round-trip per read   | Network round-trip per read  |
| **Runs in browser** | Yes (OPFS)                                                                                          | Yes (WASM)                   | No                              | No                           |
| **Built-in sync**   | [Commit-graph sync](/docs/sync) with [structural merge](/docs/conflict-resolution)                  | None                         | Pub/sub (no merge)              | Logical replication          |
| **Offline support** | Full read/write                                                                                     | Full read/write              | None                            | None                         |
| **Memory model**    | Open repos load fully into RAM, like opening a file; app explicitly controls which repos are loaded | Disk-backed, pages on demand | Entire dataset in RAM           | Disk-backed, pages on demand |
| **Data model**      | [Commit graph](/docs/commit-graph) with [deterministic structural merge](/docs/conflict-resolution) | B-tree + ACID transactions   | Key-value / streams             | Relational + ACID            |

Redis and PostgreSQL are not benchmarked here — they require a network hop per
operation, so any latency figure for them describes the network and deployment
topology more than the database. They appear above for categorical contrast
only; every measured comparison on this page is GoatDB vs SQLite, both running
in-process on the same machine.

## Head-to-Head: GoatDB vs SQLite

Both databases in their recommended production configurations: GoatDB with
cryptographic signing and relaxed durability (crash-safe via
[append-only log](/docs/repositories)), SQLite with WAL mode and
`synchronous=NORMAL`. The <span className="bench-winner">highlighted
value</span> marks the robust winner of each row (gap holds even at the
edges of measurement noise); all other values render plain. Reproduce locally:
`deno task bench`

Comparison tables report the **trimmed mean** (outlier-resistant);
[Detailed Statistics](#detailed-statistics) reports the raw arithmetic mean
alongside median, stddev, and CV. The two differ slightly for noisy operations —
both come from the same run.

**Read the warm rows carefully.** GoatDB's warm query figures measure a cache
hit on an already-materialized live-query result, not query execution. That
makes the warm comparison asymmetric by construction — see
[Query Operations Explained](#query-operations-explained).

### Query Operations Explained

The query benchmarks test three distinct capabilities:

**Filter queries** are benchmarked in two configurations:

- **Cold** — first-access cost: GoatDB creates a new query object and performs a
  full O(n) scan evaluating a JavaScript predicate per item; SQLite creates a
  new connection and runs an equivalent `WHERE` clause. This represents the
  worst case: no caching, no reuse.
- **Warm** — repeated-access cost: GoatDB reuses the same live query instance
  (pooled by config hash) and returns its age-tracked frozen result array in
  O(1) when no data has changed; SQLite reuses a persistent connection with a
  prepared statement and a warm OS page cache. This represents steady-state
  performance after the first access.

:::warning[The warm rows are not a like-for-like comparison]

GoatDB's warm figure is **cached live-query result retrieval**: a cache hit
returning an already-materialized frozen array. No predicate is evaluated and no
rows are built. SQLite's warm figure is **query execution** — the prepared
statement re-runs and re-materializes rows on every call, because SQLite has no
subscribed, self-maintaining result set. The warm rows therefore answer "what
does it cost to read a live query's current results again?", not "what does it
cost to run this query?". They support the architectural claim that GoatDB keeps
a result set live at near-zero cost. The **cold** rows are the like-for-like
execution comparison.

:::

The parenthetical shows dataset size and result count — e.g., "100k → 1k
results" scans 100,000 items cold and returns 1,000 matches; warm, it returns
the same 1,000 items directly from cache with no scan.

**Filter + sort** adds a custom sort comparator on top of predicate filtering
(GoatDB) or `ORDER BY` (SQLite), measuring the combined cost. Same cold/warm
split applies.

**Live query updates** measure reactive performance: a query is subscribed to a
100k-item dataset, then N items are modified across the predicate boundary, and
the query results are refreshed. The measurement includes both write latency (N
commits/UPDATEs) and query refresh time. In GoatDB, queries subscribe to changes
and update incrementally via event propagation. In SQLite, the equivalent is N
UPDATE statements followed by a full re-query — there is no subscription
mechanism. In the browser, GoatDB queries yield cooperatively to keep the UI at
60fps, so wall-clock time includes scheduling overhead.

### Server (Deno / Node.js)

{/* BENCH:server-comparison:START */}
<div className="benchmark-table">

| Operation | GoatDB | SQLite |
|-----------|--------|--------|
| Create instance | 1.2ms | <span className="bench-winner">80.2µs</span> |
| Open database (empty) | 315.5µs | 346.2µs |
| Open database (100k items) | 629.6ms | <span className="bench-winner">116.5µs</span> |
| Create item | 46.7µs | <span className="bench-winner">27.1µs</span> |
| Read item | <span className="bench-winner">1.8µs</span> | 13.0µs |
| Update item | <span className="bench-winner">6.6µs</span> | 21.1µs |
| Bulk create 100 items | 3.8ms | <span className="bench-winner">149.2µs</span> |
| Bulk read 100 items | 167.0µs | 221.9µs |
| Write 100k items | 3610.5ms | <span className="bench-winner">171.4ms</span> |
| Read 100k items (cold) | 283.1ms | <span className="bench-winner">67.8ms</span> |
| Read 100k items (warm) | <span className="bench-winner">5.0ms</span> | 65.1ms |
| Filter query cold (100 items) | 31.3µs | 40.3µs |
| Filter query warm (100 items) | <span className="bench-winner">0.4µs</span> | 29.2µs |
| Filter query cold (100k → 1k results) | 121.0ms | <span className="bench-winner">572.4µs</span> |
| Filter query warm (100k → 1k results) | <span className="bench-winner">0.7µs</span> | 524.5µs |
| Filter query cold (100k → 10k results) | 122.7ms | <span className="bench-winner">5.5ms</span> |
| Filter query warm (100k → 10k results) | <span className="bench-winner">0.3µs</span> | 5.4ms |
| Filter + sort query cold (100 items) | 6.1µs <span className="bench-cv">±268%</span> | 21.8µs |
| Filter + sort query warm (100 items) | <span className="bench-winner">0.4µs</span> | 3.0µs |
| Live query update (100 items) | <span className="bench-winner">177.7µs</span> | 913.8µs |
| Live query update (1k items) | <span className="bench-winner">913.3µs</span> | 3.1ms |
| Live query update (10k items) | <span className="bench-winner">8.3ms</span> | 22.2ms |
| Count operation | <span className="bench-winner">2.0µs</span> | 7.5µs |
| Keys operation | <span className="bench-winner">3.8µs</span> | 11.6µs |

</div>
{/* BENCH:server-comparison:END */}

<p className="bench-legend">Data: Deno. Node.js results are comparable for most operations (largest divergences in this run: warm 100k read ~1.9×, 100k write ~1.25×) — see <a href="#detailed-statistics">Detailed Statistics</a> for both.</p>

### Browser

GoatDB uses OPFS (Origin Private File System); SQLite uses WASM.

GoatDB writes return after committing to memory (OPFS persistence is batched in
a background worker); SQLite WASM writes include synchronous OPFS persistence.
This difference primarily affects single-item write latencies.

{/* BENCH:browser-comparison:START */}
<div className="benchmark-table">

| Operation | GoatDB | SQLite (WASM) |
|-----------|--------|--------|
| Create instance | 12.1ms | 11.6ms |
| Open database (empty) | 1.7ms | <span className="bench-winner">1.4µs</span> |
| Open database (100k items) | 647.2ms | <span className="bench-winner">2.9ms</span> |
| Create item | <span className="bench-winner">52.0µs</span> | 4.5ms |
| Read item | <span className="bench-winner">1.5µs</span> | 490.6µs |
| Update item | <span className="bench-winner">7.0µs</span> | 3.7ms |
| Bulk create 100 items | <span className="bench-winner">4.3ms</span> | 7.3ms |
| Bulk read 100 items | <span className="bench-winner">186.2µs</span> | 44.5ms |
| Read 100k items (cold) | <span className="bench-winner">237.5ms</span> | 389.8ms |
| Read 100k items (warm) | <span className="bench-winner">5.3ms</span> | 335.1ms |
| Filter query cold (100 items) | <span className="bench-winner">28.1µs</span> | 621.5µs |
| Filter query warm (100 items) | <span className="bench-winner">\<0.1µs</span> | 557.2µs |
| Filter query cold (100k → 1k results) | 631.1ms | <span className="bench-winner">4.1ms</span> |
| Filter query warm (100k → 1k results) | <span className="bench-winner">\<0.1µs</span> | 3.1ms |
| Filter query cold (100k → 10k results) | 633.3ms | <span className="bench-winner">36.6ms</span> |
| Filter query warm (100k → 10k results) | <span className="bench-winner">\<0.1µs</span> | 28.5ms |
| Filter + sort query cold (100 items) | <span className="bench-winner">5.6µs</span> | 538.0µs |
| Filter + sort query warm (100 items) | <span className="bench-winner">\<0.1µs</span> | 456.5µs |
| Live query update (100 items) | <span className="bench-winner">208.5µs</span> | 460.7ms |
| Live query update (1k items) | <span className="bench-winner">1.5ms</span> | 4532.3ms |
| Live query update (10k items) | <span className="bench-winner">44.7ms</span> | 45446.7ms |
| Count operation | <span className="bench-winner">2.0µs</span> | 459.4µs |
| Keys operation | <span className="bench-winner">5.0µs</span> | 486.5µs |

</div>
{/* BENCH:browser-comparison:END */}

<p className="bench-legend">Omitted rows perform comparably across environments — see <a href="#detailed-statistics">Detailed Statistics</a> for full browser data.</p>

### Why Browser Results Differ

Three phenomena explain why the server and browser tables tell such different
stories:

1. **GoatDB is environment-invariant.** Data lives in the JS heap regardless of
   runtime. Browser reads (~1.5μs) are nearly identical to server reads (~1.8μs)
   — both are Map lookups. The runtime boundary barely registers.

2. **SQLite pays compounding browser overhead.** Every browser SQLite operation
   crosses JS→WASM, then WASM→OPFS with synchronous I/O. On the server, SQLite
   uses native FFI + OS page cache. For the point-read measurements above, the
   gap is about 7× on the server (1.8us vs 13.0us) and over 300× in the browser
   (1.5us vs 490.6us). Live-query updates are a separate measurement: they
   include writes plus reactive result maintenance. Each individual SQLite
   UPDATE in the browser pays the full WASM+OPFS round-trip, so operations that
   issue many writes (live query updates) see the largest amplification.
   SQLite's `:memory:` mode bypasses all kernel filesystem interactions
   ([sqlite.org/forum/forumpost/7eee1ce2e4f97f47](https://sqlite.org/forum/forumpost/7eee1ce2e4f97f47));
   browser SQLite requires workarounds (Asyncify, SharedArrayBuffer+Atomics)
   that add 2–5× overhead
   ([powersync.com/blog/sqlite-persistence-on-the-web](https://www.powersync.com/blog/sqlite-persistence-on-the-web)).

3. **Cold read direction flip.** Read 100k cold is GoatDB-slower on server
   (283ms vs 68ms) but GoatDB-faster in browser (238ms vs 390ms). On the server,
   SQLite's memory-mapped pages-on-demand wins for sequential scans. In the
   browser, each page fetch pays the WASM+OPFS boundary cost, making
   pages-on-demand a liability — while GoatDB's bulk-load-and-deserialize pays
   the OPFS cost once.

## Interpreting the Results

The database **is** the application cache. After the initial open, item data
lives in memory — reads are pure Map lookups with no FFI, no B-tree traversal,
and no disk I/O.

- **Point reads and metadata**: GoatDB point reads are memory lookups — about 7×
  faster on the server and over 300× faster in the browser in these
  measurements. Count/keys are 3–4× faster on the server.
- **Cold filter queries**: SQLite wins on large scans — B-tree indexing beats a
  full predicate scan by ~22× (100k → 10k results) and ~210× (100k → 1k
  results). At 100 items the two are within noise. Cold = first-access cost, and
  this is the like-for-like execution comparison.
- **Warm filter queries**: not a query-execution comparison — GoatDB returns an
  already-computed live-query result in O(1) (cache hit), while SQLite re-runs
  the prepared statement. GoatDB's own cold-to-warm ratio is ~80× at 100 items
  and >100,000× at 100k items; SQLite's warm improvement over cold is moderate
  (prepared statement + page cache).
- **Live query updates**: GoatDB wins — incremental event propagation vs full
  re-query. Browser: cooperative yielding adds scheduling overhead (not directly
  comparable to SQLite's blocking queries).
- **Cold start**: SQLite wins — pages-on-demand = near-zero open cost.

Expected outcome after running `deno task bench`:

- **GoatDB warm reads**: ~50× faster than cold (pure Map lookups)
- **GoatDB warm queries**: orders of magnitude faster than cold (~80× at 100
  items, >100,000× at 100k items) — O(1) cached array, no predicate scan
- **SQLite warm reads**: similar to cold (B-tree traversal + FFI cost is
  irreducible)
- **SQLite warm queries**: moderate improvement over cold from prepared
  statement reuse and warm page cache

**Cold vs. warm reads**: `Read 100k items (cold)` measures first-access
deserialization — GoatDB lazily parses each commit's JSON on the first
`valueForKey` call, so 100k items means 100k JSON parses.
`Read 100k items (warm)` runs one untimed full scan first to populate all
caches, then times a second scan — this is GoatDB's steady-state: pure Map
lookups, 5.0ms to re-read all 100k items. Both databases receive identical
treatment (one untimed
warmup scan, then one timed scan), making the warm comparison the fairest
measure of each database's in-process read throughput.

The open cost maps naturally to user-initiated actions — opening a project,
switching a workspace, loading a document. Users already expect a brief load
when they open something; what they don't expect is latency on every subsequent
interaction. GoatDB pays the cost once at open time and then runs at memory
speed, matching the mental model modern apps have trained users to expect.

| Requirement                                          | Best fit                | Why                                                                                                                                   |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Read-heavy, long-running process                     | **GoatDB**              | ~2μs reads after one-time startup load; pay the cold-start cost once                                                                  |
| Reactive local queries                               | **GoatDB**              | Incremental query updates as local data changes, no query polling                                                                     |
| Offline-first / multi-device sync                    | **GoatDB**              | Built-in [commit-graph sync](/docs/sync) with [deterministic structural merge](/docs/conflict-resolution)                             |
| Distributed AI agents                                | **GoatDB**              | Runs in-process on server, edge, and browser; reactive state; optional cryptographic signing                                          |
| Bulk write ingest                                    | **SQLite**              | B-tree + WAL optimized for batch inserts                                                                                              |
| Very large datasets (many repos open simultaneously) | **SQLite / PostgreSQL** | GoatDB loads each open repo fully into RAM; keep the in-memory set manageable by opening only the repos you need and closing the rest |
| Short-lived processes (serverless, CLI)              | **SQLite**              | Near-zero startup cost; no warm-up required                                                                                           |
| Multi-tenant server with complex queries             | **PostgreSQL**          | SQL, joins, stored procedures, row-level security                                                                                     |
| High-throughput caching layer                        | **Redis**               | Purpose-built in-memory cache: TTL eviction, pub/sub (not benchmarked here)                                                           |

## Configuration Variants

The comparisons below isolate specific GoatDB configuration options. Only
operations where configurations diverge past the color-coding threshold
(&gt;1.3× for millisecond-scale, &gt;1.5× for microsecond-scale) are shown.

<details>
<summary>Trusted Mode — Bypassing Signatures</summary>

GoatDB signs every commit with Ed25519 by default, enabling
[multi-peer and untrusted environments](/docs/sessions). For single-user or
fully-trusted local scenarios you can opt out with `trusted: true`, which
removes the signing overhead.

{/* BENCH:security-modes:START */}
<div className="benchmark-table">

| Operation | GoatDB | GoatDB (Trusted) |
|-----------|--------|--------|
| Create item | 46.7µs | <span className="bench-winner">26.3µs</span> |
| Read item | 1.8µs <span className="bench-cv">±36%</span> | 1.1µs |
| Update item | 6.6µs | <span className="bench-winner">3.9µs</span> |
| Bulk create 100 items | 3.8ms | <span className="bench-winner">1.1ms</span> |
| Write 100k items | 3610.5ms | <span className="bench-winner">704.0ms</span> |

</div>
{/* BENCH:security-modes:END */}

<p className="bench-legend">Data: Deno. Only operations where trusted mode differs &gt;1.3-1.5× — omitted rows are comparable. See <a href="#detailed-statistics">Detailed Statistics</a> for full data.</p>

Trusted mode removes roughly 3–5× overhead on bulk writes (3.4× on bulk create,
5.1× on the 100k write). Reads are unaffected by signing in either mode.

</details>

<details>
<summary>Durable Mode Comparison (per-operation fsync)</summary>

GoatDB (Durable) adds per-operation fsync while keeping full cryptographic
signing — isolating the cost of waiting for disk I/O. Only operations where at
least one configuration differs meaningfully are shown.

:::note[Crash safety without fsync]

GoatDB's [append-only log](/docs/repositories) remains crash-safe even without
fsync — incomplete writes are discarded on restart. `SQLite synchronous=OFF`
risks database corruption on crash. GoatDB also exposes
[`flush()`](/api/GoatDB/classes/GoatDB#flush) for application-controlled
durability.

:::

{/* BENCH:durable-mode:START */}
<div className="benchmark-table">

| Operation | GoatDB (Durable) | GoatDB | SQLite | SQLite Fast-Unsafe |
|-----------|--------|--------|--------|--------|
| Create instance | 1.1ms | 1.2ms | 80.2µs | <span className="bench-winner">79.2µs</span> |
| Open database (empty) | 293.8µs | 315.5µs | 346.2µs | <span className="bench-winner">133.7µs</span> |
| Open database (100k items) | 691.3ms | 629.6ms | <span className="bench-winner">116.5µs</span> | 154.5µs |
| Create item | 661.7µs | 46.7µs | 27.1µs | <span className="bench-winner">13.9µs</span> |
| Read item | <span className="bench-winner">1.5µs</span> | 1.8µs | 13.0µs | 10.2µs |
| Update item | 93.0µs | <span className="bench-winner">6.6µs</span> | 21.1µs | 10.6µs |
| Bulk create 100 items | 12.0ms | 3.8ms | 149.2µs | <span className="bench-winner">135.8µs</span> |
| Bulk read 100 items | <span className="bench-winner">141.9µs</span> | 167.0µs | 221.9µs | 147.4µs |
| Write 100k items | 3902.3ms | 3610.5ms | 171.4ms | <span className="bench-winner">139.6ms</span> |
| Read 100k items (cold) | 295.7ms | 283.1ms | <span className="bench-winner">67.8ms</span> | 68.5ms |
| Read 100k items (warm) | 6.1ms | <span className="bench-winner">5.0ms</span> | 65.1ms | 63.5ms |
| Filter query cold (100 items) | 10.8µs <span className="bench-cv">±263%</span> | 31.3µs | 40.3µs | 36.6µs |
| Filter query warm (100 items) | 0.7µs | <span className="bench-winner">0.4µs</span> | 29.2µs | 25.9µs |
| Filter query cold (100k → 1k results) | 120.0ms | 121.0ms | 572.4µs | <span className="bench-winner">568.1µs</span> |
| Filter query warm (100k → 1k results) | <span className="bench-winner">0.3µs</span> | 0.7µs | 524.5µs | 515.0µs |
| Filter query cold (100k → 10k results) | 125.1ms | 122.7ms | 5.5ms | <span className="bench-winner">5.4ms</span> |
| Filter query warm (100k → 10k results) | 1.9µs | <span className="bench-winner">0.3µs</span> | 5.4ms | 5.1ms |
| Filter + sort query cold (100 items) | <span className="bench-winner">3.8µs</span> | 6.1µs | 21.8µs | 20.2µs |
| Filter + sort query warm (100 items) | 1.5µs | <span className="bench-winner">0.4µs</span> | 3.0µs | 2.0µs |
| Live query update (100 items) | <span className="bench-winner">165.5µs</span> | 177.7µs | 913.8µs | 798.6µs |
| Live query update (1k items) | 951.9µs | <span className="bench-winner">913.3µs</span> | 3.1ms | 2.8ms |
| Live query update (10k items) | 8.7ms | <span className="bench-winner">8.3ms</span> | 22.2ms | 20.5ms |
| Count operation | 2.0µs | <span className="bench-winner">2.0µs</span> | 7.5µs | 7.0µs |
| Keys operation | <span className="bench-winner">1.8µs</span> | 3.8µs | 11.6µs | 9.6µs |

</div>
{/* BENCH:durable-mode:END */}

<p className="bench-legend">Data: Deno. Only operations where at least one column differs &gt;1.3-1.5× — omitted rows are comparable. See <a href="#detailed-statistics">Detailed Statistics</a> for full data.</p>

</details>

<details>
<summary>Storage Formats: Binary vs JSONL</summary>

GoatDB defaults to **binary format** (`.goat`, fixed-layout binary with
length-prefixed framing). An optional **JSONL** format stores each commit as a
plain-text JSON line, making the database human-readable with `cat`, `jq`, or
any text editor — useful for debugging and data recovery. Only operations where
the formats diverge meaningfully are shown.

{/* BENCH:storage-formats:START */}
<div className="benchmark-table">

| Operation | Binary (default) | JSONL |
|-----------|--------|--------|
| Create instance | <span className="bench-winner">1.2ms</span> | 6.6ms |
| Open database (empty) | <span className="bench-winner">315.5µs</span> | 1.6ms |
| Open database (100k items) | <span className="bench-winner">629.6ms</span> | 929.2ms |
| Create item | 46.7µs | <span className="bench-winner">22.1µs</span> |
| Read item | 1.8µs | <span className="bench-winner">0.6µs</span> |
| Update item | 6.6µs | <span className="bench-winner">2.9µs</span> |
| Read 100k items (cold) | 283.1ms | <span className="bench-winner">104.4ms</span> |
| Count operation | 2.0µs | <span className="bench-winner">0.8µs</span> |
| Keys operation | 3.8µs | <span className="bench-winner">1.7µs</span> |

</div>
{/* BENCH:storage-formats:END */}

<p className="bench-legend">Data: GoatDB on Deno. Only operations where formats diverge &gt;1.3-1.5× — omitted rows are comparable. See <a href="#detailed-statistics">Detailed Statistics</a> for full data.</p>

The binary format (the default) produces smaller files on disk and enables fast
sequential I/O. JSONL is useful for debugging — the log is human-readable with
`cat` or `jq`. As the table above shows, JSONL is currently faster for some
steady-state operations; binary encoding overhead is a known trade-off for
compactness.

</details>

## Methodology

1–20 samples per operation with warmup (most operations use 7–10; live query
updates use 20, except the 10k case which runs once). Comparison tables report
the trimmed mean; the detailed tables below report the raw arithmetic mean plus
median, stddev, and CV — both from the same run, so noisy operations differ
slightly between the two views. The <span className="bench-winner">highlighted
value</span> in each comparison row marks the robust winner — the gap (&gt;1.3×
ms / &gt;1.5× μs) holds even at the edges of measurement noise; all other
values render plain, including statistical ties (ranges overlap), with high
variance flagged by a ±CV suffix.

Operations with fewer than 3 samples should be treated as indicative rather than
precise. In particular, live query update at 10k items runs a single iteration
due to its long execution time.

<details>
<summary>Test environment</summary>

{/* BENCH:methodology-table:START */}
| Platform | Hardware | Runtime |
|----------|----------|---------|
| Deno | Apple M4 Pro, 24GB RAM | deno 2.9.1 (darwin aarch64) |
| Node.js | Apple M4 Pro, 24GB RAM | node v24.14.1 (darwin arm64) |
| Browser | Apple M4 Pro, 24GB RAM (OPFS) | browser Chrome 149.0 (Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36) |
{/* BENCH:methodology-table:END */}

</details>

<details id="detailed-statistics">
<summary>Full statistics per suite</summary>

<Tabs groupId="stats-platform">
<TabItem value="stats-deno" label="Deno" default>

{/* BENCH:stats-deno:START */}
### GoatDB

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 1.2ms | 1.2ms | 217.4µs | 18% | 10 | 811 ops/s |
| Open database (empty) | 315.5µs | 308.6µs | 29.8µs | 9% | 7 | 3K ops/s |
| Open database (100k items) | 629.6ms | 624.3ms | 22.0ms | 3% | 7 | 2 ops/s |
| Create item | 46.7µs | 45.4µs | 12.0µs | 26% | 10 | 21K ops/s |
| Read item | 2.0µs | 1.8µs | 0.7µs | **36%** | 10 | 504K ops/s |
| Update item | 6.6µs | 6.6µs | 1.2µs | 18% | 10 | 152K ops/s |
| Bulk create 100 items | 3.8ms | 3.8ms | 301.5µs | 8% | 10 | 262 ops/s |
| Bulk read 100 items | 172.6µs | 167.1µs | 21.2µs | 12% | 10 | 6K ops/s |
| Write 100k items | 3610.5ms | 3580.2ms | 73.9ms | 2% | 7 | 0 ops/s |
| Read 100k items (cold) | 283.1ms | 283.7ms | 12.3ms | 4% | 7 | 4 ops/s |
| Read 100k items (warm) | 5.8ms | 4.9ms | 2.3ms | **39%** | 7 | 172 ops/s |
| Filter query cold (100 items) | 164.6µs | 32.2µs | 408.9µs | **248%** | 10 | 6K ops/s |
| Filter query warm (100 items) | 1.8µs | 0.3µs | 4.5µs | **253%** | 10 | 567K ops/s |
| Filter query cold (100k → 1k results) | 121.8ms | 121.1ms | 3.1ms | 3% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 1.8µs | 0.8µs | 3.2µs | **177%** | 10 | 553K ops/s |
| Filter query cold (100k → 10k results) | 122.7ms | 122.2ms | 4.2ms | 3% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 1.0µs | 0.3µs | 1.7µs | **177%** | 7 | 1.02M ops/s |
| Filter + sort query cold (100 items) | 54.3µs | 5.8µs | 145.6µs | **268%** | 10 | 18K ops/s |
| Filter + sort query warm (100 items) | 0.6µs | 0.4µs | 0.7µs | **108%** | 10 | 1.58M ops/s |
| Live query update (100 items) | 177.7µs | 166.8µs | 26.4µs | 15% | 20 | 6K ops/s |
| Live query update (1k items) | 940.9µs | 905.3µs | 134.2µs | 14% | 20 | 1K ops/s |
| Live query update (10k items) | 8.3ms | 8.3ms | \<0.1µs | 0% | 1 | 120 ops/s |
| Count operation | 2.0µs | 2.0µs | 0.5µs | 25% | 10 | 508K ops/s |
| Keys operation | 3.8µs | 3.4µs | 1.3µs | 33% | 10 | 263K ops/s |

### GoatDB (Trusted)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 1.1ms | 1.1ms | 214.9µs | 19% | 10 | 900 ops/s |
| Open database (empty) | 349.4µs | 311.2µs | 92.3µs | 26% | 7 | 3K ops/s |
| Open database (100k items) | 751.9ms | 671.9ms | 174.7ms | 23% | 7 | 1 ops/s |
| Create item | 26.3µs | 25.4µs | 3.0µs | 11% | 10 | 38K ops/s |
| Read item | 1.2µs | 1.1µs | 0.4µs | 31% | 10 | 860K ops/s |
| Update item | 3.9µs | 3.8µs | 0.7µs | 17% | 10 | 258K ops/s |
| Bulk create 100 items | 1.1ms | 1.1ms | 107.5µs | 10% | 10 | 886 ops/s |
| Bulk read 100 items | 142.5µs | 139.5µs | 14.2µs | 10% | 10 | 7K ops/s |
| Write 100k items | 704.0ms | 688.5ms | 33.9ms | 5% | 7 | 1 ops/s |
| Read 100k items (cold) | 301.9ms | 289.4ms | 32.0ms | 11% | 7 | 3 ops/s |
| Read 100k items (warm) | 5.4ms | 5.2ms | 792.2µs | 15% | 7 | 185 ops/s |
| Filter query cold (100 items) | 62.0µs | 10.9µs | 154.8µs | **250%** | 10 | 16K ops/s |
| Filter query warm (100 items) | 0.6µs | 0.6µs | 0.4µs | **60%** | 10 | 1.59M ops/s |
| Filter query cold (100k → 1k results) | 111.5ms | 111.2ms | 2.8ms | 3% | 10 | 9 ops/s |
| Filter query warm (100k → 1k results) | 0.8µs | 0.6µs | 0.5µs | **60%** | 10 | 1.20M ops/s |
| Filter query cold (100k → 10k results) | 118.1ms | 119.1ms | 2.0ms | 2% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.5µs | 0.3µs | 0.6µs | **130%** | 7 | 2.05M ops/s |
| Filter + sort query cold (100 items) | 41.0µs | 3.5µs | 107.8µs | **263%** | 10 | 24K ops/s |
| Filter + sort query warm (100 items) | 0.6µs | 0.5µs | 0.4µs | **68%** | 10 | 1.59M ops/s |
| Live query update (100 items) | 163.2µs | 162.3µs | 11.5µs | 7% | 20 | 6K ops/s |
| Live query update (1k items) | 874.8µs | 880.4µs | 56.2µs | 6% | 20 | 1K ops/s |
| Live query update (10k items) | 7.9ms | 7.9ms | \<0.1µs | 0% | 1 | 126 ops/s |
| Count operation | 2.1µs | 1.8µs | 0.7µs | 32% | 10 | 481K ops/s |
| Keys operation | 4.3µs | 2.8µs | 4.5µs | **105%** | 10 | 231K ops/s |

### GoatDB (Durable)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 1.1ms | 990.4µs | 223.1µs | 21% | 10 | 935 ops/s |
| Open database (empty) | 293.8µs | 295.2µs | 26.6µs | 9% | 7 | 3K ops/s |
| Open database (100k items) | 691.3ms | 698.7ms | 15.3ms | 2% | 7 | 1 ops/s |
| Create item | 661.7µs | 649.3µs | 136.3µs | 21% | 10 | 2K ops/s |
| Read item | 1.5µs | 1.5µs | 0.4µs | 24% | 10 | 684K ops/s |
| Update item | 99.6µs | 93.4µs | 23.6µs | 24% | 10 | 10K ops/s |
| Bulk create 100 items | 12.6ms | 12.2ms | 1.5ms | 12% | 10 | 79 ops/s |
| Bulk read 100 items | 144.7µs | 142.2µs | 9.9µs | 7% | 10 | 7K ops/s |
| Write 100k items | 3902.3ms | 3832.0ms | 221.7ms | 6% | 7 | 0 ops/s |
| Read 100k items (cold) | 295.7ms | 294.4ms | 7.3ms | 2% | 7 | 3 ops/s |
| Read 100k items (warm) | 7.4ms | 6.1ms | 3.3ms | **45%** | 7 | 136 ops/s |
| Filter query cold (100 items) | 76.5µs | 10.7µs | 201.6µs | **263%** | 10 | 13K ops/s |
| Filter query warm (100 items) | 0.7µs | 0.5µs | 0.4µs | **63%** | 10 | 1.52M ops/s |
| Filter query cold (100k → 1k results) | 120.0ms | 119.3ms | 2.3ms | 2% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 0.5µs | 0.4µs | 0.3µs | **67%** | 10 | 2.16M ops/s |
| Filter query cold (100k → 10k results) | 125.1ms | 123.9ms | 3.2ms | 3% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 2.4µs | 2.2µs | 1.5µs | **60%** | 7 | 412K ops/s |
| Filter + sort query cold (100 items) | 44.5µs | 3.6µs | 122.6µs | **275%** | 10 | 22K ops/s |
| Filter + sort query warm (100 items) | 1.5µs | 1.6µs | 0.5µs | **34%** | 10 | 686K ops/s |
| Live query update (100 items) | 177.5µs | 165.6µs | 47.6µs | 27% | 20 | 6K ops/s |
| Live query update (1k items) | 951.9µs | 952.3µs | 58.7µs | 6% | 20 | 1K ops/s |
| Live query update (10k items) | 8.7ms | 8.7ms | \<0.1µs | 0% | 1 | 115 ops/s |
| Count operation | 4.5µs | 2.2µs | 5.7µs | **126%** | 10 | 221K ops/s |
| Keys operation | 1.9µs | 1.9µs | 0.4µs | 23% | 10 | 531K ops/s |

### GoatDB JSONL

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 6.6ms | 6.1ms | 4.7ms | **71%** | 10 | 151 ops/s |
| Open database (empty) | 1.6ms | 999.2µs | 1.2ms | **74%** | 7 | 638 ops/s |
| Open database (100k items) | 1015.3ms | 897.7ms | 243.0ms | 24% | 7 | 1 ops/s |
| Create item | 22.1µs | 21.5µs | 3.2µs | 15% | 10 | 45K ops/s |
| Read item | 0.7µs | 0.6µs | 0.2µs | 29% | 10 | 1.53M ops/s |
| Update item | 3.2µs | 2.9µs | 1.3µs | **40%** | 10 | 309K ops/s |
| Bulk create 100 items | 3.7ms | 3.5ms | 620.2µs | 17% | 10 | 271 ops/s |
| Bulk read 100 items | 143.9µs | 138.8µs | 24.5µs | 17% | 10 | 7K ops/s |
| Write 100k items | 3793.2ms | 3721.2ms | 167.9ms | 4% | 7 | 0 ops/s |
| Read 100k items (cold) | 108.9ms | 105.1ms | 12.5ms | 11% | 7 | 9 ops/s |
| Read 100k items (warm) | 11.2ms | 11.6ms | 5.3ms | **47%** | 7 | 89 ops/s |
| Filter query cold (100 items) | 65.9µs | 10.8µs | 165.4µs | **251%** | 10 | 15K ops/s |
| Filter query warm (100 items) | 0.2µs | 0.2µs | 0.1µs | **49%** | 10 | 4.36M ops/s |
| Filter query cold (100k → 1k results) | 127.9ms | 127.8ms | 7.6ms | 6% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 0.2µs | 0.2µs | 0.1µs | **41%** | 10 | 5.57M ops/s |
| Filter query cold (100k → 10k results) | 124.1ms | 123.0ms | 3.0ms | 2% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.2µs | 0.2µs | 0.1µs | **64%** | 7 | 5.60M ops/s |
| Filter + sort query cold (100 items) | 36.6µs | 4.4µs | 94.1µs | **257%** | 10 | 27K ops/s |
| Filter + sort query warm (100 items) | 0.2µs | 0.2µs | 0.1µs | **59%** | 10 | 4.14M ops/s |
| Live query update (100 items) | 160.9µs | 161.0µs | 11.2µs | 7% | 20 | 6K ops/s |
| Live query update (1k items) | 913.8µs | 924.1µs | 50.2µs | 5% | 20 | 1K ops/s |
| Live query update (10k items) | 8.7ms | 8.7ms | \<0.1µs | 0% | 1 | 114 ops/s |
| Count operation | 0.8µs | 0.8µs | 0.1µs | 11% | 10 | 1.22M ops/s |
| Keys operation | 1.7µs | 1.8µs | 0.3µs | 15% | 10 | 580K ops/s |

### SQLite

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 80.2µs | 80.2µs | 7.3µs | 9% | 10 | 12K ops/s |
| Open database (empty) | 368.0µs | 356.8µs | 62.0µs | 17% | 7 | 3K ops/s |
| Open database (100k items) | 116.5µs | 114.8µs | 6.9µs | 6% | 7 | 9K ops/s |
| Create item | 27.1µs | 26.8µs | 3.2µs | 12% | 10 | 37K ops/s |
| Read item | 13.0µs | 12.1µs | 2.5µs | 19% | 10 | 77K ops/s |
| Update item | 22.5µs | 21.6µs | 3.6µs | 16% | 10 | 44K ops/s |
| Bulk create 100 items | 150.2µs | 149.1µs | 4.3µs | 3% | 10 | 7K ops/s |
| Bulk read 100 items | 221.9µs | 218.5µs | 10.0µs | 4% | 10 | 5K ops/s |
| Write 100k items | 171.4ms | 166.7ms | 12.3ms | 7% | 7 | 6 ops/s |
| Read 100k items (cold) | 67.8ms | 67.2ms | 3.3ms | 5% | 7 | 15 ops/s |
| Read 100k items (warm) | 70.8ms | 63.8ms | 15.6ms | 22% | 7 | 14 ops/s |
| Filter query cold (100 items) | 40.3µs | 39.9µs | 3.2µs | 8% | 10 | 25K ops/s |
| Filter query warm (100 items) | 29.2µs | 28.3µs | 2.1µs | 7% | 10 | 34K ops/s |
| Filter query cold (100k → 1k results) | 580.6µs | 571.8µs | 29.8µs | 5% | 10 | 2K ops/s |
| Filter query warm (100k → 1k results) | 524.5µs | 523.5µs | 6.8µs | 1% | 10 | 2K ops/s |
| Filter query cold (100k → 10k results) | 5.8ms | 5.5ms | 701.5µs | 12% | 10 | 173 ops/s |
| Filter query warm (100k → 10k results) | 5.7ms | 5.4ms | 653.5µs | 12% | 10 | 177 ops/s |
| Filter + sort query cold (100 items) | 23.1µs | 22.0µs | 4.5µs | 20% | 10 | 43K ops/s |
| Filter + sort query warm (100 items) | 3.2µs | 2.9µs | 0.8µs | 25% | 10 | 310K ops/s |
| Live query update (100 items) | 920.1µs | 920.5µs | 43.4µs | 5% | 20 | 1K ops/s |
| Live query update (1k items) | 3.3ms | 3.2ms | 431.9µs | 13% | 20 | 307 ops/s |
| Live query update (10k items) | 22.2ms | 21.1ms | 4.1ms | 19% | 20 | 45 ops/s |
| Count operation | 7.9µs | 7.5µs | 1.6µs | 20% | 10 | 126K ops/s |
| Keys operation | 12.4µs | 10.9µs | 2.9µs | 24% | 10 | 81K ops/s |

### SQLite Fast-Unsafe

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 79.2µs | 77.2µs | 9.6µs | 12% | 10 | 13K ops/s |
| Open database (empty) | 133.7µs | 133.8µs | 18.9µs | 14% | 7 | 7K ops/s |
| Open database (100k items) | 172.8µs | 150.4µs | 49.7µs | 29% | 7 | 6K ops/s |
| Create item | 13.9µs | 13.0µs | 3.5µs | 25% | 10 | 72K ops/s |
| Read item | 10.2µs | 9.6µs | 2.0µs | 20% | 10 | 98K ops/s |
| Update item | 10.6µs | 10.3µs | 1.1µs | 10% | 10 | 94K ops/s |
| Bulk create 100 items | 135.8µs | 132.3µs | 8.9µs | 7% | 10 | 7K ops/s |
| Bulk read 100 items | 147.4µs | 146.9µs | 11.1µs | 8% | 10 | 7K ops/s |
| Write 100k items | 143.8ms | 138.9ms | 11.3ms | 8% | 7 | 7 ops/s |
| Read 100k items (cold) | 172.0ms | 67.0ms | 274.1ms | **159%** | 7 | 6 ops/s |
| Read 100k items (warm) | 63.5ms | 61.5ms | 3.8ms | 6% | 7 | 16 ops/s |
| Filter query cold (100 items) | 36.6µs | 36.6µs | 3.6µs | 10% | 10 | 27K ops/s |
| Filter query warm (100 items) | 25.9µs | 25.4µs | 1.1µs | 4% | 10 | 39K ops/s |
| Filter query cold (100k → 1k results) | 1.0ms | 558.3µs | 1.5ms | **141%** | 10 | 974 ops/s |
| Filter query warm (100k → 1k results) | 520.9µs | 507.6µs | 24.5µs | 5% | 10 | 2K ops/s |
| Filter query cold (100k → 10k results) | 6.0ms | 5.4ms | 1.5ms | 25% | 10 | 166 ops/s |
| Filter query warm (100k → 10k results) | 5.3ms | 5.1ms | 564.0µs | 11% | 10 | 189 ops/s |
| Filter + sort query cold (100 items) | 20.2µs | 18.2µs | 5.7µs | 28% | 10 | 49K ops/s |
| Filter + sort query warm (100 items) | 2.2µs | 1.9µs | 0.9µs | **39%** | 10 | 447K ops/s |
| Live query update (100 items) | 798.6µs | 792.8µs | 47.1µs | 6% | 20 | 1K ops/s |
| Live query update (1k items) | 2.8ms | 2.9ms | 264.1µs | 9% | 20 | 353 ops/s |
| Live query update (10k items) | 20.5ms | 20.2ms | 3.0ms | 14% | 20 | 49 ops/s |
| Count operation | 7.0µs | 6.8µs | 1.2µs | 18% | 10 | 144K ops/s |
| Keys operation | 9.6µs | 9.3µs | 1.5µs | 15% | 10 | 104K ops/s |
{/* BENCH:stats-deno:END */}

</TabItem>
<TabItem value="stats-node" label="Node.js">

{/* BENCH:stats-node:START */}
### GoatDB

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 998.8µs | 982.3µs | 95.9µs | 10% | 10 | 1K ops/s |
| Open database (empty) | 314.3µs | 315.8µs | 17.2µs | 5% | 7 | 3K ops/s |
| Open database (100k items) | 693.0ms | 688.3ms | 18.9ms | 3% | 7 | 1 ops/s |
| Create item | 42.9µs | 42.6µs | 11.9µs | 28% | 10 | 23K ops/s |
| Read item | 1.6µs | 1.4µs | 0.5µs | 32% | 10 | 627K ops/s |
| Update item | 7.2µs | 7.3µs | 1.0µs | 14% | 10 | 138K ops/s |
| Bulk create 100 items | 4.3ms | 4.2ms | 342.6µs | 8% | 10 | 234 ops/s |
| Bulk read 100 items | 167.3µs | 163.6µs | 19.9µs | 12% | 10 | 6K ops/s |
| Write 100k items | 4533.8ms | 4527.0ms | 60.1ms | 1% | 7 | 0 ops/s |
| Read 100k items (cold) | 303.4ms | 302.5ms | 3.1ms | 1% | 7 | 3 ops/s |
| Read 100k items (warm) | 9.9ms | 9.8ms | 2.1ms | 22% | 7 | 102 ops/s |
| Filter query cold (100 items) | 163.7µs | 32.5µs | 393.8µs | **241%** | 10 | 6K ops/s |
| Filter query warm (100 items) | 1.9µs | 0.8µs | 3.7µs | **200%** | 10 | 537K ops/s |
| Filter query cold (100k → 1k results) | 130.9ms | 130.7ms | 4.8ms | 4% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 0.5µs | 0.4µs | 0.3µs | **53%** | 10 | 1.90M ops/s |
| Filter query cold (100k → 10k results) | 144.1ms | 144.0ms | 3.4ms | 2% | 7 | 7 ops/s |
| Filter query warm (100k → 10k results) | 1.2µs | 0.3µs | 2.1µs | **177%** | 7 | 823K ops/s |
| Filter + sort query cold (100 items) | 61.8µs | 7.4µs | 164.3µs | **266%** | 10 | 16K ops/s |
| Filter + sort query warm (100 items) | 0.6µs | 0.6µs | 0.3µs | **54%** | 10 | 1.67M ops/s |
| Live query update (100 items) | 198.4µs | 193.3µs | 21.1µs | 11% | 20 | 5K ops/s |
| Live query update (1k items) | 1.0ms | 999.3µs | 198.1µs | 19% | 20 | 952 ops/s |
| Live query update (10k items) | 7.7ms | 7.7ms | \<0.1µs | 0% | 1 | 131 ops/s |
| Count operation | 2.4µs | 2.0µs | 1.0µs | **42%** | 10 | 426K ops/s |
| Keys operation | 4.5µs | 3.9µs | 1.8µs | **39%** | 10 | 223K ops/s |

### GoatDB (Trusted)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 898.0µs | 859.9µs | 119.0µs | 13% | 10 | 1K ops/s |
| Open database (empty) | 364.3µs | 292.4µs | 196.2µs | **54%** | 7 | 3K ops/s |
| Open database (100k items) | 684.6ms | 677.0ms | 36.5ms | 5% | 7 | 1 ops/s |
| Create item | 21.3µs | 21.2µs | 4.6µs | 22% | 10 | 47K ops/s |
| Read item | 0.6µs | 0.6µs | 0.2µs | 33% | 10 | 1.55M ops/s |
| Update item | 2.9µs | 2.8µs | 0.4µs | 14% | 10 | 347K ops/s |
| Bulk create 100 items | 837.0µs | 826.7µs | 54.0µs | 6% | 10 | 1K ops/s |
| Bulk read 100 items | 129.3µs | 124.4µs | 11.5µs | 9% | 10 | 8K ops/s |
| Write 100k items | 814.6ms | 749.7ms | 93.2ms | 11% | 7 | 1 ops/s |
| Read 100k items (cold) | 317.3ms | 318.4ms | 10.4ms | 3% | 7 | 3 ops/s |
| Read 100k items (warm) | 7.6ms | 7.2ms | 1.5ms | 19% | 7 | 131 ops/s |
| Filter query cold (100 items) | 62.2µs | 15.0µs | 142.3µs | **229%** | 10 | 16K ops/s |
| Filter query warm (100 items) | 0.4µs | 0.4µs | 0.2µs | **60%** | 10 | 2.50M ops/s |
| Filter query cold (100k → 1k results) | 133.4ms | 132.7ms | 5.5ms | 4% | 10 | 7 ops/s |
| Filter query warm (100k → 1k results) | 0.5µs | 0.4µs | 0.3µs | **65%** | 10 | 1.97M ops/s |
| Filter query cold (100k → 10k results) | 141.2ms | 140.7ms | 4.1ms | 3% | 7 | 7 ops/s |
| Filter query warm (100k → 10k results) | 0.7µs | 0.3µs | 0.7µs | **98%** | 7 | 1.45M ops/s |
| Filter + sort query cold (100 items) | 36.7µs | 4.2µs | 97.4µs | **265%** | 10 | 27K ops/s |
| Filter + sort query warm (100 items) | 0.5µs | 0.4µs | 0.3µs | **68%** | 10 | 2.07M ops/s |
| Live query update (100 items) | 197.7µs | 192.5µs | 18.2µs | 9% | 20 | 5K ops/s |
| Live query update (1k items) | 869.1µs | 870.2µs | 84.1µs | 10% | 20 | 1K ops/s |
| Live query update (10k items) | 7.3ms | 7.3ms | \<0.1µs | 0% | 1 | 138 ops/s |
| Count operation | 1.9µs | 1.7µs | 0.4µs | 20% | 10 | 536K ops/s |
| Keys operation | 2.4µs | 2.3µs | 0.4µs | 19% | 10 | 423K ops/s |

### GoatDB (Durable)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 907.0µs | 860.3µs | 141.1µs | 16% | 10 | 1K ops/s |
| Open database (empty) | 277.3µs | 274.2µs | 30.0µs | 11% | 7 | 4K ops/s |
| Open database (100k items) | 727.0ms | 732.6ms | 22.9ms | 3% | 7 | 1 ops/s |
| Create item | 368.2µs | 366.1µs | 27.7µs | 8% | 10 | 3K ops/s |
| Read item | 1.1µs | 0.9µs | 0.4µs | **34%** | 10 | 949K ops/s |
| Update item | 108.0µs | 104.5µs | 15.6µs | 14% | 10 | 9K ops/s |
| Bulk create 100 items | 13.8ms | 13.3ms | 1.4ms | 10% | 10 | 73 ops/s |
| Bulk read 100 items | 142.2µs | 144.4µs | 8.5µs | 6% | 10 | 7K ops/s |
| Write 100k items | 4746.4ms | 4747.1ms | 54.6ms | 1% | 7 | 0 ops/s |
| Read 100k items (cold) | 344.0ms | 328.6ms | 39.2ms | 11% | 7 | 3 ops/s |
| Read 100k items (warm) | 9.9ms | 9.4ms | 1.9ms | 19% | 7 | 101 ops/s |
| Filter query cold (100 items) | 64.9µs | 15.2µs | 149.8µs | **231%** | 10 | 15K ops/s |
| Filter query warm (100 items) | 0.4µs | 0.3µs | 0.3µs | **82%** | 10 | 2.43M ops/s |
| Filter query cold (100k → 1k results) | 133.7ms | 132.7ms | 6.0ms | 4% | 10 | 7 ops/s |
| Filter query warm (100k → 1k results) | 0.4µs | 0.2µs | 0.2µs | **67%** | 10 | 2.73M ops/s |
| Filter query cold (100k → 10k results) | 141.5ms | 142.5ms | 3.2ms | 2% | 7 | 7 ops/s |
| Filter query warm (100k → 10k results) | 0.7µs | 0.4µs | 0.5µs | **82%** | 7 | 1.50M ops/s |
| Filter + sort query cold (100 items) | 49.5µs | 4.2µs | 135.8µs | **274%** | 10 | 20K ops/s |
| Filter + sort query warm (100 items) | 0.3µs | 0.2µs | 0.3µs | **101%** | 10 | 2.89M ops/s |
| Live query update (100 items) | 224.5µs | 220.6µs | 19.2µs | 9% | 20 | 4K ops/s |
| Live query update (1k items) | 1.1ms | 1.1ms | 172.6µs | 16% | 20 | 907 ops/s |
| Live query update (10k items) | 8.0ms | 8.0ms | \<0.1µs | 0% | 1 | 124 ops/s |
| Count operation | 2.8µs | 1.3µs | 4.1µs | **147%** | 10 | 363K ops/s |
| Keys operation | 1.8µs | 1.7µs | 0.2µs | 12% | 10 | 548K ops/s |

### GoatDB JSONL

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 955.6µs | 830.8µs | 397.4µs | **42%** | 10 | 1K ops/s |
| Open database (empty) | 253.9µs | 249.4µs | 17.2µs | 7% | 7 | 4K ops/s |
| Open database (100k items) | 874.2ms | 867.5ms | 66.4ms | 8% | 7 | 1 ops/s |
| Create item | 21.0µs | 20.5µs | 3.2µs | 15% | 10 | 48K ops/s |
| Read item | 0.7µs | 0.7µs | 0.2µs | 26% | 10 | 1.42M ops/s |
| Update item | 3.1µs | 3.2µs | 0.5µs | 17% | 10 | 322K ops/s |
| Bulk create 100 items | 4.3ms | 4.2ms | 619.5µs | 14% | 10 | 231 ops/s |
| Bulk read 100 items | 144.9µs | 132.8µs | 36.7µs | 25% | 10 | 7K ops/s |
| Write 100k items | 4990.7ms | 4940.1ms | 169.9ms | 3% | 7 | 0 ops/s |
| Read 100k items (cold) | 183.9ms | 144.4ms | 57.4ms | 31% | 7 | 5 ops/s |
| Read 100k items (warm) | 10.7ms | 10.0ms | 2.6ms | 24% | 7 | 93 ops/s |
| Filter query cold (100 items) | 71.2µs | 15.3µs | 168.8µs | **237%** | 10 | 14K ops/s |
| Filter query warm (100 items) | 0.1µs | 0.1µs | 0.1µs | **100%** | 10 | 7.51M ops/s |
| Filter query cold (100k → 1k results) | 142.9ms | 143.5ms | 4.7ms | 3% | 10 | 7 ops/s |
| Filter query warm (100k → 1k results) | 0.3µs | 0.3µs | 0.1µs | **44%** | 10 | 3.75M ops/s |
| Filter query cold (100k → 10k results) | 191.2ms | 157.2ms | 80.2ms | **42%** | 7 | 5 ops/s |
| Filter query warm (100k → 10k results) | 0.2µs | 0.1µs | 0.3µs | **148%** | 7 | 4.94M ops/s |
| Filter + sort query cold (100 items) | 51.3µs | 5.6µs | 132.3µs | **258%** | 10 | 19K ops/s |
| Filter + sort query warm (100 items) | 0.2µs | 0.2µs | 0.2µs | **66%** | 10 | 4.36M ops/s |
| Live query update (100 items) | 190.5µs | 185.6µs | 26.0µs | 14% | 20 | 5K ops/s |
| Live query update (1k items) | 974.6µs | 973.4µs | 67.3µs | 7% | 20 | 1K ops/s |
| Live query update (10k items) | 14.9ms | 14.9ms | \<0.1µs | 0% | 1 | 67 ops/s |
| Count operation | 2.3µs | 2.1µs | 0.7µs | 29% | 10 | 441K ops/s |
| Keys operation | 2.7µs | 2.5µs | 0.7µs | 26% | 10 | 373K ops/s |

### SQLite

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 70.5µs | 64.7µs | 14.9µs | 21% | 10 | 14K ops/s |
| Open database (empty) | 309.8µs | 306.0µs | 25.6µs | 8% | 7 | 3K ops/s |
| Open database (100k items) | 98.2µs | 97.7µs | 5.6µs | 6% | 7 | 10K ops/s |
| Create item | 23.2µs | 22.6µs | 2.8µs | 12% | 10 | 43K ops/s |
| Read item | 8.9µs | 9.4µs | 1.4µs | 16% | 10 | 112K ops/s |
| Update item | 18.9µs | 17.4µs | 4.3µs | 23% | 10 | 53K ops/s |
| Bulk create 100 items | 85.0µs | 83.9µs | 4.1µs | 5% | 10 | 12K ops/s |
| Bulk read 100 items | 161.6µs | 161.5µs | 8.7µs | 5% | 10 | 6K ops/s |
| Write 100k items | 100.3ms | 99.6ms | 3.9ms | 4% | 7 | 10 ops/s |
| Read 100k items (cold) | 38.8ms | 35.8ms | 9.5ms | 25% | 7 | 26 ops/s |
| Read 100k items (warm) | 33.4ms | 33.0ms | 1.5ms | 5% | 7 | 30 ops/s |
| Filter query cold (100 items) | 21.4µs | 21.1µs | 2.2µs | 10% | 10 | 47K ops/s |
| Filter query warm (100 items) | 14.0µs | 13.6µs | 0.9µs | 6% | 10 | 71K ops/s |
| Filter query cold (100k → 1k results) | 302.7µs | 302.6µs | 9.9µs | 3% | 10 | 3K ops/s |
| Filter query warm (100k → 1k results) | 277.9µs | 267.2µs | 33.5µs | 12% | 10 | 4K ops/s |
| Filter query cold (100k → 10k results) | 3.1ms | 2.8ms | 648.5µs | 21% | 10 | 326 ops/s |
| Filter query warm (100k → 10k results) | 2.8ms | 2.7ms | 66.9µs | 2% | 10 | 364 ops/s |
| Filter + sort query cold (100 items) | 17.9µs | 17.6µs | 3.3µs | 18% | 10 | 56K ops/s |
| Filter + sort query warm (100 items) | 2.5µs | 2.0µs | 1.1µs | **45%** | 10 | 399K ops/s |
| Live query update (100 items) | 564.8µs | 553.0µs | 41.1µs | 7% | 20 | 2K ops/s |
| Live query update (1k items) | 2.1ms | 2.0ms | 557.0µs | 26% | 20 | 469 ops/s |
| Live query update (10k items) | 13.1ms | 13.1ms | 2.5ms | 19% | 20 | 77 ops/s |
| Count operation | 7.1µs | 7.2µs | 2.2µs | 31% | 10 | 140K ops/s |
| Keys operation | 11.0µs | 11.0µs | 2.4µs | 22% | 10 | 91K ops/s |

### SQLite Fast-Unsafe

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 88.7µs | 80.0µs | 23.1µs | 26% | 10 | 11K ops/s |
| Open database (empty) | 102.3µs | 99.2µs | 17.3µs | 17% | 7 | 10K ops/s |
| Open database (100k items) | 201.3µs | 128.6µs | 198.8µs | **99%** | 7 | 5K ops/s |
| Create item | 9.4µs | 8.8µs | 2.7µs | 29% | 10 | 107K ops/s |
| Read item | 8.1µs | 8.0µs | 2.5µs | 31% | 10 | 123K ops/s |
| Update item | 7.7µs | 7.2µs | 1.5µs | 20% | 10 | 130K ops/s |
| Bulk create 100 items | 70.3µs | 71.5µs | 3.4µs | 5% | 10 | 14K ops/s |
| Bulk read 100 items | 105.0µs | 105.6µs | 6.3µs | 6% | 10 | 10K ops/s |
| Write 100k items | 85.5ms | 84.4ms | 2.7ms | 3% | 7 | 12 ops/s |
| Read 100k items (cold) | 36.3ms | 36.3ms | 863.2µs | 2% | 7 | 28 ops/s |
| Read 100k items (warm) | 32.9ms | 32.2ms | 1.7ms | 5% | 7 | 30 ops/s |
| Filter query cold (100 items) | 23.5µs | 21.8µs | 3.7µs | 16% | 10 | 43K ops/s |
| Filter query warm (100 items) | 14.7µs | 14.1µs | 1.7µs | 11% | 10 | 68K ops/s |
| Filter query cold (100k → 1k results) | 282.1µs | 281.8µs | 5.7µs | 2% | 10 | 4K ops/s |
| Filter query warm (100k → 1k results) | 265.4µs | 264.8µs | 3.5µs | 1% | 10 | 4K ops/s |
| Filter query cold (100k → 10k results) | 3.0ms | 2.8ms | 767.2µs | 25% | 10 | 332 ops/s |
| Filter query warm (100k → 10k results) | 2.7ms | 2.7ms | 49.5µs | 2% | 10 | 370 ops/s |
| Filter + sort query cold (100 items) | 14.0µs | 12.6µs | 3.9µs | 28% | 10 | 71K ops/s |
| Filter + sort query warm (100 items) | 1.4µs | 1.1µs | 0.7µs | **51%** | 10 | 729K ops/s |
| Live query update (100 items) | 460.1µs | 458.7µs | 20.9µs | 5% | 20 | 2K ops/s |
| Live query update (1k items) | 1.9ms | 1.8ms | 496.1µs | 26% | 20 | 524 ops/s |
| Live query update (10k items) | 12.0ms | 11.9ms | 1.3ms | 11% | 20 | 83 ops/s |
| Count operation | 6.3µs | 5.6µs | 2.2µs | **35%** | 10 | 160K ops/s |
| Keys operation | 9.2µs | 8.3µs | 2.9µs | 32% | 10 | 109K ops/s |
{/* BENCH:stats-node:END */}

</TabItem>
<TabItem value="stats-browser" label="Browser">

{/* BENCH:stats-browser:START */}
### GoatDB

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 12.1ms | 12.2ms | 711.7µs | 6% | 10 | 83 ops/s |
| Open database (empty) | 1.7ms | 1.7ms | 114.9µs | 7% | 7 | 577 ops/s |
| Open database (100k items) | 647.2ms | 651.7ms | 14.1ms | 2% | 7 | 2 ops/s |
| Create item | 52.0µs | 52.5µs | 11.6µs | 22% | 10 | 19K ops/s |
| Read item | 1.5µs | \<0.1µs | 2.4µs | **161%** | 10 | 667K ops/s |
| Update item | 7.0µs | 5.0µs | 2.6µs | **37%** | 10 | 143K ops/s |
| Bulk create 100 items | 4.3ms | 4.3ms | 184.2µs | 4% | 10 | 231 ops/s |
| Bulk read 100 items | 193.0µs | 187.5µs | 15.3µs | 8% | 10 | 5K ops/s |
| Read 100k items (cold) | 249.4ms | 237.3ms | 31.8ms | 13% | 7 | 4 ops/s |
| Read 100k items (warm) | 5.3ms | 4.9ms | 849.6µs | 16% | 7 | 187 ops/s |
| Filter query cold (100 items) | 243.5µs | 30.0µs | 663.1µs | **272%** | 10 | 4K ops/s |
| Filter query warm (100 items) | 2.0µs | \<0.1µs | 4.8µs | **242%** | 10 | 500K ops/s |
| Filter query cold (100k → 1k results) | 631.1ms | 629.5ms | 14.8ms | 2% | 10 | 2 ops/s |
| Filter query warm (100k → 1k results) | 0.5µs | \<0.1µs | 1.6µs | **316%** | 10 | 2.00M ops/s |
| Filter query cold (100k → 10k results) | 633.3ms | 630.8ms | 11.3ms | 2% | 7 | 2 ops/s |
| Filter query warm (100k → 10k results) | 0.7µs | \<0.1µs | 1.9µs | **265%** | 7 | 1.40M ops/s |
| Filter + sort query cold (100 items) | 168.0µs | 5.0µs | 506.7µs | **302%** | 10 | 6K ops/s |
| Filter + sort query warm (100 items) | 0.5µs | \<0.1µs | 1.6µs | **316%** | 10 | 2.00M ops/s |
| Live query update (100 items) | 208.5µs | 180.0µs | 47.5µs | 23% | 20 | 5K ops/s |
| Live query update (1k items) | 1.5ms | 1.5ms | 236.7µs | 16% | 20 | 661 ops/s |
| Live query update (10k items) | 44.7ms | 44.7ms | \<0.1µs | 0% | 1 | 22 ops/s |
| Count operation | 2.0µs | \<0.1µs | 3.5µs | **175%** | 10 | 500K ops/s |
| Keys operation | 5.0µs | 5.0µs | 3.3µs | **67%** | 10 | 200K ops/s |

### GoatDB JSONL

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 12.3ms | 11.5ms | 2.0ms | 17% | 10 | 81 ops/s |
| Open database (empty) | 2.3ms | 1.8ms | 1.1ms | **48%** | 7 | 430 ops/s |
| Open database (100k items) | 968.3ms | 943.3ms | 112.0ms | 12% | 7 | 1 ops/s |
| Create item | 30.5µs | 30.0µs | 2.8µs | 9% | 10 | 33K ops/s |
| Read item | 1.5µs | \<0.1µs | 2.4µs | **161%** | 10 | 667K ops/s |
| Update item | 6.0µs | 5.0µs | 3.2µs | **53%** | 10 | 167K ops/s |
| Bulk create 100 items | 4.3ms | 4.3ms | 109.2µs | 3% | 10 | 234 ops/s |
| Bulk read 100 items | 159.5µs | 160.0µs | 6.4µs | 4% | 10 | 6K ops/s |
| Read 100k items (cold) | 83.9ms | 82.2ms | 4.4ms | 5% | 7 | 12 ops/s |
| Read 100k items (warm) | 5.2ms | 4.7ms | 1.2ms | 23% | 7 | 193 ops/s |
| Filter query cold (100 items) | 188.0µs | 15.0µs | 540.1µs | **287%** | 10 | 5K ops/s |
| Filter query warm (100 items) | 1.0µs | \<0.1µs | 2.1µs | **211%** | 10 | 1.00M ops/s |
| Filter query cold (100k → 1k results) | 626.5ms | 621.1ms | 16.3ms | 3% | 10 | 2 ops/s |
| Filter query warm (100k → 1k results) | 0.5µs | \<0.1µs | 1.6µs | **316%** | 10 | 2.00M ops/s |
| Filter query cold (100k → 10k results) | 631.6ms | 627.5ms | 22.8ms | 4% | 7 | 2 ops/s |
| Filter query warm (100k → 10k results) | 0.7µs | \<0.1µs | 1.9µs | **265%** | 7 | 1.40M ops/s |
| Filter + sort query cold (100 items) | 109.5µs | 5.0µs | 327.1µs | **299%** | 10 | 9K ops/s |
| Filter + sort query warm (100 items) | 1.0µs | \<0.1µs | 2.1µs | **211%** | 10 | 1.00M ops/s |
| Live query update (100 items) | 177.2µs | 165.0µs | 29.4µs | 17% | 20 | 6K ops/s |
| Live query update (1k items) | 1.4ms | 1.4ms | 211.3µs | 15% | 20 | 694 ops/s |
| Live query update (10k items) | 41.9ms | 41.9ms | \<0.1µs | 0% | 1 | 24 ops/s |
| Count operation | 2.0µs | \<0.1µs | 2.6µs | **129%** | 10 | 500K ops/s |
| Keys operation | 3.5µs | 5.0µs | 3.4µs | **96%** | 10 | 286K ops/s |

### SQLite

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 11.6ms | 11.5ms | 918.0µs | 8% | 10 | 86 ops/s |
| Open database (empty) | 1.4µs | \<0.1µs | 2.4µs | **171%** | 7 | 700K ops/s |
| Open database (100k items) | 2.9ms | 3.0ms | 229.0µs | 8% | 7 | 340 ops/s |
| Create item | 4.5ms | 4.5ms | 225.9µs | 5% | 10 | 221 ops/s |
| Read item | 576.5µs | 507.5µs | 188.8µs | 33% | 10 | 2K ops/s |
| Update item | 3.7ms | 3.7ms | 240.1µs | 6% | 10 | 268 ops/s |
| Bulk create 100 items | 7.3ms | 7.3ms | 243.0µs | 3% | 10 | 136 ops/s |
| Bulk read 100 items | 45.6ms | 44.5ms | 3.7ms | 8% | 10 | 22 ops/s |
| Read 100k items (cold) | 389.8ms | 389.3ms | 5.5ms | 1% | 7 | 3 ops/s |
| Read 100k items (warm) | 335.1ms | 333.2ms | 3.4ms | 1% | 7 | 3 ops/s |
| Filter query cold (100 items) | 621.5µs | 617.5µs | 37.6µs | 6% | 10 | 2K ops/s |
| Filter query warm (100 items) | 579.0µs | 565.0µs | 75.2µs | 13% | 10 | 2K ops/s |
| Filter query cold (100k → 1k results) | 4.1ms | 4.0ms | 163.7µs | 4% | 10 | 245 ops/s |
| Filter query warm (100k → 1k results) | 3.2ms | 3.1ms | 299.9µs | 9% | 10 | 315 ops/s |
| Filter query cold (100k → 10k results) | 36.6ms | 36.5ms | 783.1µs | 2% | 10 | 27 ops/s |
| Filter query warm (100k → 10k results) | 28.8ms | 28.4ms | 1.1ms | 4% | 10 | 35 ops/s |
| Filter + sort query cold (100 items) | 538.0µs | 537.5µs | 35.3µs | 7% | 10 | 2K ops/s |
| Filter + sort query warm (100 items) | 456.5µs | 445.0µs | 33.2µs | 7% | 10 | 2K ops/s |
| Live query update (100 items) | 489.5ms | 460.9ms | 89.1ms | 18% | 20 | 2 ops/s |
| Live query update (1k items) | 4558.0ms | 4536.7ms | 74.9ms | 2% | 20 | 0 ops/s |
| Live query update (10k items) | 45467.3ms | 45475.8ms | 168.4ms | 0% | 20 | — |
| Count operation | 473.5µs | 455.0µs | 51.7µs | 11% | 10 | 2K ops/s |
| Keys operation | 486.5µs | 480.0µs | 28.1µs | 6% | 10 | 2K ops/s |
{/* BENCH:stats-browser:END */}

</TabItem>
</Tabs>

</details>

## Benchmark Scope

The benchmarks on this page measure **local, single-machine operations** —
reads, writes, queries, and startup costs — comparing GoatDB against SQLite on
the same hardware. They do **not** measure distributed performance.

Distributed/continuity benchmarks (sync latency under partition, multi-peer
convergence, recovery from replicas, offline-to-online catch-up) are planned but
do not yet have results. See the section below.

SQLite and storage-format comparisons are presented as engineering evidence; the
primary value proposition is GoatDB's sync, provenance, and authorization
capabilities, not raw single-node throughput.

## Continuity Benchmarks (Future)

The following benchmark suites are planned. No results are available yet.

### Sync Latency

- Local mutation latency
- Remote wake and sync fan-out P50/P95/P99

### Reconnect and Recovery

- Late-join catch-up after partition of varying duration (30s, 5min, 1hr)
- Server heal from available authorized replicas
- Signed provenance verification throughput

### Multi-Peer Scenarios

- N humans + agents + devices concurrently editing
- Concurrent convergence under contention
- Dropped, reordered, and duplicated network conditions

### Scalability

- Crash recovery under load
- N simultaneous peers (10, 100, 500)

## Running Your Own Benchmarks

```bash
git clone https://github.com/goatplatform/goatdb
cd goatdb
deno task bench
```

The benchmark suite runs on Deno, Node.js, and browser automatically.
