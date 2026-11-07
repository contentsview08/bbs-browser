// 費用: 1 要求あたりの書き行、1 日の件数、作りの移行、端末の不具合の検知、停止のときに起こさないこと
import { runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { DAY, MINUTE } from '../../src/config'
import { call, clock, ledger, push, record, setup, spaceIdOf, spaceStub, teardown } from './support'

const asDo = (s: unknown) => s as DurableObjectStub
const create = (token: string, body?: string) => call('POST', '/spaces', { token, ...(body !== undefined && { body }) })

/** 実体が書いた行の数(索引の更新を含む) */
const written = async (token: string): Promise<number> => runInDurableObject(asDo(spaceStub(await spaceIdOf(token))), (inst) => (inst as unknown as { writtenRows: number }).writtenRows)

async function headOnce(token: string, etag?: string | null): Promise<Response> {
  const r = await call('GET', '/head', { token, ...(etag && { headers: { 'If-None-Match': etag } }) })
  await r.text()
  return r
}

describe('書き行', () => {
  afterEach(teardown)
  it('304 の /head は行を書かない。次の 200 でまとめて 1 行', async () => {
    setup()
    await create('A')
    await push('A', [await record('1')])
    const first = await headOnce('A')
    expect(first.status).toBe(200)
    const etag = first.headers.get('ETag')
    const before = await written('A')
    // 1 分ごとの確認を 50 分(1 時間ごとの台帳への報告は入らない)
    for (let i = 0; i < 50; i++) {
      clock.now += MINUTE
      expect((await headOnce('A', etag)).status).toBe(304)
    }
    expect((await written('A')) - before).toBe(0)
    // 分の境目をまたいでいるので、変化のある確認では回数と最終使用を 1 行で写す
    clock.now += MINUTE
    expect((await headOnce('A')).status).toBe(200)
    expect((await written('A')) - before).toBe(1)
    // 同じ分のうちは書かない
    expect((await headOnce('A')).status).toBe(200)
    expect((await written('A')) - before).toBe(1)
  })
  it('1 分に 60 回の /head で書くのは数行', async () => {
    setup()
    await create('A')
    const before = await written('A')
    for (let i = 0; i < 60; i++) {
      clock.now += 1000
      expect((await headOnce('A')).status).toBe(200)
    }
    expect((await written('A')) - before).toBeLessThanOrEqual(2)
  })
  it('最終使用は 10 分ごとに写り、実体が落ちても日の単位で合う', async () => {
    setup()
    await create('A')
    clock.now += 11 * MINUTE
    const etag = (await headOnce('A')).headers.get('ETag')
    clock.now += 11 * MINUTE
    expect((await headOnce('A', etag)).status).toBe(304)
    await runInDurableObject(asDo(spaceStub(await spaceIdOf('A'))), (_o, state) => {
      // 304 では写らないので 1 回目の確認の時刻
      expect(state.storage.sql.exec<{ last_used: number }>('SELECT last_used FROM meta').one().last_used).toBe(clock.now - 11 * MINUTE)
    })
  })
  it('/records の書き行: 新規 2 件は records 2 行 + 索引 + meta 1 + requests 1。片づけは 16 件ごと', async () => {
    setup()
    await create('A')
    const b0 = await written('A')
    expect((await push('A', [await record('1'), await record('2')])).status).toBe(200)
    const fresh = (await written('A')) - b0
    // 新規: records 1 行 + version の索引 1 行 を 2 件、meta 1 行、requests 1 行
    expect(fresh).toBe(2 * 2 + 1 + 1)
    const b1 = await written('A')
    expect((await push('A', [await record('1', { base_version: 1 }), await record('2', { base_version: 2 })])).status).toBe(200)
    const replaced = (await written('A')) - b1
    // 置き換えは行の更新で、削除 + 挿入にならない
    expect(replaced).toBeLessThanOrEqual(fresh)
    console.log(JSON.stringify({ records_new_2: fresh, records_replace_2: replaced }))
    // 通番が 16 の区切りを越えるまで片づけの DELETE は走らない
    await runInDurableObject(asDo(spaceStub(await spaceIdOf('A'))), (_o, state) => {
      expect(state.storage.sql.exec("SELECT sql FROM sqlite_master WHERE name = 'requests'").one().sql).not.toContain('AUTOINCREMENT')
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_sequence'").one().n).toBe(0)
    })
  })
  it('/changes は読むだけ。同じ分なら行を書かない', async () => {
    setup()
    await create('A')
    await push('A', [await record('1')])
    const before = await written('A')
    expect((await call('GET', '/changes?since=0', { token: 'A' })).status).toBe(200)
    expect((await written('A')) - before).toBe(0)
  })
})

describe('1 日の件数', () => {
  afterEach(teardown)
  const dayRecords = async (token: string): Promise<number> => runInDurableObject(asDo(spaceStub(await spaceIdOf(token))), (_o, state) => state.storage.sql.exec<{ n: number }>('SELECT day_records AS n FROM meta').one().n)
  it('上限を超える送信は 429 で 1 行も書かず、ちょうどまでは通る。409 は数えない', async () => {
    setup({ RECORDS_PER_DAY: '5' })
    await create('A')
    expect((await push('A', [await record('1'), await record('2'), await record('3')])).status).toBe(200)
    const before = await written('A')
    // 3 + 3 > 5。途中まで書かない
    const over = await push('A', [await record('4'), await record('5'), await record('6')])
    expect(over.status).toBe(429)
    const body = (await over.json()) as { error: string; retry_after_sec: number }
    expect(body.error).toBe('rate_limited')
    expect(body.retry_after_sec).toBeGreaterThan(0)
    expect(body.retry_after_sec).toBeLessThanOrEqual(24 * 60 * 60)
    expect((await written('A')) - before).toBe(0)
    // 古い base_version で送り直したものは 409 で書かないので数えない
    const conflict = (await (await push('A', [await record('1')])).json()) as { results: { status: number }[] }
    expect(conflict.results[0].status).toBe(409)
    // ちょうど 5 件までは通り、DB にも写る
    expect((await push('A', [await record('4'), await record('5')])).status).toBe(200)
    expect(await dayRecords('A')).toBe(5)
    expect((await push('A', [await record('6')])).status).toBe(429)
  })
  it('日が変わると数え直す', async () => {
    setup({ RECORDS_PER_DAY: '2' })
    await create('A')
    expect((await push('A', [await record('1'), await record('2')])).status).toBe(200)
    expect((await push('A', [await record('3')])).status).toBe(429)
    clock.now += DAY
    expect((await push('A', [await record('3')])).status).toBe(200)
    expect((await push('A', [await record('4')])).status).toBe(200)
    expect((await push('A', [await record('5')])).status).toBe(429)
  })
})

describe('作りの移行', () => {
  afterEach(teardown)
  it('版 1 の領域は最初に触ったときに 1 回だけ requests を作り直す', async () => {
    setup()
    await create('A')
    await push('A', [await record('1')], 'r000000000000000000001')
    const stub = asDo(spaceStub(await spaceIdOf('A')))
    // 版 1 の作りに戻す
    await runInDurableObject(stub, (inst, state) => {
      state.storage.sql.exec('ALTER TABLE meta DROP COLUMN db_version')
      state.storage.sql.exec('ALTER TABLE meta DROP COLUMN day_records')
      state.storage.sql.exec('DROP TABLE requests')
      state.storage.sql.exec('CREATE TABLE requests (seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, results TEXT NOT NULL, at INTEGER NOT NULL)')
      state.storage.sql.exec("INSERT INTO requests (request_id, results, at) VALUES ('r000000000000000000001', '[]', 0)")
      ;(inst as unknown as { hasSchema: null }).hasSchema = null
    })
    expect((await headOnce('A')).status).toBe(200)
    const after = await runInDurableObject(stub, (inst, state) => {
      expect(state.storage.sql.exec("SELECT sql FROM sqlite_master WHERE name = 'requests'").one().sql).not.toContain('AUTOINCREMENT')
      expect(state.storage.sql.exec<{ v: number }>('SELECT db_version AS v FROM meta').one().v).toBe(3)
      expect(state.storage.sql.exec<{ n: number }>('SELECT day_records AS n FROM meta').one().n).toBe(0)
      expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM requests').one().n).toBe(0)
      ;(inst as unknown as { hasSchema: null }).hasSchema = null
      return (inst as unknown as { writtenRows: number }).writtenRows
    })
    // 2 回目は流れない
    const r = await headOnce('A')
    expect(r.status).toBe(200)
    expect((await written('A')) - after).toBeLessThanOrEqual(1)
    // 捨てた写しの再送は 409 で今の値が返る。新しい書き込みも通る
    const again = (await (await push('A', [await record('1')], 'r000000000000000000001')).json()) as { results: { status: number }[] }
    expect(again.results[0].status).toBe(409)
    expect((await push('A', [await record('2')])).status).toBe(200)
  })
  it('版 2 の領域は最初に触ったときに 1 日の件数の列を足し、その日は数え直す', async () => {
    setup({ RECORDS_PER_DAY: '2' })
    await create('A')
    await push('A', [await record('1')])
    const stub = asDo(spaceStub(await spaceIdOf('A')))
    // 版 2 の作りに戻し、実体が落ちたことにする
    await runInDurableObject(stub, (inst, state) => {
      state.storage.sql.exec('ALTER TABLE meta DROP COLUMN day_records')
      state.storage.sql.exec('UPDATE meta SET db_version = 2')
      Object.assign(inst as unknown as object, { hasSchema: null, live: null })
    })
    expect((await headOnce('A')).status).toBe(200)
    await runInDurableObject(stub, (_o, state) => {
      expect(state.storage.sql.exec<{ v: number }>('SELECT db_version AS v FROM meta').one().v).toBe(3)
      expect(state.storage.sql.exec<{ n: number }>('SELECT day_records AS n FROM meta').one().n).toBe(0)
    })
    expect((await push('A', [await record('2'), await record('3')])).status).toBe(200)
    expect((await push('A', [await record('4')])).status).toBe(429)
  })
})

describe('端末の不具合の検知', () => {
  afterEach(teardown)
  it('base_version が最新の version より大きければ 400 で、採番は進まない', async () => {
    setup()
    await create('A')
    await push('A', [await record('1')])
    const r = await push('A', [await record('2', { base_version: 2 })])
    expect(r.status).toBe(400)
    expect(await r.text()).toBe('{"error":"bad_request"}')
    const head = (await (await call('GET', '/head', { token: 'A' })).json()) as { version: number }
    expect(head.version).toBe(1)
    // ちょうど最新までは通る
    expect((await push('A', [await record('2', { base_version: 1 })])).status).toBe(200)
  })
})

describe('作成の停止', () => {
  afterEach(teardown)
  it('環境変数で止めているときは、PoW を出さず領域も台帳も起こさない', async () => {
    setup({ CREATION_CLOSED: '1', POW_BITS: '6' })
    const r = await create('A')
    expect(r.status).toBe(403)
    expect(((await r.json()) as { error: string }).error).toBe('creation_closed')
    expect((await spaceStub(await spaceIdOf('A')).info()).exists).toBe(false)
    const out = await ledger().admin({ keyId: 'k', nonce: 'nn', action: 'capacity', param: '', query: {}, body: null as never })
    expect(JSON.parse((out as { body: string }).body).used).toBe(0)
  })
})
