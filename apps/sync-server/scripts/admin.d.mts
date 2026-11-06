export declare function parseArgs(argv: string[]): { flags: Record<string, string>; rest: string[] }
export declare function checkKeyFile(path: string, platform?: string): void
export declare function keygen(out: string, keyId: string): { keyId: string; publicKey: string }
export declare function run(argv: string[], deps?: { env?: Record<string, string | undefined>; out?: (s: string) => void; fetch?: (url: string, init: RequestInit) => Promise<Response>; ask?: (q: string) => Promise<string>; now?: () => number }): Promise<number>
