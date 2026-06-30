import { callZedgi } from './client.js';
import type { HookPayload, PostgresClient, QueryResult, TransactionStatement, ZedgiClientOptions, ZedgiCredentialSelector } from './types.js';

export const createPostgresClient = (options: ZedgiClientOptions, credential?: ZedgiCredentialSelector): PostgresClient => {
  const builtins: Record<string, (...args: never[]) => Promise<unknown>> = {
    ping: () => callZedgi<{ pong: boolean }>(options, 'postgres', 'ping', {}, { credential }),
    query: (sql: string, params?: unknown[]) =>
      callZedgi<QueryResult>(options, 'postgres', 'query', { sql, params: params ?? [] }, { credential }),
    transaction: (statements: TransactionStatement[]) =>
      callZedgi<QueryResult[]>(options, 'postgres', 'transaction', { statements }, { credential }),
    hook: (name: string, payload: HookPayload = {}) =>
      callZedgi<unknown>(options, 'postgres', name, payload as Record<string, unknown>, { credential }),
  };

  return new Proxy(builtins, {
    get(target, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => callZedgi(options, 'postgres', prop, { args }, { credential });
    },
  }) as unknown as PostgresClient;
};
