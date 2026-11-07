// 書き込み履歴の ID と本文の切り方。切った後の本文で ID を作る(受け取った端末は切った本文しか持たないので、切る前で作ると作り直しで別の ID になる)
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex, utf8 } from './bytes'
import { POST_BODY_MAX } from './schema'

/** 暗号文の上限 16KB に、スレタイと URL の分を残す。エスケープで膨らんだ長さで数える */
export const POST_BODY_JSON_BYTES = 12288
const POST_ID_HEX = 32

/** JSON に書いたときのバイト数(canonicalJson と同じ規則) */
function jsonBytes(code: number): number {
  if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) return 2
  if (code < 0x20) return 6
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code >= 0xd800 && code <= 0xdfff) return 6
  return code < 0x10000 ? 3 : 4
}

/** 文字の途中で切らない。どちらの上限でも同じ位置で止まるので、PC とスマホで同じ本文になる */
export function fitPostBody(body: string): string {
  let bytes = 0
  let i = 0
  while (i < body.length) {
    const code = body.codePointAt(i) as number
    const units = code >= 0x10000 ? 2 : 1
    bytes += jsonBytes(code)
    if (i + units > POST_BODY_MAX || bytes > POST_BODY_JSON_BYTES) break
    i += units
  }
  return body.slice(0, i)
}

/** normalizedBoard は normalizeBoardUrl の値。同じ書き込みはどの端末でも、種まきをやり直しても同じ ID になる */
export function postIdOf(normalizedBoard: string, key: string, postedAt: number, body: string): string {
  return toHex(sha256(utf8(`${normalizedBoard}|${key}|${postedAt}|${fitPostBody(body)}`))).slice(0, POST_ID_HEX)
}
