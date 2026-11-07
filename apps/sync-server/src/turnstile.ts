// 許可証の発行のときだけ呼ぶ。再利用と期限切れは検証サービスが timeout-or-duplicate で断る
import { runtime } from './runtime'

export type TurnstileResult = 'ok' | 'invalid' | 'unavailable'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 10_000
/** 利用者のせいではない失敗。発行を止めるほうへ倒す */
const SERVICE_ERRORS = new Set(['internal-error', 'missing-input-secret', 'invalid-input-secret', 'bad-request'])
/** Cloudflare の公式のテスト用の秘密。本物のトークンを断り、ダミーのトークンだけを通す */
const TEST_SECRETS = new Set(['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA'])

export const isTestSecret = (secret: string): boolean => TEST_SECRETS.has(secret)

export interface TurnstileClaims {
  hostname: string
  action: string
}

/** claims が null なのはテスト用の秘密のときだけ。応答の hostname が example.com に決まっていて action もないため */
export async function verifyTurnstile(secret: string, token: string, claims: TurnstileClaims | null): Promise<TurnstileResult> {
  let res: Response
  try {
    res = await runtime.fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return 'unavailable'
  }
  if (res.status >= 500) return 'unavailable'
  let v: { success?: unknown; hostname?: unknown; action?: unknown; 'error-codes'?: unknown }
  try {
    v = await res.json()
  } catch {
    return 'unavailable'
  }
  if (v.success !== true) {
    const codes = Array.isArray(v['error-codes']) ? v['error-codes'] : []
    return codes.length === 0 || codes.some((c) => SERVICE_ERRORS.has(c as string)) ? 'unavailable' : 'invalid'
  }
  if (claims && (v.hostname !== claims.hostname || v.action !== claims.action)) return 'invalid'
  return 'ok'
}
