// キャラクターのアイコン: ハッシュから枠を決める決まりは packages/conformance/avatar の JSON が正(Android も同じものを読む)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BG_HUES,
  BODY_COLORS,
  CLOTHES_HUES,
  CLOTHES_MIN_GAP,
  avatarOf,
  avatarSvg,
  clothesColorsFor,
  fmix32,
  fnv1a32,
  hueGap,
  type AvatarPart,
} from '../src/utils/avatar'
import { AVATAR_BODY, AVATAR_CLOTHES, AVATAR_FACES, AVATAR_SIZE, AVATAR_SPECIES } from '../src/utils/avatarParts'

const dir = new URL('../../../packages/conformance/avatar/', import.meta.url)
const parts = JSON.parse(readFileSync(new URL('parts.json', dir), 'utf-8')) as {
  size: number
  symbols: Record<string, string>
  body: AvatarPart
  species: AvatarPart[]
  faces: AvatarPart[]
  clothes: AvatarPart[]
}
const cases = JSON.parse(readFileSync(new URL('cases.json', dir), 'utf-8')).cases as {
  seed: string
  fnv1a32: number
  fmix32: number
  expected: ReturnType<typeof avatarOf>
}[]

describe('avatarOf(試験データ)', () => {
  it('20 件ある', () => expect(cases.length).toBe(20))
  for (const c of cases) {
    it(JSON.stringify(c.seed), () => {
      expect(fnv1a32(c.seed)).toBe(c.fnv1a32)
      expect(fmix32(c.fnv1a32)).toBe(c.fmix32)
      expect(avatarOf(c.seed)).toEqual(c.expected)
    })
  }
})

describe('色の組み合わせ', () => {
  it('どの背景・体の色でも、服の色が 2 つ以上残り、どれも 60° 以上離れている', () => {
    for (let bg = 0; bg < BG_HUES.length; bg++) {
      for (let body = 0; body < BODY_COLORS.length; body++) {
        const choices = clothesColorsFor(bg, body)
        expect(choices.length).toBeGreaterThanOrEqual(2)
        for (const i of choices) {
          expect(hueGap(CLOTHES_HUES[i], BG_HUES[bg])).toBeGreaterThanOrEqual(CLOTHES_MIN_GAP)
          expect(hueGap(CLOTHES_HUES[i], BODY_COLORS[body][0])).toBeGreaterThanOrEqual(CLOTHES_MIN_GAP)
        }
      }
    }
  })
  it('背景は 30° おき 12 色、体の色は 8、服の色は 8', () => {
    expect(BG_HUES).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])
    expect(BODY_COLORS.length).toBe(8)
    expect(CLOTHES_HUES.length).toBe(8)
  })
  it('たくさんの ID で、服の色はいつも決まりの中・どの種類も出る', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) {
      const a = avatarOf(`id${i}`)
      seen.add(a.species)
      expect(hueGap(CLOTHES_HUES[a.clothesColor], BG_HUES[a.bg])).toBeGreaterThanOrEqual(CLOTHES_MIN_GAP)
      expect(hueGap(CLOTHES_HUES[a.clothesColor], BODY_COLORS[a.body][0])).toBeGreaterThanOrEqual(CLOTHES_MIN_GAP)
    }
    expect(seen.size).toBe(AVATAR_SPECIES.length)
  })
})

describe('部品の升目', () => {
  const all = [parts.body, ...parts.species, ...parts.faces, ...parts.clothes]
  it('数: 種類 8・表情 4・服 3', () => {
    expect(parts.species.length).toBe(8)
    expect(parts.faces.length).toBe(4)
    expect(parts.clothes.length).toBe(3)
  })
  for (const p of all) {
    it(`${p.key} は ${parts.size}×${parts.size} で、決まった記号だけ`, () => {
      expect(p.rows.length).toBe(parts.size)
      for (const row of p.rows) {
        expect(row.length).toBe(parts.size)
        for (const ch of row) expect(Object.keys(parts.symbols)).toContain(ch)
      }
    })
  }
  it('部品の名前が重ならない', () => {
    const keys = all.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('PC の写し(avatarParts.ts)が parts.json と同じ(違えば node scripts/gen-avatar-parts.mjs)', () => {
    expect(AVATAR_SIZE).toBe(parts.size)
    expect(AVATAR_BODY).toEqual(parts.body)
    expect(AVATAR_SPECIES).toEqual(parts.species)
    expect(AVATAR_FACES).toEqual(parts.faces)
    expect(AVATAR_CLOTHES).toEqual(parts.clothes)
  })
})

describe('avatarSvg', () => {
  it('色は 背景・体・服 と 線・白 だけ', () => {
    for (const c of cases) {
      const fills = new Set([...avatarSvg(c.seed, true).matchAll(/fill="([^"]+)"/g)].map((m) => m[1]))
      expect(fills.size).toBeLessThanOrEqual(5)
    }
  })
})
