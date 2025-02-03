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

👉 Head over to the [Tutorial](/turorial) page for the full instructions.

## Status

This library is in **pre-release** status. While it has been used in production
internally at [ovvio.io](https://ovvio.io) for over a year, its API is still
subject to change, and there may be undiscovered bugs or edge cases.

We are actively working toward a **v0.1 release in Q1 2025**. We welcome
feedback and contributions but recommend caution when integrating it into
critical systems.

**Use at your own risk.**

## Use Cases

GoatDB is designed to address a variety of scenarios, making it a versatile
solution for modern applications. Below are the primary use cases:

### 1. **Data Synchronization** 🔄

Synchronize data across multiple devices in real-time, ensuring consistency and
seamless user experience.

### 2. **Offline Operation** 🛠️

Enable continuous functionality even during server downtime, ensuring your
application remains reliable and responsive.

### 3. **Privacy-First Backup** 🔐

Move data end-to-end between clients, ensuring that sensitive information is
never exposed to the central server.

### 4. **Collaborative Editing** 👥

Allow multiple users to collaboratively edit and share the same data, perfect
for teamwork and shared workflows.

### 5. **Rapid Prototyping** ⚡

Support fast product iteration cycles with flexible compatibility for frequent
schema or structural changes.

### 6. **Data Integrity Auditing** 📈

Protect against fraudulent data manipulation and maintain trust by preventing
unauthorized modifications.

### 7. **Read-Heavy Optimization** 📊

Optimize for cost and performance in read-intensive workloads, making your
application more efficient.

### 8. **Secure Sandboxing** 🔒

Create secure data sandboxes for experimentation, testing, or semi-trusted
interactions without compromising the main dataset.

---

We’d love to hear your feedback! For any questions or suggestions, contact us
at:

`ofri [at] goatdb [dot] com`
