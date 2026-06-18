import { encryptCredential, hmacSign, randomNonce, sha256Hex } from './crypto.js';
/** Web-standard UUID (works in Node 18+, Cloudflare Workers, Deno, browsers). */
const randomId = () => (globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
/** In-memory caches (per client options object) so we encrypt/pull at most once. */
const accountKeyCache = new WeakMap();
const credBlobCache = new WeakMap();
const signingSecretCache = new WeakMap();
const signingSecretOf = (o) => o.signingSecret ?? o.secret;
/** Resolve the HMAC signing secret — from options, or auto-pull via /api/account/signing-secret. */
const resolveSigningSecret = async (options) => {
    const explicit = signingSecretOf(options);
    if (explicit)
        return explicit;
    let cached = signingSecretCache.get(options);
    if (!cached) {
        cached = (async () => {
            const url = new URL('/api/account/signing-secret', options.url);
            const res = await fetch(url.toString(), { headers: { 'x-zedgi-key': options.key } });
            const parsed = (await res.json());
            if (!res.ok || !parsed.ok || !parsed.result) {
                throw new Error(`Failed to fetch signing secret (${res.status})`);
            }
            return parsed.result.signing_secret;
        })();
        signingSecretCache.set(options, cached);
    }
    return cached;
};
const isPlainRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
export const splitCredentialHeader = (credential) => {
    const { header, ...encryptedCredential } = credential;
    if (header == null)
        return { encryptedCredential };
    if (!isPlainRecord(header))
        throw new Error('credential.header must be an object');
    return { encryptedCredential, credentialHeader: header };
};
/** Resolve the account public key — from options, or auto-pull via /api/account/keys/current. */
const resolveAccountKey = async (options) => {
    if (options.publicKey && options.accountId && options.keyVersion !== undefined) {
        return { publicKey: options.publicKey, accountId: options.accountId, keyVersion: options.keyVersion };
    }
    let cached = accountKeyCache.get(options);
    if (!cached) {
        cached = (async () => {
            const url = new URL('/api/account/keys/current', options.url);
            const res = await fetch(url.toString(), { headers: { 'x-zedgi-key': options.key } });
            const parsed = (await res.json());
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
const resolveCredBlob = async (options) => {
    if (!options.credential)
        return undefined;
    const build = async () => {
        const ak = await resolveAccountKey(options);
        const { encryptedCredential } = splitCredentialHeader(options.credential);
        return encryptCredential(encryptedCredential, ak.publicKey, ak.accountId, ak.keyVersion);
    };
    if (options.cache === false)
        return build();
    let cached = credBlobCache.get(options);
    if (!cached) {
        cached = build();
        credBlobCache.set(options, cached);
    }
    return cached;
};
/** True when the SDK is auto-pulling the account key (so it can re-pull on rotation). */
const autoKeyMode = (o) => !(o.publicKey && o.accountId && o.keyVersion !== undefined);
/** A rotated/outdated encryption key — clearing the cache + re-pulling fixes it. */
const isStaleKeyError = (status, code) => status === 412 || code === 'CRED_DECRYPT_FAILED';
const sendOnce = async (options, service, method, payload) => {
    const url = new URL('/rpc', options.url);
    const credentialHeader = options.credential ? splitCredentialHeader(options.credential).credentialHeader : undefined;
    const body = JSON.stringify({
        requestId: randomId(),
        service,
        method,
        payload,
        ...(credentialHeader ? { credentialHeader } : {}),
    });
    const headers = {
        'content-type': 'application/json',
        'x-zedgi-key': options.key,
    };
    // Request signing (timestamp + nonce + HMAC-SHA256 over "ts:nonce:sha256(body)").
    // The signing secret is auto-pulled (and cached) when not supplied in options.
    const secret = await resolveSigningSecret(options);
    const ts = String(Date.now());
    const nonce = randomNonce();
    const sig = await hmacSign(`${ts}:${nonce}:${await sha256Hex(body)}`, secret);
    headers['x-zedgi-ts'] = ts;
    headers['x-zedgi-nonce'] = nonce;
    headers['x-zedgi-sig'] = sig;
    // ECIES-encrypted credentials (never sent in plaintext).
    const credBlob = await resolveCredBlob(options);
    if (credBlob)
        headers['x-zedgi-cred'] = credBlob;
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), options.timeout ?? 10_000);
    let response;
    try {
        response = await fetch(url.toString(), { method: 'POST', headers, body, signal: controller.signal });
    }
    finally {
        clearTimeout(timerId);
    }
    const parsed = await response.json();
    if (parsed.ok)
        return { ok: true, value: parsed.result };
    return { ok: false, status: response.status, error: parsed.error };
};
export const callZedgi = async (options, service, method, payload = {}) => {
    // Two attempts at most: on a rotated/outdated key (in auto mode) we drop the
    // cached public key + ciphertext, re-pull the current key, and retry once.
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await sendOnce(options, service, method, payload);
        if (res.ok)
            return res.value;
        if (attempt === 0 && autoKeyMode(options) && isStaleKeyError(res.status, res.error?.code)) {
            accountKeyCache.delete(options);
            credBlobCache.delete(options);
            continue;
        }
        const err = new Error(res.error?.message ?? `Zedgi call failed (${res.status})`);
        err.code = res.error?.code;
        err.statusCode = res.status;
        err.details = res.error?.details;
        throw err;
    }
    // Unreachable: the loop either returns a value or throws.
    throw new Error('Zedgi call failed');
};
