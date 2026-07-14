# @zedgi/zedgi-client

Call your own **Redis, Postgres, MySQL, and Memcached beta** from any JavaScript runtime over HTTPS — no TCP sockets required.

Works in Node.js, Cloudflare Workers, Deno, Bun, browsers (with a proxy), and any other environment that supports `fetch`.

## Installation

```bash
npm install @zedgi/zedgi-client
```

## Quick Start

```ts
import { createZedgiClient } from '@zedgi/zedgi-client';

const zedgi = createZedgiClient({
  url: 'https://YOUR_SUBDOMAIN.zedgi.app',
  key: process.env.ZEDGI_KEY!,
  credentials: {
    redis: { default: { password: process.env.REDIS_PASSWORD!, db: 0 } },
    postgres: { default: { user: 'app', password: process.env.PG_PASSWORD!, database: 'app' } },
    mysql: { default: { user: 'app', password: process.env.MYSQL_PASSWORD!, database: 'app' } },
  },
});

// Redis
const redis = zedgi.redis();
await redis.set('user:42', JSON.stringify({ name: 'Ada' }));
const val = await redis.get('user:42');

// Postgres
const pg = zedgi.postgres();
const { rows } = await pg.query('SELECT NOW() AS ts');

// MySQL
const mysql = zedgi.mysql();
const result = await mysql.query('SELECT 1 AS n');
```

## API

### `createZedgiClient(options)`

```ts
const zedgi = createZedgiClient({
  url: string;           // Your Zedgi endpoint, e.g. https://dev123.zedgi.app
  key: string;           // API key identifier (zk_...) — sent as x-zedgi-key. From the dashboard.
  credential?: Record<string, unknown>; // Legacy/default DB creds, encrypted into x-zedgi-cred
  credentials?: {        // Named credentials per service; "default" is used by zedgi.redis()
    redis?: Record<string, Record<string, unknown>>;
    postgres?: Record<string, Record<string, unknown>>;
    mysql?: Record<string, Record<string, unknown>>;
  };
  secret?: string;       // OPTIONAL — HMAC signing secret. Auto-pulled + cached when omitted.
  publicKey?: string;    // OPTIONAL — account X25519 public key (base64url). Auto-pulled when omitted.
  cache?: boolean;       // Cache the encrypted credential blob (default: true)
  timeout?: number;      // Request timeout in ms (default: 10000)
});
```

You normally pass **`url`, `key`, and either `credential` or `credentials`**. The
signing secret and account public key are fetched automatically.

**Where each value comes from**

- **`key`** — create it in the dashboard: open your service → **+ New key**. Shown once; it's the `x-zedgi-key` header.
- **`credential` / `credentials`** — your **own database** credentials (see shapes below). Zedgi never issues these.
- **`secret`** (signing secret) — **don't set this normally.** Each key has one; the client auto-pulls it via `GET /api/account/signing-secret` (authed by `key`) and caches it. Set it only if you want to manage signing yourself.

**Credential shapes** (`host`/`port` come from the registered service, not here).
All credentials may include an optional `header` object for signed plaintext
proxy/firewall metadata.

```ts
// redis — password and db are optional; omit the credential entirely if password-less
{ password: 's3cr3t', db: 2, header: { 'x-firewall-token': '...' } }

// postgres — ssl and header are optional
{ user: 'app', password: 's3cr3t', database: 'prod', ssl: true, header: { 'x-firewall-token': '...' } }

// mysql — ssl and header are optional
{ user: 'app', password: 's3cr3t', database: 'prod', ssl: true, header: { 'x-firewall-token': '...' } }
```

### Credential profiles and headers

Use `credentials` when one app talks to more than one service, Redis logical DB,
database user, or firewall/header variant:

```ts
const zedgi = createZedgiClient({
  url: 'https://YOUR_SUBDOMAIN.zedgi.app',
  key: process.env.ZEDGI_KEY!,
  credentials: {
    redis: {
      default: { password: process.env.REDIS_PASSWORD!, db: 0 },
      cache: {
        password: process.env.REDIS_PASSWORD!,
        db: 1,
        header: { 'x-firewall-token': process.env.REDIS_FIREWALL_TOKEN! },
      },
    },
    postgres: {
      default: { user: 'app', password: process.env.PG_PASSWORD!, database: 'app' },
      reporting: { user: 'reporter', password: process.env.PG_REPORTING_PASSWORD!, database: 'reports' },
    },
  },
});

const redis = zedgi.redis();          // credentials.redis.default
const cache = zedgi.redis('cache');   // credentials.redis.cache
const pg = zedgi.postgres('reporting');
const temp = zedgi.redis({ password: process.env.REDIS_PASSWORD!, db: 2 });
```

Credential selection order is: ad-hoc object, named profile, service `default`,
legacy `credential`, then no credential. If you request a missing profile, the
client throws before making the HTTP request.

`header` is optional and special: it is removed from the encrypted credential, added to the
signed RPC body as `credentialHeader`, and forwarded as plaintext metadata for
proxy/firewall integrations. Put only values there that the receiving proxy or
firewall must see.

The client implements the **link logic** for zero-knowledge credentials:

- When you supply `credential` or a selected profile from `credentials`, the client reuses the encrypted `x-zedgi-cred` blob for 55 minutes by credential content (or encrypts per call if `cache:false`) using your account's X25519 public key (ECIES: X25519 + HKDF + AES-256-GCM).
- If `credential.header` is present, it is excluded from ECIES encryption and added to the signed RPC body as plaintext metadata for proxy/firewall integrations.
- The resulting blob is sent as the `x-zedgi-cred` header on every RPC.
- The server never sees plaintext credentials and never stores them.
- Request signing (`x-zedgi-ts` / `x-zedgi-nonce` / `x-zedgi-sig`) is **always** applied; the signing secret is auto-pulled + cached when `secret` is not provided.

Keep `cache:true` in production. It is the default and gives the best performance because repeated calls reuse the same encrypted `x-zedgi-cred` for 55 minutes, allowing the gateway decrypt cache to hit. Use `cache:false` only when you deliberately need fresh credential ciphertext on every request, for example while debugging credential encryption or testing rotation behavior; it increases SDK CPU work and makes the gateway repeat full credential decrypt/re-encrypt work.

**Auto public key pull**

If `publicKey` is omitted and `credential` is supplied, the client will fetch the current active public key from `GET /api/account/keys/current` (authenticated with your `key`). The result is cached for the lifetime of the client instance.

This makes rotation seamless in many cases (see below).

The returned client has:

- `redis(profileOrCredential?)` → Redis client
- `postgres(profileOrCredential?)` → Postgres client
- `mysql(profileOrCredential?)` → MySQL client
- `queue(name, profileOrCredential?)` → BullMQ queue client using Redis credentials
- `call(service, method, payload?, { credential })` → low-level RPC call

### Redis

The Redis client supports a large subset of common commands plus a few extras:

```ts
const redis = zedgi.redis();

await redis.ping();
await redis.set('key', 'value', 'EX', 60);
await redis.get('key');
await redis.del('key1', 'key2');
await redis.hset('user:1', 'name', 'Ada', 'age', '42');
await redis.lrange('queue', 0, -1);
await redis.zadd('scores', 100, 'player1');

// Escape hatch for any command
await redis.call('ZREVRANGE', 'leaderboard', 0, 9, 'WITHSCORES');

// Pipeline / MULTI
await redis.pipeline([{ command: 'SET', args: ['a', '1'] }, { command: 'INCR', args: ['a'] }]);
await redis.multi([...]);
```

Unknown method names are automatically forwarded as custom hooks (see below).

### BullMQ queues

BullMQ rides on your existing **Redis** service — there's no separate service to register.
Use the same `key`/`credential` as Redis; the client sends each op as `bull:<method>` and the
backend runs the real BullMQ operation (default `bull` key prefix, so jobs interoperate with
your own workers).

```ts
const queue = zedgi.queue('emails');          // uses credentials.redis.default
const cacheQueue = zedgi.queue('emails', 'cache'); // uses credentials.redis.cache

// Produce
await queue.add('send', { to: 'dev@example.com' }, { attempts: 3 });

// Inspect
await queue.getJobCounts();          // { waiting, active, completed, failed, ... }
await queue.getJob('42');
await queue.getSnapshot();           // counts across all queues — for dashboards

// Manage
await queue.pause();
await queue.retryJob('42');
await queue.clean(0, 1000, 'completed');
```

> Workers/consumers still run in your own runtime against the same Redis — the client covers
> producing jobs and inspecting/managing queue state, not running the processors.

### Postgres & MySQL

```ts
const pg = zedgi.postgres();
const mysql = zedgi.mysql();

const result = await pg.query('SELECT * FROM users WHERE id = $1', [42]);
// { rows: [...], rowCount: 1, fields: [...] }

await pg.transaction([
  { sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [100, 1] },
  { sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [100, 2] },
]);
```

MySQL uses a slightly different result shape (`fields` is a string array).

### Custom Hooks (paid feature)

Custom hooks let you register server-side logic (Lua scripts or SQL templates) and call them by name.

```ts
// Redis Lua hook expecting KEYS + ARGV
await redis.hook('topUsers', {
  keys: ['leaderboard'],
  args: [10],
});

// SQL hook with parameters
await pg.hook('activeUsers', {
  params: [30],
});

// Magic proxy — any unknown method name becomes a hook call
await redis.topUsers('leaderboard', 10);           // positional args
await pg.activeUsers(30);
```

See the [Custom Hooks guide](https://zedgi.app/docs/guide/custom-hooks) for how to register hooks in the dashboard.

### Low-level `call`

```ts
await zedgi.call('redis', 'get', { args: ['mykey'] });
```

### Error Handling

All errors thrown by the client have extra properties:

```ts
try {
  await redis.get('missing');
} catch (err: any) {
  console.log(err.code);        // e.g. 'ZEDGI_...'
  console.log(err.statusCode);  // HTTP status
  console.log(err.details);     // optional extra data
}
```

Common codes include `ZEDGI_HOOK_NOT_FOUND`, `ZEDGI_PAID_FEATURE`, authentication errors, etc.

## Credentials & the "link" (zero-knowledge model)

ZedGi stores **only** target endpoint metadata for your service. The port is optional; use `host` or `host:port` in the dashboard. Your database credentials (user, password, etc.) are **never sent to ZedGi in plaintext**.

- You (or the SDK) encrypt the credential object client-side with your **account public key**.
- `credential.header` or a profile's `header` is not encrypted into `x-zedgi-cred`; it is authenticated by request signing and forwarded separately.
- The ciphertext travels as `x-zedgi-cred`.
- On the server it is re-encrypted (never decrypted to plaintext at the edge) for the specific proxy node.
- Only the proxy node (transiently) decrypts to open the TCP connection to your real database.

See the full guide: https://zedgi.app/docs/guide/auth and the Getting Started "Encrypting credentials" + "Key rotation" sections.

```ts
const zedgi = createZedgiClient({
  url: 'https://YOUR_SUBDOMAIN.zedgi.app',
  key: process.env.ZEDGI_KEY!,           // from the dashboard; signing is automatic
  credentials: {
    postgres: {
      default: {
        user: 'app',
        password: process.env.DB_PASSWORD!,
        database: 'main',
        header: {
          'x-firewall-token': process.env.DB_FIREWALL_TOKEN!,
        },
      },
    },
  },
});
```

## Key rotation

1. Rotate from the dashboard or `POST /api/account/keys/rotate`.
2. A new public key becomes active. You receive an email.
3. Update any pinned `publicKey` in your environment.
4. Re-supply `credential` / `credentials` to `createZedgiClient` (or re-encrypt your `x-zedgi-cred` blob manually).
5. The SDK (when using auto public key or on a 412 "key outdated" response) will refetch the new public key and re-encrypt.

API keys (`zk_...` + signing secret) are **unaffected** by account keypair rotation — only the credential encryption key changes.

## Raw HTTP (any language)

Every call must include:

- `x-zedgi-key`
- `x-zedgi-ts`, `x-zedgi-nonce`, `x-zedgi-sig` (HMAC of `ts:nonce:sha256(body)` with the signing secret)
- `x-zedgi-cred` (ECIES blob encrypted to your current account public key)

The client does all of this for you from just `key` + `credential` or `credentials` — it auto-pulls the signing secret (`GET /api/account/signing-secret`) and the account public key (`GET /api/account/keys/current`). Doing it by hand? Fetch the signing secret from that endpoint with your `x-zedgi-key`.

## TypeScript

The package ships full TypeScript declarations. All major methods are typed.

## Related

- Python client: [`zedgi`](https://pypi.org/project/zedgi/) on PyPI
- Full documentation & API reference: https://zedgi.app/docs
- Dashboard: https://zedgi.app

## License

MIT © ZedGi

---

Part of the [ZedGi](https://zedgi.app) TCP-to-HTTP proxy platform.
