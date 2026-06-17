import { callZedgi } from './client.js';
import type { HookPayload, MysqlQueryResult, MySQLClient, TransactionStatement, ZedgiClientOptions } from './types.js';

export const createMysqlClient = (options: ZedgiClientOptions): MySQLClient => {
  const builtins: Record<string, (...args: never[]) => Promise<unknown>> = {
    ping: () => callZedgi<{ pong: boolean }>(options, 'mysql', 'ping'),
    query: (sql: string, params?: unknown[]) =>
      callZedgi<MysqlQueryResult>(options, 'mysql', 'query', { sql, params: params ?? [] }),
    transaction: (statements: TransactionStatement[]) =>
      callZedgi<MysqlQueryResult[]>(options, 'mysql', 'transaction', { statements }),
    hook: (name: string, payload: HookPayload = {}) =>
      callZedgi<unknown>(options, 'mysql', name, payload),
  };

  return new Proxy(builtins, {
    get(target, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => callZedgi(options, 'mysql', prop, { args });
    },
  }) as unknown as MySQLClient;
};
