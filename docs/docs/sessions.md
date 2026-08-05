---
id: sessions
title: Sessions and Users
sidebar_position: 4
slug: /sessions
---

import SessionIdentity from '@site/src/components/diagrams/SessionIdentity';
import SessionSigning from '@site/src/components/diagrams/SessionSigning';
import SessionAudit from '@site/src/components/diagrams/SessionAudit';

# Sessions and Users

When work is delegated to AI agents, the first audit question is: who did what —
a human, or an agent? GoatDB's answer is signed provenance: in secure mode
(default), every commit is signed by the session that produced it, so the
[commit graph](/docs/commit-graph) doubles as an audit trail for delegated work.
Mapping a session to a specific human, agent, or tool is the application's
responsibility (see [Session vs Actor](#key-distinction-session-vs-actor)).

[GoatDB](/) implements a robust session-based authentication system that
provides secure and flexible [user management](/docs/authorization). This
document explains how sessions work, their security implications, and how they
integrate with [user management](/docs/authorization).

## Key Distinction: Session vs Actor

Session signatures prove that a commit originated from the holder of a **session
key**, not from a verified real-world identity. The application is responsible
for mapping sessions to actors such as humans, agents, services, or tools.

This is a deliberate design choice. It means:

- A single human may use multiple sessions across devices.
- An agent may have its own sessions independent of any human.
- A service may share a session across multiple invocations.
- Session ownership (`session.owner`) is an application-level field, not a
  cryptographically verified identity claim.

### Trusted Mode Exception

In [trusted mode](#trusted-mode), cryptographic signing and session verification
are bypassed entirely. This is suitable for trusted environments where security
is handled at a different layer — but it means signed provenance guarantees are
lost.

## Understanding Session-Based Authentication

At its core, GoatDB's authentication system revolves around sessions - secure
connections to the database that are represented by **Ed25519 public/private key
pairs**. The private key is generated and stored exclusively on the peer's
machine, never leaving its local storage. Only the corresponding public key is
shared with the GoatDB network.

<SessionIdentity />

Sessions come in two forms: identified sessions, which are tied to specific user
IDs and peers, and anonymous sessions, which are only associated with specific
peers. Each session has a default expiration period of 30 days, though this can
be configured based on your security requirements. Session expiration serves as
an automatic key rotation mechanism - once a session expires, its private key
can no longer be used to sign new commits, effectively forcing the creation of a
new session with fresh cryptographic keys.

For additional security, sessions can be manually revoked by editing their
expiration time to a past date. Since sessions are regular items in the system,
this forced logout is achieved by updating the session's expiration field. Note
that only root users (typically servers) have the authority to modify sessions,
ensuring that session management remains under administrative control.

In secure mode (the default), every commit is cryptographically signed with
the session's private key on the peer. The signature verifies the commit's
integrity and proves that it originated from the holder of the signing session
key. It does not establish the creator's real-world identity; the application
maps actors to sessions. In [trusted mode](#trusted-mode), signing,
verification, authorization, and provenance are disabled.

<SessionSigning />

## Distributed Security Architecture

In secure mode (the default), every commit is signed so peers can verify its
integrity and signing session. Reads are local and not signed. Invalid or unauthorized changes are rejected
during verification before entering the [commit graph](/docs/commit-graph).
Trusted mode disables these guarantees.

<SessionAudit />

Clients maintain a full local commit graph for each repository they open and, in
secure mode, verify operations independently. A replica can restore only the
repositories and history it retains. Recovery therefore requires an available
authorized replica with the relevant commit history; an arbitrary client cannot
restore an arbitrary peer. Trusted mode provides no provenance checks.

This distributed verification system ensures data integrity even in challenging
scenarios like network partitions, peer failures, or malicious actors. Clients
can independently verify the database state, eliminating single points of
failure in the verification process.

## Trusted Mode

For applications where security is handled at a different layer or in trusted
environments (such as microservices running in the cloud without direct client
interaction), [GoatDB](/) offers a trusted mode that bypasses cryptographic
verification and security controls. This mode can significantly
[improve performance](/docs/benchmarks#configuration-variants) by skipping
commit signing and verification.

:::note

Trusted mode is particularly useful in scenarios where:

- The application runs in a controlled, trusted environment
- Security is handled at a different layer (e.g., network security, container
  isolation)
- Performance is a critical requirement
- The database is used as a backend service without direct client interaction
- As an active-active in-memory caching layer for performance optimization

:::

To enable trusted mode, set the `trusted` flag to `true` when creating a DB
instance:

```typescript
const db = new GoatDB({
  path: '/path/to/db',
  trusted: true,
});
```

:::warning

Note that trusted mode disables several security features:

- Cryptographic **signing** and **verification** of commits
- **Authorization** rules and protection against unauthorized modifications
- **Provenance** tracking and distributed security guarantees

Use trusted mode with caution and only in environments where the security
tradeoffs are acceptable.

:::

## User Management Integration

GoatDB offers flexible user management options to accommodate different
deployment scenarios. You can choose between two approaches:

1. **Internal Management**: Users are stored and managed directly in GoatDB
   using the `/sys/users` repository.
2. **External Management**: Users are managed by an external system, with GoatDB
   only receiving user information through session ownership.

This flexibility allows you to:

- Use GoatDB's built-in user management
- Integrate with external identity providers
- Support multiple authentication methods
- Maintain security while being system-agnostic
- Allow anonymous access where appropriate
- Gradually upgrade anonymous sessions to identified ones
