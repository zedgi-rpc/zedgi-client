import type { ZedgiClientOptions, ZedgiServiceType } from './types.js';
export declare const callZedgi: <T = unknown>(options: ZedgiClientOptions, service: ZedgiServiceType, method: string, payload?: Record<string, unknown>) => Promise<T>;
