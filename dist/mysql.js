import { callZedgi } from './client.js';
export const createMysqlClient = (options) => {
    const builtins = {
        ping: () => callZedgi(options, 'mysql', 'ping'),
        query: (sql, params) => callZedgi(options, 'mysql', 'query', { sql, params: params ?? [] }),
        transaction: (statements) => callZedgi(options, 'mysql', 'transaction', { statements }),
        hook: (name, payload = {}) => callZedgi(options, 'mysql', name, payload),
    };
    return new Proxy(builtins, {
        get(target, prop) {
            if (typeof prop !== 'string')
                return undefined;
            if (prop in target)
                return target[prop];
            return (...args) => callZedgi(options, 'mysql', prop, { args });
        },
    });
};
