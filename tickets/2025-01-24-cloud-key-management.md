# 2025-01-24 - [FEATURE] Cloud-Native Server Key Management for GoatDB Clusters
**Priority**: High

Enable GoatDB server clusters to use cloud provider secret stores (AWS Secrets Manager, Google Secret Manager, Azure Key Vault) for secure key storage and rotation.

## Problem Statement

Currently, GoatDB servers store their cryptographic keys in local `settings.json` files. This creates challenges for:
- Secure key distribution in containerized/cloud environments
- Key rotation without downtime
- Compliance with security best practices
- Multi-server cluster deployments

## Proposed Solution

### 1. Cloud Settings Provider

Create a new `DBSettingsProvider` implementation that integrates with cloud secret stores:

```typescript
// db/settings/cloud.ts
export class CloudSecretSettings implements DBSettingsProvider {
  private secretClient: SecretClient; // AWS/GCP/Azure SDK
  
  constructor(
    readonly secretId: string,
    readonly cloudProvider: 'aws' | 'gcp' | 'azure',
    readonly mode: DBMode,
  ) {
    this.secretClient = this.initializeClient();
  }

  async load(): Promise<void> {
    const secretValue = await this.secretClient.getSecretValue(this.secretId);
    const decoded = JSON.parse(secretValue);
    
    this._settings = {
      currentSession: await decodeSession(decoded.currentSession), // Has private key
      roots: await Promise.all(decoded.roots.map(r => decodeSession(r))), // Public keys only
      trustedSessions: [], // Empty - populated from /sys/sessions repo
    };
  }

  async update(settings: DBSettings): Promise<void> {
    // Only save server identity (not user sessions)
    const encoded = {
      currentSession: await encodeSession(settings.currentSession), // Full session with private key
      roots: await Promise.all(settings.roots.map(s => {
        // Strip private keys from roots - only need public keys for verification
        const publicOnly = { ...s, privateKey: undefined };
        return encodeSession(publicOnly);
      })),
      version: 2,
      lastUpdated: new Date().toISOString(),
    };
    
    await this.secretClient.updateSecret(this.secretId, JSON.stringify(encoded));
  }
}
```

### 2. How It Works

#### Server Identity vs User Data Separation
- **Cloud Secret**: Stores only server identity - typically < 10KB
  - `currentSession`: The active root session WITH private key (for signing)
  - `roots`: Array of root sessions with PUBLIC keys only (for verification)
- **User Sessions**: Stored in `/sys/sessions` repository, synced through normal GoatDB mechanisms
- **Trust Chain**: Root sessions can sign new sessions, creating a verifiable chain of trust

#### Startup Flow
1. Server loads identity from cloud secret store
2. Initializes TrustPool with minimal sessions
3. Opens `/sys/sessions` repository
4. Automatically loads all user sessions from the repository
5. New sessions discovered through sync are added to trust pool

### 3. Key Rotation Process

#### Zero-Downtime Rotation with Automatic Rollback

```typescript
// 1. Current state: Server using root key A
{
  "currentSession": { // Full session with private key
    "id": "root-A",
    "privateKey": "...",
    "publicKey": "...",
    "owner": "root",
    "expiration": "2025-12-31"
  },
  "roots": [{ // Public keys only for verification
    "id": "root-A",
    "publicKey": "...",
    "owner": "root",
    "expiration": "2025-12-31"
  }]
}

// 2. Before rotation, backup current session with version
await secretClient.updateSecret('goatdb/prod-cluster/root', currentSecret, {
  versionLabel: 'stable'
});

// 3. Generate new root key B, signed by A
const newRoot = await generateSession('root');
const signedCommit = await createSessionCommit(currentRoot, newRoot);

// 4. Update cloud secret with new key
{
  "currentSession": { // New private key for signing
    "id": "root-B",
    "privateKey": "...",
    "publicKey": "...",
    "owner": "root",
    "expiration": "2026-12-31"
  },
  "roots": [
    { "id": "root-A", "publicKey": "..." }, // Old public key for verification
    { "id": "root-B", "publicKey": "..." }  // New public key
  ],
  "rotatedFrom": "root-A",
  "rotatedAt": "2025-01-24T12:00:00Z"
}

// 5. If rotation fails, rollback is simple:
await secretClient.updateSecret('goatdb/prod-cluster/root', 
  await secretClient.getSecretVersion('stable')
);
```

#### Rollback Strategy

The rollback mechanism leverages cloud provider versioning:

1. **Before Rotation**: Tag current secret version as 'stable'
2. **During Rotation**: Create new version with rotated keys
3. **If Issues Detected**: Restore 'stable' version
4. **After Verification**: Update 'stable' tag to new version

This approach:
- Uses native cloud provider features (versions/labels)
- Maintains single source of truth
- Enables instant rollback
- Preserves audit trail

#### Key Properties
- No dual-key complexity - GoatDB's design handles it naturally
- Old commits remain valid (immutable, signed by old key)
- New commits signed with new key
- Trust chain preserved through root session signatures

### 4. Cloud Provider Plugins

#### Plugin Architecture
```typescript
interface CloudSecretProvider {
  getSecret(secretId: string): Promise<string>;
  updateSecret(secretId: string, value: string): Promise<void>;
  deleteSecret(secretId: string): Promise<void>;
}

// Implementations
class AWSSecretProvider implements CloudSecretProvider {
  constructor(private region: string) {}
  async getSecret(secretId: string): Promise<string> {
    const client = new SecretsManagerClient({ region: this.region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    return response.SecretString!;
  }
}

class GCPSecretProvider implements CloudSecretProvider {
  constructor(private projectId: string) {}
  async getSecret(secretId: string): Promise<string> {
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({
      name: `projects/${this.projectId}/secrets/${secretId}/versions/latest`
    });
    return version.payload!.data!.toString();
  }
}

class AzureSecretProvider implements CloudSecretProvider {
  constructor(private vaultUrl: string) {}
  async getSecret(secretId: string): Promise<string> {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(this.vaultUrl, credential);
    const secret = await client.getSecret(secretId);
    return secret.value!;
  }
}
```

#### Configuration
```typescript
// Server startup configuration
const server = new Server({
  path: './data',
  settingsProvider: {
    type: 'cloud',
    cloudConfig: {
      provider: 'aws',
      secretId: 'goatdb/prod-cluster/root',
      region: 'us-east-1',
    },
  },
});
```

### 5. Security Benefits

1. **No Secrets in Code**: Keys never touch git, CI/CD, or container images
2. **IAM-Based Access**: Cloud provider IAM controls who can access keys
3. **Audit Trail**: All secret access logged by cloud provider
4. **Automatic Encryption**: Secrets encrypted at rest by cloud KMS
5. **Compliance Ready**: Meets SOC2, HIPAA, PCI requirements

### 6. Implementation Plan

1. Create base `CloudSecretProvider` interface
2. Implement provider-specific adapters (AWS, GCP, Azure)
3. Add `CloudSecretSettings` implementation
4. Modify `GoatDB._createTrustPool()` to support provider selection
5. Add configuration options to `ServerOptions`
6. Create rotation utilities
7. Add documentation and examples

### 7. Testing Strategy

1. Unit tests with mocked secret providers
2. Integration tests with localstack/emulators
3. Cluster rotation tests
4. Backward compatibility tests with file-based settings

## Success Criteria

- Servers can load keys from cloud secret stores
- Key rotation works without downtime
- No performance impact on normal operations
- Clear migration path from file-based settings
- Works with all major cloud providers

## Future Enhancements

- Automatic rotation scheduling
- Multi-region secret replication
- Hardware Security Module (HSM) integration
- Kubernetes secret integration
- HashiCorp Vault support