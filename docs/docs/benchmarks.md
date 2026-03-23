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

## A Third Category of Database

Traditional databases fall into two camps. **Remote databases** (PostgreSQL, Redis) store data on a server — every read and every write crosses the network. A single-row lookup costs 1–5ms in the same datacenter, 10–50ms from a browser. **Embedded databases** (SQLite) eliminate the network by running in-process — reads drop to ~15μs — but they offer no sync, no collaboration, and no security primitives.

GoatDB is a third option: an **embedded database with built-in peer-to-peer sync** whose memory model mirrors how desktop apps handle files. When your app opens a [repository](/docs/repositories), the full dataset loads into memory — like a word processor opening a document. After that one-time cost, reads complete in ~1μs with no network hop and no disk I/O. The app explicitly controls which repositories are in memory by opening and closing them, the same way users open and close files. Explicit user interactions — opening a project, switching a workspace, loading a document — map directly to `db.open()` and `db.closeRepo()` calls, so the startup cost is expected and bounded. [Sync](/docs/sync), [conflict resolution](/docs/conflict-resolution), and [cryptographic signing](/docs/sessions) run entirely in the background. The network never appears in your hot path.

The table below places GoatDB alongside the databases it draws from. The benchmark sections that follow compare GoatDB head-to-head with SQLite — the only other embedded database that runs across server, browser, and edge.

| | GoatDB | SQLite | Redis | PostgreSQL |
|---|---|---|---|---|
| **Category** | Embedded, memory-first, syncing | Embedded, local-only | Remote, in-memory | Remote, disk-based |
| **Read latency** | ~1μs (memory lookup) | ~15μs (FFI + B-tree) | ~50-200μs P50 (same datacenter) | 1–5ms (network + query) |
| **Runs in browser** | Yes (OPFS) | Yes (WASM) | No | No |
| **Built-in sync** | [Multi-peer CRDT](/docs/sync) | None | Pub/sub (no CRDT) | Logical replication |
| **Offline support** | Full read/write | Full read/write | None | None |
| **Memory model** | Open repos load fully into RAM, like opening a file; app explicitly controls which repos are loaded | Disk-backed, pages on demand | Entire dataset in RAM | Disk-backed, pages on demand |
| **Data model** | [Commit graph](/docs/commit-graph) with [CRDT conflict resolution](/docs/conflict-resolution) | B-tree + ACID transactions | Key-value / streams | Relational + ACID |

Redis and PostgreSQL are not benchmarked here — they require a network hop per operation, making direct comparison misleading. Reference latency from published production data: Redis ([oneuptime.com 2026](https://oneuptime.com/blog/post/2026-01-21-redis-reduce-latency/view), [centminmod 2025](https://github.com/centminmod/redis-comparison-benchmarks)), PostgreSQL ([integrate.io 2026](https://www.integrate.io/blog/database-replication-speed-metrics)). Add 10–50ms from a browser or across regions.

## Head-to-Head: GoatDB vs SQLite

Both databases in their recommended production configurations: GoatDB with cryptographic signing and relaxed durability (crash-safe via [append-only log](/docs/repositories)), SQLite with WAL mode and `synchronous=NORMAL`. Color coding: <span className="bench-excels">green = meaningfully faster</span>, <span className="bench-tradeoff">amber = meaningfully slower</span>, <span className="bench-tie">grey = statistical tie</span> (variance makes winner uncertain). Reproduce locally: `deno task bench`

### Query Operations Explained

The query benchmarks test three distinct capabilities:

**Filter queries** are benchmarked in two configurations:

- **Cold** — first-access cost: GoatDB creates a new query object and performs a full O(n) scan evaluating a JavaScript predicate per item; SQLite creates a new connection and runs an equivalent `WHERE` clause. This represents the worst case: no caching, no reuse.
- **Warm** — repeated-access cost: GoatDB reuses the same live query instance (pooled by config hash) and returns its age-tracked frozen result array in O(1) when no data has changed; SQLite reuses a persistent connection with a prepared statement and a warm OS page cache. This represents steady-state performance after the first access.

The parenthetical shows dataset size and result count — e.g., "100k → 1k results" scans 100,000 items cold and returns 1,000 matches; warm, it returns the same 1,000 items directly from cache with no scan.

**Filter + sort** adds a custom sort comparator on top of predicate filtering (GoatDB) or `ORDER BY` (SQLite), measuring the combined cost. Same cold/warm split applies.

**Live query updates** measure reactive performance: a query is subscribed to a 100k-item dataset, then N items are modified across the predicate boundary, and the query results are refreshed. The measurement includes both write latency (N commits/UPDATEs) and query refresh time. In GoatDB, queries subscribe to changes and update incrementally via event propagation. In SQLite, the equivalent is N UPDATE statements followed by a full re-query — there is no subscription mechanism. In the browser, GoatDB queries yield cooperatively to keep the UI at 60fps, so wall-clock time includes scheduling overhead.

### Server (Deno / Node.js)

{/* BENCH:server-comparison:START */}
<div className="benchmark-table">

| Operation | GoatDB | SQLite |
|-----------|--------|--------|
| Create instance | <span className="bench-tradeoff">1.3ms</span> | <span className="bench-excels">73.7µs</span> |
| Open database (empty) | 437.7µs | 333.6µs |
| Open database (100k items) | <span className="bench-tradeoff">643.7ms</span> | <span className="bench-excels">130.4µs</span> |
| Create item | 35.6µs | 24.3µs |
| Read item | <span className="bench-excels">1.3µs</span> | <span className="bench-tradeoff">10.2µs</span> |
| Update item | <span className="bench-excels">6.3µs</span> | <span className="bench-tradeoff">17.9µs</span> |
| Bulk create 100 items | <span className="bench-tradeoff">2.8ms</span> | <span className="bench-excels">143.4µs</span> |
| Bulk read 100 items | 162.1µs | 238.1µs |
| Write 100k items | <span className="bench-tradeoff">2615.1ms</span> | <span className="bench-excels">153.3ms</span> |
| Read 100k items (cold) | <span className="bench-tradeoff">278.5ms</span> | <span className="bench-excels">69.9ms</span> |
| Read 100k items (warm) | <span className="bench-tie">5.3ms <span className="bench-cv">±37%</span></span> | <span className="bench-tie">70.6ms <span className="bench-cv">±91%</span></span> |
| Filter query cold (100 items) | 30.6µs | 37.2µs |
| Filter query warm (100 items) | <span className="bench-excels">0.4µs</span> | <span className="bench-tradeoff">28.9µs</span> |
| Filter query cold (100k → 1k results) | <span className="bench-tradeoff">114.8ms</span> | <span className="bench-excels">540.9µs</span> |
| Filter query warm (100k → 1k results) | <span className="bench-excels">0.3µs</span> | <span className="bench-tradeoff">534.9µs</span> |
| Filter query cold (100k → 10k results) | <span className="bench-tradeoff">124.1ms</span> | <span className="bench-excels">5.5ms</span> |
| Filter query warm (100k → 10k results) | <span className="bench-excels">0.8µs</span> | <span className="bench-tradeoff">5.4ms</span> |
| Filter + sort query cold (100 items) | <span className="bench-tie">7.0µs <span className="bench-cv">±286%</span></span> | <span className="bench-tie">17.7µs <span className="bench-cv">±40%</span></span> |
| Filter + sort query warm (100 items) | <span className="bench-excels">0.6µs</span> | <span className="bench-tradeoff">3.1µs</span> |
| Live query update (100 items) | <span className="bench-excels">195.7µs</span> | <span className="bench-tradeoff">907.1µs</span> |
| Live query update (1k items) | <span className="bench-excels">1.2ms</span> | <span className="bench-tradeoff">3.0ms</span> |
| Live query update (10k items) | <span className="bench-excels">9.5ms</span> | <span className="bench-tradeoff">21.1ms</span> |
| Count operation | <span className="bench-excels">1.3µs</span> | <span className="bench-tradeoff">6.5µs</span> |
| Keys operation | <span className="bench-excels">2.9µs</span> | <span className="bench-tradeoff">11.9µs</span> |

</div>
{/* BENCH:server-comparison:END */}

<p className="bench-legend">Data: Deno. Node.js results are comparable for most operations (bulk writes diverge ~1.7×) — see <a href="#detailed-statistics">Detailed Statistics</a> for both.</p>

### Browser

GoatDB uses OPFS (Origin Private File System); SQLite uses WASM.

GoatDB writes return after committing to memory (OPFS persistence is batched in a background worker); SQLite WASM writes include synchronous OPFS persistence. This difference primarily affects single-item write latencies.

{/* BENCH:browser-comparison:START */}
<div className="benchmark-table">

| Operation | GoatDB | SQLite (WASM) |
|-----------|--------|--------|
| Create instance | 11.9ms | 10.8ms |
| Open database (empty) | <span className="bench-tradeoff">1.8ms</span> | <span className="bench-excels">2.9µs</span> |
| Open database (100k items) | <span className="bench-tradeoff">655.2ms</span> | <span className="bench-excels">2.8ms</span> |
| Create item | <span className="bench-excels">45.0µs</span> | <span className="bench-tradeoff">4.4ms</span> |
| Read item | <span className="bench-excels">2.0µs</span> | <span className="bench-tradeoff">515.5µs</span> |
| Update item | <span className="bench-excels">6.5µs</span> | <span className="bench-tradeoff">3.7ms</span> |
| Bulk create 100 items | <span className="bench-excels">4.9ms</span> | <span className="bench-tradeoff">6.8ms</span> |
| Bulk read 100 items | <span className="bench-excels">181.7µs</span> | <span className="bench-tradeoff">44.3ms</span> |
| Read 100k items (cold) | <span className="bench-excels">223.1ms</span> | <span className="bench-tradeoff">378.8ms</span> |
| Read 100k items (warm) | <span className="bench-excels">4.9ms</span> | <span className="bench-tradeoff">347.5ms</span> |
| Filter query cold (100 items) | <span className="bench-excels">33.1µs</span> | <span className="bench-tradeoff">631.5µs</span> |
| Filter query warm (100 items) | <span className="bench-excels">1.1µs</span> | <span className="bench-tradeoff">627.8µs</span> |
| Filter query cold (100k → 1k results) | <span className="bench-tradeoff">602.6ms</span> | <span className="bench-excels">3.9ms</span> |
| Filter query warm (100k → 1k results) | <span className="bench-excels">\<0.1µs</span> | <span className="bench-tradeoff">3.8ms</span> |
| Filter query cold (100k → 10k results) | <span className="bench-tradeoff">600.7ms</span> | <span className="bench-excels">35.6ms</span> |
| Filter query warm (100k → 10k results) | <span className="bench-excels">\<0.1µs</span> | <span className="bench-tradeoff">29.2ms</span> |
| Filter + sort query cold (100 items) | <span className="bench-excels">5.6µs</span> | <span className="bench-tradeoff">498.0µs</span> |
| Filter + sort query warm (100 items) | <span className="bench-excels">\<0.1µs</span> | <span className="bench-tradeoff">469.5µs</span> |
| Live query update (100 items) | <span className="bench-excels">170.0µs</span> | <span className="bench-tradeoff">454.2ms</span> |
| Live query update (1k items) | <span className="bench-excels">1.4ms</span> | <span className="bench-tradeoff">4429.1ms</span> |
| Live query update (10k items) | <span className="bench-excels">42.4ms</span> | <span className="bench-tradeoff">43846.9ms</span> |
| Count operation | <span className="bench-excels">1.5µs</span> | <span className="bench-tradeoff">439.4µs</span> |
| Keys operation | <span className="bench-excels">5.5µs</span> | <span className="bench-tradeoff">459.0µs</span> |

</div>
{/* BENCH:browser-comparison:END */}

<p className="bench-legend">Omitted rows perform comparably across environments — see <a href="#detailed-statistics">Detailed Statistics</a> for full browser data.</p>

### Why Browser Results Differ

Three phenomena explain why the server and browser tables tell such different stories:

1. **GoatDB is environment-invariant.** Data lives in the JS heap regardless of runtime. Browser reads (~1.5μs) are nearly identical to server reads (~0.8μs) — both are Map lookups. The runtime boundary barely registers.

2. **SQLite pays compounding browser overhead.** Every browser SQLite operation crosses JS→WASM, then WASM→OPFS with synchronous I/O. On the server, SQLite uses native FFI + OS page cache. This is why read gaps jump from ~11× (server) to ~301× (browser), and live query gaps from 2.3× to 1,022×. Each individual SQLite UPDATE in the browser pays the full WASM+OPFS round-trip, so operations that issue many writes (live query updates) see the largest amplification. SQLite's `:memory:` mode bypasses all kernel filesystem interactions ([sqlite.org/forum/forumpost/7eee1ce2e4f97f47](https://sqlite.org/forum/forumpost/7eee1ce2e4f97f47)); browser SQLite requires workarounds (Asyncify, SharedArrayBuffer+Atomics) that add 2–5× overhead ([powersync.com/blog/sqlite-persistence-on-the-web](https://www.powersync.com/blog/sqlite-persistence-on-the-web)).

3. **Cold read direction flip.** Read 100k cold is GoatDB-slower on server (273ms vs 68ms) but GoatDB-faster in browser (223ms vs 367ms). On the server, SQLite's memory-mapped pages-on-demand wins for sequential scans. In the browser, each page fetch pays the WASM+OPFS boundary cost, making pages-on-demand a liability — while GoatDB's bulk-load-and-deserialize pays the OPFS cost once.

## Interpreting the Results

The database **is** the application cache. After the initial open, item data lives in memory — reads are pure Map lookups with no FFI, no B-tree traversal, and no disk I/O.

- **Reads and metadata**: GoatDB wins — ~1μs memory lookups (~11× on server, ~301× in browser). Count/keys 5–8× faster.
- **Cold filter queries**: SQLite wins — B-tree indexing: 2–3× faster on server (small datasets), ~18× on large. Cold = first-access cost.
- **Warm filter queries**: GoatDB wins — O(1) cached frozen array return. Cold-to-warm speedup: 100–1,000×. SQLite warm improvement is moderate (prepared statement + page cache).
- **Live query updates**: GoatDB wins — incremental event propagation vs full re-query. Browser: cooperative yielding adds scheduling overhead (not directly comparable to SQLite's blocking queries).
- **Cold start**: SQLite wins — pages-on-demand = near-zero open cost.

Expected outcome after running `deno task bench`:
- **GoatDB warm reads**: 10–50× faster than cold (pure Map lookups)
- **GoatDB warm queries**: ~100–1,000× faster than cold (O(1) cached array, no predicate scan)
- **SQLite warm reads**: similar to cold (B-tree traversal + FFI cost is irreducible)
- **SQLite warm queries**: moderate improvement over cold from prepared statement reuse and warm page cache

**Cold vs. warm reads**: `Read 100k items (cold)` measures first-access deserialization — GoatDB lazily parses each commit's JSON on the first `valueForKey` call, so 100k items means 100k JSON parses. `Read 100k items (warm)` runs one untimed full scan first to populate all caches, then times a second scan — this is GoatDB's steady-state: pure Map lookups at ~1μs each. Both databases receive identical treatment (one untimed warmup scan, then one timed scan), making the warm comparison the fairest measure of each database's in-process read throughput.

The open cost maps naturally to user-initiated actions — opening a project, switching a workspace, loading a document. Users already expect a brief load when they open something; what they don't expect is latency on every subsequent interaction. GoatDB pays the cost once at open time and then runs at memory speed, matching the mental model modern apps have trained users to expect.

| Requirement | Best fit | Why |
|---|---|---|
| Read-heavy, long-running process | **GoatDB** | ~1μs reads after one-time startup load; pay the cold-start cost once |
| Real-time reactive queries | **GoatDB** | Incremental query updates as data changes, no polling |
| Offline-first / multi-device sync | **GoatDB** | Built-in [CRDT sync](/docs/sync) with [automatic conflict resolution](/docs/conflict-resolution) |
| Distributed AI agents | **GoatDB** | Runs in-process on server, edge, and browser; reactive state; optional cryptographic signing |
| Bulk write ingest | **SQLite** | B-tree + WAL optimized for batch inserts |
| Very large datasets (many repos open simultaneously) | **SQLite / PostgreSQL** | GoatDB loads each open repo fully into RAM; keep the in-memory set manageable by opening only the repos you need and closing the rest |
| Short-lived processes (serverless, CLI) | **SQLite** | Near-zero startup cost; no warm-up required |
| Multi-tenant server with complex queries | **PostgreSQL** | SQL, joins, stored procedures, row-level security |
| High-throughput caching layer | **Redis** | 150K+ ops/s single instance, TTL eviction, pub/sub |

## Configuration Variants

The comparisons below isolate specific GoatDB configuration options. Only operations where configurations differ by more than 2× are shown.

<details>
<summary>Trusted Mode — Bypassing Signatures</summary>

GoatDB signs every commit with Ed25519 by default, enabling [multi-peer and untrusted environments](/docs/sessions). For single-user or fully-trusted local scenarios you can opt out with `trusted: true`, which removes the signing overhead.

{/* BENCH:security-modes:START */}
<div className="benchmark-table">

| Operation | GoatDB | GoatDB (Trusted) |
|-----------|--------|--------|
| Create instance | <span className="bench-tradeoff">1.3ms</span> | <span className="bench-excels">846.3µs</span> |
| Create item | <span className="bench-tradeoff">35.6µs</span> | <span className="bench-excels">15.8µs</span> |
| Read item | <span className="bench-tie">1.3µs</span> | <span className="bench-tie">0.8µs <span className="bench-cv">±43%</span></span> |
| Update item | <span className="bench-tradeoff">6.3µs</span> | <span className="bench-excels">2.5µs</span> |
| Bulk create 100 items | <span className="bench-tradeoff">2.8ms</span> | <span className="bench-excels">848.3µs</span> |
| Write 100k items | <span className="bench-tradeoff">2615.1ms</span> | <span className="bench-excels">679.2ms</span> |

</div>
{/* BENCH:security-modes:END */}

<p className="bench-legend">Data: Deno. Only operations where trusted mode differs &gt;1.3-1.5× — omitted rows are comparable. See <a href="#detailed-statistics">Detailed Statistics</a> for full data.</p>

Trusted mode removes ~3× overhead on bulk writes. Reads are unaffected by signing in either mode.

</details>

<details>
<summary>Durable Mode Comparison (per-operation fsync)</summary>

GoatDB (Durable) adds per-operation fsync while keeping full cryptographic signing — isolating the cost of waiting for disk I/O. Only operations where at least one configuration differs meaningfully are shown.

:::note Crash safety without fsync
GoatDB's [append-only log](/docs/repositories) remains crash-safe even without fsync — incomplete writes are discarded on restart. `SQLite synchronous=OFF` risks database corruption on crash. GoatDB also exposes [`flush()`](/api/GoatDB/classes/GoatDB#flush) for application-controlled durability.
:::

{/* BENCH:durable-mode:START */}
<div className="benchmark-table">

| Operation | GoatDB (Durable) | GoatDB | SQLite | SQLite Fast-Unsafe |
|-----------|--------|--------|--------|--------|
| Create instance | 821.7µs | <span className="bench-tradeoff">1.3ms</span> | <span className="bench-excels">73.7µs</span> | 89.2µs |
| Open database (empty) | 316.8µs | <span className="bench-tradeoff">437.7µs</span> | 333.6µs | <span className="bench-excels">121.8µs</span> |
| Open database (100k items) | <span className="bench-tradeoff">826.5ms</span> | 643.7ms | <span className="bench-excels">130.4µs</span> | 143.2µs |
| Create item | <span className="bench-tradeoff">352.5µs</span> | 35.6µs | 24.3µs | <span className="bench-excels">13.6µs</span> |
| Read item | <span className="bench-excels">0.8µs</span> | 1.3µs | <span className="bench-tradeoff">10.2µs</span> | 8.8µs |
| Update item | <span className="bench-tradeoff">61.4µs</span> | <span className="bench-excels">6.3µs</span> | 17.9µs | 10.0µs |
| Bulk create 100 items | <span className="bench-tradeoff">14.6ms</span> | 2.8ms | 143.4µs | <span className="bench-excels">128.7µs</span> |
| Bulk read 100 items | <span className="bench-excels">122.6µs</span> | 162.1µs | <span className="bench-tradeoff">238.1µs</span> | 129.1µs |
| Write 100k items | <span className="bench-tradeoff">2945.9ms</span> | 2615.1ms | 153.3ms | <span className="bench-excels">140.9ms</span> |
| Read 100k items (cold) | <span className="bench-tradeoff">295.4ms</span> | 278.5ms | 69.9ms | <span className="bench-excels">69.8ms</span> |
| Read 100k items (warm) | 6.5ms | <span className="bench-tie">5.3ms <span className="bench-cv">±37%</span></span> | <span className="bench-tie">70.6ms <span className="bench-cv">±91%</span></span> | 67.3ms |
| Filter query cold (100 items) | <span className="bench-tie">10.8µs <span className="bench-cv">±243%</span></span> | 30.6µs | <span className="bench-tie">37.2µs</span> | 36.4µs |
| Filter query warm (100 items) | <span className="bench-excels">0.2µs</span> | 0.4µs | <span className="bench-tradeoff">28.9µs</span> | 28.7µs |
| Filter query cold (100k → 1k results) | 113.6ms | <span className="bench-tradeoff">114.8ms</span> | <span className="bench-excels">540.9µs</span> | 565.6µs |
| Filter query warm (100k → 1k results) | <span className="bench-excels">0.2µs</span> | 0.3µs | <span className="bench-tradeoff">534.9µs</span> | 504.9µs |
| Filter query cold (100k → 10k results) | 122.6ms | <span className="bench-tradeoff">124.1ms</span> | <span className="bench-excels">5.5ms</span> | 5.6ms |
| Filter query warm (100k → 10k results) | <span className="bench-excels">0.5µs</span> | 0.8µs | 5.4ms | <span className="bench-tradeoff">5.5ms</span> |
| Filter + sort query cold (100 items) | <span className="bench-excels">3.3µs</span> | 7.0µs | 17.7µs | <span className="bench-tradeoff">17.8µs</span> |
| Filter + sort query warm (100 items) | <span className="bench-excels">0.3µs</span> | 0.6µs | <span className="bench-tradeoff">3.1µs</span> | 2.0µs |
| Live query update (100 items) | <span className="bench-excels">175.7µs</span> | 195.7µs | <span className="bench-tradeoff">907.1µs</span> | 816.4µs |
| Live query update (1k items) | 1.3ms | <span className="bench-excels">1.2ms</span> | 3.0ms | <span className="bench-tradeoff">3.1ms</span> |
| Live query update (10k items) | 11.0ms | <span className="bench-excels">9.5ms</span> | <span className="bench-tradeoff">21.1ms</span> | 21.0ms |
| Count operation | 1.5µs | <span className="bench-excels">1.3µs</span> | <span className="bench-tradeoff">6.5µs</span> | 6.4µs |
| Keys operation | <span className="bench-excels">1.1µs</span> | 2.9µs | <span className="bench-tradeoff">11.9µs</span> | 10.6µs |

</div>
{/* BENCH:durable-mode:END */}

<p className="bench-legend">Data: Deno. Only operations where at least one column differs &gt;1.3-1.5× — omitted rows are comparable. See <a href="#detailed-statistics">Detailed Statistics</a> for full data.</p>

</details>

<details>
<summary>Storage Formats: Binary vs JSONL</summary>

GoatDB defaults to **binary format** (`.goat`, fixed-layout binary with length-prefixed framing). An optional **JSONL** format stores each commit as a plain-text JSON line, making the database human-readable with `cat`, `jq`, or any text editor — useful for debugging and data recovery. Only operations where the formats diverge meaningfully are shown.

{/* BENCH:storage-formats:START */}
<div className="benchmark-table">

| Operation | Binary (default) | JSONL |
|-----------|--------|--------|
| Open database (empty) | <span className="bench-tradeoff">437.7µs</span> | <span className="bench-excels">271.8µs</span> |
| Open database (100k items) | <span className="bench-excels">643.7ms</span> | <span className="bench-tradeoff">879.5ms</span> |
| Create item | <span className="bench-tradeoff">35.6µs</span> | <span className="bench-excels">10.6µs</span> |
| Read item | <span className="bench-tradeoff">1.3µs</span> | <span className="bench-excels">0.5µs</span> |
| Update item | <span className="bench-tradeoff">6.3µs</span> | <span className="bench-excels">2.2µs</span> |
| Read 100k items (cold) | <span className="bench-tradeoff">278.5ms</span> | <span className="bench-excels">103.2ms</span> |
| Count operation | <span className="bench-tradeoff">1.3µs</span> | <span className="bench-excels">0.6µs</span> |
| Keys operation | <span className="bench-tradeoff">2.9µs</span> | <span className="bench-excels">1.0µs</span> |

</div>
{/* BENCH:storage-formats:END */}

<p className="bench-legend">Data: GoatDB on Deno. Only operations where formats diverge &gt;1.3-1.5× — omitted rows are comparable. See <a href="#detailed-statistics">Detailed Statistics</a> for full data.</p>

The binary format (the default) produces smaller files on disk and enables fast sequential I/O. JSONL is useful for debugging — the log is human-readable with `cat` or `jq`. As the table above shows, JSONL is currently faster for some steady-state operations; binary encoding overhead is a known trade-off for compactness.

</details>

## Methodology

3–10 samples per operation with warmup. Color coding: <span className="bench-excels">green = meaningfully faster (&gt;1.3× ms / &gt;1.5× μs)</span>, <span className="bench-tradeoff">amber = meaningfully slower (&gt;1.3× ms / &gt;1.5× μs)</span>, <span className="bench-tie">grey = statistical tie</span> (ranges overlap — variance makes winner uncertain), plain = within noise.

Operations with fewer than 3 samples should be treated as indicative rather than precise. In particular, live query update at 10k items runs a single iteration due to its long execution time.

<details>
<summary>Test environment</summary>

{/* BENCH:methodology-table:START */}
| Platform | Hardware | Runtime |
|----------|----------|---------|
| Deno | Apple M4 Pro, 24GB RAM | deno 2.7.5 (darwin aarch64) |
| Node.js | Apple M4 Pro, 24GB RAM | node v25.2.1 (darwin arm64) |
| Browser | Apple M4 Pro, 24GB RAM (OPFS) | browser Chrome 145.0 (Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36) |
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
| Create instance | 1.3ms | 1.3ms | 126.9µs | 10% | 10 | 781 ops/s |
| Open database (empty) | 423.2µs | 430.6µs | 43.9µs | 10% | 7 | 2K ops/s |
| Open database (100k items) | 643.7ms | 648.3ms | 18.4ms | 3% | 7 | 2 ops/s |
| Create item | 35.6µs | 35.9µs | 10.8µs | 30% | 10 | 28K ops/s |
| Read item | 1.3µs | 1.3µs | 0.3µs | 25% | 10 | 774K ops/s |
| Update item | 6.3µs | 6.3µs | 1.2µs | 19% | 10 | 158K ops/s |
| Bulk create 100 items | 2.8ms | 2.7ms | 116.7µs | 4% | 10 | 359 ops/s |
| Bulk read 100 items | 166.5µs | 163.4µs | 18.4µs | 11% | 10 | 6K ops/s |
| Write 100k items | 2615.1ms | 2616.7ms | 9.9ms | 0% | 7 | 0 ops/s |
| Read 100k items (cold) | 278.5ms | 276.9ms | 5.1ms | 2% | 7 | 4 ops/s |
| Read 100k items (warm) | 6.2ms | 5.4ms | 2.3ms | **37%** | 7 | 162 ops/s |
| Filter query cold (100 items) | 307.3µs | 30.4µs | 847.5µs | **276%** | 10 | 3K ops/s |
| Filter query warm (100 items) | 1.8µs | 0.4µs | 3.8µs | **214%** | 10 | 561K ops/s |
| Filter query cold (100k → 1k results) | 114.8ms | 115.0ms | 1.1ms | 1% | 10 | 9 ops/s |
| Filter query warm (100k → 1k results) | 0.3µs | 0.3µs | 0.1µs | **43%** | 10 | 2.96M ops/s |
| Filter query cold (100k → 10k results) | 124.1ms | 123.3ms | 2.4ms | 2% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.8µs | 0.3µs | 0.9µs | **116%** | 7 | 1.28M ops/s |
| Filter + sort query cold (100 items) | 113.3µs | 6.6µs | 324.0µs | **286%** | 10 | 9K ops/s |
| Filter + sort query warm (100 items) | 0.8µs | 0.7µs | 0.5µs | **60%** | 10 | 1.22M ops/s |
| Live query update (100 items) | 200.3µs | 198.7µs | 16.1µs | 8% | 20 | 5K ops/s |
| Live query update (1k items) | 1.2ms | 1.2ms | 133.8µs | 11% | 20 | 842 ops/s |
| Live query update (10k items) | 9.5ms | 9.5ms | \<0.1µs | 0% | 1 | 105 ops/s |
| Count operation | 1.3µs | 1.3µs | 0.3µs | 20% | 10 | 777K ops/s |
| Keys operation | 2.9µs | 2.0µs | 1.5µs | **52%** | 10 | 351K ops/s |

### GoatDB (Trusted)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 846.3µs | 844.9µs | 32.2µs | 4% | 10 | 1K ops/s |
| Open database (empty) | 366.6µs | 339.6µs | 59.5µs | 16% | 7 | 3K ops/s |
| Open database (100k items) | 742.1ms | 740.1ms | 17.7ms | 2% | 7 | 1 ops/s |
| Create item | 15.8µs | 16.2µs | 3.2µs | 20% | 10 | 63K ops/s |
| Read item | 0.8µs | 0.8µs | 0.4µs | **43%** | 10 | 1.19M ops/s |
| Update item | 2.5µs | 2.5µs | 0.8µs | 33% | 10 | 395K ops/s |
| Bulk create 100 items | 848.3µs | 827.7µs | 54.5µs | 6% | 10 | 1K ops/s |
| Bulk read 100 items | 131.8µs | 131.5µs | 6.7µs | 5% | 10 | 8K ops/s |
| Write 100k items | 679.2ms | 674.2ms | 23.0ms | 3% | 7 | 1 ops/s |
| Read 100k items (cold) | 291.7ms | 291.1ms | 1.9ms | 1% | 7 | 3 ops/s |
| Read 100k items (warm) | 6.6ms | 5.3ms | 2.5ms | **38%** | 7 | 152 ops/s |
| Filter query cold (100 items) | 205.6µs | 10.8µs | 607.4µs | **296%** | 10 | 5K ops/s |
| Filter query warm (100 items) | 0.3µs | 0.2µs | 0.4µs | **131%** | 10 | 3.34M ops/s |
| Filter query cold (100k → 1k results) | 114.2ms | 113.9ms | 2.2ms | 2% | 10 | 9 ops/s |
| Filter query warm (100k → 1k results) | 0.3µs | 0.2µs | 0.2µs | **63%** | 10 | 3.58M ops/s |
| Filter query cold (100k → 10k results) | 121.2ms | 119.9ms | 3.0ms | 2% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.4µs | 0.2µs | 0.3µs | **72%** | 7 | 2.80M ops/s |
| Filter + sort query cold (100 items) | 36.3µs | 3.4µs | 95.4µs | **263%** | 10 | 28K ops/s |
| Filter + sort query warm (100 items) | 0.4µs | 0.2µs | 0.3µs | **86%** | 10 | 2.73M ops/s |
| Live query update (100 items) | 168.3µs | 168.5µs | 7.3µs | 4% | 20 | 6K ops/s |
| Live query update (1k items) | 972.1µs | 964.5µs | 125.7µs | 13% | 20 | 1K ops/s |
| Live query update (10k items) | 10.4ms | 10.4ms | \<0.1µs | 0% | 1 | 96 ops/s |
| Count operation | 1.0µs | 1.0µs | 0.2µs | 20% | 10 | 984K ops/s |
| Keys operation | 1.9µs | 1.5µs | 0.8µs | **43%** | 10 | 524K ops/s |

### GoatDB (Durable)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 849.3µs | 814.7µs | 95.1µs | 11% | 10 | 1K ops/s |
| Open database (empty) | 316.8µs | 329.8µs | 24.7µs | 8% | 7 | 3K ops/s |
| Open database (100k items) | 826.5ms | 827.1ms | 19.4ms | 2% | 7 | 1 ops/s |
| Create item | 359.0µs | 359.7µs | 41.8µs | 12% | 10 | 3K ops/s |
| Read item | 1.1µs | 0.9µs | 0.6µs | **54%** | 10 | 923K ops/s |
| Update item | 63.5µs | 59.8µs | 9.8µs | 15% | 10 | 16K ops/s |
| Bulk create 100 items | 14.6ms | 15.6ms | 2.1ms | 14% | 10 | 68 ops/s |
| Bulk read 100 items | 122.6µs | 121.4µs | 2.4µs | 2% | 10 | 8K ops/s |
| Write 100k items | 2945.9ms | 2946.4ms | 12.1ms | 0% | 7 | 0 ops/s |
| Read 100k items (cold) | 295.4ms | 296.6ms | 3.8ms | 1% | 7 | 3 ops/s |
| Read 100k items (warm) | 6.5ms | 5.5ms | 2.2ms | **34%** | 7 | 155 ops/s |
| Filter query cold (100 items) | 58.5µs | 10.5µs | 141.9µs | **243%** | 10 | 17K ops/s |
| Filter query warm (100 items) | 0.3µs | 0.2µs | 0.4µs | **128%** | 10 | 3.16M ops/s |
| Filter query cold (100k → 1k results) | 113.6ms | 113.9ms | 1.2ms | 1% | 10 | 9 ops/s |
| Filter query warm (100k → 1k results) | 0.2µs | 0.2µs | 0.1µs | **37%** | 10 | 4.53M ops/s |
| Filter query cold (100k → 10k results) | 122.6ms | 121.8ms | 3.1ms | 3% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.5µs | 0.3µs | 0.5µs | **94%** | 7 | 1.95M ops/s |
| Filter + sort query cold (100 items) | 53.6µs | 3.0µs | 150.2µs | **280%** | 10 | 19K ops/s |
| Filter + sort query warm (100 items) | 0.4µs | 0.2µs | 0.4µs | **104%** | 10 | 2.67M ops/s |
| Live query update (100 items) | 177.1µs | 177.0µs | 9.5µs | 5% | 20 | 6K ops/s |
| Live query update (1k items) | 1.3ms | 1.3ms | 81.1µs | 6% | 20 | 795 ops/s |
| Live query update (10k items) | 11.0ms | 11.0ms | \<0.1µs | 0% | 1 | 91 ops/s |
| Count operation | 3.2µs | 1.4µs | 4.0µs | **126%** | 10 | 315K ops/s |
| Keys operation | 1.1µs | 1.1µs | 0.1µs | 11% | 10 | 873K ops/s |

### GoatDB JSONL

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 918.4µs | 907.8µs | 114.7µs | 12% | 10 | 1K ops/s |
| Open database (empty) | 271.8µs | 274.5µs | 22.3µs | 8% | 7 | 4K ops/s |
| Open database (100k items) | 929.9ms | 875.0ms | 138.1ms | 15% | 7 | 1 ops/s |
| Create item | 11.8µs | 10.9µs | 3.9µs | **33%** | 10 | 85K ops/s |
| Read item | 0.5µs | 0.5µs | 0.1µs | 26% | 10 | 2.00M ops/s |
| Update item | 2.2µs | 2.1µs | 0.5µs | 25% | 10 | 455K ops/s |
| Bulk create 100 items | 2.6ms | 2.6ms | 48.2µs | 2% | 10 | 383 ops/s |
| Bulk read 100 items | 130.4µs | 125.8µs | 10.4µs | 8% | 10 | 8K ops/s |
| Write 100k items | 2668.8ms | 2667.1ms | 10.7ms | 0% | 7 | 0 ops/s |
| Read 100k items (cold) | 103.2ms | 101.8ms | 4.3ms | 4% | 7 | 10 ops/s |
| Read 100k items (warm) | 6.9ms | 5.2ms | 3.0ms | **43%** | 7 | 145 ops/s |
| Filter query cold (100 items) | 285.7µs | 10.5µs | 855.5µs | **299%** | 10 | 3K ops/s |
| Filter query warm (100 items) | 0.2µs | 0.1µs | 0.2µs | **110%** | 10 | 6.00M ops/s |
| Filter query cold (100k → 1k results) | 115.9ms | 116.0ms | 1.4ms | 1% | 10 | 9 ops/s |
| Filter query warm (100k → 1k results) | 0.2µs | 0.1µs | 0.1µs | **95%** | 10 | 6.66M ops/s |
| Filter query cold (100k → 10k results) | 120.0ms | 120.5ms | 2.3ms | 2% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.4µs | 0.3µs | 0.5µs | **117%** | 7 | 2.40M ops/s |
| Filter + sort query cold (100 items) | 162.8µs | 4.3µs | 489.7µs | **301%** | 10 | 6K ops/s |
| Filter + sort query warm (100 items) | 0.2µs | 0.1µs | 0.1µs | **67%** | 10 | 5.70M ops/s |
| Live query update (100 items) | 182.0µs | 180.8µs | 12.4µs | 7% | 20 | 5K ops/s |
| Live query update (1k items) | 1.2ms | 1.2ms | 47.0µs | 4% | 20 | 848 ops/s |
| Live query update (10k items) | 11.1ms | 11.1ms | \<0.1µs | 0% | 1 | 90 ops/s |
| Count operation | 0.6µs | 0.6µs | 0.1µs | 21% | 10 | 1.63M ops/s |
| Keys operation | 1.0µs | 0.9µs | 0.2µs | 21% | 10 | 1.04M ops/s |

### SQLite

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 77.1µs | 74.9µs | 7.6µs | 10% | 10 | 13K ops/s |
| Open database (empty) | 333.6µs | 314.3µs | 34.7µs | 10% | 7 | 3K ops/s |
| Open database (100k items) | 130.4µs | 124.8µs | 20.7µs | 16% | 7 | 8K ops/s |
| Create item | 26.5µs | 24.6µs | 5.0µs | 19% | 10 | 38K ops/s |
| Read item | 10.2µs | 9.5µs | 2.0µs | 20% | 10 | 98K ops/s |
| Update item | 17.9µs | 18.0µs | 1.0µs | 6% | 10 | 56K ops/s |
| Bulk create 100 items | 143.4µs | 143.0µs | 3.1µs | 2% | 10 | 7K ops/s |
| Bulk read 100 items | 238.1µs | 231.9µs | 14.9µs | 6% | 10 | 4K ops/s |
| Write 100k items | 153.3ms | 150.8ms | 3.8ms | 3% | 7 | 7 ops/s |
| Read 100k items (cold) | 69.9ms | 68.0ms | 5.0ms | 7% | 7 | 14 ops/s |
| Read 100k items (warm) | 107.3ms | 69.0ms | 97.5ms | **91%** | 7 | 9 ops/s |
| Filter query cold (100 items) | 38.7µs | 36.1µs | 5.4µs | 14% | 10 | 26K ops/s |
| Filter query warm (100 items) | 29.2µs | 28.8µs | 1.0µs | 4% | 10 | 34K ops/s |
| Filter query cold (100k → 1k results) | 543.3µs | 540.1µs | 9.4µs | 2% | 10 | 2K ops/s |
| Filter query warm (100k → 1k results) | 539.5µs | 534.6µs | 17.2µs | 3% | 10 | 2K ops/s |
| Filter query cold (100k → 10k results) | 5.6ms | 5.5ms | 486.3µs | 9% | 10 | 178 ops/s |
| Filter query warm (100k → 10k results) | 5.5ms | 5.4ms | 444.3µs | 8% | 10 | 181 ops/s |
| Filter + sort query cold (100 items) | 20.0µs | 17.0µs | 8.0µs | **40%** | 10 | 50K ops/s |
| Filter + sort query warm (100 items) | 3.3µs | 3.0µs | 0.8µs | 23% | 10 | 300K ops/s |
| Live query update (100 items) | 982.8µs | 919.3µs | 305.5µs | 31% | 20 | 1K ops/s |
| Live query update (1k items) | 3.0ms | 3.2ms | 240.9µs | 8% | 20 | 329 ops/s |
| Live query update (10k items) | 21.1ms | 20.9ms | 2.8ms | 13% | 20 | 47 ops/s |
| Count operation | 7.1µs | 6.3µs | 2.2µs | 31% | 10 | 140K ops/s |
| Keys operation | 11.9µs | 11.3µs | 1.4µs | 12% | 10 | 84K ops/s |

### SQLite Fast-Unsafe

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 89.2µs | 84.4µs | 13.8µs | 16% | 10 | 11K ops/s |
| Open database (empty) | 121.8µs | 122.7µs | 9.6µs | 8% | 7 | 8K ops/s |
| Open database (100k items) | 143.2µs | 142.0µs | 8.5µs | 6% | 7 | 7K ops/s |
| Create item | 15.3µs | 13.7µs | 6.4µs | **42%** | 10 | 65K ops/s |
| Read item | 8.8µs | 8.0µs | 2.4µs | 27% | 10 | 114K ops/s |
| Update item | 10.0µs | 9.9µs | 1.3µs | 13% | 10 | 100K ops/s |
| Bulk create 100 items | 128.7µs | 129.6µs | 2.6µs | 2% | 10 | 8K ops/s |
| Bulk read 100 items | 129.1µs | 128.1µs | 6.4µs | 5% | 10 | 8K ops/s |
| Write 100k items | 140.9ms | 140.5ms | 2.1ms | 2% | 7 | 7 ops/s |
| Read 100k items (cold) | 69.8ms | 69.4ms | 5.4ms | 8% | 7 | 14 ops/s |
| Read 100k items (warm) | 67.3ms | 66.8ms | 4.1ms | 6% | 7 | 15 ops/s |
| Filter query cold (100 items) | 36.4µs | 35.9µs | 1.9µs | 5% | 10 | 27K ops/s |
| Filter query warm (100 items) | 28.7µs | 27.5µs | 1.9µs | 6% | 10 | 35K ops/s |
| Filter query cold (100k → 1k results) | 572.8µs | 565.5µs | 25.2µs | 4% | 10 | 2K ops/s |
| Filter query warm (100k → 1k results) | 501.7µs | 503.5µs | 13.1µs | 3% | 10 | 2K ops/s |
| Filter query cold (100k → 10k results) | 6.0ms | 5.7ms | 763.2µs | 13% | 10 | 167 ops/s |
| Filter query warm (100k → 10k results) | 5.8ms | 5.5ms | 731.8µs | 13% | 10 | 172 ops/s |
| Filter + sort query cold (100 items) | 19.1µs | 17.9µs | 5.2µs | 27% | 10 | 52K ops/s |
| Filter + sort query warm (100 items) | 2.2µs | 1.9µs | 0.8µs | **35%** | 10 | 454K ops/s |
| Live query update (100 items) | 850.6µs | 832.7µs | 81.4µs | 10% | 20 | 1K ops/s |
| Live query update (1k items) | 3.1ms | 3.1ms | 325.7µs | 11% | 20 | 326 ops/s |
| Live query update (10k items) | 21.0ms | 20.7ms | 3.2ms | 15% | 20 | 48 ops/s |
| Count operation | 6.4µs | 6.2µs | 1.3µs | 20% | 10 | 155K ops/s |
| Keys operation | 10.6µs | 10.1µs | 1.6µs | 15% | 10 | 94K ops/s |
{/* BENCH:stats-deno:END */}
</TabItem>
<TabItem value="stats-node" label="Node.js">

{/* BENCH:stats-node:START */}
### GoatDB

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 934.5µs | 915.3µs | 106.7µs | 11% | 10 | 1K ops/s |
| Open database (empty) | 293.6µs | 287.3µs | 24.8µs | 8% | 7 | 3K ops/s |
| Open database (100k items) | 666.5ms | 663.1ms | 16.2ms | 2% | 7 | 2 ops/s |
| Create item | 29.7µs | 28.8µs | 9.0µs | 30% | 10 | 34K ops/s |
| Read item | 0.9µs | 0.9µs | 0.3µs | 30% | 10 | 1.12M ops/s |
| Update item | 5.5µs | 4.9µs | 2.0µs | **36%** | 10 | 181K ops/s |
| Bulk create 100 items | 4.4ms | 4.3ms | 291.9µs | 7% | 10 | 226 ops/s |
| Bulk read 100 items | 158.5µs | 155.0µs | 16.0µs | 10% | 10 | 6K ops/s |
| Write 100k items | 4504.2ms | 4502.5ms | 33.0ms | 1% | 7 | 0 ops/s |
| Read 100k items (cold) | 300.9ms | 301.6ms | 3.9ms | 1% | 7 | 3 ops/s |
| Read 100k items (warm) | 8.5ms | 7.8ms | 1.8ms | 21% | 7 | 118 ops/s |
| Filter query cold (100 items) | 174.4µs | 30.8µs | 433.7µs | **249%** | 10 | 6K ops/s |
| Filter query warm (100 items) | 1.7µs | 0.6µs | 3.7µs | **216%** | 10 | 590K ops/s |
| Filter query cold (100k → 1k results) | 117.6ms | 117.9ms | 4.0ms | 3% | 10 | 9 ops/s |
| Filter query warm (100k → 1k results) | 0.4µs | 0.2µs | 0.2µs | **58%** | 10 | 2.79M ops/s |
| Filter query cold (100k → 10k results) | 126.5ms | 127.3ms | 3.2ms | 3% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 1.4µs | 0.6µs | 2.5µs | **174%** | 7 | 706K ops/s |
| Filter + sort query cold (100 items) | 55.7µs | 7.3µs | 144.3µs | **259%** | 10 | 18K ops/s |
| Filter + sort query warm (100 items) | 0.4µs | 0.3µs | 0.3µs | **64%** | 10 | 2.22M ops/s |
| Live query update (100 items) | 194.4µs | 189.9µs | 19.5µs | 10% | 20 | 5K ops/s |
| Live query update (1k items) | 1.1ms | 1.1ms | 67.9µs | 6% | 20 | 910 ops/s |
| Live query update (10k items) | 7.3ms | 7.3ms | \<0.1µs | 0% | 1 | 138 ops/s |
| Count operation | 1.3µs | 1.2µs | 0.4µs | **34%** | 10 | 760K ops/s |
| Keys operation | 2.5µs | 2.1µs | 1.0µs | **41%** | 10 | 403K ops/s |

### GoatDB (Trusted)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 805.9µs | 791.2µs | 52.5µs | 7% | 10 | 1K ops/s |
| Open database (empty) | 351.9µs | 298.5µs | 126.0µs | **36%** | 7 | 3K ops/s |
| Open database (100k items) | 676.4ms | 680.2ms | 29.2ms | 4% | 7 | 1 ops/s |
| Create item | 16.7µs | 11.9µs | 12.3µs | **74%** | 10 | 60K ops/s |
| Read item | 0.6µs | 0.5µs | 0.2µs | **43%** | 10 | 1.73M ops/s |
| Update item | 1.9µs | 1.9µs | 0.5µs | 27% | 10 | 513K ops/s |
| Bulk create 100 items | 732.8µs | 715.7µs | 56.5µs | 8% | 10 | 1K ops/s |
| Bulk read 100 items | 130.0µs | 125.9µs | 11.5µs | 9% | 10 | 8K ops/s |
| Write 100k items | 793.5ms | 742.1ms | 99.5ms | 13% | 7 | 1 ops/s |
| Read 100k items (cold) | 317.0ms | 313.1ms | 8.9ms | 3% | 7 | 3 ops/s |
| Read 100k items (warm) | 8.4ms | 7.7ms | 1.9ms | 23% | 7 | 119 ops/s |
| Filter query cold (100 items) | 63.7µs | 14.6µs | 147.7µs | **232%** | 10 | 16K ops/s |
| Filter query warm (100 items) | 0.5µs | 0.4µs | 0.4µs | **83%** | 10 | 2.07M ops/s |
| Filter query cold (100k → 1k results) | 120.5ms | 120.9ms | 2.8ms | 2% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 0.3µs | 0.3µs | 0.2µs | **45%** | 10 | 3.00M ops/s |
| Filter query cold (100k → 10k results) | 129.6ms | 128.4ms | 4.9ms | 4% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.8µs | 0.4µs | 0.9µs | **106%** | 7 | 1.24M ops/s |
| Filter + sort query cold (100 items) | 37.3µs | 4.0µs | 96.1µs | **257%** | 10 | 27K ops/s |
| Filter + sort query warm (100 items) | 0.4µs | 0.2µs | 0.4µs | **97%** | 10 | 2.45M ops/s |
| Live query update (100 items) | 175.3µs | 174.5µs | 15.3µs | 9% | 20 | 6K ops/s |
| Live query update (1k items) | 878.7µs | 870.7µs | 78.3µs | 9% | 20 | 1K ops/s |
| Live query update (10k items) | 7.5ms | 7.5ms | \<0.1µs | 0% | 1 | 134 ops/s |
| Count operation | 1.2µs | 1.2µs | 0.2µs | 16% | 10 | 848K ops/s |
| Keys operation | 3.1µs | 1.4µs | 5.0µs | **163%** | 10 | 326K ops/s |

### GoatDB (Durable)

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 831.9µs | 804.9µs | 95.2µs | 11% | 10 | 1K ops/s |
| Open database (empty) | 266.8µs | 264.0µs | 14.5µs | 5% | 7 | 4K ops/s |
| Open database (100k items) | 708.1ms | 707.4ms | 18.2ms | 3% | 7 | 1 ops/s |
| Create item | 310.0µs | 310.9µs | 20.5µs | 7% | 10 | 3K ops/s |
| Read item | 0.6µs | 0.5µs | 0.2µs | **39%** | 10 | 1.77M ops/s |
| Update item | 73.9µs | 71.4µs | 8.7µs | 12% | 10 | 14K ops/s |
| Bulk create 100 items | 12.9ms | 12.7ms | 681.1µs | 5% | 10 | 78 ops/s |
| Bulk read 100 items | 123.9µs | 123.2µs | 4.3µs | 3% | 10 | 8K ops/s |
| Write 100k items | 4703.1ms | 4710.1ms | 99.6ms | 2% | 7 | 0 ops/s |
| Read 100k items (cold) | 345.8ms | 349.2ms | 26.5ms | 8% | 7 | 3 ops/s |
| Read 100k items (warm) | 9.9ms | 9.2ms | 2.2ms | 22% | 7 | 101 ops/s |
| Filter query cold (100 items) | 72.3µs | 16.9µs | 136.9µs | **189%** | 10 | 14K ops/s |
| Filter query warm (100 items) | 0.4µs | 0.2µs | 0.5µs | **125%** | 10 | 2.53M ops/s |
| Filter query cold (100k → 1k results) | 128.8ms | 129.0ms | 3.8ms | 3% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 0.4µs | 0.4µs | 0.2µs | **53%** | 10 | 2.47M ops/s |
| Filter query cold (100k → 10k results) | 136.5ms | 136.6ms | 4.6ms | 3% | 7 | 7 ops/s |
| Filter query warm (100k → 10k results) | 0.4µs | 0.3µs | 0.3µs | **67%** | 7 | 2.44M ops/s |
| Filter + sort query cold (100 items) | 36.6µs | 4.1µs | 97.2µs | **265%** | 10 | 27K ops/s |
| Filter + sort query warm (100 items) | 0.4µs | 0.2µs | 0.4µs | **112%** | 10 | 2.64M ops/s |
| Live query update (100 items) | 187.0µs | 186.5µs | 11.7µs | 6% | 20 | 5K ops/s |
| Live query update (1k items) | 1.4ms | 1.1ms | 1.4ms | **103%** | 20 | 714 ops/s |
| Live query update (10k items) | 7.5ms | 7.5ms | \<0.1µs | 0% | 1 | 133 ops/s |
| Count operation | 2.7µs | 1.9µs | 2.5µs | **94%** | 10 | 374K ops/s |
| Keys operation | 1.1µs | 1.1µs | 0.2µs | 16% | 10 | 909K ops/s |

### GoatDB JSONL

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 848.6µs | 794.7µs | 152.6µs | 18% | 10 | 1K ops/s |
| Open database (empty) | 256.1µs | 261.5µs | 15.2µs | 6% | 7 | 4K ops/s |
| Open database (100k items) | 873.8ms | 859.5ms | 76.1ms | 9% | 7 | 1 ops/s |
| Create item | 11.0µs | 10.6µs | 1.8µs | 16% | 10 | 91K ops/s |
| Read item | 0.4µs | 0.3µs | 0.3µs | **66%** | 10 | 2.47M ops/s |
| Update item | 2.5µs | 2.7µs | 0.4µs | 17% | 10 | 405K ops/s |
| Bulk create 100 items | 4.5ms | 4.3ms | 613.2µs | 14% | 10 | 223 ops/s |
| Bulk read 100 items | 120.2µs | 118.9µs | 3.3µs | 3% | 10 | 8K ops/s |
| Write 100k items | 4804.1ms | 4779.3ms | 108.0ms | 2% | 7 | 0 ops/s |
| Read 100k items (cold) | 155.8ms | 148.2ms | 16.7ms | 11% | 7 | 6 ops/s |
| Read 100k items (warm) | 9.3ms | 8.3ms | 2.0ms | 22% | 7 | 107 ops/s |
| Filter query cold (100 items) | 60.0µs | 14.5µs | 137.5µs | **229%** | 10 | 17K ops/s |
| Filter query warm (100 items) | 0.2µs | 0.1µs | 0.2µs | **101%** | 10 | 6.15M ops/s |
| Filter query cold (100k → 1k results) | 129.6ms | 130.0ms | 3.4ms | 3% | 10 | 8 ops/s |
| Filter query warm (100k → 1k results) | 0.1µs | 0.1µs | 0.1µs | **66%** | 10 | 7.75M ops/s |
| Filter query cold (100k → 10k results) | 133.1ms | 134.4ms | 4.9ms | 4% | 7 | 8 ops/s |
| Filter query warm (100k → 10k results) | 0.4µs | 0.4µs | 0.4µs | **88%** | 7 | 2.33M ops/s |
| Filter + sort query cold (100 items) | 38.1µs | 4.6µs | 99.9µs | **262%** | 10 | 26K ops/s |
| Filter + sort query warm (100 items) | 0.2µs | 0.1µs | 0.2µs | **108%** | 10 | 5.11M ops/s |
| Live query update (100 items) | 172.4µs | 167.4µs | 21.2µs | 12% | 20 | 6K ops/s |
| Live query update (1k items) | 1.3ms | 1.3ms | 68.2µs | 5% | 20 | 754 ops/s |
| Live query update (10k items) | 7.5ms | 7.5ms | \<0.1µs | 0% | 1 | 134 ops/s |
| Count operation | 0.8µs | 0.7µs | 0.2µs | 27% | 10 | 1.20M ops/s |
| Keys operation | 1.6µs | 1.1µs | 1.6µs | **103%** | 10 | 638K ops/s |

### SQLite

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 82.6µs | 81.1µs | 13.8µs | 17% | 10 | 12K ops/s |
| Open database (empty) | 332.4µs | 316.1µs | 40.7µs | 12% | 7 | 3K ops/s |
| Open database (100k items) | 98.5µs | 99.7µs | 6.2µs | 6% | 7 | 10K ops/s |
| Create item | 23.2µs | 22.9µs | 2.1µs | 9% | 10 | 43K ops/s |
| Read item | 8.0µs | 6.8µs | 2.1µs | 26% | 10 | 125K ops/s |
| Update item | 18.4µs | 17.6µs | 3.5µs | 19% | 10 | 54K ops/s |
| Bulk create 100 items | 110.1µs | 108.0µs | 3.8µs | 3% | 10 | 9K ops/s |
| Bulk read 100 items | 194.7µs | 193.0µs | 7.7µs | 4% | 10 | 5K ops/s |
| Write 100k items | 117.1ms | 114.7ms | 4.0ms | 3% | 7 | 9 ops/s |
| Read 100k items (cold) | 38.4ms | 39.5ms | 2.7ms | 7% | 7 | 26 ops/s |
| Read 100k items (warm) | 37.2ms | 36.6ms | 1.7ms | 4% | 7 | 27 ops/s |
| Filter query cold (100 items) | 23.7µs | 23.6µs | 0.8µs | 3% | 10 | 42K ops/s |
| Filter query warm (100 items) | 17.3µs | 17.0µs | 0.8µs | 5% | 10 | 58K ops/s |
| Filter query cold (100k → 1k results) | 331.1µs | 330.4µs | 8.8µs | 3% | 10 | 3K ops/s |
| Filter query warm (100k → 1k results) | 310.1µs | 306.1µs | 20.5µs | 7% | 10 | 3K ops/s |
| Filter query cold (100k → 10k results) | 3.4ms | 3.2ms | 760.4µs | 22% | 10 | 295 ops/s |
| Filter query warm (100k → 10k results) | 3.2ms | 3.0ms | 727.2µs | 23% | 10 | 312 ops/s |
| Filter + sort query cold (100 items) | 13.5µs | 12.0µs | 3.2µs | 24% | 10 | 74K ops/s |
| Filter + sort query warm (100 items) | 2.7µs | 2.4µs | 0.8µs | 28% | 10 | 366K ops/s |
| Live query update (100 items) | 601.9µs | 595.3µs | 34.7µs | 6% | 20 | 2K ops/s |
| Live query update (1k items) | 2.2ms | 2.2ms | 135.6µs | 6% | 20 | 453 ops/s |
| Live query update (10k items) | 15.0ms | 14.9ms | 1.5ms | 10% | 20 | 67 ops/s |
| Count operation | 6.4µs | 6.5µs | 0.9µs | 14% | 10 | 157K ops/s |
| Keys operation | 9.4µs | 8.8µs | 1.4µs | 15% | 10 | 107K ops/s |

### SQLite Fast-Unsafe

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 74.3µs | 73.7µs | 5.8µs | 8% | 10 | 13K ops/s |
| Open database (empty) | 102.3µs | 102.0µs | 4.4µs | 4% | 7 | 10K ops/s |
| Open database (100k items) | 125.3µs | 125.5µs | 6.5µs | 5% | 7 | 8K ops/s |
| Create item | 9.8µs | 9.7µs | 1.5µs | 16% | 10 | 102K ops/s |
| Read item | 7.2µs | 6.5µs | 2.2µs | 31% | 10 | 138K ops/s |
| Update item | 7.3µs | 7.2µs | 1.0µs | 13% | 10 | 137K ops/s |
| Bulk create 100 items | 91.5µs | 91.0µs | 2.1µs | 2% | 10 | 11K ops/s |
| Bulk read 100 items | 112.8µs | 111.6µs | 4.5µs | 4% | 10 | 9K ops/s |
| Write 100k items | 104.9ms | 103.5ms | 2.4ms | 2% | 7 | 10 ops/s |
| Read 100k items (cold) | 37.2ms | 36.5ms | 3.7ms | 10% | 7 | 27 ops/s |
| Read 100k items (warm) | 36.2ms | 36.2ms | 501.5µs | 1% | 7 | 28 ops/s |
| Filter query cold (100 items) | 22.6µs | 22.1µs | 1.3µs | 6% | 10 | 44K ops/s |
| Filter query warm (100 items) | 15.1µs | 14.5µs | 1.6µs | 10% | 10 | 66K ops/s |
| Filter query cold (100k → 1k results) | 311.8µs | 312.7µs | 5.9µs | 2% | 10 | 3K ops/s |
| Filter query warm (100k → 1k results) | 313.7µs | 304.8µs | 27.6µs | 9% | 10 | 3K ops/s |
| Filter query cold (100k → 10k results) | 3.1ms | 3.1ms | 45.0µs | 1% | 10 | 323 ops/s |
| Filter query warm (100k → 10k results) | 3.0ms | 3.0ms | 17.8µs | 1% | 10 | 336 ops/s |
| Filter + sort query cold (100 items) | 13.8µs | 12.5µs | 3.5µs | 26% | 10 | 73K ops/s |
| Filter + sort query warm (100 items) | 1.8µs | 1.5µs | 0.8µs | **43%** | 10 | 543K ops/s |
| Live query update (100 items) | 518.8µs | 519.8µs | 21.4µs | 4% | 20 | 2K ops/s |
| Live query update (1k items) | 2.2ms | 2.1ms | 425.0µs | 20% | 20 | 463 ops/s |
| Live query update (10k items) | 14.5ms | 14.5ms | 1.5ms | 10% | 20 | 69 ops/s |
| Count operation | 5.0µs | 4.6µs | 1.3µs | 25% | 10 | 200K ops/s |
| Keys operation | 9.0µs | 7.6µs | 3.8µs | **43%** | 10 | 112K ops/s |
{/* BENCH:stats-node:END */}
</TabItem>
<TabItem value="stats-browser" label="Browser">

{/* BENCH:stats-browser:START */}
### GoatDB

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 11.9ms | 11.8ms | 652.7µs | 5% | 10 | 84 ops/s |
| Open database (empty) | 1.8ms | 1.7ms | 357.4µs | 20% | 7 | 551 ops/s |
| Open database (100k items) | 655.2ms | 662.2ms | 20.2ms | 3% | 7 | 2 ops/s |
| Create item | 45.0µs | 45.0µs | 12.7µs | 28% | 10 | 22K ops/s |
| Read item | 2.0µs | \<0.1µs | 2.6µs | **129%** | 10 | 500K ops/s |
| Update item | 6.5µs | 5.0µs | 3.4µs | **52%** | 10 | 154K ops/s |
| Bulk create 100 items | 4.9ms | 4.9ms | 277.1µs | 6% | 10 | 204 ops/s |
| Bulk read 100 items | 185.0µs | 180.0µs | 12.9µs | 7% | 10 | 5K ops/s |
| Read 100k items (cold) | 223.1ms | 223.5ms | 3.3ms | 1% | 7 | 4 ops/s |
| Read 100k items (warm) | 5.4ms | 4.7ms | 1.2ms | 22% | 7 | 186 ops/s |
| Filter query cold (100 items) | 260.0µs | 32.5µs | 699.5µs | **269%** | 10 | 4K ops/s |
| Filter query warm (100 items) | 2.5µs | \<0.1µs | 4.9µs | **194%** | 10 | 400K ops/s |
| Filter query cold (100k → 1k results) | 600.7ms | 600.7ms | 8.4ms | 1% | 10 | 2 ops/s |
| Filter query warm (100k → 1k results) | \<0.1µs | \<0.1µs | \<0.1µs | 0% | 10 | — |
| Filter query cold (100k → 10k results) | 600.7ms | 600.9ms | 6.6ms | 1% | 7 | 2 ops/s |
| Filter query warm (100k → 10k results) | \<0.1µs | \<0.1µs | \<0.1µs | 0% | 7 | — |
| Filter + sort query cold (100 items) | 172.5µs | 5.0µs | 520.9µs | **302%** | 10 | 6K ops/s |
| Filter + sort query warm (100 items) | 1.0µs | \<0.1µs | 2.1µs | **211%** | 10 | 1.00M ops/s |
| Live query update (100 items) | 173.3µs | 165.0µs | 25.0µs | 14% | 20 | 6K ops/s |
| Live query update (1k items) | 1.4ms | 1.4ms | 81.1µs | 6% | 20 | 710 ops/s |
| Live query update (10k items) | 42.4ms | 42.4ms | \<0.1µs | 0% | 1 | 24 ops/s |
| Count operation | 1.5µs | \<0.1µs | 2.4µs | **161%** | 10 | 667K ops/s |
| Keys operation | 5.5µs | 5.0µs | 4.4µs | **80%** | 10 | 182K ops/s |

### GoatDB JSONL

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 12.6ms | 12.2ms | 1.4ms | 11% | 10 | 79 ops/s |
| Open database (empty) | 2.3ms | 2.2ms | 917.7µs | **39%** | 7 | 430 ops/s |
| Open database (100k items) | 1236.0ms | 1258.7ms | 89.1ms | 7% | 7 | 1 ops/s |
| Create item | 23.5µs | 25.0µs | 4.1µs | 18% | 10 | 43K ops/s |
| Read item | 0.5µs | \<0.1µs | 1.6µs | **316%** | 10 | 2.00M ops/s |
| Update item | 5.0µs | 5.0µs | 2.4µs | **47%** | 10 | 200K ops/s |
| Bulk create 100 items | 4.8ms | 4.7ms | 243.9µs | 5% | 10 | 210 ops/s |
| Bulk read 100 items | 154.0µs | 155.0µs | 8.1µs | 5% | 10 | 6K ops/s |
| Read 100k items (cold) | 94.2ms | 83.7ms | 27.6ms | 29% | 7 | 11 ops/s |
| Read 100k items (warm) | 5.2ms | 4.8ms | 974.8µs | 19% | 7 | 194 ops/s |
| Filter query cold (100 items) | 191.5µs | 15.0µs | 552.9µs | **289%** | 10 | 5K ops/s |
| Filter query warm (100 items) | 0.5µs | \<0.1µs | 1.6µs | **316%** | 10 | 2.00M ops/s |
| Filter query cold (100k → 1k results) | 601.2ms | 600.0ms | 4.5ms | 1% | 10 | 2 ops/s |
| Filter query warm (100k → 1k results) | 0.5µs | \<0.1µs | 1.6µs | **316%** | 10 | 2.00M ops/s |
| Filter query cold (100k → 10k results) | 600.4ms | 599.4ms | 5.2ms | 1% | 7 | 2 ops/s |
| Filter query warm (100k → 10k results) | \<0.1µs | \<0.1µs | \<0.1µs | 0% | 7 | — |
| Filter + sort query cold (100 items) | 186.5µs | 5.0µs | 568.8µs | **305%** | 10 | 5K ops/s |
| Filter + sort query warm (100 items) | 1.5µs | \<0.1µs | 2.4µs | **161%** | 10 | 667K ops/s |
| Live query update (100 items) | 144.5µs | 145.0µs | 7.2µs | 5% | 20 | 7K ops/s |
| Live query update (1k items) | 1.2ms | 1.2ms | 53.7µs | 4% | 20 | 825 ops/s |
| Live query update (10k items) | 43.8ms | 43.8ms | \<0.1µs | 0% | 1 | 23 ops/s |
| Count operation | 2.0µs | \<0.1µs | 3.5µs | **175%** | 10 | 500K ops/s |
| Keys operation | 2.0µs | \<0.1µs | 2.6µs | **129%** | 10 | 500K ops/s |

### SQLite

| Operation | Average | Median | Stddev | CV | Samples | Throughput |
|-----------|---------|--------|--------|----|---------|------------|
| Create instance | 10.8ms | 10.8ms | 904.5µs | 8% | 10 | 93 ops/s |
| Open database (empty) | 2.9µs | 5.0µs | 2.7µs | **94%** | 7 | 350K ops/s |
| Open database (100k items) | 2.8ms | 2.8ms | 96.2µs | 3% | 7 | 357 ops/s |
| Create item | 4.4ms | 4.4ms | 172.7µs | 4% | 10 | 229 ops/s |
| Read item | 515.5µs | 497.5µs | 61.5µs | 12% | 10 | 2K ops/s |
| Update item | 3.7ms | 3.7ms | 178.3µs | 5% | 10 | 269 ops/s |
| Bulk create 100 items | 6.8ms | 6.8ms | 161.3µs | 2% | 10 | 146 ops/s |
| Bulk read 100 items | 45.7ms | 44.7ms | 3.3ms | 7% | 10 | 22 ops/s |
| Read 100k items (cold) | 378.8ms | 380.0ms | 3.9ms | 1% | 7 | 3 ops/s |
| Read 100k items (warm) | 347.5ms | 346.3ms | 10.7ms | 3% | 7 | 3 ops/s |
| Filter query cold (100 items) | 631.5µs | 635.0µs | 31.4µs | 5% | 10 | 2K ops/s |
| Filter query warm (100 items) | 812.0µs | 625.0µs | 584.9µs | **72%** | 10 | 1K ops/s |
| Filter query cold (100k → 1k results) | 3.9ms | 3.9ms | 106.7µs | 3% | 10 | 254 ops/s |
| Filter query warm (100k → 1k results) | 3.8ms | 3.1ms | 1.3ms | **35%** | 10 | 261 ops/s |
| Filter query cold (100k → 10k results) | 35.6ms | 35.3ms | 828.4µs | 2% | 10 | 28 ops/s |
| Filter query warm (100k → 10k results) | 29.2ms | 28.3ms | 1.8ms | 6% | 10 | 34 ops/s |
| Filter + sort query cold (100 items) | 498.0µs | 487.5µs | 93.8µs | 19% | 10 | 2K ops/s |
| Filter + sort query warm (100 items) | 469.5µs | 465.0µs | 35.1µs | 7% | 10 | 2K ops/s |
| Live query update (100 items) | 474.5ms | 455.9ms | 68.7ms | 14% | 20 | 2 ops/s |
| Live query update (1k items) | 4432.8ms | 4429.7ms | 42.7ms | 1% | 20 | 0 ops/s |
| Live query update (10k items) | 43846.9ms | 43796.0ms | 205.1ms | 0% | 20 | — |
| Count operation | 446.0µs | 442.5µs | 24.2µs | 5% | 10 | 2K ops/s |
| Keys operation | 459.0µs | 455.0µs | 17.9µs | 4% | 10 | 2K ops/s |
{/* BENCH:stats-browser:END */}
</TabItem>
</Tabs>

</details>

## Running Your Own Benchmarks

```bash
git clone https://github.com/goatplatform/goatdb
cd goatdb
deno task bench
```

The benchmark suite runs on Deno, Node.js, and browser automatically.
