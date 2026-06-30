import { callZedgi } from './client.js';
import { createMysqlClient } from './mysql.js';
import { createPostgresClient } from './postgres.js';
import { createRedisClient } from './redis.js';
import { createQueueClient } from './queue.js';
import type { ZedgiCallOptions, ZedgiClient, ZedgiClientOptions, ZedgiCredentialSelector, ZedgiServiceType } from './types.js';

export const createZedgiClient = (options: ZedgiClientOptions): ZedgiClient =>
  Object.freeze({
    redis: (credential?: ZedgiCredentialSelector) => createRedisClient(options, credential),
    postgres: (credential?: ZedgiCredentialSelector) => createPostgresClient(options, credential),
    mysql: (credential?: ZedgiCredentialSelector) => createMysqlClient(options, credential),
    queue: (name: string, credential?: ZedgiCredentialSelector) => createQueueClient(options, name, credential),
    call: <T = unknown>(
      service: ZedgiServiceType,
      method: string,
      payload?: Record<string, unknown>,
      callOptions?: ZedgiCallOptions
    ) => callZedgi<T>(options, service, method, payload ?? {}, callOptions),
  });

export { createRedisClient } from './redis.js';
export { createPostgresClient } from './postgres.js';
export { createMysqlClient } from './mysql.js';
export { createQueueClient } from './queue.js';
export { callZedgi } from './client.js';

// Low-level crypto helpers — exported so advanced users (and our own diagnostics)
// can hand-build a signed/encrypted `/rpc` request without the high-level client.
export { encryptCredential, hmacSign, randomNonce, sha256Hex } from './crypto.js';

export type {
  ZedgiClient,
  ZedgiClientOptions,
  ZedgiCredential,
  ZedgiCredentialProfiles,
  ZedgiCredentialSelector,
  ZedgiCallOptions,
  ZedgiServiceType,
  RedisClient,
  PostgresClient,
  MySQLClient,
  QueueClient,
  QueueJob,
  QueryResult,
  MysqlQueryResult,
  TransactionStatement,
} from './types.js';

export const _ZEDGI_CLIENT_VERSION = '1.0.3';
