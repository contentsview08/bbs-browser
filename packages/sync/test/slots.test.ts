import { describe, it } from 'vitest'
import { runScenario } from './scenarioRunner'
import { randomSlotScenario, SLOT_SCENARIOS } from './slotScenarios'

describe('枠 2・3 領域のシミュレーター(偽サーバー)', () => {
  it.each(SLOT_SCENARIOS)('$name', async (c) => {
    await runScenario(c)
  })
  it('100 シード', async () => {
    for (let seed = 1; seed <= 100; seed++) {
      await runScenario(randomSlotScenario(seed))
      await runScenario(randomSlotScenario(seed, true))
    }
  }, 300_000)
})
