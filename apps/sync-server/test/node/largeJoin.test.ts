// 件数の多い合流を本物のサーバーへ通す。所要時間を出す
import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { largeJoinScenario } from '../../../../packages/sync/test/randomScenario'
import { runScenario } from '../../../../packages/sync/test/scenarioRunner'
import { MiniflareSyncServer, scenarioOverrides, startServer } from './server'

describe('件数の多い合流(Miniflare)', () => {
  let mf: Miniflare
  beforeAll(async () => {
    mf = await startServer()
    await mf.ready
  })
  afterAll(async () => {
    await mf.dispose()
  })
  it('5,000 スレと 5,000 件の書き込みを持つ 2 台', async () => {
    const at = Date.now()
    await runScenario(largeJoinScenario(), (now, options) => new MiniflareSyncServer(mf, now, scenarioOverrides(options)))
    console.log(`Miniflare の合流 2 台(レコード 25,000): ${Date.now() - at} ms`)
  }, 590_000)
})
