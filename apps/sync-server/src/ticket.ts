// 領域の作成の許可証。発行も確認も同じサーバーなので HMAC で足りる。保存しないので、確認は署名だけで済む
import { fromBase64Url, safeEqual, toBase64Url, utf8 } from './encoding'

const FORM = /^(v1\.([0-9a-f]{64})\.([0-9]{1,12})\.([A-Za-z0-9_-]{1,16}))\.([A-Za-z0-9_-]{43})$/
const KID = /^[A-Za-z0-9_-]{1,16}$/
const MIN_KEY_BYTES = 32

export type TicketCheck = 'ok' | 'invalid' | 'expired'

/** 1 つでも読めない鍵があれば全部を捨てる。設定の誤りで弱い鍵を受け入れないように */
export function parseTicketKeys(raw: string): Map<string, Uint8Array> | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const keys = new Map<string, Uint8Array>()
  for (const [kid, secret] of Object.entries(v)) {
    const bytes = typeof secret === 'string' ? fromBase64Url(secret) : null
    if (!KID.test(kid) || !bytes || bytes.length < MIN_KEY_BYTES) return null
    keys.set(kid, bytes)
  }
  return keys.size > 0 ? keys : null
}

async function mac(key: Uint8Array, payload: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8(`obb-sync-ticket-v1:${payload}`)))
}

export async function issueTicket(key: Uint8Array, kid: string, spaceId: string, expSec: number): Promise<string> {
  const payload = `v1.${spaceId}.${expSec}.${kid}`
  return `${payload}.${toBase64Url(await mac(key, payload))}`
}

export async function checkTicket(keys: Map<string, Uint8Array>, spaceId: string, nowMs: number, ticket: string): Promise<TicketCheck> {
  const m = FORM.exec(ticket)
  if (!m) return 'invalid'
  const key = keys.get(m[4])
  const sig = fromBase64Url(m[5])
  if (!key || !sig || !safeEqual(sig, await mac(key, m[1]))) return 'invalid'
  if (m[2] !== spaceId) return 'invalid'
  return Number(m[3]) * 1000 <= nowMs ? 'expired' : 'ok'
}
