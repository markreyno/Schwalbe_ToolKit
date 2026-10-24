import forge from 'node-forge';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const CA_DIR = 'phone-local-ca';
const CA_CERT = 'ca.crt';
const CA_KEY = 'ca.key.pem';

export type LocalCaMaterial = {
  caCertPem: string;
  caKeyPem: string;
  serverCertPem: string;
  serverKeyPem: string;
  fingerprintSha256: string;
  sans: string[];
};

function fingerprintPem(pem: string): string {
  const cert = forge.pki.certificateFromPem(pem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const hash = createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex').toUpperCase();
  return hash.replace(/(.{2})/g, '$1:').replace(/:$/, '');
}

function collectSans(): string[] {
  const sans = new Set<string>(['localhost', '127.0.0.1']);
  const hostname = os.hostname();
  if (hostname) sans.add(hostname.toLowerCase());
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) sans.add(addr.address);
    }
  }
  return [...sans];
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function ensureCaPair(dir: string): Promise<{ caCertPem: string; caKeyPem: string }> {
  const certPath = path.join(dir, CA_CERT);
  const keyPath = path.join(dir, CA_KEY);
  const existingCert = await readIfExists(certPath);
  const existingKey = await readIfExists(keyPath);
  if (existingCert && existingKey) return { caCertPem: existingCert, caKeyPem: existingKey };

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [{ name: 'commonName', value: 'Schwalbe ToolKit Phone CA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const caCertPem = forge.pki.certificateToPem(cert);
  const caKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(certPath, caCertPem);
  await fs.writeFile(keyPath, caKeyPem, { mode: 0o600 });
  return { caCertPem, caKeyPem };
}

function issueServerCert(caCertPem: string, caKeyPem: string, sans: string[]): { certPem: string; keyPem: string } {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Date.now());
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  cert.setSubject([{ name: 'commonName', value: 'Schwalbe ToolKit Phone Server' }]);
  cert.setIssuer(caCert.subject.attributes);
  const altNames = sans.map(name => {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return { type: 7, ip: name };
    return { type: 2, value: name };
  });
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames }
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

export async function ensureLocalTlsMaterial(userDataDir: string, forceRegenerate = false): Promise<LocalCaMaterial> {
  const dir = path.join(userDataDir, CA_DIR);
  const { caCertPem, caKeyPem } = await ensureCaPair(dir);
  const sans = collectSans();
  const sansKey = sans.sort().join(',');
  const metaPath = path.join(dir, 'server-meta.json');
  let reuse = false;
  if (!forceRegenerate) {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      if (meta.sansKey === sansKey) {
        const certPem = await fs.readFile(path.join(dir, 'server.crt'), 'utf8');
        const keyPem = await fs.readFile(path.join(dir, 'server.key.pem'), 'utf8');
        return {
          caCertPem,
          caKeyPem,
          serverCertPem: certPem,
          serverKeyPem: keyPem,
          fingerprintSha256: fingerprintPem(caCertPem),
          sans
        };
      }
    } catch { /* regenerate */ }
  }
  const { certPem, keyPem } = issueServerCert(caCertPem, caKeyPem, sans);
  await fs.writeFile(path.join(dir, 'server.crt'), certPem);
  await fs.writeFile(path.join(dir, 'server.key.pem'), keyPem, { mode: 0o600 });
  await fs.writeFile(metaPath, JSON.stringify({ sansKey, updatedAt: new Date().toISOString() }));
  return {
    caCertPem,
    caKeyPem,
    serverCertPem: certPem,
    serverKeyPem: keyPem,
    fingerprintSha256: fingerprintPem(caCertPem),
    sans
  };
}

export function buildIosMobileConfig(caCertPem: string): string {
  const b64 = Buffer.from(caCertPem, 'utf8').toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>Schwalbe-ToolKit-CA.crt</string>
      <key>PayloadContent</key>
      <data>${b64}</data>
      <key>PayloadDescription</key>
      <string>Trust the Schwalbe ToolKit desktop for HTTPS phone tools.</string>
      <key>PayloadDisplayName</key>
      <string>Schwalbe ToolKit Phone CA</string>
      <key>PayloadIdentifier</key>
      <string>com.schwalbe.toolkit.phone.ca</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>8A1B2C3D-4E5F-6789-ABCD-EF0123456789</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>Schwalbe ToolKit Trust</string>
  <key>PayloadIdentifier</key>
  <string>com.schwalbe.toolkit.phone.trust</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>9B2C3D4E-5F60-7890-BCDE-F01234567890</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
}

export { fingerprintPem };
