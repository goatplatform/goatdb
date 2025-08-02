export interface SelfSignedCertificate {
  key: string;
  cert: string;
}

/**
 * Generates a self-signed certificate for development/testing purposes.
 * Tries mkcert first (locally trusted), falls back to OpenSSL.
 */
export async function generateSelfSignedCertificate(
  hostname = 'localhost',
): Promise<SelfSignedCertificate> {
  // Try mkcert first if available (creates locally trusted certificates)
  try {
    return await generateMkcertCertificate(hostname);
  } catch (error) {
    console.warn(
      'mkcert failed, falling back to OpenSSL:',
      (error as Error).message,
    );
    return await generateOpenSSLCertificate(hostname);
  }
}

/**
 * Generate certificate using mkcert (locally trusted)
 */
async function generateMkcertCertificate(
  hostname: string,
): Promise<SelfSignedCertificate> {
  const tempDir = await Deno.makeTempDir({ prefix: 'goatdb-mkcert-' });

  try {
    const keyPath = `${tempDir}/${hostname}-key.pem`;
    const certPath = `${tempDir}/${hostname}.pem`;

    // Generate certificate with mkcert
    const cmd = new Deno.Command('mkcert', {
      args: [
        '-key-file',
        keyPath,
        '-cert-file',
        certPath,
        hostname,
        'localhost',
        '127.0.0.1',
      ],
      stdout: 'piped',
      stderr: 'piped',
      cwd: tempDir,
    });

    const result = await cmd.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`mkcert failed: ${stderr}`);
    }

    // Read the generated files
    const key = await Deno.readTextFile(keyPath);
    const cert = await Deno.readTextFile(certPath);

    return { key, cert };
  } finally {
    // Clean up temporary directory
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * Generate certificate using OpenSSL (fallback)
 */
async function generateOpenSSLCertificate(
  hostname: string,
): Promise<SelfSignedCertificate> {
  const tempDir = await Deno.makeTempDir({ prefix: 'goatdb-cert-' });

  try {
    const keyPath = `${tempDir}/key.pem`;
    const csrPath = `${tempDir}/cert.csr`;
    const certPath = `${tempDir}/cert.pem`;

    // Generate ECC private key (more efficient than RSA)
    const keyCmd = new Deno.Command('openssl', {
      args: ['ecparam', '-genkey', '-name', 'prime256v1', '-out', keyPath],
      stdout: 'piped',
      stderr: 'piped',
    });

    let result = await keyCmd.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to generate private key: ${stderr}`);
    }

    // Generate CSR with SAN extension
    const csrCmd = new Deno.Command('openssl', {
      args: [
        'req',
        '-new',
        '-key',
        keyPath,
        '-out',
        csrPath,
        '-subj',
        `/C=US/ST=Test/L=Test/O=GoatDB/OU=Test/CN=${hostname}`,
        '-addext',
        `subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1`,
      ],
      stdout: 'piped',
      stderr: 'piped',
    });

    result = await csrCmd.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to generate CSR: ${stderr}`);
    }

    // Sign the certificate with SAN extension
    const certCmd = new Deno.Command('openssl', {
      args: [
        'x509',
        '-req',
        '-days',
        '30',
        '-in',
        csrPath,
        '-signkey',
        keyPath,
        '-out',
        certPath,
        '-extensions',
        'v3_req',
        '-extfile',
        '/dev/stdin',
      ],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    });

    const extConfig = `[v3_req]
keyUsage = critical, digitalSignature, keyAgreement
extendedKeyUsage = serverAuth
subjectAltName = DNS:${hostname},DNS:localhost,IP:127.0.0.1`;

    const certProcess = certCmd.spawn();
    const stdin = certProcess.stdin.getWriter();
    await stdin.write(new TextEncoder().encode(extConfig));
    await stdin.close();

    result = await certProcess.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to sign certificate: ${stderr}`);
    }

    // Read the generated files
    const key = await Deno.readTextFile(keyPath);
    const cert = await Deno.readTextFile(certPath);

    return { key, cert };
  } finally {
    // Clean up temporary directory
    await Deno.remove(tempDir, { recursive: true });
  }
}
