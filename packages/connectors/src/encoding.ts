// バイト列の文字コードを見分ける。掲示板は Content-Type に charset を書かないことが多く、
// 同じサイトでも bbsmenu.html は UTF-8、subject.txt は Shift_JIS ということがある。
// 宣言は間違っていることもあるので、バイト列そのものを最も強い手がかりにする。
// スマホ版の bbs/Encoding.kt と同じ決まりで、正は packages/conformance/charset.json。

import { formBody } from './formEncode'
import type { Encoding } from './types'

interface Utf8Stats {
  /** 3・4 バイトの正しい並び。日本語の UTF-8 はここに入る */
  long: number
  /** 2 バイトの正しい並び。Shift_JIS の半角カナでも偶然できる */
  short: number
  invalid: number
}

function utf8Stats(b: Uint8Array): Utf8Stats {
  const s: Utf8Stats = { long: 0, short: 0, invalid: 0 }
  const cont = (i: number, lo = 0x80, hi = 0xbf) => i >= b.length || (b[i] >= lo && b[i] <= hi)
  for (let i = 0; i < b.length; ) {
    const c = b[i]
    if (c < 0x80) {
      i++
    } else if (c >= 0xc2 && c <= 0xdf && cont(i + 1)) {
      if (i + 2 <= b.length) s.short++
      i += 2
    } else if (c >= 0xe0 && c <= 0xef && cont(i + 1, c === 0xe0 ? 0xa0 : 0x80, c === 0xed ? 0x9f : 0xbf) && cont(i + 2)) {
      // 末尾で切れた並びは、許すが手がかりにはしない
      if (i + 3 <= b.length) s.long++
      i += 3
    } else if (c >= 0xf0 && c <= 0xf4 && cont(i + 1, c === 0xf0 ? 0x90 : 0x80, c === 0xf4 ? 0x8f : 0xbf) && cont(i + 2) && cont(i + 3)) {
      if (i + 4 <= b.length) s.long++
      i += 4
    } else {
      s.invalid++
      i++
    }
  }
  return s
}

/** Shift_JIS として正しくないバイトの数 */
function sjisInvalid(b: Uint8Array): number {
  let n = 0
  for (let i = 0; i < b.length; i++) {
    const c = b[i]
    if (c < 0x80 || (c >= 0xa1 && c <= 0xdf)) continue
    if ((c >= 0x81 && c <= 0x9f) || (c >= 0xe0 && c <= 0xfc)) {
      if (i + 1 >= b.length) break
      const t = b[i + 1]
      if ((t >= 0x40 && t <= 0x7e) || (t >= 0x80 && t <= 0xfc)) i++
      else n++
    } else n++
  }
  return n
}

const eucTrail = (c: number) => c >= 0xa1 && c <= 0xfe

/** EUC-JP として正しくないバイトの数と、ひらがなの数 */
function eucStats(b: Uint8Array): { invalid: number; pairs: number; hiragana: number } {
  const s = { invalid: 0, pairs: 0, hiragana: 0 }
  for (let i = 0; i < b.length; i++) {
    const c = b[i]
    if (c < 0x80) continue
    if (i + 1 >= b.length) break
    const t = b[i + 1]
    if (c === 0x8e && t >= 0xa1 && t <= 0xdf) {
      i++
    } else if (c === 0x8f && eucTrail(t) && (i + 2 >= b.length || eucTrail(b[i + 2]))) {
      i += 2
    } else if (eucTrail(c) && eucTrail(t)) {
      s.pairs++
      // Shift_JIS の半角の「､」「･」の並びと紛れないように、その 2 つは数えない
      if (c === 0xa4 && t !== 0xa4 && t !== 0xa5) s.hiragana++
      i++
    } else s.invalid++
  }
  return s
}

/** Shift_JIS と EUC-JP のどちらか。どちらとしても正しいときは、ひらがなが目立てば EUC-JP(Shift_JIS では半角カナの羅列になる) */
function guessLegacy(b: Uint8Array, preferred: Encoding): Encoding {
  const sjis = sjisInvalid(b)
  const euc = eucStats(b)
  if (sjis !== euc.invalid) return sjis < euc.invalid ? 'shift_jis' : 'euc-jp'
  if (sjis > 0) return preferred === 'euc-jp' ? 'euc-jp' : 'shift_jis'
  if (preferred === 'euc-jp') return 'euc-jp'
  return euc.hiragana >= 3 && euc.hiragana * 4 >= euc.pairs ? 'euc-jp' : 'shift_jis'
}

const LABELS: Record<string, Encoding> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  shift_jis: 'shift_jis',
  'shift-jis': 'shift_jis',
  sjis: 'shift_jis',
  'x-sjis': 'shift_jis',
  ms932: 'shift_jis',
  cp932: 'shift_jis',
  'windows-31j': 'shift_jis',
  'x-ms-cp932': 'shift_jis',
  'euc-jp': 'euc-jp',
  eucjp: 'euc-jp',
  'x-euc-jp': 'euc-jp',
}

/** UTF-8 の日本語と言ってよいか。Shift_JIS の文章がこの形になることはまずない。数バイトの壊れは許す */
const isJapaneseUtf8 = (s: Utf8Stats) => s.long > 0 && s.invalid * 20 <= s.long

/** 宣言された文字コードの名前(小文字)。ヘッダー、なければ HTML の <meta> */
export function declaredCharset(body: Uint8Array, contentType?: string): string | undefined {
  const type = contentType ?? ''
  const fromHeader = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(type)?.[1]
  if (fromHeader) return fromHeader.toLowerCase()
  // dat や subject.txt の本文に書かれた <meta> を宣言と取り違えないように、HTML のときだけ見る
  if (/text\/plain/i.test(type)) return undefined
  let head = ''
  for (let i = 0; i < Math.min(body.length, 4096); i++) head += String.fromCharCode(body[i])
  if (!/^\s*</.test(head)) return undefined
  return /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1].toLowerCase()
}

export const looksLikeUtf8 = (body: Uint8Array) => isJapaneseUtf8(utf8Stats(body))

/**
 * 文字コードを決める。順番は UTF-8 の BOM → UTF-8 の形 → 宣言(中身と矛盾しなければ) → 中身から推測。
 * fallback は、手がかりがないときに選ぶもの(そのサイトの慣習)
 */
export function detectEncoding(body: Uint8Array, contentType?: string, fallback: Encoding = 'shift_jis'): Encoding {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return 'utf-8'
  const label = declaredCharset(body, contentType)
  const declared = label ? LABELS[label] : undefined
  if (!body.some((c) => c >= 0x80)) return declared ?? fallback
  const utf8 = utf8Stats(body)
  if (isJapaneseUtf8(utf8)) return 'utf-8'
  if (declared === 'utf-8' && utf8.invalid * 20 <= utf8.long + utf8.short) return 'utf-8'
  if (declared === 'shift_jis' && sjisInvalid(body) === 0) return 'shift_jis'
  if (declared === 'euc-jp' && eucStats(body).invalid === 0) return 'euc-jp'
  if (fallback === 'utf-8' && utf8.invalid === 0) return 'utf-8'
  return guessLegacy(body, declared ?? fallback)
}

/** UTF-8 の掲示板へ送るフォームの本文。空白は +、改行は CR LF(Shift_JIS のときと同じ決まり) */
export function encodeUtf8Form(fields: Record<string, string>): string {
  const utf8 = new TextEncoder()
  return formBody(fields, (ch) => utf8.encode(ch))
}
