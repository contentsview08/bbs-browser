// hono-bbs-merge packages/web/src/utils/identicon.ts から複製
// GitHub風のIdenticon(ハッシュから機械的に生成する、シンボリックなアイコン)を
// ブラウザ側だけで生成するためのユーティリティ。サーバーには一切問い合わせない
// (同じ文字列を渡せば常に同じ見た目になる、という決定性だけが必要)。
//
// アルゴリズムの大枠は「MD5ハッシュの先頭15桁を3列×5行のパターンにし、左右対称に
// 5列へミラーする。ハッシュの別の部分から色相/彩度/輝度を作る」という、よくある
// Identicon生成方式(GitHubのIdenticonも同じ考え方)を踏襲している。ただし暗号学的な
// 強度や既存実装とのビット互換性は不要なため、MD5の代わりに軽量な非暗号学的ハッシュ
// (cyrb53)+ 決定的な擬似乱数生成器(mulberry32)を使い、依存ライブラリ無し・
// 常に同期的に計算できるようにしている。

// 文字列から53bit相当の決定的なハッシュ値を作る(cyrb53)。同じ文字列からは常に
// 同じ値、違う文字列ならなるべく違う値になる分布の良さが目的で、暗号学的な
// 安全性(衝突困難性等)は要求しない。
export function cyrb53(str: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

// mulberry32 PRNG。cyrb53で作った種から、必要な桁数だけ16進1桁(0-15)の
// 決定的な擬似乱数列を取り出す(同じ種なら常に同じ列になる)。
function hexDigitsFromSeed(seed: number, count: number): number[] {
  let a = seed >>> 0
  const digits: number[] = []
  function next32(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
  while (digits.length < count) {
    const v = next32()
    for (let shift = 28; shift >= 0 && digits.length < count; shift -= 4) {
      digits.push((v >>> shift) & 0xf)
    }
  }
  return digits
}

export interface Identicon {
  /** 5行5列。trueのマスだけcolorで塗る(falseは背景色のまま透明に抜く) */
  pattern: boolean[][]
  /** CSSのcolor値(hsl(...)形式) */
  color: string
}

const PATTERN_HALF_DIGITS = 15 // 3列 x 5行ぶん(左右対称にする前の半分)
const HUE_DIGITS = 3
const SAT_DIGITS = 2
const LUM_DIGITS = 2

/**
 * 任意の文字列(投稿者ID等)から決定的にIdenticonを生成する。同じseedからは
 * 常に同じpattern/colorが得られる。
 */
export function generateIdenticon(seed: string): Identicon {
  const digits = hexDigitsFromSeed(
    cyrb53(seed),
    PATTERN_HALF_DIGITS + HUE_DIGITS + SAT_DIGITS + LUM_DIGITS,
  )

  // 先頭15桁を3列x5行に並べ、参考にした生成方式と同じく左右対称にミラーして
  // 5列にする(半分の情報量だけで左右対称な図形にできるのがIdenticonらしい見た目の肝)
  const half: boolean[][] = []
  for (let row = 0; row < 5; row++) {
    half.push([
      digits[row * 3] % 2 === 0,
      digits[row * 3 + 1] % 2 === 0,
      digits[row * 3 + 2] % 2 === 0,
    ])
  }
  const pattern = half.map((row) => [row[2], row[1], row[0], row[1], row[2]])

  // 残りの桁から色相(0-360)/彩度/輝度を作る。彩度・輝度は極端な値(真っ黒/真っ白や
  // 彩度ゼロのグレー)を避け、常にはっきり色が乗った見た目になる範囲に収める。
  let i = PATTERN_HALF_DIGITS
  const hueDigits = digits.slice(i, i + HUE_DIGITS); i += HUE_DIGITS
  const satDigits = digits.slice(i, i + SAT_DIGITS); i += SAT_DIGITS
  const lumDigits = digits.slice(i, i + LUM_DIGITS)

  const hueRaw = hueDigits.reduce((acc, d) => acc * 16 + d, 0) // 0-4095
  const satRaw = satDigits.reduce((acc, d) => acc * 16 + d, 0) // 0-255
  const lumRaw = lumDigits.reduce((acc, d) => acc * 16 + d, 0) // 0-255

  const hue = (hueRaw / 4095) * 360
  const sat = 65 - (satRaw / 255) * 20 // 45%〜65%
  const lum = 70 - (lumRaw / 255) * 20 // 50%〜70%(明るめに寄せ、背景との衝突を避ける)

  return {
    pattern,
    color: `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${lum.toFixed(1)}%)`,
  }
}
