// 枠・押し出し・放置削除・台帳・作成元。枠 2 で 3 領域
import { runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { DAY, HOUR } from '../../src/config'
import { advance, call, clock, freshIp, ledger, push, record, setup, spaceIdOf, spaceStub, teardown } from './support'

const asDo = (s: unknown) => s as DurableObjectStub
const create = (token: string, ip?: string) => call('POST', '/spaces', { token, ...(ip && { ip }) })
const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error
const status = async (token: string) => (await call('GET', '/head', { token })).status

function ledgerSql<T extends Record<string, SqlStorageValue>>(sql: string, ...args: SqlStorageValue[]): Promise<T[]> {
  return runInDurableObject(asDo(ledger()), (_o, state) => state.storage.sql.exec<T>(sql, ...args).toArray())
}

const activeCount = async () => (await ledgerSql<{ n: number }>("SELECT COUNT(*) AS n FROM spaces WHERE state IN ('active', 'pending')"))[0].n

describe('枠', () => {
  afterEach(teardown)
  it('枠ちょうどは作れ、1 つ超えは capacity_full。既存の領域の作成は枠を使わない', async () => {
    setup({ SPACE_LIMIT: '2' })
    expect((await create('A')).status).toBe(201)
    expect((await create('B')).status).toBe(201)
    const over = await create('C')
    expect(over.status).toBe(403)
    expect(await errorOf(over)).toBe('capacity_full')
    expect((await create('A')).status).toBe(200)
    expect(await activeCount()).toBe(2)
  })
  it('枠が埋まっても既存の領域の同期は止まらない', async () => {
    setup({ SPACE_LIMIT: '1' })
    await create('A')
    expect((await create('B')).status).toBe(403)
    expect((await push('A', [await record('1')])).status).toBe(200)
    expect((await call('GET', '/changes?since=0', { token: 'A' })).status).toBe(200)
  })
  it('作成の停止は環境変数で', async () => {
    setup({ CREATION_CLOSED: '1' })
    const r = await create('A')
    expect(r.status).toBe(403)
    expect(await errorOf(r)).toBe('creation_closed')
  })
  it('同時の作成で枠を超えない。通番も作成の数も崩れない', async () => {
    setup({ SPACE_LIMIT: '5' })
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => create(`P${i}`, freshIp())))
    const statuses = res.map((r) => r.status)
    expect(statuses.filter((s) => s === 201).length).toBe(5)
    expect(statuses.filter((s) => s === 403).length).toBe(25)
    expect(await activeCount()).toBe(5)
  })
  it('同じ領域の同時の作成は 1 つだけ 201 で、枠を 1 つだけ使う', async () => {
    setup({ SPACE_LIMIT: '3' })
    const res = await Promise.all(Array.from({ length: 10 }, () => create('same', freshIp())))
    const statuses = res.map((r) => r.status)
    expect(statuses.filter((s) => s === 201).length).toBe(1)
    expect(statuses.filter((s) => s === 200).length).toBe(9)
    expect(new Set(await Promise.all(res.map(async (r) => ((await r.json()) as { epoch: string }).epoch))).size).toBe(1)
    expect(await activeCount()).toBe(1)
  })
})

describe('押し出し(枠 2 で 3 領域・偽の時計)', () => {
  afterEach(teardown)
  it('14 日空いた一番古いものから消え、消された領域は作り直せる', async () => {
    setup({ SPACE_LIMIT: '2' })
    const a = (await (await create('A')).json()) as { epoch: string }
    await push('A', [await record('1')])
    await advance(DAY, [])
    await create('B')
    await advance(14 * DAY, [])
    expect((await create('C')).status).toBe(201)
    expect(await status('A')).toBe(404)
    expect(await status('B')).toBe(200)
    expect(await status('C')).toBe(200)
    expect(await activeCount()).toBe(2)
    // 消された領域の中身まで消えている
    await runInDurableObject(asDo(spaceStub(await spaceIdOf('A'))), async (_o, state) => {
      expect(await state.storage.getAlarm()).toBeNull()
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'meta'").one().n).toBe(0)
    })
    // B は今使ったので押し出せない。C も新しい。A の作り直しは満員
    const again = await create('A')
    expect(again.status).toBe(403)
    expect(await errorOf(again)).toBe('capacity_full')
    await advance(14 * DAY, [])
    await status('C')
    const back = await create('A')
    expect(back.status).toBe(201)
    expect(((await back.json()) as { epoch: string }).epoch).not.toBe(a.epoch)
    expect(await status('B')).toBe(404)
    expect(await status('C')).toBe(200)
  })
  it('台帳の報告が遅れていても、使用中の領域を消さない', async () => {
    setup({ SPACE_LIMIT: '1' })
    await create('A')
    // 同じ日の 1 時間以内の要求は台帳へ報告しない
    clock.now += 30 * 60 * 1000
    expect(await status('A')).toBe(200)
    const before = (await ledgerSql<{ last_access_at: number }>('SELECT last_access_at FROM spaces'))[0].last_access_at
    expect(before).toBeLessThan(clock.now)
    clock.now += 14 * DAY - 10 * 60 * 1000
    const r = await create('B')
    expect(r.status).toBe(403)
    expect(await errorOf(r)).toBe('capacity_full')
    expect(await status('A')).toBe(200)
    expect(await activeCount()).toBe(1)
    // 台帳は本当の最終使用へ直っている
    const after = (await ledgerSql<{ last_access_at: number; state: string }>('SELECT last_access_at, state FROM spaces'))[0]
    expect(after.state).toBe('active')
    expect(after.last_access_at).toBeGreaterThan(before)
  })
  it('14 日に 1 ミリ秒足りなければ消さない', async () => {
    setup({ SPACE_LIMIT: '1' })
    await create('A')
    clock.now += 14 * DAY - 1
    expect((await create('B')).status).toBe(403)
    expect(await status('A')).toBe(200)
  })
  it('次の候補へ進む。消えた候補の代わりに、使っていない候補を消す', async () => {
    setup({ SPACE_LIMIT: '2' })
    await create('A')
    clock.now += HOUR
    await create('B')
    clock.now += 30 * 60 * 1000
    await status('A')
    clock.now += 14 * DAY - 40 * 60 * 1000
    // A は報告が古いが実際は使っている。B は 14 日空いていない(1 時間 - 10 分 の差)
    expect((await create('C')).status).toBe(403)
    clock.now += 11 * 60 * 1000
    expect((await create('C')).status).toBe(201)
    expect(await status('A')).toBe(200)
    expect(await status('B')).toBe(404)
  })
  it('同時の作成が同じ候補を選ばず、枠を超えない', async () => {
    setup({ SPACE_LIMIT: '2' })
    await create('A')
    await create('B')
    clock.now += 14 * DAY
    const res = await Promise.all(['C', 'D', 'E', 'F', 'G', 'H'].map((t) => create(t, freshIp())))
    const statuses = res.map((r) => r.status)
    expect(statuses.filter((s) => s === 201).length).toBe(2)
    expect(statuses.filter((s) => s === 403).length).toBe(4)
    expect(await activeCount()).toBe(2)
    expect(await status('A')).toBe(404)
    expect(await status('B')).toBe(404)
  })
  it('押し出しの確認に失敗したら消さず、枠も増やさない', async () => {
    setup({ SPACE_LIMIT: '1' })
    await create('A')
    clock.now += 14 * DAY
    await runInDurableObject(asDo(ledger()), (o) => {
      ;(o as unknown as { evictSpace: () => Promise<never> }).evictSpace = async () => {
        throw new Error('down')
      }
    })
    expect((await create('B')).status).toBe(403)
    expect(await activeCount()).toBe(1)
    expect(await status('A')).toBe(200)
  })
})

describe('放置削除', () => {
  afterEach(teardown)
  it('90 日で消えて枠が空く。89 日は残る', async () => {
    setup({ SPACE_LIMIT: '1', EVICT_IDLE_DAYS: '1000' })
    const id = await spaceIdOf('A')
    await create('A')
    await advance(89 * DAY, [id])
    expect((await spaceStub(id).info()).exists).toBe(true)
    expect((await create('B')).status).toBe(403)
    await advance(DAY, [id])
    expect((await spaceStub(id).info()).exists).toBe(false)
    expect((await create('B')).status).toBe(201)
  })
  it('alarm が遅れても、要求の時点で期限を過ぎていれば 404 で枠が空く', async () => {
    setup({ SPACE_LIMIT: '1', EVICT_IDLE_DAYS: '1000' })
    await create('A')
    clock.now += 90 * DAY
    expect(await status('A')).toBe(404)
    expect(await activeCount()).toBe(0)
  })
  it('一度もレコードの来ない領域は短い期限で消える。レコードがあれば消えない', async () => {
    setup({ EMPTY_SPACE_DAYS: '7', SPACE_LIMIT: '5' })
    const a = await spaceIdOf('A')
    const b = await spaceIdOf('B')
    await create('A')
    await create('B')
    await push('B', [await record('1')])
    await advance(7 * DAY, [a, b])
    expect((await spaceStub(a).info()).exists).toBe(false)
    expect((await spaceStub(b).info()).exists).toBe(true)
    expect(await activeCount()).toBe(1)
  })
  it('台帳へ知らせられなくても、台帳の alarm が照合して枠を空ける', async () => {
    setup({ SPACE_LIMIT: '1', EVICT_IDLE_DAYS: '1000' })
    const id = await spaceIdOf('A')
    await create('A')
    await spaceStub(id).adminWipe(null)
    expect(await activeCount()).toBe(1)
    await advance(90 * DAY)
    expect(await activeCount()).toBe(0)
    expect((await create('B')).status).toBe(201)
  })
  it('端末の削除で枠が空く。古い知らせは作り直した領域を消さない', async () => {
    setup({ SPACE_LIMIT: '1' })
    await create('A')
    const first = (await spaceStub(await spaceIdOf('A')).info()).epoch as string
    expect((await call('DELETE', '/space', { token: 'A' })).status).toBe(200)
    expect(await activeCount()).toBe(0)
    await create('A')
    await ledger().spaceGone(await spaceIdOf('A'), first)
    expect(await activeCount()).toBe(1)
  })
  it('途中で落ちた予約は、台帳の alarm が実体を見て直す', async () => {
    setup({ SPACE_LIMIT: '2' })
    const a = await spaceIdOf('A')
    await ledger().reserve(a, '198.51.100.1')
    const dead = await spaceIdOf('dead')
    await ledger().reserve(dead, '198.51.100.1')
    await spaceStub(a).create(a)
    expect((await create('C')).status).toBe(403)
    await advance(10 * 60 * 1000)
    const rows = await ledgerSql<{ space_id: string; state: string }>('SELECT space_id, state FROM spaces')
    expect(rows).toEqual([{ space_id: a, state: 'active' }])
    expect((await create('C')).status).toBe(201)
  })
})

describe('台帳の報告', () => {
  afterEach(teardown)
  it('日の変わり目に最終使用、1 時間ごとに使用量を報告する', async () => {
    setup({ SPACE_LIMIT: '5' })
    await create('A')
    await push('A', [await record('1')])
    let row = (await ledgerSql<{ used_bytes: number; last_access_day: number }>('SELECT * FROM spaces'))[0]
    expect(row.used_bytes).toBe(0)
    clock.now += HOUR
    await status('A')
    row = (await ledgerSql<{ used_bytes: number; last_access_day: number; record_count: number; req_recent: number }>('SELECT * FROM spaces'))[0] as typeof row
    expect(row.used_bytes).toBeGreaterThan(0)
    clock.now += DAY
    await status('A')
    row = (await ledgerSql<{ used_bytes: number; last_access_day: number }>('SELECT * FROM spaces'))[0]
    expect(row.last_access_day).toBe(Math.floor(clock.now / DAY))
  })
  it('台帳に中身と鍵が入らない', async () => {
    setup()
    await create('A')
    const columns = (await ledgerSql<{ name: string }>("SELECT name FROM pragma_table_info('spaces')")).map((c) => c.name)
    expect(columns.sort()).toEqual(['created_at', 'epoch', 'last_access_at', 'last_access_day', 'record_count', 'req_recent', 'slot_moved', 'source_mac', 'space_id', 'state', 'state_at', 'used_bytes'].sort())
  })
})

describe('作成元', () => {
  afterEach(teardown)
  it('作成元ごとの制限は 7 日に 5 領域。別の作成元は通る。7 日で値が消える', async () => {
    setup({ SOURCE_LIMIT: '5', SPACE_LIMIT: '100' })
    const ip = freshIp()
    for (let i = 0; i < 5; i++) expect((await create(`S${i}`, ip)).status).toBe(201)
    const over = await create('S5', ip)
    expect(over.status).toBe(403)
    expect(await errorOf(over)).toBe('creation_closed')
    expect((await create('O1', freshIp())).status).toBe(201)
    await advance(7 * DAY)
    const macs = await ledgerSql<{ source_mac: string | null }>('SELECT source_mac FROM spaces')
    expect(macs.every((m) => m.source_mac === null)).toBe(true)
    expect((await ledgerSql<{ n: number }>('SELECT COUNT(*) AS n FROM source_events'))[0].n).toBe(0)
    expect((await create('S5', ip)).status).toBe(201)
  })
  it('週をまたいでも先週の鍵の値と比べて数える。鍵は 2 週分だけ', async () => {
    setup({ SOURCE_LIMIT: '2' })
    const ip = freshIp()
    await create('W1', ip)
    await create('W2', ip)
    const week = 7 * DAY
    // 週の境目の直後まで進める(7 日は経っていない)
    clock.now = (Math.floor(clock.now / week) + 1) * week + 1000
    expect(clock.now - 1_800_000_000_000).toBeLessThan(week)
    expect((await create('W3', ip)).status).toBe(403)
    clock.now += 2 * week
    await create('other', freshIp())
    const keys = await ledgerSql<{ week: number }>('SELECT week FROM source_keys')
    expect(keys.length).toBeLessThanOrEqual(2)
    expect(Math.min(...keys.map((k) => k.week))).toBeGreaterThanOrEqual(Math.floor(clock.now / week) - 1)
  })
  it('平文の IP と User-Agent が台帳のどの表にもない', async () => {
    setup()
    const ip = '203.0.113.200'
    const v6 = '2001:db8:aaaa:bbbb::1'
    await call('POST', '/spaces', { token: 'A', ip, headers: { 'User-Agent': 'secret-agent' } })
    await call('POST', '/spaces', { token: 'B', ip: v6, headers: { 'User-Agent': 'secret-agent' } })
    const tables = await ledgerSql<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' AND name NOT LIKE '\\_%' ESCAPE '\\'")
    for (const t of tables) {
      const text = await runInDurableObject(asDo(ledger()), (_o, state) => JSON.stringify(state.storage.sql.exec(`SELECT * FROM "${t.name}"`).toArray()))
      for (const needle of [ip, 'secret-agent', '2001', 'db8']) expect(text.includes(needle) && !/^[0-9a-f]+$/.test(needle), `${t.name}: ${needle}`).toBe(false)
      expect(text).not.toContain(ip)
    }
    // 領域の側にも置かない
    const inSpace = await runInDurableObject(asDo(spaceStub(await spaceIdOf('A'))), (_o, state) => JSON.stringify(state.storage.sql.exec('SELECT * FROM meta').toArray()))
    expect(inSpace).not.toContain(ip)
  })
  it('v6 は /64 で同じ作成元、v4 射影は v4 と同じ', async () => {
    setup({ SOURCE_LIMIT: '1' })
    expect((await create('X1', '2001:db8:1:2::1')).status).toBe(201)
    expect((await create('X2', '2001:db8:1:2:ffff::9')).status).toBe(403)
    expect((await create('X3', '2001:db8:1:3::1')).status).toBe(201)
    expect((await create('Y1', '203.0.113.50')).status).toBe(201)
    expect((await create('Y2', '::ffff:203.0.113.50')).status).toBe(403)
  })
})

