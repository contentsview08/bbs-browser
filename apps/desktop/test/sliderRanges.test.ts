import { describe, expect, it } from 'vitest'
import { BAR_PX_MIN, DEFAULT_SETTINGS, FONT_PX_MAX, FONT_PX_MIN, FONT_SCALE_MAX, FONT_SCALE_MIN, FOOTER_PX_MAX, HEADER_PX_MAX, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN, PAD_PX_MAX, SCREEN_PX_RANGE, scaledPxRange } from '../src/ui/settings'

describe('スライダーの幅(スマホ版と同じ)', () => {
  it('幅の値', () => {
    expect([FONT_SCALE_MIN, FONT_SCALE_MAX]).toEqual([0.6, 1.6])
    expect([FONT_PX_MIN, FONT_PX_MAX]).toEqual([8, 32])
    expect(PAD_PX_MAX).toBe(40)
    expect([LINE_HEIGHT_MIN, LINE_HEIGHT_MAX]).toEqual([1, 3])
    expect([BAR_PX_MIN, HEADER_PX_MAX, FOOTER_PX_MAX]).toEqual([32, 120, 110])
  })

  it('px で持つ文字の倍率は、1 倍の大きさから同じ割合で決まる', () => {
    expect(scaledPxRange(16)).toEqual({ min: 9.6, max: 25.6, step: 0.8 })
    expect(scaledPxRange(14)).toEqual({ min: 8.4, max: 22.4, step: 0.7 })
  })

  it('既定の大きさは 1 段の刻みの上に乗り、幅の中にある', () => {
    const base = DEFAULT_SETTINGS.fontPx
    expect(SCREEN_PX_RANGE.min).toBeLessThan(base)
    expect(SCREEN_PX_RANGE.max).toBeGreaterThan(base)
    const steps = (base - SCREEN_PX_RANGE.min) / SCREEN_PX_RANGE.step
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9)
  })
})
