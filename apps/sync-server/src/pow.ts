// 作成の費用を上げる計算の問題。問題はサーバーの秘密で署名し、期限と space_id に結び付ける
import { fromBase64Url, safeEqual, sha256, toBase64Url, utf8 } from './encoding'

async function mac(secret: string, text: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(text)))
}

export async function issuePow(secret: string, spaceId: string, bits: number, nowMs: number, ttlSec: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSec
  const payload = `v1.${spaceId}.${exp}.${bits}`
  return `${payload}.${toBase64Url(await mac(secret, payload))}`
}

export function leadingZeroBits(b: Uint8Array): number {
  let n = 0
  for (const x of b) {
    if (x === 0) {
      n += 8
      continue
    }
    return n + Math.clz32(x) - 24
  }
  return n
}

export async function verifyPow(secret: string, spaceId: string, minBits: number, nowMs: number, challenge: string, nonce: string): Promise<boolean> {
  const m = /^(v1\.([0-9a-f]{64})\.([0-9]{1,12})\.([0-9]{1,3}))\.([A-Za-z0-9_-]{43})$/.exec(challenge)
  if (!m) return false
  const sig = fromBase64Url(m[5])
  if (!sig || !safeEqual(sig, await mac(secret, m[1]))) return false
  if (m[2] !== spaceId) return false
  if (Number(m[3]) * 1000 <= nowMs) return false
  const bits = Number(m[4])
  if (bits < minBits) return false
  return leadingZeroBits(await sha256(utf8(`${challenge}:${nonce}`))) >= bits
}
