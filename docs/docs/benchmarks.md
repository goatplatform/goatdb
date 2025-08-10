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

GoatDB's benchmarks provide performance comparisons across different platforms and operational modes against SQLite. These help you understand what performance to expect and the tradeoffs involved.

## Quick Summary

GoatDB is a **memory-first database** that loads entire datasets into memory before operations begin. This design trades initial load time for very fast operations once loaded. It's designed for **offline-first applications** with built-in synchronization and cryptographic security.

**Key tradeoffs vs SQLite:**
- **Much faster reads** once data is loaded (1-2μs vs 10-500μs)  
- **Slower initial loading** (hundreds of ms for large datasets)
- **Built-in security** and synchronization (cryptographically signed commits)
- **Real-time collaboration** with automatic conflict resolution

## Performance by Platform

<Tabs groupId="platform">
<TabItem value="node" label="Node.js" default>

**System:** Apple M4 Pro, 24GB RAM, NVMe SSD  
**Runtime:** node v24.4.1 (darwin arm64)

<div className="benchmark-table">

| Operation | GoatDB | GoatDB-Trusted | SQLite |
|-----------|--------|----------------|--------|
| Create instance | 1.0ms | 1.2ms | <span className="winner">112.2μs</span> |
| Open database (empty) | 422.4μs | 379.0μs | <span className="winner">280.3μs</span> |
| Open database (100k items) | 1.1ms | 840.9μs | <span className="winner">77.7μs</span> |
| Create item | 383.8μs | 363.2μs | <span className="winner">229.9μs</span> |
| Read item by ID | 0.9μs | <span className="winner">0.8μs</span> | 12.4μs |
| Update item | 122.2μs | <span className="winner">90.4μs</span> | 1.2ms |
| Bulk create 100 items | 6.8ms | 1.8ms | <span className="winner">674.6μs</span> |
| Bulk read 100 items | 193.9μs | <span className="winner">147.2μs</span> | 416.4μs |
| Read 100k items | 110.3ms | 417.3ms | <span className="winner">36.2ms</span> |
| Simple query | 377.6μs | <span className="winner">193.3μs</span> | 752.1μs |
| Complex query with sort | <span className="winner">114.5μs</span> | 137.1μs | 742.4μs |
| Count operation | 3.1μs | <span className="winner">1.4μs</span> | 676.4μs |
| Keys operation | 3.3μs | <span className="winner">2.7μs</span> | 647.9μs |

</div>

</TabItem>
<TabItem value="browser" label="Browser">

**System:** Apple M4 Pro (12 cores), 24GB RAM  
**Storage:** OPFS  
**Browser:** Chrome 139.0

<div className="benchmark-table">

| Operation | GoatDB | SQLite |
|-----------|--------|--------|
| Create instance | 16.9ms | <span className="winner">3.6ms</span> |
| Open database (empty) | 911.7μs | <span className="winner">2.5μs</span> |
| Open database (100k items) | 289.3ms | <span className="winner">1.7ms</span> |
| Create item | <span className="winner">1.0ms</span> | 4.1ms |
| Read item by ID | <span className="winner">0.5μs</span> | 566.5μs |
| Update item | <span className="winner">101.5μs</span> | 3.1ms |
| Bulk create 100 items | 21.4ms | <span className="winner">6.8ms</span> |
| Bulk read 100 items | <span className="winner">140.0μs</span> | 44.0ms |
| Read 100k items | <span className="winner">84.5ms</span> | 358.2ms |
| Simple query | 826.0μs | <span className="winner">668.0μs</span> |
| Complex query with sort | 697.0μs | <span className="winner">538.5μs</span> |
| Count operation | <span className="winner">2.0μs</span> | 522.5μs |
| Keys operation | <span className="winner">3.0μs</span> | 512.5μs |

</div>

</TabItem>
<TabItem value="deno" label="Deno">

**System:** Apple M4 Pro, 24GB RAM, NVMe SSD  
**Runtime:** deno 2.4.3 (darwin aarch64)

<div className="benchmark-table">

| Operation | GoatDB | GoatDB-Trusted | SQLite |
|-----------|--------|----------------|--------|
| Create instance | 1.3ms | 1.2ms | <span className="winner">88.6μs</span> |
| Open database (empty) | 522.6μs | 381.2μs | <span className="winner">277.3μs</span> |
| Open database (100k items) | 377.6ms | 361.3ms | <span className="winner">79.7μs</span> |
| Create item | 484.2μs | 383.4μs | <span className="winner">376.5μs</span> |
| Read item by ID | 1.6μs | <span className="winner">1.2μs</span> | 14.0μs |
| Update item | 137.7μs | <span className="winner">82.2μs</span> | 1.0ms |
| Bulk create 100 items | 13.7ms | 2.2ms | <span className="winner">1.0ms</span> |
| Bulk read 100 items | 228.3μs | <span className="winner">208.8μs</span> | 430.8μs |
| Read 100k items | 119.7ms | 368.5ms | <span className="winner">53.4ms</span> |
| Simple query | 321.3μs | <span className="winner">145.6μs</span> | 1.2ms |
| Complex query with sort | <span className="winner">96.9μs</span> | 96.9μs | 1.3ms |
| Count operation | 1.8μs | <span className="winner">1.5μs</span> | 1.5ms |
| Keys operation | 3.2μs | <span className="winner">2.0μs</span> | 1.6ms |

</div>

</TabItem>
</Tabs>

## Understanding the Numbers

:::info GoatDB's Memory-First Design
GoatDB loads the entire dataset into memory before any operations can begin. The "Open database (100k items)" benchmark shows this upfront cost - but this comparison is misleading. SQLite only opens the database file without reading the data, while GoatDB actually loads all 100k items into memory for immediate access.
:::

The numbers above show GoatDB in "durable mode" where every operation explicitly flushes to disk for fair comparison with SQLite's default fsync behavior. This creates an artificially pessimistic view of GoatDB's real-world performance.

:::tip When GoatDB Excels
- **Individual reads**: 1-2μs vs SQLite's 10-500μs  
- **Bulk reads**: Processing many items at once
- **Repository operations**: count, keys operations are nearly instant
- **Real-time queries**: Incremental updates as data changes
:::

In practice, GoatDB doesn't fsync by default. It uses dual-write to both local disk and network peers for redundancy, with explicit flushing available when needed.

:::warning Trade-offs to Consider
- **Initial load time**: Hundreds of milliseconds for large datasets  
- **Memory usage**: Entire dataset must fit in memory
- **Batched writes**: Operations are grouped with a slight delay, achieving write amplification = 1
:::

## Operational Modes

**Default Mode**: Cryptographically signs every commit with ECDSA P-384 for tamper-proof audit trails and secure multi-peer synchronization. In real-world usage, writes to both local disk and network peers without waiting for fsync, providing eventual durability with crash consistency. The benchmarks above artificially add explicit flushing for fair comparison.

**Trusted Mode**: Bypasses cryptographic signing for better performance in controlled environments like backend services. Same durability behavior as default mode - the performance gain comes from skipping cryptography, not durability changes.

## Architecture Notes

GoatDB is built on an **append-only distributed commit graph** stored as a JSON log on disk. This design fundamentally differs from SQLite's B-tree approach:

**Why GoatDB doesn't need fsync like SQLite:**
- **SQLite's B-tree**: In-place updates that can corrupt the database if interrupted during writes
- **GoatDB's append-only log**: New commits are simply appended; incomplete writes are discarded on restart
- **Corruption immunity**: The log truncates to the last valid commit on crash recovery

The benchmarks above show an artificial "durable mode" where GoatDB explicitly flushes after every operation to match SQLite's default fsync behavior. In real-world usage, GoatDB provides:

- **Better write performance** without explicit flushing (up to 10x faster)
- **Dual redundancy** through concurrent local/network persistence
- **Application-controlled durability** via explicit flush when needed

**Application-level sharding**: Rather than growing single large databases, GoatDB uses multiple medium-sized repositories that sync independently. Each user or data group typically gets its own repository, enabling natural horizontal scaling.

## Synchronization Performance

The benchmarks above focus on local database operations. For distributed synchronization between peers, GoatDB exhibits different characteristics:

| Metric | Typical Range | Notes |
|--------|---------------|-------|
| Single item sync | 700-1000ms | End-to-end application latency |
| Concurrent sync (10 items) | 1000-1400ms avg | With queuing overhead |
| Success rate under load | >95% | 10 concurrent operations |

These measurements represent end-to-end latency from item creation on one peer to availability on another, including GoatDB's polling-based sync, Bloom filter exchanges, and processing overhead. Network transmission is ~50-200ms of the total.

:::note
**Measurement methodology**: Unlike the automated benchmarks above, synchronization performance is measured manually in real-world scenarios. Synchronization currently prioritizes consistency and offline-first design over minimal latency, making GoatDB well-suited for collaborative applications but less optimal for high-frequency real-time scenarios. However, this is expected to improve significantly with the [planned sync protocol optimization](https://github.com/goatplatform/goatdb/issues/37), which will reduce end-to-end sync latency and make GoatDB more suitable for low-latency and high-frequency use cases in the future.
:::

## Fast Mode Comparison

For maximum performance, GoatDB can drop both cryptographic signing and fsync while retaining crash-proof storage and network sync:

<Tabs groupId="platform">
<TabItem value="node-fast" label="Node.js" default>

**GoatDB Fast Mode (no signing, no fsync) vs SQLite with `synchronous = OFF`**

<div className="benchmark-table">

| Operation | GoatDB-Fast | SQLite-Fast-Unsafe |
|-----------|-------------|-------------------|
| Create instance | 1.1ms | <span className="winner">65.6μs</span> |
| Open database (empty) | 376.1μs | <span className="winner">314.2μs</span> |
| Create item | <span className="winner">18.5μs</span> | 448.8μs |
| Read item by ID | <span className="winner">1.1μs</span> | 482.2μs |
| Update item | <span className="winner">7.1μs</span> | 633.7μs |
| Bulk create 100 items | 2.3ms | <span className="winner">518.7μs</span> |
| Bulk read 100 items | <span className="winner">18.1μs</span> | 935.0μs |
| Read 100k items | 398.5ms | <span className="winner">133.3ms</span> |
| Simple query | <span className="winner">137.7μs</span> | 678.2μs |
| Complex query with sort | <span className="winner">112.8μs</span> | 591.8μs |
| Count operation | <span className="winner">1.7μs</span> | 474.2μs |
| Keys operation | <span className="winner">3.2μs</span> | 544.0μs |

</div>

</TabItem>
<TabItem value="deno-fast" label="Deno">

**GoatDB Fast Mode (no signing, no fsync) vs SQLite with `synchronous = OFF`**

<div className="benchmark-table">

| Operation | GoatDB-Fast | SQLite-Fast-Unsafe |
|-----------|-------------|-------------------|
| Create instance | 2.2ms | <span className="winner">103.1μs</span> |
| Open database (empty) | 3.2ms | <span className="winner">745.2μs</span> |
| Create item | <span className="winner">23.3μs</span> | 533.5μs |
| Read item by ID | <span className="winner">1.3μs</span> | 585.1μs |
| Update item | <span className="winner">9.6μs</span> | 681.3μs |
| Bulk create 100 items | 2.6ms | <span className="winner">635.5μs</span> |
| Bulk read 100 items | <span className="winner">20.8μs</span> | 1.2ms |
| Read 100k items | 401.5ms | <span className="winner">185.0ms</span> |
| Simple query | <span className="winner">166.9μs</span> | 848.5μs |
| Complex query with sort | <span className="winner">88.8μs</span> | 717.1μs |
| Count operation | <span className="winner">1.6μs</span> | 526.2μs |
| Keys operation | <span className="winner">2.9μs</span> | 570.9μs |

</div>

</TabItem>
</Tabs>

:::info GoatDB Fast Mode
**Fast Mode** drops both cryptographic signing and fsync but retains dual writes to disk and network. This creates a **multi-master embedded cache** that is:
- **Memory-first fast**: All operations work from memory
- **Crash-proof**: Append-only log design prevents corruption
- **Network-synced**: Automatic replication to peers
- **Perfect for backend caching**: Maximum speed with reliability

GoatDB exposes [`sync()`](/docs/api/classes/goatdb#sync) and [`flush()`](/docs/api/classes/goatdb#flush) methods so applications can control synchronization and durability in the rare cases where explicit control is needed.

**SQLite `synchronous = OFF`** risks database corruption on crash, while GoatDB Fast Mode remains crash-proof due to its append-only design.
:::

## Detailed Statistics

<details>
<summary>Expand for detailed percentile breakdowns</summary>

<Tabs groupId="platform">
<TabItem value="stats-node" label="Node.js" default>

### GoatDB Default Mode

| Operation | Average | p95 | p99 | Samples |
|-----------|---------|-----|-----|---------|
| Create instance | 1.0ms | 1.1ms | 1.1ms | 10 |
| Open repository (empty) | 422.4μs | 630.5μs | 630.5μs | 3 |
| Open repository (100k items) | 1.1ms | 1.3ms | 1.3ms | 3 |
| Read 100k items | 110.3ms | 124.6ms | 124.6ms | 3 |
| Create single item | 383.8μs | 445.7μs | 445.7μs | 10 |
| Read item by path | 0.9μs | 1.3μs | 1.3μs | 10 |
| Update item | 122.2μs | 157.3μs | 157.3μs | 10 |
| Bulk create 100 items | 6.8ms | 10.7ms | 10.7ms | 10 |
| Bulk read 100 items | 193.9μs | 254.5μs | 254.5μs | 10 |
| Simple query | 377.6μs | 2.0ms | 2.0ms | 10 |
| Complex query with sort | 114.5μs | 370.6μs | 370.6μs | 10 |
| Repository operations: count | 3.1μs | 15.2μs | 15.2μs | 10 |
| Repository operations: keys | 3.3μs | 6.8μs | 6.8μs | 10 |

### GoatDB Trusted Mode

| Operation | Average | p95 | p99 | Samples |
|-----------|---------|-----|-----|---------|
| Create instance | 1.2ms | 1.4ms | 1.4ms | 10 |
| Open repository (empty) | 379.0μs | 507.4μs | 507.4μs | 3 |
| Open repository (100k items) | 840.9μs | 923.9μs | 923.9μs | 3 |
| Create single item | 363.2μs | 419.8μs | 419.8μs | 10 |
| Read item by path | 0.8μs | 1.3μs | 1.3μs | 10 |
| Update item | 90.4μs | 176.0μs | 176.0μs | 10 |
| Bulk create 100 items | 1.8ms | 1.9ms | 1.9ms | 10 |
| Bulk read 100 items | 147.2μs | 159.2μs | 159.2μs | 10 |
| Read 100k items | 417.3ms | 426.7ms | 426.7ms | 3 |
| Simple query | 193.3μs | 531.1μs | 531.1μs | 10 |
| Complex query with sort | 137.1μs | 459.9μs | 459.9μs | 10 |
| Repository operations: count | 1.4μs | 1.8μs | 1.8μs | 10 |
| Repository operations: keys | 2.7μs | 5.1μs | 5.1μs | 10 |

### SQLite

| Operation | Average | p95 | p99 | Samples |
|-----------|---------|-----|-----|---------|
| Create instance | 112.2μs | 188.5μs | 188.5μs | 10 |
| Create table | 280.3μs | 403.3μs | 403.3μs | 10 |
| Open database (100k items) | 77.7μs | 93.7μs | 93.7μs | 3 |
| Read 100k items | 36.2ms | 39.1ms | 39.1ms | 3 |
| Create single item | 229.9μs | 298.3μs | 298.3μs | 10 |
| Read item by ID | 12.4μs | 15.0μs | 15.0μs | 10 |
| Update item | 1.2ms | 2.5ms | 2.5ms | 10 |
| Bulk create 100 items | 674.6μs | 707.0μs | 707.0μs | 10 |
| Bulk read 100 items | 416.4μs | 431.5μs | 431.5μs | 10 |
| Simple query | 752.1μs | 796.2μs | 796.2μs | 10 |
| Complex query with sort | 742.4μs | 859.4μs | 859.4μs | 10 |
| Count operation | 676.4μs | 1.4ms | 1.4ms | 10 |
| Keys operation | 647.9μs | 749.7μs | 749.7μs | 10 |

</TabItem>
<TabItem value="stats-deno" label="Deno">

### GoatDB Default Mode

| Operation | Average | p95 | p99 | Samples |
|-----------|---------|-----|-----|---------|
| Create instance | 1.3ms | 2.0ms | 2.0ms | 10 |
| Open repository (empty) | 522.6μs | 720.7μs | 720.7μs | 3 |
| Open repository (100k items) | 377.6ms | 519.5ms | 519.5ms | 3 |
| Read 100k items | 119.7ms | 133.0ms | 133.0ms | 3 |
| Create single item | 484.2μs | 925.6μs | 925.6μs | 10 |
| Read item by path | 1.6μs | 2.4μs | 2.4μs | 10 |
| Update item | 137.7μs | 180.6μs | 180.6μs | 10 |
| Bulk create 100 items | 13.7ms | 21.6ms | 21.6ms | 10 |
| Bulk read 100 items | 228.3μs | 318.1μs | 318.1μs | 10 |
| Simple query | 321.3μs | 1.5ms | 1.5ms | 10 |
| Complex query with sort | 96.9μs | 342.9μs | 342.9μs | 10 |
| Repository operations: count | 1.8μs | 2.4μs | 2.4μs | 10 |
| Repository operations: keys | 3.2μs | 5.7μs | 5.7μs | 10 |

### GoatDB Trusted Mode

| Operation | Average | p95 | p99 | Samples |
|-----------|---------|-----|-----|---------|
| Create instance | 1.2ms | 1.7ms | 1.7ms | 10 |
| Open repository (empty) | 381.2μs | 428.5μs | 428.5μs | 3 |
| Open repository (100k items) | 361.3ms | 463.9ms | 463.9ms | 3 |
| Create single item | 383.4μs | 745.0μs | 745.0μs | 10 |
| Read item by path | 1.2μs | 2.0μs | 2.0μs | 10 |
| Update item | 82.2μs | 105.9μs | 105.9μs | 10 |
| Bulk create 100 items | 2.2ms | 2.5ms | 2.5ms | 10 |
| Bulk read 100 items | 208.8μs | 568.9μs | 568.9μs | 10 |
| Read 100k items | 368.5ms | 413.0ms | 413.0ms | 3 |
| Simple query | 145.6μs | 297.1μs | 297.1μs | 10 |
| Complex query with sort | 96.9μs | 316.6μs | 316.6μs | 10 |
| Repository operations: count | 1.5μs | 2.3μs | 2.3μs | 10 |
| Repository operations: keys | 2.0μs | 2.9μs | 2.9μs | 10 |

### SQLite

| Operation | Average | p95 | p99 | Samples |
|-----------|---------|-----|-----|---------|
| Create instance | 88.6μs | 106.9μs | 106.9μs | 10 |
| Create table | 277.3μs | 333.5μs | 333.5μs | 10 |
| Open database (100k items) | 79.7μs | 81.7μs | 81.7μs | 3 |
| Read 100k items | 53.4ms | 56.4ms | 56.4ms | 3 |
| Create single item | 376.5μs | 629.4μs | 629.4μs | 10 |
| Read item by ID | 14.0μs | 20.4μs | 20.4μs | 10 |
| Update item | 1.0ms | 1.4ms | 1.4ms | 10 |
| Bulk create 100 items | 1.0ms | 2.5ms | 2.5ms | 10 |
| Bulk read 100 items | 430.8μs | 464.6μs | 464.6μs | 10 |
| Simple query | 1.2ms | 2.7ms | 2.7ms | 10 |
| Complex query with sort | 1.3ms | 3.6ms | 3.6ms | 10 |
| Count operation | 1.5ms | 2.7ms | 2.7ms | 10 |
| Keys operation | 1.6ms | 3.6ms | 3.6ms | 10 |

</TabItem>
</Tabs>

</details>

## Running Your Own Benchmarks

To replicate these results on your machine:

```bash
git clone https://github.com/goatplatform/goatdb
cd goatdb
deno task bench
```

The benchmark suite runs on Deno, Node.js, and Browser environments automatically, providing comprehensive performance data across all supported platforms.