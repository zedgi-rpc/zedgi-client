import { callZedgi } from './client.js';
export const createPostgresClient = (options) => {
    const builtins = {
        ping: () => callZedgi(options, 'postgres', 'ping'),
        query: (sql, params) => callZedgi(options, 'postgres', 'query', { sql, params: params ?? [] }),
        transaction: (statements) => callZedgi(options, 'postgres', 'transaction', { statements }),
        hook: (name, payload = {}) => callZedgi(options, 'postgres', name, payload),
    };
    return new Proxy(builtins, {
        get(target, prop) {
            if (typeof prop !== 'string')
                return undefined;
            if (prop in target)
                return target[prop];
            return (...args) => callZedgi(options, 'postgres', prop, { args });
        },
    });
};
