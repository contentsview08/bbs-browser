import { describe, expect, it } from 'vitest'
import {
  clampLiveRefresh,
  clampLiveSpeed,
  formatLiveSpeed,
  LIVE_SPEED_DEFAULT,
  LIVE_SPEED_MAX,
  LIVE_SPEED_MIN,
  LIVE_SPEED_STEPS,
  liveScrollPxPerSec,
  liveSpeedOfStep,
  liveStepOfSpeed,
} from '../src/utils/autoScroll'

describe('実況モードの流す速さ', () => {
  it('行は本文の 1 行の高さ(字を大きくすると px の速さも上がる)', () => {
    expect(liveScrollPxPerSec(2, 26)).toBe(52)
    expect(liveScrollPxPerSec(0.5, 20)).toBe(10)
    expect(liveScrollPxPerSec(2, 0)).toBe(0)
  })

  it('幅の外の速さは幅に入れ、数でなければ既定', () => {
    expect(clampLiveSpeed(100)).toBe(LIVE_SPEED_MAX)
    expect(clampLiveSpeed(0.1)).toBe(LIVE_SPEED_MIN)
    expect(clampLiveSpeed('normal')).toBe(LIVE_SPEED_DEFAULT)
    expect(clampLiveSpeed(NaN)).toBe(LIVE_SPEED_DEFAULT)
  })

  it('更新の間隔は選択肢のどれかにする', () => {
    expect(clampLiveRefresh(10)).toBe(10)
    expect(clampLiveRefresh(7)).toBe(5)
    expect(clampLiveRefresh(undefined)).toBe(5)
  })
})

describe('速さのつまみ(対数の目盛り)', () => {
  it('両端は 0.5 行と 40 行', () => {
    expect(liveSpeedOfStep(0)).toBe(0.5)
    expect(liveSpeedOfStep(LIVE_SPEED_STEPS)).toBe(40)
  })

  it('真ん中は掛け算の真ん中(約 4.5 行)。遅い側を細かく選べる', () => {
    expect(liveSpeedOfStep(LIVE_SPEED_STEPS / 2)).toBeCloseTo(4.5, 1)
  })

  it('既定の 2 行は、目盛りに戻しても 2 行', () => {
    expect(liveSpeedOfStep(liveStepOfSpeed(2))).toBe(2)
  })

  it('つまみで選んだ速さは、目盛りに戻して読み直しても同じ速さ', () => {
    for (let s = 0; s <= LIVE_SPEED_STEPS; s++) {
      const v = liveSpeedOfStep(s)
      expect(liveSpeedOfStep(liveStepOfSpeed(v))).toBe(v)
    }
  })

  it('10 行より遅いと 0.1 行、速いと 1 行に丸める', () => {
    expect(formatLiveSpeed(2)).toBe('1 秒に 2 行')
    expect(formatLiveSpeed(0.54)).toBe('1 秒に 0.5 行')
    expect(formatLiveSpeed(4.47)).toBe('1 秒に 4.5 行')
    expect(formatLiveSpeed(23.4)).toBe('1 秒に 23 行')
  })
})
