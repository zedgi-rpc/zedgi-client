import type { ZedgiClientOptions, ZedgiCredential, ZedgiCredentialSelector, ZedgiServiceType } from './types.js';
import { encryptCredential, hmacSign, randomNonce, sha256Hex } from './crypto.js';

type RpcResponse<T> = { ok: true; result: T; requestId: string | null; error: null } | { ok: false; error: { code: string; message: string; details?: unknown }; result?: never };

/** Web-standard UUID (works in Node 18+, Cloudflare Workers, Deno, browsers). */
const randomId = (): string =>
(globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Account public key material needed to encrypt credentials client-side. */
type AccountKey = { publicKey: string; accountId: string; keyVersion: number };

type BootstrapDetails = {
  accountKey: AccountKey;
  signingSecret: string;
  /** Encrypted full node target from bootstrap (required for /rpc). */
  node?: string;
};

/** In-memory caches (per client options object) so we encrypt/pull at most once. */
const bootstrapCache = new WeakMap<ZedgiClientOptions, Promise<BootstrapDetails>>();
const CRED_BLOB_TTL_MS = 55 * 60 * 1000;
const credBlobCache = new Map<string, { exp: number; blob: Promise<string> }>();

const signingSecretOf = (o: ZedgiClientOptions): string | undefined => o.signingSecret ?? o.secret;

const resolveBootstrap = (options: ZedgiClientOptions): Promise<BootstrapDetails> => {
  let cached = bootstrapCache.get(options);
  if (!cached) {
    cached = (async () => {
      let keyData: AccountKey | undefined;
      let secretData: string | undefined;
      let node: string | undefined;

      const explicitSecret = signingSecretOf(options);
      const hasExplicitKey = options.publicKey && options.accountId && options.keyVersion !== undefined;

      // Always hit bootstrap when we need signing secret, account key, or the node blob.
      // Explicit key/secret alone is not enough — /rpc requires x-zedgi-node from bootstrap.
      const url = new URL('/api/account/bootstrap', options.url);
      const res = await fetch(url.toString(), { headers: { 'x-zedgi-key': options.key } });
      const parsed = (await res.json()) as {
        ok: boolean;
        result?: {
          key: { id: string; key_version: number; public_key: string; created_at: number };
          signing_secret: string;
          node?: string;
          node_prefix?: string;
        };
        error?: { message?: string };
      };
      if (!res.ok || !parsed.ok || !parsed.result) {
        throw new Error(
          parsed.error?.message
            ? `Failed to bootstrap client config: ${parsed.error.message}`
            : `Failed to bootstrap client config (${res.status})`,
        );
      }

      keyData = {
        publicKey: parsed.result.key.public_key,
        accountId: parsed.result.key.id,
        keyVersion: parsed.result.key.key_version,
      };
      secretData = parsed.result.signing_secret;
      node = parsed.result.node ?? parsed.result.node_prefix;

      if (explicitSecret) secretData = explicitSecret;
      if (hasExplicitKey) {
        keyData = {
          publicKey: options.publicKey!,
          accountId: options.accountId!,
          keyVersion: options.keyVersion!,
        };
      }

      if (!node) {
        throw new Error('Bootstrap returned no node — cannot call /rpc without x-zedgi-node');
      }

      return { accountKey: keyData, signingSecret: secretData, node };
    })();
    bootstrapCache.set(options, cached);
  }
  return cached;
};

/** Resolve the HMAC signing secret — from options, or auto-pull via /api/account/bootstrap. */
const resolveSigningSecret = async (options: ZedgiClientOptions): Promise<string> => {
  const details = await resolveBootstrap(options);
  return details.signingSecret;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const splitCredentialHeader = (
  credential: Record<string, unknown>
): { encryptedCredential: Record<string, unknown>; credentialHeader?: Record<string, unknown> } => {
  const { header, ...encryptedCredential } = credential;
  if (header == null) return { encryptedCredential };
  if (!isPlainRecord(header)) throw new Error('credential.header must be an object');
  return { encryptedCredential, credentialHeader: header };
};

export const resolveCredential = (
  options: ZedgiClientOptions,
  service: ZedgiServiceType,
  selector?: ZedgiCredentialSelector
): ZedgiCredential | undefined => {
  if (isPlainRecord(selector)) return selector;
  if (typeof selector === 'string') {
    const credential = options.credentials?.[service]?.[selector];
    if (!credential) throw new Error(`Zedgi credential profile "${selector}" was not found for ${service}`);
    return credential;
  }
  return options.credentials?.[service]?.default ?? options.credential;
};

/** Resolve the account public key — from options, or auto-pull via /api/account/bootstrap. */
const resolveAccountKey = async (options: ZedgiClientOptions): Promise<AccountKey> => {
  const details = await resolveBootstrap(options);
  return details.accountKey;
};

/** Build the ECIES-encrypted credential blob, caching it unless cache:false. */
const resolveCredBlob = async (options: ZedgiClientOptions, credential?: ZedgiCredential): Promise<string | undefined> => {
  if (!credential) return undefined;
  const ak = await resolveAccountKey(options);
  const { encryptedCredential } = splitCredentialHeader(credential);
  const build = (): Promise<string> =>
    encryptCredential(encryptedCredential, ak.publicKey, ak.accountId, ak.keyVersion);
  if (options.cache === false) return build();

  const key = `${ak.accountId}:${ak.keyVersion}:${ak.publicKey}:${stableJson(encryptedCredential)}`;
  const now = Date.now();
  const cached = credBlobCache.get(key);
  if (cached && cached.exp > now) return cached.blob;

  const blob = build();
  credBlobCache.set(key, { exp: now + CRED_BLOB_TTL_MS, blob });
  if (credBlobCache.size > 256) {
    const oldest = credBlobCache.keys().next().value;
    if (oldest !== undefined) credBlobCache.delete(oldest);
  }
  return blob;
};

/** True when the SDK is auto-pulling the account key (so it can re-pull on rotation). */
const autoKeyMode = (o: ZedgiClientOptions): boolean =>
  !(o.publicKey && o.accountId && o.keyVersion !== undefined);

/** A rotated/outdated encryption key — clearing the cache + re-pulling fixes it. */
const isStaleKeyError = (status: number, code?: string): boolean =>
  status === 412 || code === 'CRED_DECRYPT_FAILED';

const sendOnce = async <T>(
  options: ZedgiClientOptions,
  service: ZedgiServiceType,
  method: string,
  payload: Record<string, unknown>,
  credential?: ZedgiCredential
): Promise<{ ok: true; value: T } | { ok: false; status: number; error?: { code?: string; message?: string; details?: unknown } }> => {
  const url = new URL('/rpc', options.url);
  const credentialHeader = credential ? splitCredentialHeader(credential).credentialHeader : undefined;
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
  // The signing secret is auto-pulled (and cached) when not supplied in options.
  const details = await resolveBootstrap(options);
  const secret = details.signingSecret;
  if (!options.testNodeUuid) {
    if (!details.node) {
      throw new Error('Missing node from bootstrap — cannot call /rpc without x-zedgi-node');
    }
    headers['x-zedgi-node'] = details.node;
  }
  const ts = String(Date.now());
  const nonce = randomNonce();
  const sig = await hmacSign(`${ts}:${nonce}:${await sha256Hex(body)}`, secret);
  headers['x-zedgi-ts'] = ts;
  headers['x-zedgi-nonce'] = nonce;
  headers['x-zedgi-sig'] = sig;

  // ECIES-encrypted credentials (never sent in plaintext).
  const credBlob = await resolveCredBlob(options, credential);
  if (credBlob) headers['x-zedgi-cred'] = credBlob;
  if (options.testNodeUuid) headers['x-zedgi-node-uuid'] = options.testNodeUuid;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), options.timeout ?? 10_000);

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: 'POST', headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }

  const parsed = await response.json() as RpcResponse<T>;

  const respNode = response.headers.get('x-zedgi-node');
  if (respNode && details.node !== respNode) {
    details.node = respNode;
  }

  if (parsed.ok) return { ok: true, value: parsed.result };
  return { ok: false, status: response.status, error: parsed.error };
};

export const callZedgi = async <T = unknown>(
  options: ZedgiClientOptions,
  service: ZedgiServiceType,
  method: string,
  payload: Record<string, unknown> = {},
  callOptions: { credential?: ZedgiCredentialSelector } = {}
): Promise<T> => {
  const credential = resolveCredential(options, service, callOptions.credential);
  // Two attempts at most: on a rotated/outdated key (in auto mode) we drop the
  // cached public key + ciphertext, re-pull the current key, and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await sendOnce<T>(options, service, method, payload, credential);
    if (res.ok === false) {
      if (attempt === 0 && autoKeyMode(options) && isStaleKeyError(res.status, res.error?.code)) {
        bootstrapCache.delete(options);
        credBlobCache.clear();
        continue;
      }

      const err = new Error(res.error?.message ?? `Zedgi call failed (${res.status})`) as Error & { code?: string; statusCode?: number; details?: unknown };
      err.code = res.error?.code;
      err.statusCode = res.status;
      err.details = res.error?.details;
      throw err;
    }

    return res.value;
  }
  // Unreachable: the loop either returns a value or throws.
  throw new Error('Zedgi call failed');
};
