import { callZedgi } from './client.js';
import type { MemcachedClient, ZedgiClientOptions, ZedgiCredentialSelector } from './types.js';

export const createMemcachedClient = (
  options: ZedgiClientOptions,
  credential?: ZedgiCredentialSelector
): MemcachedClient => {
  const call = <T>(method: string, payload: Record<string, unknown> = {}): Promise<T> =>
    callZedgi<T>(options, 'memcached', method, payload, { credential });

  const store = (method: string, key: string, value: unknown, ttl = 0, flags = 0): Promise<boolean> =>
    call<boolean>(method, { key, value, ttl, flags });

  return Object.freeze({
    ping: () => call<{ pong: boolean; version?: string }>('ping'),
    version: () => call<string>('version'),
    get: (key: string) => call<string | null>('get', { key }),
    getMany: (keys: string[]) => call<Record<string, string | null>>('get', { keys }),
    gets: (key: string) => call<{ value: string; flags: number; cas?: string } | null>('gets', { key }),
    gat: (ttl: number, key: string) => call<string | null>('gat', { ttl, key }),
    gats: (ttl: number, key: string) => call<{ value: string; flags: number; cas?: string } | null>('gats', { ttl, key }),
    set: (key: string, value: unknown, ttl = 0, flags = 0) => store('set', key, value, ttl, flags),
    add: (key: string, value: unknown, ttl = 0, flags = 0) => store('add', key, value, ttl, flags),
    replace: (key: string, value: unknown, ttl = 0, flags = 0) => store('replace', key, value, ttl, flags),
    append: (key: string, value: unknown) => store('append', key, value),
    prepend: (key: string, value: unknown) => store('prepend', key, value),
    cas: (key: string, value: unknown, cas: string, ttl = 0, flags = 0) =>
      call<boolean>('cas', { key, value, cas, ttl, flags }),
    delete: (key: string) => call<boolean>('delete', { key }),
    del: (key: string) => call<boolean>('delete', { key }),
    incr: (key: string, delta = 1) => call<number | null>('incr', { key, delta }),
    decr: (key: string, delta = 1) => call<number | null>('decr', { key, delta }),
    touch: (key: string, ttl: number) => call<boolean>('touch', { key, ttl }),
    stats: (arg?: string) => call<Record<string, string>>('stats', arg ? { arg } : {}),
  });
};
