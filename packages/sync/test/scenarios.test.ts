// 端末 2 台と偽サーバーで、利用者の操作から別の端末の今のデータまでを通す。PC とスマホで同じファイルを流す
import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { randomScenario } from './randomScenario'
import { runScenario, type Scenario } from './scenarioRunner'

const url = (f: string) => new URL(`../../conformance/${f}`, import.meta.url)
const update = process.env.SYNC_UPDATE_DIGESTS === '1'
if (update) {
  const list = Array.from({ length: 20 }, (_, i) => randomScenario(i + 1, i % 2 === 0))
  writeFileSync(url('sync-client-random.json'), `${JSON.stringify(list, null, 1)}\n`)
}
const scenarios: Scenario[] = [...JSON.parse(readFileSync(url('sync-client.json'), 'utf-8')), ...JSON.parse(readFileSync(url('sync-client-random.json'), 'utf-8'))]
const digests: Record<string, Record<string, string>> = JSON.parse(readFileSync(url('sync-client-digests.json'), 'utf-8'))
const next: Record<string, Record<string, string>> = {}

describe('sync-client.json', () => {
  it.each(scenarios)('$name', async (c) => {
    const got = await runScenario(c)
    next[c.name] = got
    // スマホ版は同じ値を読んで比べるので、ここが両方の揃い方の基準になる
    if (!update) expect(got).toEqual(digests[c.name])
  })
  afterAll(() => {
    if (update) writeFileSync(url('sync-client-digests.json'), `${JSON.stringify(next, null, 1)}\n`)
  })
})
