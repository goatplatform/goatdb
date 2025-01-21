---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
title: Home
nav_exclude: true
---

# The Edge-Native Database

GoatDB is a real-time, distributed Version Control Database (VCDB). By running tasks like reading and writing on the client side, it ensures fast performance and offline functionality. With causal consistency and an edge-native design, GoatDB simplifies development and supports scalable, modern workloads.

If you like what we're building, please star our [GitHub project](<[https://](https://github.com/goatplatform/goatdb)>) ⭐️. We really appreciate it! 🙏

## Getting Started

Before continuing, make sure you have Deno 2+ installed. If not, install it from [here](https://docs.deno.com/runtime/getting_started/installation/). Then, run the following commands inside your project's directory.

1. `deno add jsr:@goatdb/goatdb`
2. `deno run -A jsr:@goatdb/goatdb/init`

👉 Head over to the [Getting Started](/getting-started) page for the full instructions.

## Why GoatDB?

GoatDB empowers frontend developers by simplifying the complexities of building modern, distributed applications. It prioritizes:

- **Ease of Development:** Frontend developers work with an in-memory snapshot, while background synchronization keeps updates consistent across devices.
- **Performance:** Local data processing ensures low latency and responsive applications.
- **Scalability:** GoatDB distributes workloads across client devices, reducing infrastructure costs.
- **Freedom to Deploy Anywhere:** GoatDB can be deployed on any cloud or on-premises environment with a single executable file, giving developers complete control and flexibility in choosing their infrastructure.

## Use Cases

### SaaS B2B

GoatDB enhances UI responsiveness and reduces operational costs for SaaS B2B platforms. Its real-time processing, edge-native design, and scalability lower expenses in both cloud infrastructure and personnel needs, optimizing operational efficiency.

### Prototyping

GoatDB simplifies rapid prototyping with minimal setup and intuitive client-side processing. Its version control for both data and schema supports quick iterations and feature testing, making it ideal for fast-paced, innovation-driven teams.

### Consumer Mobile Apps

GoatDB empowers consumer mobile apps with offline-first functionality, instant responsiveness, and real-time data synchronization. Whether for social networking, e-commerce, or fitness tracking, it ensures users can interact seamlessly even without a stable internet connection. Developers benefit from simplified data handling and improved app performance, enhancing user engagement and retention.

### Education and Gaming

GoatDB supports offline-first learning tools and multiplayer games with real-time synchronization and tamper-proof tracking. It delivers seamless interactions and secure progress tracking for diverse user needs.

### Automotive

GoatDB drives automotive innovation with rapid feature rollouts, secure OTA updates, and offline support. It ensures robust performance and reliability for diagnostics, fleet management, and other critical applications.

### Healthcare and Compliance

GoatDB ensures secure, privacy-compliant data storage with a signed audit log for traceability. Single-tenant deployments, packaged as a single executable, simplify installation and management while providing complete control over infrastructure and compliance needs.

### Agents and Telemetry

GoatDB enables efficient telemetry collection for distributed systems with delta compression and rolling deployments. Its architecture ensures low-resource usage and reliable performance for IoT devices and industrial applications.

## Project Status

GoatDB has been production-tested in Ovvio’s real-time collaboration platform since January 2024 ([https://ovvio.io](https://ovvio.io)). This open-source release decouples the database core for broader adoption. Alongside this, an upcoming managed service platform will make deploying GoatDB even easier, offering features like one-click deployment, automated backups, and infrastructure-free operation for developers.

---

Join us in building the next generation of edge-native, local-first applications!
