// 同じ変更の集合を、順番を変え、重複させて適用しても同じになるか。依存を増やさないよう fast-check は使わず、スマホ版と同じ乱数で作る(シードで再現できる)
import { describe, expect, it } from 'vitest'
import { canonicalJson, mergeLww, mergePayloads, mergeWithMax, type SyncPayload } from '../src/index'
import { Rng, randomPayload, simulate } from './sim'

const SKEWS = [0, 3_600_000, -7_200_000, 3 * 86_400_000]
const eq = (a: SyncPayload, b: SyncPayload) => canonicalJson(a) === canonicalJson(b)

const lawsOf = (name: string, kind: string, merge: (a: SyncPayload, b: SyncPayload) => SyncPayload) => {
  it(`${name}: 可換・結合的・冪等`, () => {
    const rng = new Rng(20261107)
    for (let i = 0; i < 20000; i++) {
      const [a, b, c] = [randomPayload(rng, kind), randomPayload(rng, kind), randomPayload(rng, kind)]
      expect(eq(merge(a, b), merge(b, a)), canonicalJson([a, b])).toBe(true)
      expect(eq(merge(merge(a, b), c), merge(a, merge(b, c))), canonicalJson([a, b, c])).toBe(true)
      expect(eq(merge(a, a), a), canonicalJson(a)).toBe(true)
      expect(eq(merge(merge(a, b), b), merge(a, b)), canonicalJson([a, b])).toBe(true)
    }
  }, 60_000)
}

describe('マージの法則', () => {
  lawsOf('LWW', 'favorite', mergeLww)
  lawsOf('LWW + max', 'last_view', (a, b) => mergeWithMax(a, b, 'last_viewed_at'))
  lawsOf('種類で選ぶマージ', 'last_view', mergePayloads)
})

describe('端末のシミュレーション', () => {
  it('300 シード: 全端末が一致し、steps が溢れなければ読みの記録から求めた既読位置と同じ', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = simulate({ seed, devices: 3, ops: 150, skews: SKEWS, max_reads: 8 })
      expect(r.converged, `seed ${seed}`).toBe(true)
      expect(r.positions, `seed ${seed}`).toEqual(r.oracle)
    }
  }, 60_000)
  it('100 シード: 小さくなる読みで steps が溢れても全端末が一致し、既読位置は読んだ位置を超えない', () => {
    let under = 0
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate({ seed, devices: 3, ops: 1000, skews: SKEWS, decreasing_reads: true })
      expect(r.converged, `seed ${seed}`).toBe(true)
      for (const t of ['t0', 't1']) {
        expect(r.positions[t], `seed ${seed}`).toBeLessThanOrEqual(r.oracle[t])
        expect(r.positions[t], `seed ${seed}`).toBeGreaterThanOrEqual(r.resets[t])
        if (r.positions[t] < r.oracle[t]) under++
      }
    }
    // 溢れの場面を本当に通っているかを確かめる
    expect(under).toBeGreaterThan(0)
    console.log(`steps の溢れで読みより小さくなった数: ${under} / 200`)
  }, 120_000)
})
