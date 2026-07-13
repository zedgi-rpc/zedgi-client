export type ZedgiCredential = Record<string, unknown>;

export type ZedgiCredentialProfiles = Partial<Record<ZedgiServiceType, Record<string, ZedgiCredential>>>;

export type ZedgiCredentialSelector = string | ZedgiCredential;

export type ZedgiClientOptions = Readonly<{
  url: string;
  key: string;                 // x-zedgi-key (zk_... identifier)
  signingSecret?: string;      // HMAC signing secret (never sent over wire). Required to sign requests.
  secret?: string;             // deprecated alias for signingSecret (back-compat)
  publicKey?: string;          // account X25519 public key (base64url) for ECIES credential encryption. Omit to auto-pull via /api/account/keys/current
  accountId?: string;          // 32-hex account id for the cred blob header (auto-pulled with publicKey when omitted)
  keyVersion?: number;         // keypair rotation counter (auto-pulled with publicKey when omitted)
  credential?: ZedgiCredential; // legacy default DB/service credential; credential.header is sent signed but unencrypted
  credentials?: ZedgiCredentialProfiles; // named credentials per service; "default" is used when no profile is selected
  cache?: boolean;             // cache encrypted credential blob in memory (default true)
  timeout?: number;
  testNodeUuid?: string;       // admin diagnostics only: force /rpc through a specific proxy node
}>;

export type ZedgiServiceType =
  | 'redis'
  | 'postgres'
  | 'mysql'
  | 'memcached'
  | 'mongodb'
  | 'rabbitmq'
  | 'nats'
  | 'mqtt'
  | 'ldap'
  | 'sftp';

export type ZedgiCallOptions = Readonly<{
  requestId?: string;
  credential?: ZedgiCredentialSelector;
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

export type MemcachedClient = Readonly<{
  ping: () => Promise<{ pong: boolean; version?: string }>;
  version: () => Promise<string>;
  get: (key: string) => Promise<string | null>;
  getMany: (keys: string[]) => Promise<Record<string, string | null>>;
  gets: (key: string) => Promise<{ value: string; flags: number; cas?: string } | null>;
  gat: (ttl: number, key: string) => Promise<string | null>;
  gats: (ttl: number, key: string) => Promise<{ value: string; flags: number; cas?: string } | null>;
  set: (key: string, value: unknown, ttl?: number, flags?: number) => Promise<boolean>;
  add: (key: string, value: unknown, ttl?: number, flags?: number) => Promise<boolean>;
  replace: (key: string, value: unknown, ttl?: number, flags?: number) => Promise<boolean>;
  append: (key: string, value: unknown) => Promise<boolean>;
  prepend: (key: string, value: unknown) => Promise<boolean>;
  cas: (key: string, value: unknown, cas: string, ttl?: number, flags?: number) => Promise<boolean>;
  delete: (key: string) => Promise<boolean>;
  del: (key: string) => Promise<boolean>;
  incr: (key: string, delta?: number) => Promise<number | null>;
  decr: (key: string, delta?: number) => Promise<number | null>;
  touch: (key: string, ttl: number) => Promise<boolean>;
  stats: (arg?: string) => Promise<Record<string, string>>;
}>;

/** A serialized BullMQ job as returned by the backend. */
export type QueueJob = Readonly<{
  id?: string;
  name: string;
  queueName: string;
  data: unknown;
  opts: Record<string, unknown>;
  attemptsMade: number;
  failedReason?: string;
  returnvalue?: unknown;
  timestamp?: number;
  processedOn?: number | null;
  finishedOn?: number | null;
  state?: string;
}>;

/**
 * BullMQ queue client. Rides on your existing Redis service — ops are sent as
 * `bull:<method>` with the queue name in the payload. Obtain one with
 * `zedgi.queue('emails')`.
 */
export type QueueClient = Readonly<{
  add: (jobName: string, data?: unknown, opts?: Record<string, unknown>) => Promise<QueueJob | null>;
  getJob: (id: string) => Promise<QueueJob | null>;
  getJobs: (states?: string[], start?: number, end?: number, asc?: boolean) => Promise<(QueueJob | null)[]>;
  getJobCounts: (...types: string[]) => Promise<Record<string, number>>;
  count: () => Promise<number>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  drain: (delayed?: boolean) => Promise<boolean>;
  clean: (grace: number, limit: number, type?: string) => Promise<string[]>;
  removeJob: (id: string) => Promise<boolean>;
  retryJob: (id: string) => Promise<{ ok: boolean; status: string }>;
  promoteJob: (id: string) => Promise<{ ok: boolean; status: string }>;
  obliterate: (opts?: Record<string, unknown>) => Promise<boolean>;
  closeQueue: () => Promise<boolean>;
  getSnapshot: () => Promise<{ status: string; startedAt: string; queues: Array<{ name: string; counts: Record<string, number> }> }>;
  getEvents: () => Promise<Array<{ event: string; payload: unknown; at: number }>>;
  getRecentJobsForQueue: (limit?: number) => Promise<(QueueJob | null)[]>;
}>;

export type ZedgiClient = Readonly<{
  redis: (credential?: ZedgiCredentialSelector) => RedisClient;
  postgres: (credential?: ZedgiCredentialSelector) => PostgresClient;
  mysql: (credential?: ZedgiCredentialSelector) => MySQLClient;
  memcached: (credential?: ZedgiCredentialSelector) => MemcachedClient;
  queue: (name: string, credential?: ZedgiCredentialSelector) => QueueClient;
  call: <T = unknown>(service: ZedgiServiceType, method: string, payload?: Record<string, unknown>, options?: ZedgiCallOptions) => Promise<T>;
}>;
