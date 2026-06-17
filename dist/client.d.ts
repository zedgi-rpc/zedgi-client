import type { ZedgiClientOptions, ZedgiServiceType } from './types.js';
export declare const splitCredentialHeader: (credential: Record<string, unknown>) => {
    encryptedCredential: Record<string, unknown>;
    credentialHeader?: Record<string, unknown>;
};
export declare const callZedgi: <T = unknown>(options: ZedgiClientOptions, service: ZedgiServiceType, method: string, payload?: Record<string, unknown>) => Promise<T>;
