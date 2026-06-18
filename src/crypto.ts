/**
 * Client-side crypto for the ZedGi zero-knowledge model.
 *
 * Ports the wire formats enforced server-side by `app/Support/ecies.ts` and
 * `app/Middleware/RequestSignature.ts` so credentials are encrypted and requests
 * are signed before they ever leave the developer's process.
 *
 * Uses WebCrypto (`globalThis.crypto.subtle`) — available in Node 18+, Cloudflare
 * Workers, Deno, and browsers.
 *
 * ECIES blob layout (binary, then base64url) — must match app/Support/ecies.ts:
 *   0x01          (1 byte  — version: 0x01 X25519, 0x02 P-256 fallback)
 *   accountId     (16 bytes — account id hex, raw binary)
 *   keyVersion    (2 bytes  — uint16 big-endian)
 *   ephemeralPub  (32 bytes X25519 / 65 bytes P-256 — raw public key)
 *   iv            (12 bytes — AES-GCM nonce)
 *   ciphertext+tag(variable)
 */

// Ensure a Uint8Array is backed by a plain ArrayBuffer so WebCrypto accepts it.
const toAB = (u: Uint8Array): Uint8Array<ArrayBuffer> => {
  const buf = new ArrayBuffer(u.byteLength);
  const view = new Uint8Array(buf);
  view.set(u);
  return view;
};

const enc = (s: string): Uint8Array<ArrayBuffer> => toAB(new TextEncoder().encode(s));

const toB64u = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const fromB64u = (s: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  const buf = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

const toHex = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
};

// HKDF domain-separation string for the client → gateway hop (see ecies.ts).
const HKDF_INFO_CLIENT_GATEWAY = 'zedgi-cred-client-gateway-v1';

/**
 * The X25519 WebCrypto naming differs across runtimes:
 *   - Cloudflare Workers / Deno / browsers: { name: 'ECDH', namedCurve: 'X25519' }
 *   - Node.js:                              { name: 'X25519' }
 * We detect the supported form once. `deriveName` is the algorithm name used for
 * deriveBits (the curve is implied for X25519, but ECDH needs the public key).
 * P-256 is a last-resort fallback (only valid against P-256 account keys).
 */
type Algo = { gen: AlgorithmIdentifier | EcKeyGenParams; deriveName: 'ECDH' | 'X25519' };
let detectedX25519: Algo | null = null;
let detectedP256: Algo | null = null;

// X25519 spelling differs by runtime (ECDH+namedCurve vs bare X25519); P-256 is
// a single form. The recipient key's raw length picks the curve, NOT the runtime
// — a P-256 account key (65 bytes) must be used with P-256 even where X25519 is
// available, otherwise importKey rejects it ("raw keys must be exactly 32-bytes").
const X25519_CANDIDATES: Algo[] = [
  { gen: { name: 'ECDH', namedCurve: 'X25519' } as EcKeyGenParams, deriveName: 'ECDH' },
  { gen: { name: 'X25519' }, deriveName: 'X25519' },
];
const P256_ALGO: Algo = { gen: { name: 'ECDH', namedCurve: 'P-256' } as EcKeyGenParams, deriveName: 'ECDH' };

/** Pick the ECDH algorithm matching the recipient key: 65 bytes → P-256, else X25519. */
const resolveAlgo = async (keyLen: number): Promise<Algo> => {
  if (keyLen === 65) {
    if (detectedP256) return detectedP256;
    await crypto.subtle.generateKey(P256_ALGO.gen, true, ['deriveBits']);
    detectedP256 = P256_ALGO;
    return P256_ALGO;
  }
  if (detectedX25519) return detectedX25519;
  for (const c of X25519_CANDIDATES) {
    try {
      await crypto.subtle.generateKey(c.gen, true, ['deriveBits']);
      detectedX25519 = c;
      return c;
    } catch {
      // try next
    }
  }
  throw new Error('X25519 not supported in this runtime (account key is X25519)');
};

const deriveAesKey = async (sharedBits: ArrayBuffer): Promise<CryptoKey> => {
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc(HKDF_INFO_CLIENT_GATEWAY) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
};

/**
 * ECIES-encrypt a credential object for the account public key.
 * Returns the base64url blob to send in the `x-zedgi-cred` header.
 */
export const encryptCredential = async (
  credential: Record<string, unknown>,
  publicKeyB64u: string,
  accountIdHex: string,
  keyVersion: number
): Promise<string> => {
  const recipientRaw = fromB64u(publicKeyB64u);
  const algo = await resolveAlgo(recipientRaw.length);

  const recipientPub = await crypto.subtle.importKey('raw', recipientRaw, algo.gen, false, []);
  const ephemeral = (await crypto.subtle.generateKey(algo.gen, true, ['deriveBits'])) as CryptoKeyPair;
  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const sharedBits = await crypto.subtle.deriveBits(
    { name: algo.deriveName, public: recipientPub } as unknown as AlgorithmIdentifier,
    ephemeral.privateKey,
    256
  );
  const aesKey = await deriveAesKey(sharedBits);

  const iv = toAB(crypto.getRandomValues(new Uint8Array(12)));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc(JSON.stringify(credential)))
  );

  const accBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) accBytes[i] = Number.parseInt(accountIdHex.slice(i * 2, i * 2 + 2), 16);
  const kvBuf = new Uint8Array(2);
  new DataView(kvBuf.buffer).setUint16(0, keyVersion, false); // big-endian

  const pubKeySize = ephemeralPubRaw.length;
  const version = pubKeySize === 32 ? 0x01 : 0x02;
  const blob = new Uint8Array(1 + 16 + 2 + pubKeySize + 12 + ciphertext.length);
  let off = 0;
  blob[off++] = version;
  blob.set(accBytes, off); off += 16;
  blob.set(kvBuf, off); off += 2;
  blob.set(ephemeralPubRaw, off); off += pubKeySize;
  blob.set(iv, off); off += 12;
  blob.set(ciphertext, off);

  return toB64u(blob);
};

/** SHA-256 of a string → lowercase hex (used for the signed body hash). */
export const sha256Hex = async (s: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', enc(s)));

/** HMAC-SHA256(message, secret) → lowercase hex. Matches ecies.ts:hmacSign. */
export const hmacSign = async (message: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc(message)));
};

/** 32-char lowercase hex (128-bit) single-use nonce. */
export const randomNonce = (): string => toHex(crypto.getRandomValues(new Uint8Array(16)));
