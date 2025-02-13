---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
title: Home
nav_exclude: true
---

# The Edge-Native Database

GoatDB is a real-time, distributed Version Control Database (VCDB). By running
tasks like reading and writing on the client side, it ensures fast performance
and offline functionality. With causal consistency and an edge-native design,
GoatDB simplifies development and supports scalable, modern workloads.

If you like what we're building, please star our
[GitHub project]([https://](https://github.com/goatplatform/goatdb)) ⭐️. We
really appreciate it! 🙏

## Getting Started

Before continuing, make sure you have Deno 2+ installed. If not, install it from
[here](https://docs.deno.com/runtime/getting_started/installation/). Then, run
the following commands inside your project's directory.

1. `deno add jsr:@goatdb/goatdb`
2. `deno run -A jsr:@goatdb/goatdb/init`

👉 Head over to the [Tutorial](/tutorial) page for the full instructions.

## Status

GoatDB is currently in **public beta**. While it has been used in production
internally at [ovvio.io](https://ovvio.io) for over a year, its API is still
subject to change, and there may be undiscovered bugs or edge cases.

We recommend testing thoroughly before using in production systems. **Use at
your own risk.**

We’d love to hear your feedback! For any questions or suggestions, contact us
at:

`ofri [at] goatdb [dot] com`

## Runtime Support

GoatDB currently runs on Deno and we're actively working on supporting
additional JavaScript runtimes including:

- Node.js
- Bun
- Cloudflare Workers
- Other edge runtimes

Stay tuned for updates as we expand runtime compatibility!

## UI Framework Support

GoatDB currently provides first-class support for React through our React hooks
API. We're actively working on supporting additional UI frameworks to make
GoatDB accessible to more developers.

## GoatDB Use Cases

GoatDB is designed to address a variety of scenarios, making it a versatile
solution for modern applications. Below are the primary use cases:

### 1. **Data Synchronization** 🔄

Synchronize data across multiple devices in real-time, ensuring consistency and
seamless user experience.

### 2. **Multi-Agent Communication** 🤖

Enable reliable communication and state synchronization between autonomous
agents in multi-agent systems, with built-in conflict resolution and eventual
consistency guarantees.

### 3. **Hallucination-Safe Enclaves** 🔒

Create secure data sandboxes to validate LLM outputs and prevent hallucinations,
allowing safe experimentation with AI models without compromising the main
dataset.

### 4. **Vector Search** 🔍 (Coming Soon)

Support for vector embeddings and similarity search is in development
([tracking issue](https://github.com/goatplatform/goatdb/issues/15)), enabling
semantic search and AI-powered features.

### 5. **ETL Pipeline** 🔄

Serve as a lightweight, self-contained ETL (Extract, Transform, Load) pipeline,
leveraging GoatDB's schema validation and distributed processing capabilities to
efficiently transform and migrate data between systems.

### 6. **Database Migration** 🔄

Facilitate smooth transitions between different database systems by using GoatDB
as an intermediary layer, allowing gradual migration of data and functionality
while maintaining application stability.

### 7. **Offline Operation** 🛠️

Enable continuous functionality even during server downtime, ensuring your
application remains reliable and responsive.

### 8. **Privacy-First Backup** 🔐

Move data end-to-end between clients, ensuring that sensitive information is
never exposed to the central server.

### 9. **Collaborative Editing** 👥

Allow multiple users to collaboratively edit and share the same data, perfect
for teamwork and shared workflows.

### 10. **Rapid Prototyping** ⚡

Support fast product iteration cycles with flexible compatibility for frequent
schema or structural changes.

### 11. **Data Integrity Auditing** 📈

Protect against fraudulent data manipulation and maintain trust by preventing
unauthorized modifications.

### 12. **Read-Heavy Optimization** 📊

Optimize for cost and performance in read-intensive workloads, making your
application more efficient.
