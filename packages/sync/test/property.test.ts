// 同じ変更の集合を、順番を変え、重複させて適用しても同じになるか。依存を増やさないよう fast-check は使わず、スマホ版と同じ乱数で作る(シードで再現できる)
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalJson, mergeLww, mergePayloads, mergeWithMax, type SyncPayload } from '../src/index'
import { Rng, randomPayload, simulate, simulateRecreate } from './sim'

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

describe('領域の削除と作り直し', () => {
  it('200 シード: 途中までの受信と送信を混ぜても全端末とサーバーが一致し、削除が復活せず、失うものもない', () => {
    let survived = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = simulateRecreate({ seed, devices: 2 + (seed % 3), ops: 150, skews: SKEWS })
      expect(r.converged, `seed ${seed}`).toBe(true)
      expect(r.matches_log, `seed ${seed}`).toBe(true)
      expect(r.revived, `seed ${seed}`).toBe(0)
      survived += r.survived_tombstones
    }
    // 領域をまたいで残る tombstone の場面を本当に通っているかを確かめる
    expect(survived).toBeGreaterThan(0)
    console.log(`領域をまたいで残った tombstone: ${survived}`)
  }, 120_000)
})

// 共通テストのハッシュは TS の実装で求める。SYNC_WRITE_SIM_HASHES=1 のときだけ書き出す(使い方は gen-conformance.py の先頭)
describe.runIf(process.env.SYNC_WRITE_SIM_HASHES === '1')('ハッシュの書き出し', () => {
  it('sim-hashes.json', () => {
    const url = new URL('../scripts/sim-params.json', import.meta.url)
    const params = JSON.parse(readFileSync(url, 'utf-8')) as { sim: any[]; sim_recreate: any[] }
    const out: Record<string, string> = {}
    for (const p of params.sim) out[`sim:${p.seed}`] = simulate(p).sha256
    for (const p of params.sim_recreate) out[`sim_recreate:${p.seed}`] = simulateRecreate(p).sha256
    writeFileSync(new URL('../scripts/sim-hashes.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
  }, 120_000)
})
