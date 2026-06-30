import { callZedgi } from './client.js';
import type { HookPayload, MysqlQueryResult, MySQLClient, TransactionStatement, ZedgiClientOptions, ZedgiCredentialSelector } from './types.js';

export const createMysqlClient = (options: ZedgiClientOptions, credential?: ZedgiCredentialSelector): MySQLClient => {
  const builtins: Record<string, (...args: never[]) => Promise<unknown>> = {
    ping: () => callZedgi<{ pong: boolean }>(options, 'mysql', 'ping', {}, { credential }),
    query: (sql: string, params?: unknown[]) =>
      callZedgi<MysqlQueryResult>(options, 'mysql', 'query', { sql, params: params ?? [] }, { credential }),
    transaction: (statements: TransactionStatement[]) =>
      callZedgi<MysqlQueryResult[]>(options, 'mysql', 'transaction', { statements }, { credential }),
    hook: (name: string, payload: HookPayload = {}) =>
      callZedgi<unknown>(options, 'mysql', name, payload, { credential }),
  };

  return new Proxy(builtins, {
    get(target, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => callZedgi(options, 'mysql', prop, { args }, { credential });
    },
  }) as unknown as MySQLClient;
};
