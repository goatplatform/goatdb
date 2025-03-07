---
permalink: /benchmarks/
layout: default
title: Benchmarks
nav_order: 9
---

# GoatDB Benchmarks

GoatDB's benchmarks provide a performance comparison between GoatDB's different
operational modes and SQLite. These benchmarks help understand the performance
characteristics and tradeoffs of each approach.

All benchmarks were performed on the following configuration:

- CPU: Intel(R) Core(TM) i7-8850H CPU @ 2.60GHz
- Runtime: Deno 2.2.3 (x86_64-apple-darwin)

## Summary

The table below compares performance across GoatDB's operational modes and
SQLite:

| Benchmark                    | GoatDB (Default) | GoatDB (Trusted) | SQLite       |
| ---------------------------- | ---------------- | ---------------- | ------------ |
| Create instance              | 5.1 ms           | 4.6 ms           | **203.2 µs** |
| Open repository (empty)      | 1.4 ms           | 1.5 ms           | **1.1 ms**   |
| Open repository (100k items) | 969.1 ms         | 1.1 s            | **186.3 µs** |
| Create single item           | 3.0 ms           | 2.0 ms           | **815.6 µs** |
| Read item by path            | **2.0 µs**       | **2.5 µs**       | 67.0 µs      |
| Update item                  | 1.8 ms           | **327.5 µs**     | 780.6 µs     |
| Bulk create 100 items        | 98.1 ms          | 67.1 ms          | **1.5 ms**   |
| Bulk read 100 items          | **421.8 µs**     | **468.5 µs**     | 1.7 ms       |
| Simple query                 | 264.1 µs         | 324.2 µs         | **149.0 µs** |
| Complex query with sort      | 144.1 µs         | 207.2 µs         | **97.1 µs**  |
| Repository operations: count | **4.7 µs**       | **4.6 µs**       | 64.7 µs      |
| Repository operations: keys  | **7.9 µs**       | **7.9 µs**       | 81.6 µs      |

GoatDB is a memory-first database built on an append-only distributed commit
graph stored as a log of commits on disk. This design currently requires the
entire commit graph to be present in memory before any operations can be
performed on it. This is why opening a repository takes time proportional to the
number of commits it contains. Most of this time is spent on deserializing and
constructing the in-memory representation of the commit graph. We're working on
a zero-copy format that will skip most of this work (~90% of the).

SQLite shines in query performance with its decades of battle-tested
optimizations, though GoatDB's incremental queries perform competitively in
real-world scenarios despite their simpler implementation.

It's worth noting that GoatDB is implemented in TypeScript for browser
compatibility, while SQLite is written in C with decades of optimization. This
difference in language and maturity explains many performance gaps. SQLite's
superior performance in queries and database creation demonstrates its status as
a highly optimized database engine refined since 2000.

## Default Mode

GoatDB offers two operational modes: Default and Trusted. The benchmarks below
show performance in Default mode, which includes all security and cryptographic
controls. While these controls add some performance overhead, they enable
critical features such as:

- Cryptographically verified data integrity
- Secure multi-user collaboration
- Ability for clients to securely restore a crashed server
- Protection against unauthorized data modifications
- Full audit trail of all changes

For performance-critical applications where these security features aren't
required, see the Trusted mode benchmarks below, which offer significantly
better performance.

| Benchmark                    | time/iter (avg) | p75      | p99      | p995     |
| ---------------------------- | --------------- | -------- | -------- | -------- |
| Create instance              | 5.1 ms          | 5.4 ms   | 9.1 ms   | 9.1 ms   |
| Open repository (empty)      | 1.4 ms          | 1.5 ms   | 1.8 ms   | 1.8 ms   |
| Open repository (100k items) | 969.1 ms        | 973.6 ms | 980.6 ms | 980.6 ms |
| Create single item           | 3.0 ms          | 3.2 ms   | 3.2 ms   | 3.2 ms   |
| Read item by path            | 2.0 µs          | 2.0 µs   | 2.5 µs   | 2.5 µs   |
| Update item                  | 1.8 ms          | 1.9 ms   | 2.2 ms   | 2.2 ms   |
| Bulk create 100 items        | 98.1 ms         | 77.5 ms  | 402.4 ms | 402.4 ms |
| Bulk read 100 items          | 421.8 µs        | 443.9 µs | 487.5 µs | 487.5 µs |
| Simple query                 | 264.1 µs        | 264.1 µs | 1.3 ms   | 1.3 ms   |
| Complex query with sort      | 144.1 µs        | 157.3 µs | 215.2 µs | 215.2 µs |
| Repository operations: count | 4.7 µs          | 4.8 µs   | 7.6 µs   | 7.6 µs   |
| Repository operations: keys  | 7.9 µs          | 8.2 µs   | 9.2 µs   | 9.2 µs   |

## Trusted Mode

Trusted mode bypasses cryptographic verification and security controls for
improved performance. This mode is suitable for applications where security is
handled at a different layer or in trusted environments, such as microservices
running in the cloud without direct client interaction.

| Benchmark                             | time/iter (avg) | p75      | p99      | p995     |
| ------------------------------------- | --------------- | -------- | -------- | -------- |
| Trusted: Create instance              | 4.6 ms          | 4.9 ms   | 7.7 ms   | 7.7 ms   |
| Trusted: Open repository (empty)      | 1.5 ms          | 1.5 ms   | 4.2 ms   | 4.2 ms   |
| Trusted: Open repository (100k items) | 1.1 s           | 1.1 s    | 1.7 s    | 1.7 s    |
| Trusted: Create single item           | 2.0 ms          | 2.1 ms   | 2.5 ms   | 2.5 ms   |
| Trusted: Read item by path            | 2.5 µs          | 2.7 µs   | 3.3 µs   | 3.3 µs   |
| Trusted: Update item                  | 327.5 µs        | 373.5 µs | 441.0 µs | 441.0 µs |
| Trusted: Bulk create 100 items        | 67.1 ms         | 78.8 ms  | 80.6 ms  | 80.6 ms  |
| Trusted: Bulk read 100 items          | 468.5 µs        | 462.9 µs | 952.9 µs | 952.9 µs |
| Trusted: Simple query                 | 324.2 µs        | 333.3 µs | 382.0 µs | 382.0 µs |
| Trusted: Complex query with sort      | 207.2 µs        | 222.7 µs | 242.8 µs | 242.8 µs |
| Trusted: Repository operations: count | 4.6 µs          | 4.5 µs   | 7.1 µs   | 7.1 µs   |
| Trusted: Repository operations: keys  | 7.9 µs          | 8.6 µs   | 9.1 µs   | 9.1 µs   |

## SQLite Comparison

SQLite is currently the leading choice in embedded databases, known for its
reliability and performance. While SQLite doesn't provide any security controls
nor synchronizes across devices, its benchmark is provided here for reference
purposes.

GoatDB offers features like cryptographic verification, multi-device
synchronization, and access controls that SQLite doesn't provide. However, it's
useful to compare performance with this industry standard to understand the
trade-offs between security features and raw performance.

The following benchmarks were conducted using the same test data and similar
operations to provide a fair comparison:

| Benchmark                          | time/iter (avg) | p75      | p99      | p995     |
| ---------------------------------- | --------------- | -------- | -------- | -------- |
| SQLite: Create instance            | 203.2 µs        | 195.5 µs | 396.0 µs | 506.9 µs |
| SQLite: Create table               | 1.1 ms          | 1.1 ms   | 2.0 ms   | 2.2 ms   |
| SQLite: Open database (100k items) | 186.3 µs        | 199.9 µs | 332.2 µs | 342.4 µs |
| SQLite: Create single item         | 815.6 µs        | 889.9 µs | 1.2 ms   | 1.2 ms   |
| SQLite: Read item by ID            | 67.0 µs         | 71.6 µs  | 121.7 µs | 126.0 µs |
| SQLite: Update item                | 780.6 µs        | 891.5 µs | 1.2 ms   | 1.3 ms   |
| SQLite: Bulk create 100 items      | 1.5 ms          | 1.5 ms   | 2.3 ms   | 3.0 ms   |
| SQLite: Bulk read 100 items        | 1.7 ms          | 1.7 ms   | 2.3 ms   | 2.4 ms   |
| SQLite: Simple query               | 149.0 µs        | 155.8 µs | 291.5 µs | 491.8 µs |
| SQLite: Complex query with sort    | 97.1 µs         | 101.8 µs | 169.7 µs | 233.7 µs |
| SQLite: Count operation            | 64.7 µs         | 65.1 µs  | 131.7 µs | 366.9 µs |
| SQLite: Keys operation             | 81.6 µs         | 84.9 µs  | 197.0 µs | 211.6 µs |
