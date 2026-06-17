export type ZedgiClientOptions = Readonly<{
  url: string;
  key: string;                 // x-zedgi-key (zk_... identifier)
  signingSecret?: string;      // HMAC signing secret (never sent over wire). Required to sign requests.
  secret?: string;             // deprecated alias for signingSecret (back-compat)
  publicKey?: string;          // account X25519 public key (base64url) for ECIES credential encryption. Omit to auto-pull via /api/account/keys/current
  accountId?: string;          // 32-hex account id for the cred blob header (auto-pulled with publicKey when omitted)
  keyVersion?: number;         // keypair rotation counter (auto-pulled with publicKey when omitted)
  credential?: Record<string, unknown>; // DB/service credentials to encrypt client-side; credential.header is sent signed but unencrypted
  cache?: boolean;             // cache encrypted credential blob in memory (default true)
  timeout?: number;
}>;

export type ZedgiServiceType = 'redis' | 'postgres' | 'mysql';

export type ZedgiCallOptions = Readonly<{
  requestId?: string;
}>;

export type QueryResult<T = Record<string, unknown>> = Readonly<{
  rows: T[];
  rowCount: number | null;
  fields?: Array<{ name: string }>;
}>;

export type MysqlQueryResult<T = Record<string, unknown>> = Readonly<{
  rows: T[];
  fields: string[];
}>;

export type TransactionStatement = Readonly<{
  sql: string;
  params?: unknown[];
}>;

/**
 * Payload for a custom hook invocation.
 * - `keys`   — Redis Lua `KEYS` (script hooks only)
 * - `args`   — Redis `ARGV` / macro `{0}`,`{1}` substitution values
 * - `params` — SQL parameters ($1/? placeholders)
 */
export type HookPayload = Readonly<{
  keys?: string[];
  args?: unknown[];
  params?: unknown[];
}>;

/** Lets any unknown method name be called as a registered custom hook. */
export type CustomHookInvoker = {
  readonly [method: string]: (...args: unknown[]) => Promise<unknown>;
};

export type RedisClient = Readonly<{
  ping: () => Promise<string>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: unknown[]) => Promise<'OK' | null>;
  del: (...keys: string[]) => Promise<number>;
  exists: (...keys: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  ttl: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
  decr: (key: string) => Promise<number>;
  incrby: (key: string, increment: number) => Promise<number>;
  decrby: (key: string, decrement: number) => Promise<number>;
  hget: (key: string, field: string) => Promise<string | null>;
  hset: (key: string, ...fieldValues: string[]) => Promise<number>;
  hgetall: (key: string) => Promise<Record<string, string> | null>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
  lpush: (key: string, ...values: string[]) => Promise<number>;
  rpush: (key: string, ...values: string[]) => Promise<number>;
  lpop: (key: string) => Promise<string | null>;
  rpop: (key: string) => Promise<string | null>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
  smembers: (key: string) => Promise<string[]>;
  sismember: (key: string, member: string) => Promise<number>;
  zadd: (key: string, score: number, member: string) => Promise<number>;
  zrange: (key: string, start: number, stop: number) => Promise<string[]>;
  zscore: (key: string, member: string) => Promise<string | null>;
  call: (command: string, ...args: unknown[]) => Promise<unknown>;
  pipeline: (commands: Array<{ command: string; args?: unknown[] }>) => Promise<unknown[]>;
  multi: (commands: Array<{ command: string; args?: unknown[] }>) => Promise<unknown[]>;
  /** Invoke a registered custom hook by name (paid tier). */
  hook: <T = unknown>(name: string, payload?: HookPayload) => Promise<T>;
}> & CustomHookInvoker;

export type PostgresClient = Readonly<{
  ping: () => Promise<{ pong: boolean }>;
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  transaction: (statements: TransactionStatement[]) => Promise<QueryResult[]>;
  hook: <T = unknown>(name: string, payload?: HookPayload) => Promise<T>;
}> & CustomHookInvoker;

export type MySQLClient = Readonly<{
  ping: () => Promise<{ pong: boolean }>;
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<MysqlQueryResult<T>>;
  transaction: (statements: TransactionStatement[]) => Promise<MysqlQueryResult[]>;
  hook: <T = unknown>(name: string, payload?: HookPayload) => Promise<T>;
}> & CustomHookInvoker;

export type ZedgiClient = Readonly<{
  redis: () => RedisClient;
  postgres: () => PostgresClient;
  mysql: () => MySQLClient;
  call: <T = unknown>(service: ZedgiServiceType, method: string, payload?: Record<string, unknown>) => Promise<T>;
}>;
