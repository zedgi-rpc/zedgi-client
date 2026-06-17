import type { ZedgiClientOptions, ZedgiServiceType } from './types.js';
import { encryptCredential, hmacSign, randomNonce, sha256Hex } from './crypto.js';

type RpcResponse<T> = { ok: true; result: T; requestId: string | null; error: null } | { ok: false; error: { code: string; message: string; details?: unknown }; result?: never };

/** Web-standard UUID (works in Node 18+, Cloudflare Workers, Deno, browsers). */
const randomId = (): string =>
  (globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Account public key material needed to encrypt credentials client-side. */
type AccountKey = { publicKey: string; accountId: string; keyVersion: number };

/** In-memory caches (per client options object) so we encrypt/pull at most once. */
const accountKeyCache = new WeakMap<ZedgiClientOptions, Promise<AccountKey>>();
const credBlobCache = new WeakMap<ZedgiClientOptions, Promise<string>>();

const signingSecretOf = (o: ZedgiClientOptions): string | undefined => o.signingSecret ?? o.secret;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const splitCredentialHeader = (
  credential: Record<string, unknown>
): { encryptedCredential: Record<string, unknown>; credentialHeader?: Record<string, unknown> } => {
  const { header, ...encryptedCredential } = credential;
  if (header == null) return { encryptedCredential };
  if (!isPlainRecord(header)) throw new Error('credential.header must be an object');
  return { encryptedCredential, credentialHeader: header };
};

/** Resolve the account public key — from options, or auto-pull via /api/account/keys/current. */
const resolveAccountKey = async (options: ZedgiClientOptions): Promise<AccountKey> => {
  if (options.publicKey && options.accountId && options.keyVersion !== undefined) {
    return { publicKey: options.publicKey, accountId: options.accountId, keyVersion: options.keyVersion };
  }
  let cached = accountKeyCache.get(options);
  if (!cached) {
    cached = (async () => {
      const url = new URL('/api/account/keys/current', options.url);
      const res = await fetch(url.toString(), { headers: { 'x-zedgi-key': options.key } });
      const parsed = (await res.json()) as { ok: boolean; result?: { id: string; key_version: number; public_key: string } };
      if (!res.ok || !parsed.ok || !parsed.result) {
        throw new Error(`Failed to fetch account public key (${res.status})`);
      }
      return { publicKey: parsed.result.public_key, accountId: parsed.result.id, keyVersion: parsed.result.key_version };
    })();
    accountKeyCache.set(options, cached);
  }
  return cached;
};

/** Build the ECIES-encrypted credential blob, caching it unless cache:false. */
const resolveCredBlob = async (options: ZedgiClientOptions): Promise<string | undefined> => {
  if (!options.credential) return undefined;
  const build = async (): Promise<string> => {
    const ak = await resolveAccountKey(options);
    const { encryptedCredential } = splitCredentialHeader(options.credential!);
    return encryptCredential(encryptedCredential, ak.publicKey, ak.accountId, ak.keyVersion);
  };
  if (options.cache === false) return build();
  let cached = credBlobCache.get(options);
  if (!cached) {
    cached = build();
    credBlobCache.set(options, cached);
  }
  return cached;
};

export const callZedgi = async <T = unknown>(
  options: ZedgiClientOptions,
  service: ZedgiServiceType,
  method: string,
  payload: Record<string, unknown> = {}
): Promise<T> => {
  const url = new URL('/rpc', options.url);
  const credentialHeader = options.credential ? splitCredentialHeader(options.credential).credentialHeader : undefined;
  const body = JSON.stringify({
    requestId: randomId(),
    service,
    method,
    payload,
    ...(credentialHeader ? { credentialHeader } : {}),
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-zedgi-key': options.key,
  };

  // Request signing (timestamp + nonce + HMAC-SHA256 over "ts:nonce:sha256(body)").
  const secret = signingSecretOf(options);
  if (secret) {
    const ts = String(Date.now());
    const nonce = randomNonce();
    const sig = await hmacSign(`${ts}:${nonce}:${await sha256Hex(body)}`, secret);
    headers['x-zedgi-ts'] = ts;
    headers['x-zedgi-nonce'] = nonce;
    headers['x-zedgi-sig'] = sig;
  }

  // ECIES-encrypted credentials (never sent in plaintext).
  const credBlob = await resolveCredBlob(options);
  if (credBlob) headers['x-zedgi-cred'] = credBlob;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), options.timeout ?? 10_000);

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: 'POST', headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }

  const parsed = await response.json() as RpcResponse<T>;

  if (!parsed.ok) {
    // Key rotated: drop cached key/blob so the next call re-pulls + re-encrypts.
    if (response.status === 412) {
      accountKeyCache.delete(options);
      credBlobCache.delete(options);
    }
    const err = new Error(parsed.error?.message ?? `Zedgi call failed (${response.status})`) as Error & { code?: string; statusCode?: number; details?: unknown };
    err.code = parsed.error?.code;
    err.statusCode = response.status;
    err.details = parsed.error?.details;
    throw err;
  }

  return parsed.result;
};
