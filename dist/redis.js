import { callZedgi } from './client.js';
/**
 * Wraps the typed built-in methods in a Proxy so any unknown method name is
 * forwarded as a registered custom-hook call: `redis.topUsers('leaderboard', 10)`
 * → POST /rpc { method: 'topUsers', payload: { args: ['leaderboard', 10] } }.
 * For Lua hooks needing KEYS, use the explicit `redis.hook(name, { keys, args })`.
 */
export const createRedisClient = (options) => {
    const call = (method, payload = {}) => callZedgi(options, 'redis', method, payload);
    const builtins = {
        ping: () => call('ping'),
        get: (key) => call('get', { args: [key] }),
        set: (key, value, ...args) => call('set', { args: [key, value, ...args] }),
        del: (...keys) => call('del', { args: keys }),
        exists: (...keys) => call('exists', { args: keys }),
        expire: (key, seconds) => call('expire', { args: [key, seconds] }),
        ttl: (key) => call('ttl', { args: [key] }),
        incr: (key) => call('incr', { args: [key] }),
        decr: (key) => call('decr', { args: [key] }),
        incrby: (key, increment) => call('incrby', { args: [key, increment] }),
        decrby: (key, decrement) => call('decrby', { args: [key, decrement] }),
        hget: (key, field) => call('hget', { args: [key, field] }),
        hset: (key, ...fv) => call('hset', { args: [key, ...fv] }),
        hgetall: (key) => call('hgetall', { args: [key] }),
        hdel: (key, ...fields) => call('hdel', { args: [key, ...fields] }),
        lpush: (key, ...values) => call('lpush', { args: [key, ...values] }),
        rpush: (key, ...values) => call('rpush', { args: [key, ...values] }),
        lpop: (key) => call('lpop', { args: [key] }),
        rpop: (key) => call('rpop', { args: [key] }),
        lrange: (key, start, stop) => call('lrange', { args: [key, start, stop] }),
        sadd: (key, ...members) => call('sadd', { args: [key, ...members] }),
        srem: (key, ...members) => call('srem', { args: [key, ...members] }),
        smembers: (key) => call('smembers', { args: [key] }),
        sismember: (key, member) => call('sismember', { args: [key, member] }),
        zadd: (key, score, member) => call('zadd', { args: [key, score, member] }),
        zrange: (key, start, stop) => call('zrange', { args: [key, start, stop] }),
        zscore: (key, member) => call('zscore', { args: [key, member] }),
        call: (command, ...args) => call('call', { command, args }),
        pipeline: (commands) => call('pipeline', { commands }),
        multi: (commands) => call('multi', { commands }),
        hook: (name, payload = {}) => call(name, payload),
    };
    return new Proxy(builtins, {
        get(target, prop) {
            if (typeof prop !== 'string')
                return undefined;
            if (prop in target)
                return target[prop];
            // Unknown name → treat as a custom hook; pass positional args through.
            return (...args) => call(prop, { args });
        },
    });
};
