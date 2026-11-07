// 枠 2・3 領域のシミュレーターを本物のサーバーへ
import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { runScenario } from '../../../../packages/sync/test/scenarioRunner'
import { randomSlotScenario, SLOT_SCENARIOS } from '../../../../packages/sync/test/slotScenarios'
import { MiniflareSyncServer, scenarioOverrides, startServer } from './server'

describe('枠 2・3 領域のシミュレーター(Miniflare)', () => {
  let mf: Miniflare
  beforeAll(async () => {
    mf = await startServer()
    await mf.ready
  })
  afterAll(async () => {
    await mf.dispose()
  })
  const make = (now: () => number, options: Record<string, unknown>) => new MiniflareSyncServer(mf, now, scenarioOverrides(options))
  it.each(SLOT_SCENARIOS)('$name', async (c) => {
    await runScenario(c, make)
  })
  const seeds = Number(process.env.OBB_SLOT_SEEDS ?? 12)
  it(`${seeds} シード`, async () => {
    for (let seed = 1; seed <= seeds; seed++) {
      await runScenario(randomSlotScenario(seed), make)
      await runScenario(randomSlotScenario(seed, true), make)
    }
  }, 580_000)
})
