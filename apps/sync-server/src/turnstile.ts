// 一般公開のときだけ使う。秘密を入れない限り呼ばれない
import type { Config } from './config'
import { runtime } from './runtime'

export type TurnstileResult = 'ok' | 'invalid' | 'unavailable'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(secret: string, token: string, cfg: Config): Promise<TurnstileResult> {
  let res: Response
  try {
    res = await runtime.fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
    })
  } catch {
    return 'unavailable'
  }
  if (!res.ok) return 'unavailable'
  let v: { success?: unknown; hostname?: unknown; action?: unknown }
  try {
    v = await res.json()
  } catch {
    return 'unavailable'
  }
  // 期限切れと再利用は検証サービスが success: false で返す
  if (v.success !== true) return 'invalid'
  if (cfg.turnstileHostname && v.hostname !== cfg.turnstileHostname) return 'invalid'
  if (v.action !== cfg.turnstileAction) return 'invalid'
  return 'ok'
}
