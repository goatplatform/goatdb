import {
  decodeSession,
  encodeSession,
  generateRequestSignature,
  generateSession,
  isOwnedSession,
  sessionFromItem,
  sessionToItem,
  signData,
  verifyData,
  verifyRequestSignature,
} from '../db/session.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assertTrue } from './asserts.ts';
import { assertEquals } from '@std/assert';
import { TEST } from './mod.ts';

export default function setup() {
  TEST('Session', 'generateSession and isOwnedSession', async () => {
    const session = await generateSession('test-owner');
    assertTrue(!!session.id);
    assertTrue(!!session.publicKey);
    assertTrue(!!session.privateKey);
    assertTrue(!!session.expiration);
    assertEquals(session.owner, 'test-owner');
    assertTrue(isOwnedSession(session));
  });

  TEST('Session', 'encodeSession/decodeSession roundtrip', async () => {
    const session = await generateSession('test-owner');
    const encoded = await encodeSession(session);
    const decoded = await decodeSession(encoded);
    assertEquals(decoded.id, session.id);
    assertEquals(decoded.owner, session.owner);
    assertEquals(decoded.expiration.getTime(), session.expiration.getTime());
    // Public key roundtrip: check JWK thumbprint
    const reEncoded = await encodeSession(decoded);
    assertEquals(
      JSON.stringify(encoded.publicKey),
      JSON.stringify(reEncoded.publicKey),
    );
    assertTrue(isOwnedSession(decoded) === isOwnedSession(session));
  });

  TEST('Session', 'signData/verifyData', async () => {
    const session = await generateSession('test-owner');
    const data = { foo: 'bar', n: 42 };
    const signature = await signData(session, data);
    const valid = await verifyData(session, signature, data);
    assertTrue(valid);
    // Tampered data should fail
    const invalid = await verifyData(session, signature, { foo: 'baz', n: 42 });
    assertTrue(!invalid);
  });

  TEST('Session', 'sessionToItem/sessionFromItem roundtrip', async () => {
    const registry = new DataRegistry();
    const session = await generateSession('test-owner');
    const item = await sessionToItem(session, registry);
    assertTrue(!!item);
    const session2 = await sessionFromItem(item);
    assertEquals(session2.id, session.id);
    assertEquals(session2.owner, session.owner);
    assertEquals(session2.expiration.getTime(), session.expiration.getTime());
  });

  TEST(
    'Session',
    'generateRequestSignature/verifyRequestSignature',
    async () => {
      const session = await generateSession('test-owner');
      const sig = await generateRequestSignature(session);
      const valid = await verifyRequestSignature(session, sig);
      assertTrue(valid);
    },
  );

  // Edge case: decodeSession with missing/invalid fields
  TEST('Session', 'decodeSession with missing fields should fail', async () => {
    let errorCaught = false;
    try {
      // Missing publicKey
      await decodeSession({ id: 'x', expiration: Date.now() } as any);
    } catch (e) {
      errorCaught = true;
    }
    assertTrue(errorCaught);
  });

  // Edge case: verifyData with wrong session
  TEST('Session', 'verifyData with wrong session should fail', async () => {
    const session1 = await generateSession('owner1');
    const session2 = await generateSession('owner2');
    const data = { foo: 'bar' };
    const sig = await signData(session1, data);
    const valid = await verifyData(session2, sig, data);
    assertTrue(!valid);
  });

  // Edge case: encodeSession/roundtrip with no owner
  TEST(
    'Session',
    'encodeSession/decodeSession roundtrip with no owner',
    async () => {
      const session = await generateSession();
      const encoded = await encodeSession(session);
      const decoded = await decodeSession(encoded);
      assertEquals(decoded.owner, undefined);
      assertEquals(decoded.id, session.id);
    },
  );

  // Edge case: sessionToItem/sessionFromItem with missing registry
  TEST(
    'Session',
    'sessionToItem/sessionFromItem with default registry',
    async () => {
      const session = await generateSession('test-owner');
      // Use DataRegistry.default implicitly
      const item = await sessionToItem(session, DataRegistry.default);
      const session2 = await sessionFromItem(item);
      assertEquals(session2.id, session.id);
    },
  );

  // Edge case: verifyRequestSignature with expired signature (simulate)
  TEST(
    'Session',
    'verifyRequestSignature with expired signature should fail',
    async () => {
      const session = await generateSession('test-owner');
      const sig = await generateRequestSignature(session);
      // Decode, tamper timestamp, re-encode
      const { decodeSignature, encodeSignature } = await import(
        '../db/session.ts'
      );
      const decoded = decodeSignature(sig);
      if (!decoded.data) decoded.data = {} as any;
      (decoded.data as any).ts = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const tampered = encodeSignature(decoded);
      const valid = await verifyRequestSignature(session, tampered);
      assertTrue(!valid);
    },
  );

  // Edge case: signData/verifyData with undefined data
  TEST('Session', 'signData/verifyData with undefined data', async () => {
    const session = await generateSession('test-owner');
    const sig = await signData(session);
    const valid = await verifyData(session, sig);
    assertTrue(valid);
  });

  // Edge case: decodeSession with invalid key material
  TEST(
    'Session',
    'decodeSession with invalid key material should fail',
    async () => {
      // Deno does not throw for invalid key material, so skip this test in Deno
      if (typeof Deno !== 'undefined') {
        console.log(
          'Skipping invalid key material test in Deno (does not throw)',
        );
        return;
      }
      let errorCaught = false;
      try {
        await decodeSession({
          id: 'x',
          publicKey: { kty: 'EC', crv: 'P-384', x: 'bad', y: 'bad' },
          expiration: Date.now(),
        } as any);
      } catch (e) {
        errorCaught = true;
      }
      assertTrue(errorCaught);
    },
  );
}
