// 端末 2 台と偽サーバーで、利用者の操作から別の端末の今のデータまでを通す。PC とスマホで同じファイルを流す。
// 同じシナリオを偽の Drive の置き場でも流す(docs/sync-drive.md 9.2)
import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { randomScenario } from './randomScenario'
import { runScenario, runScenarioOn, type Scenario } from './scenarioRunner'

const url = (f: string) => new URL(`../../conformance/${f}`, import.meta.url)
const update = process.env.SYNC_UPDATE_DIGESTS === '1'
/** Drive の digest だけを書き直す */
const updateDrive = update || process.env.SYNC_UPDATE_DRIVE_DIGESTS === '1'
if (update) {
  const list = Array.from({ length: 20 }, (_, i) => randomScenario(i + 1, i % 2 === 0))
  writeFileSync(url('sync-client-random.json'), `${JSON.stringify(list, null, 1)}\n`)
}
const scenarios: Scenario[] = [...JSON.parse(readFileSync(url('sync-client.json'), 'utf-8')), ...JSON.parse(readFileSync(url('sync-client-random.json'), 'utf-8'))]
const digests: Record<string, Record<string, string>> = JSON.parse(readFileSync(url('sync-client-digests.json'), 'utf-8'))
/** Drive の置き場の digest。同期の表の version は端末の中だけの通番なので、サーバーとは別に持つ */
const driveDigests: Record<string, Record<string, string>> = updateDrive ? {} : JSON.parse(readFileSync(url('sync-client-digests-drive.json'), 'utf-8'))
const next: Record<string, Record<string, string>> = {}
const nextDrive: Record<string, Record<string, string>> = {}
const onServer = scenarios.filter((c) => !c.stores || c.stores.includes('server'))
const onDrive = scenarios.filter((c) => !c.stores || c.stores.includes('drive'))

describe('sync-client.json', () => {
  it.each(onServer)('$name', async (c) => {
    const got = await runScenario(c)
    next[c.name] = got
    // スマホ版は同じ値を読んで比べるので、ここが両方の揃い方の基準になる
    if (!update) expect(got).toEqual(digests[c.name])
  })
  afterAll(() => {
    if (update) writeFileSync(url('sync-client-digests.json'), `${JSON.stringify(next, null, 1)}\n`)
  })
})

describe('sync-client.json を Drive の置き場で', () => {
  it.each(onDrive)('$name', async (c) => {
    const drive = await runScenarioOn('drive', c)
    // 今のデータ(画面が読むもの)は置き場によらず同じ
    const server = await runScenarioOn('server', c)
    expect(drive.data).toEqual(server.data)
    nextDrive[c.name] = drive.digests
    if (!updateDrive) expect(drive.digests).toEqual(driveDigests[c.name])
  })
  afterAll(() => {
    if (updateDrive) writeFileSync(url('sync-client-digests-drive.json'), `${JSON.stringify(nextDrive, null, 1)}\n`)
  })
})
