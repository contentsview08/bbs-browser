// 枠 2 で 3 領域(各 2 台)。シードから操作列を作り、偽サーバーと本物で同期の表の digest が同じになること。枠の数も見る
import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runScenario, type Scenario, type Step } from '../../../../packages/sync/test/scenarioRunner'
import { MiniflareSyncServer, scenarioOverrides, startServer } from './server'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const DEVICES = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

function generate(seed: number, count: number): Scenario {
  const r = rng(seed)
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]
  const steps: Step[] = []
  // 作る順と間を空けて、消す相手が同じ時刻で並ばないようにする
  for (const group of ['a', 'b', 'c']) {
    steps.push({ op: 'pair_first', device: `${group}1` }, { op: 'pair_join', device: `${group}2`, from: `${group}1` }, { op: 'advance_ms', ms: 15 * DAY + 1000 })
  }
  const offline = new Set<string>()
  for (let i = 0; i < count; i++) {
    const device = pick(DEVICES)
    const x = r()
    if (x < 0.3) steps.push({ op: 'favorite_thread_add', device, board: 'https://a.5ch.io/x/', key: String(1 + Math.floor(r() * 5)), title: `t${i}` })
    else if (x < 0.4) steps.push({ op: 'favorite_thread_remove', device, board: 'https://a.5ch.io/x/', key: String(1 + Math.floor(r() * 5)), title: '' })
    else if (x < 0.75) steps.push({ op: 'sync', device })
    else if (x < 0.8) {
      if (offline.has(device)) offline.delete(device)
      else offline.add(device)
      steps.push({ op: offline.has(device) ? 'offline' : 'online', device })
    } else steps.push({ op: 'advance_ms', ms: pick([HOUR + 7, 2 * DAY + 11, 8 * DAY + 13, 15 * DAY + 17]) })
  }
  for (const d of DEVICES) steps.push({ op: 'online', device: d }, { op: 'advance_ms', ms: 61_000 }, { op: 'sync', device: d })
  return { name: `seed${seed}`, devices: DEVICES, server: { space_limit: 2 }, steps }
}

describe('枠 2 で 3 領域の操作列(偽サーバーと本物の比較)', () => {
  let mf: Miniflare
  beforeAll(async () => {
    mf = await startServer()
    await mf.ready
  })
  afterAll(async () => {
    await mf.dispose()
  })
  it.each([1, 2, 3, 4, 5])('シード %i', async (seed) => {
    const c = generate(seed, 120)
    const fake = await runScenario(c)
    let most = 0
    const real = await runScenario(c, (now, options) => {
      const server = new MiniflareSyncServer(mf, now, scenarioOverrides(options))
      const handle = server.handle.bind(server)
      server.handle = async (req) => {
        const res = await handle(req)
        most = Math.max(most, await server.spaceCount())
        return res
      }
      return server
    })
    expect(real).toEqual(fake)
    expect(most).toBeLessThanOrEqual(2)
    expect(most).toBe(2)
  })
})
