import { callZedgi } from './client.js';
import type { ZedgiClientOptions, RedisClient, HookPayload } from './types.js';

/**
 * Wraps the typed built-in methods in a Proxy so any unknown method name is
 * forwarded as a registered custom-hook call: `redis.topUsers('leaderboard', 10)`
 * → POST /rpc { method: 'topUsers', payload: { args: ['leaderboard', 10] } }.
 * For Lua hooks needing KEYS, use the explicit `redis.hook(name, { keys, args })`.
 */
export const createRedisClient = (options: ZedgiClientOptions): RedisClient => {
  const call = <T>(method: string, payload: Record<string, unknown> = {}): Promise<T> =>
    callZedgi<T>(options, 'redis', method, payload);

  const builtins: Record<string, (...args: never[]) => Promise<unknown>> = {
    ping: () => call<string>('ping'),
    get: (key: string) => call<string | null>('get', { args: [key] }),
    set: (key: string, value: string, ...args: unknown[]) => call('set', { args: [key, value, ...args] }),
    del: (...keys: string[]) => call<number>('del', { args: keys }),
    exists: (...keys: string[]) => call<number>('exists', { args: keys }),
    expire: (key: string, seconds: number) => call<number>('expire', { args: [key, seconds] }),
    ttl: (key: string) => call<number>('ttl', { args: [key] }),
    incr: (key: string) => call<number>('incr', { args: [key] }),
    decr: (key: string) => call<number>('decr', { args: [key] }),
    incrby: (key: string, increment: number) => call<number>('incrby', { args: [key, increment] }),
    decrby: (key: string, decrement: number) => call<number>('decrby', { args: [key, decrement] }),
    hget: (key: string, field: string) => call<string | null>('hget', { args: [key, field] }),
    hset: (key: string, ...fv: string[]) => call<number>('hset', { args: [key, ...fv] }),
    hgetall: (key: string) => call<Record<string, string> | null>('hgetall', { args: [key] }),
    hdel: (key: string, ...fields: string[]) => call<number>('hdel', { args: [key, ...fields] }),
    lpush: (key: string, ...values: string[]) => call<number>('lpush', { args: [key, ...values] }),
    rpush: (key: string, ...values: string[]) => call<number>('rpush', { args: [key, ...values] }),
    lpop: (key: string) => call<string | null>('lpop', { args: [key] }),
    rpop: (key: string) => call<string | null>('rpop', { args: [key] }),
    lrange: (key: string, start: number, stop: number) => call<string[]>('lrange', { args: [key, start, stop] }),
    sadd: (key: string, ...members: string[]) => call<number>('sadd', { args: [key, ...members] }),
    srem: (key: string, ...members: string[]) => call<number>('srem', { args: [key, ...members] }),
    smembers: (key: string) => call<string[]>('smembers', { args: [key] }),
    sismember: (key: string, member: string) => call<number>('sismember', { args: [key, member] }),
    zadd: (key: string, score: number, member: string) => call<number>('zadd', { args: [key, score, member] }),
    zrange: (key: string, start: number, stop: number) => call<string[]>('zrange', { args: [key, start, stop] }),
    zscore: (key: string, member: string) => call<string | null>('zscore', { args: [key, member] }),
    call: (command: string, ...args: unknown[]) => call<unknown>('call', { command, args }),
    pipeline: (commands: Array<{ command: string; args?: unknown[] }>) => call<unknown[]>('pipeline', { commands }),
    multi: (commands: Array<{ command: string; args?: unknown[] }>) => call<unknown[]>('multi', { commands }),
    hook: (name: string, payload: HookPayload = {}) => call<unknown>(name, payload as Record<string, unknown>),
  };

  return new Proxy(builtins, {
    get(target, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      // Unknown name → treat as a custom hook; pass positional args through.
      return (...args: unknown[]) => call(prop, { args });
    },
  }) as unknown as RedisClient;
};
