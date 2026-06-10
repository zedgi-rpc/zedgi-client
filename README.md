# @zedgi/zedgi-client

Call your own **Redis, Postgres, and MySQL** from any JavaScript runtime over HTTPS — no TCP sockets required.

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
  key: string;           // API key (starts with zk_...)
  timeout?: number;      // Request timeout in ms (default: 10000)
});
```

The returned client has:

- `redis()` → Redis client
- `postgres()` → Postgres client
- `mysql()` → MySQL client
- `call(service, method, payload?)` → low-level RPC call

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