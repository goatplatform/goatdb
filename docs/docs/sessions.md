---
id: sessions
title: Sessions and Users
sidebar_position: 4
slug: /sessions
---

import KeyGeneration from '@site/src/components/diagrams/KeyGeneration';
import SigningVerification from '@site/src/components/diagrams/SigningVerification';
import DistributedSecurity from '@site/src/components/diagrams/DistributedSecurity';

# Sessions and Users

[GoatDB](/) implements a robust session-based authentication system that
provides secure and flexible [user management](/docs/authorization). This document
explains how sessions work, their security implications, and how they integrate
with [user management](/docs/authorization).

## Understanding Session-Based Authentication

At its core, GoatDB's authentication system revolves around sessions - secure
connections to the database that are represented by **ECDSA P-384 public/private
key pairs**. The private key is generated and stored exclusively on the peer's
machine, never leaving its local storage. Only the corresponding public key is
shared with the GoatDB network.

<KeyGeneration />

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

Every operation in [GoatDB](/) is cryptographically signed using the session's
private key on the peer's machine. This signature serves two critical security
functions: it verifies the integrity of the operation's content (ensuring it
hasn't been tampered with) and proves the identity of the operation's creator.
This dual verification system creates a robust foundation for both data
integrity and accountability.

<SigningVerification />

## Distributed Security Architecture

The public/private key design enables a powerful distributed security model.
Every operation in [GoatDB](/) is cryptographically signed, allowing all peers
in the network to verify its authenticity. This creates a tamper-proof
[commit graph](/docs/commit-graph) where each change can be traced back to its
authorized source, with invalid or unauthorized changes being automatically
rejected by the network.

<DistributedSecurity />

A key feature of this architecture is the client-as-replica design. Clients
maintain their own copy of the [commit graph](/docs/commit-graph) and verify all
operations independently. This enables clients to act as replicas of the
database state, providing resilience against peer failures. If a peer crashes,
any client can safely restore the peer's state by replaying the verified commit
graph and ensuring all operations were properly signed.

This distributed verification system ensures data integrity even in challenging
scenarios like network partitions, peer failures, or malicious actors. Clients
can independently verify the database state, eliminating single points of
failure in the verification process.

## Trusted Mode

For applications where security is handled at a different layer or in trusted
environments (such as microservices running in the cloud without direct client
interaction), [GoatDB](/) offers a trusted mode that bypasses cryptographic
verification and security controls. This mode can significantly
[improve performance](/docs/benchmarks/#trusted-mode) by skipping commit signing and
verification.

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

- Cryptographic signing of commits
- Skips authorization rules
- Protection against unauthorized modifications
- Distributed security guarantees

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
