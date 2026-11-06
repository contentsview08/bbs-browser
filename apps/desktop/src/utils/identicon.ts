// 文字列から決まる、左右対称の 5×5 の模様と色を作る(GitHub 風)。
// 暗号の強さは要らないので、依存なしで同期的に計算できる cyrb53 + mulberry32 を使う

// cyrb53: 53 ビットのハッシュ
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

// mulberry32: 種から 16 進 1 桁(0-15)の乱数列を取り出す
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
  color: string
}

const PATTERN_HALF_DIGITS = 15 // 3列 x 5行ぶん(左右対称にする前の半分)
const HUE_DIGITS = 3
const SAT_DIGITS = 2
const LUM_DIGITS = 2

export function generateIdenticon(seed: string): Identicon {
  const digits = hexDigitsFromSeed(
    cyrb53(seed),
    PATTERN_HALF_DIGITS + HUE_DIGITS + SAT_DIGITS + LUM_DIGITS,
  )

  // 先頭 15 桁を 3 列 × 5 行に並べ、左右対称に広げて 5 列にする
  const half: boolean[][] = []
  for (let row = 0; row < 5; row++) {
    half.push([
      digits[row * 3] % 2 === 0,
      digits[row * 3 + 1] % 2 === 0,
      digits[row * 3 + 2] % 2 === 0,
    ])
  }
  const pattern = half.map((row) => [row[2], row[1], row[0], row[1], row[2]])

  // 残りの桁から色を作る。彩度・輝度は、真っ黒・真っ白・灰色にならない範囲に収める
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
