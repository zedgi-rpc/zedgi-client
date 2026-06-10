import type { ZedgiClientOptions, RedisClient } from './types.js';
/**
 * Wraps the typed built-in methods in a Proxy so any unknown method name is
 * forwarded as a registered custom-hook call: `redis.topUsers('leaderboard', 10)`
 * → POST /rpc { method: 'topUsers', payload: { args: ['leaderboard', 10] } }.
 * For Lua hooks needing KEYS, use the explicit `redis.hook(name, { keys, args })`.
 */
export declare const createRedisClient: (options: ZedgiClientOptions) => RedisClient;
