import { callZedgi } from './client.js';
import { createMysqlClient } from './mysql.js';
import { createPostgresClient } from './postgres.js';
import { createRedisClient } from './redis.js';
export const createZedgiClient = (options) => Object.freeze({
    redis: () => createRedisClient(options),
    postgres: () => createPostgresClient(options),
    mysql: () => createMysqlClient(options),
    call: (service, method, payload) => callZedgi(options, service, method, payload ?? {}),
});
export { createRedisClient } from './redis.js';
export { createPostgresClient } from './postgres.js';
export { createMysqlClient } from './mysql.js';
export { callZedgi } from './client.js';
// Low-level crypto helpers — exported so advanced users (and our own diagnostics)
// can hand-build a signed/encrypted `/rpc` request without the high-level client.
export { encryptCredential, hmacSign, randomNonce, sha256Hex } from './crypto.js';
export const _ZEDGI_CLIENT_VERSION = '1.0.1';
