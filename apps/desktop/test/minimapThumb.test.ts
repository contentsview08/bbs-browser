import { describe, expect, it } from 'vitest'
import { minimapThumbColor, nearColor, THUMB_CALM } from '../src/utils/minimapThumb'

// 印の色(人気の 3 段・画像・動画・リンク・自分・未読)。値は theme.css・app.css のもの
const DARK_MARKS = ['#5fc28a', '#ef7470', '#6aa9f0', '#a28bff']
const LIGHT_MARKS = ['#24794a', '#c53631', '#2969c2', '#5a3cc0']

describe('minimapThumbColor: つまみの色', () => {
  it('差し色が印と近いテーマは青灰色', () => {
    // LINE ライト: 緑の差し色は画像の印(緑)と近い
    expect(minimapThumbColor('#008c45', ['#cc5f00', '#d6440f', '#cf2a2a', ...LIGHT_MARKS, '#06c755'], false)).toBe(THUMB_CALM.light)
    // Discord: 青紫の差し色は自分の印と近い
    expect(minimapThumbColor('#5865f2', ['#f0b232', '#f57731', '#f23f43', ...DARK_MARKS, '#f23f43'], true)).toBe(THUMB_CALM.dark)
    // モノクロ: 灰色の差し色は灰色の人気の棒と近い
    expect(minimapThumbColor('#e8e8e8', ['#bdbdbd', '#d6d6d6', '#f0f0f0', ...DARK_MARKS, '#ff6b81'], true)).toBe(THUMB_CALM.dark)
  })
  it('近くなければ差し色のまま', () => {
    expect(minimapThumbColor('#dcdcdc', ['#f2c14e', '#f2914b', '#ff6b6b', ...DARK_MARKS, '#ff8fa3'], true)).toBe('#dcdcdc')
  })
  it('青灰色は、どの印とも近くない', () => {
    for (const m of [...DARK_MARKS, '#7c93e8', '#bdbdbd']) expect(nearColor(THUMB_CALM.dark, m)).toBe(false)
    for (const m of LIGHT_MARKS) expect(nearColor(THUMB_CALM.light, m)).toBe(false)
  })
})
