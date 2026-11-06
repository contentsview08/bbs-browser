// 領域の作成に要る計算の問題を解く。決まりは docs/sync-client.md の「サーバーとの形」と packages/conformance/sync-pow.json
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8 } from '../bytes'

/** これより難しい問題は悪意のあるサーバーとして解かない。端末を止められないように */
export const POW_MAX_BITS = 28
const YIELD_EVERY = 4096

export interface PowChallenge {
  challenge: string
  bits: number
}

export function checkPowChallenge(v: unknown): PowChallenge {
  const o = v as PowChallenge | null
  if (o === null || typeof o !== 'object' || typeof o.challenge !== 'string' || o.challenge.length === 0 || o.challenge.length > 512) throw new Error('bad_pow')
  if (!Number.isSafeInteger(o.bits) || o.bits < 0 || o.bits > POW_MAX_BITS) throw new Error('bad_pow')
  return { challenge: o.challenge, bits: o.bits }
}

export function powOk(challenge: string, nonce: string, bits: number): boolean {
  const h = sha256(utf8(`${challenge}:${nonce}`))
  let left = bits
  for (const x of h) {
    if (left <= 0) return true
    if (left >= 8) {
      if (x !== 0) return false
      left -= 8
    } else return x >> (8 - left) === 0
  }
  return left <= 0
}

/** 画面を止めないよう、ときどき譲る */
export async function solvePow(challenge: string, bits: number): Promise<string> {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36)
    if (powOk(challenge, nonce, bits)) return nonce
    if (i % YIELD_EVERY === YIELD_EVERY - 1) await new Promise((r) => setTimeout(r, 0))
  }
}
