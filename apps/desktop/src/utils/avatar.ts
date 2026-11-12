// ID から作るキャラクターのアイコン(試作)。決まりは bbs-suite の docs/avatar.md。
// PC・Web・Android で同じ ID から同じ絵を出すため、ハッシュと枠の決め方は単純で決まったものにする(試験データは packages/conformance/avatar/cases.json)
import { AVATAR_BODY, AVATAR_CLOTHES, AVATAR_FACES, AVATAR_SIZE, AVATAR_SPECIES } from './avatarParts'

/** 部品 1 つ。rows は AVATAR_SIZE 行 × AVATAR_SIZE 文字(記号は parts.json の symbols) */
export interface AvatarPart {
  key: string
  name: string
  rows: string[]
}

/** ハッシュから決めた枠の値(どれも番号) */
export interface Avatar {
  species: number
  bg: number
  body: number
  clothes: number
  /** 服の色(CLOTHES_HUES の番号) */
  clothesColor: number
  face: number
}

/** 背景の色相(30° おき 12 色) */
export const BG_HUES = Array.from({ length: 12 }, (_, i) => i * 30)
/** 体の色(HSL)。顔の線が沈まないよう、暗い色は入れない */
export const BODY_COLORS: [number, number, number][] = [
  [43, 40, 94], // 白
  [43, 76, 79], // クリーム
  [31, 76, 64], // 茶トラ
  [26, 45, 54], // こげ茶
  [215, 10, 70], // 灰
  [345, 75, 84], // 桃
  [200, 60, 80], // 水色
  [90, 50, 70], // 若草
]
/** 服の色相(45° おき 8 色)。背景・体の色相から 60° 以上離れたものだけを使う */
export const CLOTHES_HUES = Array.from({ length: 8 }, (_, i) => i * 45)
/** 服の色相が背景・体から離れていてほしい角度 */
export const CLOTHES_MIN_GAP = 60

/** 色相の差(0〜180) */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** その背景・体の色に合う服の色(CLOTHES_HUES の番号)。どの組でも 2 つ以上残る(60° の幅に 45° おきの色は 3 つまでしか入らない) */
export function clothesColorsFor(bg: number, body: number): number[] {
  const out: number[] = []
  CLOTHES_HUES.forEach((h, i) => {
    if (hueGap(h, BG_HUES[bg]) >= CLOTHES_MIN_GAP && hueGap(h, BODY_COLORS[body][0]) >= CLOTHES_MIN_GAP) out.push(i)
  })
  return out
}

/** FNV-1a(32 ビット)を UTF-8 のバイト列に。Kotlin でも同じ値を出しやすい */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(s)) {
    h ^= b
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** murmur3 の仕上げ。FNV-1a は下の桁の混ざりが弱く、似た ID で枠がそろうので、全部の桁を混ぜてから割る */
export function fmix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * ID から枠の値を決める。ハッシュを見分けの強い順(種類 → 背景 → 体の色 → 服 → 服の色 → 表情)に、余りで少しずつ取り出す
 * (先に取るほど偏りが少ない)
 */
export function avatarOf(seed: string): Avatar {
  let h = fmix32(fnv1a32(seed))
  const take = (n: number) => {
    const v = h % n
    h = Math.floor(h / n)
    return v
  }
  const species = take(AVATAR_SPECIES.length)
  const bg = take(BG_HUES.length)
  const body = take(BODY_COLORS.length)
  const clothes = take(AVATAR_CLOTHES.length)
  const choices = clothesColorsFor(bg, body)
  const clothesColor = choices[take(choices.length)]
  const face = take(AVATAR_FACES.length)
  return { species, bg, body, clothes, clothesColor, face }
}

const hsl = ([h, s, l]: [number, number, number]) => `hsl(${h}, ${s}%, ${l}%)`

/** 記号ごとの色。背景は暗い配色では暗く、明るい配色では淡く(どちらでも地から浮くように) */
export function avatarColors(a: Avatar, dark: boolean): Record<string, string> {
  const bgHue = BG_HUES[a.bg]
  return {
    B: hsl(dark ? [bgHue, 42, 34] : [bgHue, 62, 80]),
    K: hsl(BODY_COLORS[a.body]),
    C: hsl([CLOTHES_HUES[a.clothesColor], 62, dark ? 56 : 50]),
    L: '#2b2b33',
    W: '#ffffff',
  }
}

/** 重ねる順の部品(体 → 服 → 種類 → 表情) */
export function avatarLayers(a: Avatar): AvatarPart[] {
  return [AVATAR_BODY, AVATAR_CLOTHES[a.clothes], AVATAR_SPECIES[a.species], AVATAR_FACES[a.face]]
}

/** 描く升目(後の部品が上)。null は背景のまま */
export function avatarGrid(a: Avatar): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: AVATAR_SIZE }, () => Array<string | null>(AVATAR_SIZE).fill(null))
  for (const part of avatarLayers(a)) {
    part.rows.forEach((row, y) => {
      for (let x = 0; x < AVATAR_SIZE; x++) if (row[x] !== '.') grid[y][x] = row[x]
    })
  }
  return grid
}

/**
 * SVG にする。横に同じ色が続くマスは 1 つの rect にまとめる(全レスに出すので軽く)。
 * 背景は四角 1 枚(丸く切るのは描く側)
 */
export function avatarSvg(seed: string, dark: boolean): string {
  const a = avatarOf(seed)
  const colors = avatarColors(a, dark)
  const grid = avatarGrid(a)
  const byColor = new Map<string, string[]>()
  grid.forEach((row, y) => {
    for (let x = 0; x < AVATAR_SIZE; ) {
      const c = row[x]
      let w = 1
      while (x + w < AVATAR_SIZE && row[x + w] === c) w++
      if (c !== null && c !== 'B') {
        const list = byColor.get(c) ?? []
        list.push(`<rect x="${x}" y="${y}" width="${w}" height="1"/>`)
        byColor.set(c, list)
      }
      x += w
    }
  })
  const groups = [...byColor].map(([c, rects]) => `<g fill="${colors[c]}">${rects.join('')}</g>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}" shape-rendering="crispEdges"><rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" fill="${colors.B}"/>${groups}</svg>`
}
