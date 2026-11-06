export declare const ADMIN_HEADER: string
export declare function sortQuery(search: string): string
export declare function signingString(v: { method: string; host: string; path: string; query: string; bodySha256: string; timestamp: number; nonce: string; keyId: string }): string
export declare function formatHeader(v: { keyId: string; timestamp: number; nonce: string; signature: string }): string
