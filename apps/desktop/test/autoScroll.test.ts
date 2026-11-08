import { describe, expect, it } from 'vitest'
import { autoScrollBacklogged, autoScrollBaseSpeed, autoScrollSpeed, msToNextRefresh } from '../src/utils/autoScroll'

// 行の高さ 10px なら、ふつう = 20px/秒(最大 120)、ゆっくり = 10(最大 60)、速い = 40(最大 240)
const LINE = 10

describe('自動で流す速さ', () => {
  it('追いつくまでは既定の速さで一定', () => {
    expect(autoScrollSpeed(100_000, 5000, LINE, 'normal', false)).toBe(20)
    expect(autoScrollSpeed(30, 5000, LINE, 'normal', false)).toBe(20)
    expect(autoScrollSpeed(100_000, 5000, LINE, 'slow', false)).toBe(10)
    expect(autoScrollSpeed(100_000, 5000, LINE, 'fast', false)).toBe(40)
  })

  it('追いついた後は、次の更新の時刻にちょうど下に着く速さ', () => {
    // 残り 500px・次の更新まで 10 秒 → 50px/秒
    expect(autoScrollSpeed(500, 10_000, LINE, 'normal', true)).toBeCloseTo(50)
  })

  it('追いついた後も、既定の速さより遅くしない(早く着いたら下で待つ)', () => {
    // 残り 40px・10 秒 → 4px/秒 だが、ふつうの 20px/秒
    expect(autoScrollSpeed(40, 10_000, LINE, 'normal', true)).toBe(20)
    expect(autoScrollSpeed(40, 10_000, LINE, 'fast', true)).toBe(40)
  })

  it('最大の速さ(既定の 6 倍)を超えない', () => {
    expect(autoScrollSpeed(100_000, 10_000, LINE, 'normal', true)).toBe(120)
    expect(autoScrollSpeed(100_000, 10_000, LINE, 'slow', true)).toBe(60)
    expect(autoScrollSpeed(100_000, 10_000, LINE, 'fast', true)).toBe(240)
  })

  it('下に着いていれば 0', () => {
    expect(autoScrollSpeed(0, 10_000, LINE, 'normal', true)).toBe(0)
    expect(autoScrollSpeed(-3, 10_000, LINE, 'normal', false)).toBe(0)
  })

  it('更新が遅れた(次の更新までが 0 以下)ら、残りの距離 × 0.5 / 秒で寄せる', () => {
    expect(autoScrollSpeed(100, 0, LINE, 'normal', true)).toBe(50)
    expect(autoScrollSpeed(10, -2000, LINE, 'normal', true)).toBe(5)
    // 遠ければ最大の速さまで
    expect(autoScrollSpeed(10_000, -1, LINE, 'normal', true)).toBe(120)
  })

  it('自動更新がオフなら、新着は既定の速さで流し、下で止まる', () => {
    const off = msToNextRefresh(0, 1000, 5000)
    expect(off).toBe(Infinity)
    expect(autoScrollSpeed(300, off, LINE, 'normal', true)).toBe(20)
    expect(autoScrollSpeed(0, off, LINE, 'normal', true)).toBe(0)
  })

  it('既定の速さは 1 秒に 1・2・4 行(行は本文の 1 行の高さ)', () => {
    expect(autoScrollBaseSpeed(26, 'slow')).toBe(26)
    expect(autoScrollBaseSpeed(26, 'normal')).toBe(52)
    expect(autoScrollBaseSpeed(26, 'fast')).toBe(104)
  })

  it('知らない速さはふつうとして扱う', () => {
    expect(autoScrollBaseSpeed(LINE, 'zzz' as never)).toBe(20)
  })
})

describe('次の自動更新までの時間', () => {
  it('前回の時刻と間隔から出す', () => {
    expect(msToNextRefresh(10, 1000, 4000)).toBe(7000)
    expect(msToNextRefresh(10, 1000, 12_000)).toBe(-1000)
  })
  it('まだ回っていなければ Infinity', () => {
    expect(msToNextRefresh(10, undefined, 4000)).toBe(Infinity)
  })
})

describe('溜まりすぎの札', () => {
  it('画面 10 枚を超えたら出す', () => {
    expect(autoScrollBacklogged(8000, 800)).toBe(false)
    expect(autoScrollBacklogged(8001, 800)).toBe(true)
    expect(autoScrollBacklogged(100, 0)).toBe(false)
  })
})
