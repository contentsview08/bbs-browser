// docs/sync-security.md の否定のテストの一覧
import { createExecutionContext, runInDurableObject, runDurableObjectAlarm, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../src/index'
import { leadingZeroBits } from '../../src/pow'
import { sha256, utf8 } from '../../src/encoding'
import { runtime } from '../../src/runtime'
import { advance, BASE, call, clock, cipher, freshIp, ledger, push, record, recordIdOf, requestId, setup, spaceIdOf, spaceStub, teardown, testEnv, tokenOf, until429 } from './support'

const create = (token: string, o = {}) => call('POST', '/spaces', { token, ...o })
const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error
const asDo = (s: unknown) => s as DurableObjectStub

async function solve(challenge: string): Promise<string> {
  const bits = Number(challenge.split('.')[3])
  for (let i = 0; ; i++) {
    const nonce = `n${i}`
    if (leadingZeroBits(await sha256(utf8(`${challenge}:${nonce}`))) >= bits) return nonce
  }
}

describe('head の ETag', () => {
  beforeEach(() => setup())
  afterEach(teardown)
  it('Cloudflare が書き換えた弱い ETag でも 304 を返す', async () => {
    await create('E')
    const etag = (await call('GET', '/head', { token: 'E' })).headers.get('ETag') as string
    for (const value of [etag, `W/${etag}`]) {
      const r = await call('GET', '/head', { token: 'E', headers: { 'If-None-Match': value } })
      expect(r.status).toBe(304)
    }
  })
})

describe('トークン', () => {
  beforeEach(() => setup())
  afterEach(teardown)
  it('なし・短い・形の違うものは 401', async () => {
    expect((await call('GET', '/head')).status).toBe(401)
    expect((await call('GET', '/head', { auth: 'Bearer abcd' })).status).toBe(401)
    expect((await call('GET', '/head', { auth: `Bearer ${'A'.repeat(64)}` })).status).toBe(401)
    expect((await call('GET', '/head', { auth: `bearer ${'a'.repeat(64)}` })).status).toBe(401)
    expect((await call('GET', '/head', { auth: `Bearer ${'a'.repeat(64)}x` })).status).toBe(401)
    expect((await call('POST', '/records', { auth: 'x' })).status).toBe(401)
  })
  it('別の領域のトークンでは、その領域しか見えない', async () => {
    await create('A')
    await create('B')
    await push('A', [await record('1')])
    const b = (await (await call('GET', '/changes?since=0', { token: 'B' })).json()) as { records: unknown[]; head: number }
    expect(b.records).toEqual([])
    expect(b.head).toBe(0)
    expect((await call('GET', '/head', { token: 'C' })).status).toBe(404)
  })
  it('認証の失敗を IP ごとに数える', async () => {
    const ip = freshIp()
    expect((await until429(30, () => call('GET', '/head', { auth: 'Bearer x', ip }))).status).toBe(429)
    expect((await call('GET', '/head', { auth: 'Bearer x', ip: freshIp() })).status).toBe(401)
  })
  it('無い領域への要求も数える', async () => {
    const ip = freshIp()
    expect((await until429(30, (i) => call('GET', '/head', { token: `none${i}`, ip }))).status).toBe(429)
    // 空の Durable Object に何も書かない
    await runInDurableObject(asDo(spaceStub(await spaceIdOf('none0'))), (_o, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'").one().n).toBe(0)
    })
  })
})

describe('本文', () => {
  beforeEach(() => setup())
  afterEach(teardown)
  const direct = async (body: BodyInit | null, headers: Record<string, string>) => {
    const ctx = createExecutionContext()
    const req = new Request(`${BASE}/records`, { method: 'POST', headers: { Authorization: `Bearer ${await tokenOf('A')}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': freshIp(), ...headers }, body })
    const res = await worker.fetch(req, testEnv)
    await waitOnExecutionContext(ctx)
    return res
  }
  it('1MB を超えると読む前に 413', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1)
    expect((await call('POST', '/records', { token: 'A', body: big })).status).toBe(413)
    expect((await call('POST', '/records', { auth: 'x', body: big })).status).toBe(413)
  })
  it('Content-Length がなければ 413', async () => {
    const stream = new ReadableStream({ start: (c) => (c.enqueue(utf8('{}')), c.close()) })
    const res = await direct(stream, {})
    expect(res.status).toBe(413)
  })
  it('Content-Length の嘘: 宣言より長ければ 413、短ければ 400', async () => {
    await create('A')
    const long = new TransformStream<Uint8Array, Uint8Array>()
    const w = long.writable.getWriter()
    void w.write(new Uint8Array(100)).then(() => w.close()).catch(() => undefined)
    expect((await direct(long.readable, { 'Content-Length': '10' })).status).toBe(413)
    const short = new ReadableStream({ start: (c) => (c.enqueue(utf8('{}')), c.close()) })
    expect((await direct(short, { 'Content-Length': '10' })).status).toBe(400)
    expect((await call('POST', '/records', { token: 'A', headers: { 'Content-Length': 'abc' } })).status).toBeLessThan(500)
  })
  it('途中で切れた本文は 400', async () => {
    await create('A')
    const cut = new ReadableStream({
      pull(c) {
        c.enqueue(utf8('{"request_id"'))
        c.error(new Error('cut'))
      },
    })
    expect((await direct(cut, { 'Content-Length': '1000' })).status).toBe(400)
  })
  it('圧縮された本文(爆弾)は展開せず 415', async () => {
    await create('A')
    expect((await call('POST', '/records', { token: 'A', headers: { 'Content-Encoding': 'gzip' }, body: '\x1f\x8b' })).status).toBe(415)
    expect((await call('POST', '/spaces', { token: 'A', headers: { 'Content-Encoding': 'br' } })).status).toBe(415)
  })
  it('Content-Type は application/json だけ', async () => {
    await create('A')
    expect((await call('POST', '/records', { token: 'A', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await call('POST', '/spaces', { token: 'A', headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status).toBe(200)
  })
})

describe('JSON', () => {
  beforeEach(async () => {
    setup()
    await create('A')
  })
  afterEach(teardown)
  const post = (body: string) => call('POST', '/records', { token: 'A', body })
  it('壊れている', async () => {
    for (const b of ['{broken', '', '[', '"x"', 'null', '123', '{"a":}', '﻿{}']) expect((await post(b)).status, b).toBe(400)
  })
  it('深い', async () => {
    expect((await post(`${'['.repeat(100000)}${']'.repeat(100000)}`)).status).toBe(400)
    expect((await post(`{"records":${'['.repeat(20)}${']'.repeat(20)},"request_id":"${requestId()}"}`)).status).toBe(400)
  })
  it('キーの重複', async () => {
    const r = await record('1')
    expect((await post(`{"request_id":"${requestId()}","request_id":"${requestId()}","records":[${JSON.stringify(r)}]}`)).status).toBe(400)
    const inner = JSON.stringify(r).replace('{', '{"deleted":true,')
    expect((await post(`{"request_id":"${requestId()}","records":[${inner}]}`)).status).toBe(400)
    // エスケープで同じ名前にしても重複
    expect((await post(`{"request_id":"${requestId()}","request\\u005fid":"${requestId()}","records":[${JSON.stringify(r)}]}`)).status).toBe(400)
  })
  it('巨大な数値', async () => {
    for (const v of ['9007199254740992', '1e400', '-1', '1.5']) {
      const r = JSON.stringify(await record('1')).replace('"base_version":0', `"base_version":${v}`)
      expect((await post(`{"request_id":"${requestId()}","records":[${r}]}`)).status, v).toBe(400)
    }
  })
  it('型違い', async () => {
    const r = await record('1')
    for (const patch of [{ deleted: 'true' }, { deleted: 1 }, { kind_tag: 'x' }, { kind_tag: 1 }, { schema_version: '1' }, { schema_version: -1 }, { base_version: null }, { nonce: 1 }, { ciphertext: [] }, { record_id: 0 }]) {
      expect((await push('A', [{ ...r, ...patch }])).status, JSON.stringify(patch)).toBe(400)
    }
    expect((await post(JSON.stringify({ request_id: 1, records: [r] }))).status).toBe(400)
    expect((await post(JSON.stringify({ request_id: requestId(), records: {} }))).status).toBe(400)
    expect((await post(JSON.stringify({ request_id: requestId(), records: [] }))).status).toBe(400)
    expect((await post(JSON.stringify({ request_id: requestId(), records: [r], x: 1 }))).status).toBe(400)
    expect((await call('POST', '/spaces', { token: 'A', body: '{"x":1}' })).status).toBe(400)
  })
})

describe('レコードの形', () => {
  beforeEach(async () => {
    setup()
    await create('A')
  })
  afterEach(teardown)
  it('record_id・nonce の長さ違いと SQL の断片', async () => {
    const r = await record('1')
    const bad = [
      { record_id: 'a'.repeat(63) },
      { record_id: 'a'.repeat(65) },
      { record_id: 'A'.repeat(64) },
      { record_id: `'; DROP TABLE records; --${'a'.repeat(39)}` },
      { nonce: 'A'.repeat(31) },
      { nonce: 'A'.repeat(34) },
      { nonce: `'; DROP TABLE records; --${'A'.repeat(7)}` },
      { nonce: 'A'.repeat(31) + '=' },
      { ciphertext: `${cipher().slice(0, -1)}'` },
    ]
    for (const b of bad) expect((await push('A', [{ ...r, ...b }])).status, JSON.stringify(b)).toBe(400)
    expect((await push('A', [r], `'; DROP TABLE r; --${'a'.repeat(4)}`)).status).toBe(400)
    expect((await push('A', [r])).status).toBe(200)
  })
  it('暗号文は 256 バイト単位 + タグ。余りのビットが立った別表記も断る', async () => {
    const r = await record('1')
    expect((await push('A', [{ ...r, ciphertext: cipher(271) }])).status).toBe(400)
    expect((await push('A', [{ ...r, ciphertext: cipher(273) }])).status).toBe(400)
    expect((await push('A', [{ ...r, ciphertext: cipher(16) }])).status).toBe(400)
    const c = cipher(272)
    expect((await push('A', [{ ...r, ciphertext: `${c.slice(0, -1)}B` }])).status).toBe(400)
    expect((await push('A', [{ ...r, ciphertext: cipher(16144) }])).status).toBe(200)
  })
  it('101 件と 16KB 超え', async () => {
    const many = await Promise.all(Array.from({ length: 101 }, (_, i) => record(`m${i}`)))
    expect((await push('A', many)).status).toBe(400)
    expect((await push('A', many.slice(0, 100))).status).toBe(200)
    expect((await push('A', [await record('big', { bytes: 16400 })])).status).toBe(400)
  })
  it('同じレコードを同じ要求に 2 回入れても通番は壊れない', async () => {
    const r = await record('dup')
    const res = (await (await push('A', [r, r])).json()) as { results: { status: number; version?: number }[] }
    expect(res.results.map((x) => x.status)).toEqual([200, 409])
  })
})

describe('クォータ', () => {
  afterEach(teardown)
  const b64 = Math.ceil((272 * 4) / 3)
  it('容量ちょうどは通り、1 バイト超えは断る', async () => {
    setup({ QUOTA_BYTES: String(b64) })
    await create('A')
    expect((await push('A', [await record('1')])).status).toBe(200)
    expect((await push('A', [await record('1', { base_version: 1, bytes: 272 })])).status).toBe(200)
    const over = await push('A', [await record('2')])
    expect(over.status).toBe(413)
    expect(await errorOf(over)).toBe('quota_exceeded')
    teardown()
    setup({ QUOTA_BYTES: String(b64 - 1) })
    await create('B')
    expect((await push('B', [await record('1')])).status).toBe(413)
  })
  it('件数ちょうどは通り、1 件超えは断る。tombstone も数える', async () => {
    setup({ QUOTA_RECORDS: '2' })
    await create('A')
    expect((await push('A', [await record('1'), await record('2', { deleted: true })])).status).toBe(200)
    expect((await push('A', [await record('3', { deleted: true })])).status).toBe(413)
    const s = (await (await call('GET', '/space', { token: 'A' })).json()) as { record_count: number; used_bytes: number }
    expect(s.record_count).toBe(2)
    expect(s.used_bytes).toBe(b64 * 2)
  })
  it('片づけで使用量が減り、また書ける', async () => {
    setup({ QUOTA_RECORDS: '1', TOMB_GC_DAYS: '1' })
    await create('A')
    await push('A', [await record('1', { deleted: true })])
    expect((await push('A', [await record('2')])).status).toBe(413)
    await advance(24 * 60 * 60 * 1000)
    await spaceStub(await spaceIdOf('A')).housekeep()
    expect((await push('A', [await record('2')])).status).toBe(200)
    const s = (await (await call('GET', '/space', { token: 'A' })).json()) as { record_count: number; gc_floor: number }
    expect(s.record_count).toBe(1)
    expect(s.gc_floor).toBe(1)
  })
})

describe('since', () => {
  beforeEach(async () => {
    setup()
    await create('A')
  })
  afterEach(teardown)
  it('負数・小数・巨大な値・文字列は 400', async () => {
    for (const q of ['-1', '1.5', '1e3', 'x', '9007199254740992', '99999999999999999999999', '', '01', '0x10', '1%00', '1&since=2', "0'--", ' 1']) {
      expect((await call('GET', `/changes?since=${q}`, { token: 'A' })).status, q).toBe(400)
    }
    expect((await call('GET', '/changes', { token: 'A' })).status).toBe(400)
    expect((await call('GET', '/changes?since=9007199254740991', { token: 'A' })).status).toBe(200)
  })
})

describe('request_id と同時の書き込み', () => {
  beforeEach(async () => {
    setup()
    await create('A')
  })
  afterEach(teardown)
  it('同じ request_id の再送で通番が増えない', async () => {
    const id = requestId()
    const r1 = await record('1')
    const a = await (await push('A', [r1], id)).text()
    const b = await (await push('A', [r1], id)).text()
    expect(b).toBe(a)
    const head = (await (await call('GET', '/head', { token: 'A' })).json()) as { version: number }
    expect(head.version).toBe(1)
  })
  it('覚えている数を超えた古い request_id は片づくが、送り直しても 409 で収まる', async () => {
    const first = requestId()
    const r1 = await record('1')
    await push('A', [r1], first)
    for (let i = 0; i < 70; i++) await push('A', [await record(`f${i}`)])
    const again = (await (await push('A', [r1], first)).json()) as { results: { status: number; record?: { version: number } }[] }
    expect(again.results[0].status).toBe(409)
    expect(again.results[0].record?.version).toBe(1)
    await runInDurableObject(asDo(spaceStub(await spaceIdOf('A'))), (_o, state) => {
      expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM requests').one().n).toBeLessThanOrEqual(64)
    })
  })
  it('同時の書き込みで通番の重複も取りこぼしもない', async () => {
    const sets = await Promise.all(Array.from({ length: 20 }, async (_, i) => [await record(`c${i}a`), await record(`c${i}b`)]))
    const res = await Promise.all(sets.map((s) => push('A', s)))
    const versions: number[] = []
    for (const r of res) {
      expect(r.status).toBe(200)
      for (const x of ((await r.json()) as { results: { version: number }[] }).results) versions.push(x.version)
    }
    expect(versions.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    const list = (await (await call('GET', '/changes?since=0', { token: 'A' })).json()) as { records: { version: number }[]; head: number }
    expect(list.head).toBe(40)
    expect(list.records.length).toBe(40)
  })
  it('同じレコードへの同時の書き込みは 1 つだけ勝つ', async () => {
    const r1 = await record('same')
    const res = await Promise.all(Array.from({ length: 10 }, () => push('A', [r1])))
    const statuses: number[] = []
    for (const r of res) statuses.push(((await r.json()) as { results: { status: number }[] }).results[0].status)
    expect(statuses.filter((s) => s === 200).length).toBe(1)
    expect(statuses.filter((s) => s === 409).length).toBe(9)
  })
  it('409 の応答は端末の読み取りの上限に収まり、入らない分は結果から外す', async () => {
    teardown()
    setup({ CONFLICT_BYTES: '50000' })
    await create('B')
    const big = await Promise.all(Array.from({ length: 5 }, (_, i) => record(`b${i}`, { bytes: 16144 })))
    await push('B', big)
    const res = (await (await push('B', big)).json()) as { results: { status: number }[] }
    expect(res.results.length).toBe(2)
    expect(res.results.every((r) => r.status === 409)).toBe(true)
  })
})

describe('PoW', () => {
  afterEach(teardown)
  const challenge = async (token: string) => ((await (await create(token)).json()) as { error: string; pow: { challenge: string; bits: number } })
  it('問題を受け取り、解いて作る', async () => {
    setup({ POW_BITS: '6' })
    const c = await challenge('A')
    expect(c.error).toBe('pow_required')
    expect(c.pow.bits).toBe(6)
    const nonce = await solve(c.pow.challenge)
    const res = await create('A', { body: JSON.stringify({ pow: { challenge: c.pow.challenge, nonce } }) })
    expect(res.status).toBe(201)
  })
  it('作成の前に DO を起こさない', async () => {
    setup({ POW_BITS: '6' })
    await challenge('Z')
    const out = await ledger().admin({ keyId: 'k', nonce: 'nn', action: 'capacity', param: '', query: {}, body: null as never })
    expect(JSON.parse((out as { body: string }).body).used).toBe(0)
  })
  it('期限切れ', async () => {
    setup({ POW_BITS: '4' })
    const c = await challenge('A')
    const nonce = await solve(c.pow.challenge)
    clock.now += 300_000
    const res = await create('A', { body: JSON.stringify({ pow: { challenge: c.pow.challenge, nonce } }) })
    expect(res.status).toBe(403)
    expect(await errorOf(res)).toBe('pow_invalid')
  })
  it('他の領域の問題', async () => {
    setup({ POW_BITS: '4' })
    const c = await challenge('A')
    const nonce = await solve(c.pow.challenge)
    const res = await create('B', { body: JSON.stringify({ pow: { challenge: c.pow.challenge, nonce } }) })
    expect(await errorOf(res)).toBe('pow_invalid')
  })
  it('改ざんした問題・解けていない答え・難易度を下げた問題', async () => {
    setup({ POW_BITS: '8' })
    const c = await challenge('A')
    const parts = c.pow.challenge.split('.')
    const send = (ch: string, nonce: string) => create('A', { body: JSON.stringify({ pow: { challenge: ch, nonce } }) })
    const longer = [...parts]
    longer[2] = String(Number(parts[2]) + 1000)
    expect(await errorOf(await send(longer.join('.'), 'x'))).toBe('pow_invalid')
    const easy = [...parts]
    easy[3] = '0'
    expect(await errorOf(await send(easy.join('.'), 'x'))).toBe('pow_invalid')
    for (let i = 0; ; i++) {
      const n = `w${i}`
      if (leadingZeroBits(await sha256(utf8(`${c.pow.challenge}:${n}`))) < 8) {
        expect(await errorOf(await send(c.pow.challenge, n))).toBe('pow_invalid')
        break
      }
    }
    expect((await send('x'.repeat(600), 'x')).status).toBe(400)
  })
  it('秘密がなければ作成を止める。問題を偽造させない', async () => {
    setup({ POW_BITS: '4' })
    const res = await worker.fetch(new Request(`${BASE}/spaces`, { method: 'POST', headers: { Authorization: `Bearer ${await tokenOf('A')}`, 'Content-Type': 'application/json', 'Content-Length': '2', 'CF-Connecting-IP': freshIp() }, body: '{}' }), { ...testEnv, POW_SECRET: undefined })
    expect(res.status).toBe(503)
  })
})

describe('Turnstile', () => {
  const envWith = { ...testEnv, TURNSTILE_SECRET: 'sec' }
  const send = async (token: string, body: unknown) =>
    await worker.fetch(new Request(`${BASE}/spaces`, { method: 'POST', headers: { Authorization: `Bearer ${await tokenOf(token)}`, 'Content-Type': 'application/json', 'Content-Length': String(JSON.stringify(body).length), 'CF-Connecting-IP': freshIp() }, body: JSON.stringify(body) }), envWith)
  afterEach(() => {
    teardown()
    runtime.fetch = (input, init) => fetch(input, init)
  })
  it('通ったときだけ作る。hostname と action を確かめる', async () => {
    setup()
    runtime.fetch = async () => Response.json({ success: true, hostname: 'sync.test', action: 'create-space' })
    expect((await send('A', {})).status).toBe(403)
    expect((await send('A', { turnstile: 'tok' })).status).toBe(201)
    runtime.fetch = async () => Response.json({ success: true, hostname: 'evil.test', action: 'create-space' })
    expect(await errorOf(await send('B', { turnstile: 'tok' }))).toBe('turnstile_invalid')
    runtime.fetch = async () => Response.json({ success: true, hostname: 'sync.test', action: 'other' })
    expect(await errorOf(await send('B', { turnstile: 'tok' }))).toBe('turnstile_invalid')
  })
  it('再利用したトークンを断る', async () => {
    setup()
    runtime.fetch = async () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })
    const res = await send('A', { turnstile: 'used' })
    expect(res.status).toBe(403)
    expect(await errorOf(res)).toBe('turnstile_invalid')
  })
  it('検証サービスの障害では新規作成だけが止まり、既存の同期は続く', async () => {
    setup()
    await create('A')
    runtime.fetch = async () => {
      throw new Error('down')
    }
    const res = await send('B', { turnstile: 'tok' })
    expect(res.status).toBe(503)
    expect(await errorOf(res)).toBe('turnstile_unavailable')
    runtime.fetch = async () => new Response('bad', { status: 500 })
    expect((await send('B', { turnstile: 'tok' })).status).toBe(503)
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(200)
  })
})

describe('入口', () => {
  afterEach(teardown)
  it('workers.dev など許可のないホストは 404', async () => {
    setup({ ALLOWED_HOSTS: 'sync.example.test' })
    const blocked = await call('GET', '/head', { token: 'A', base: 'https://obb-sync.foo.workers.dev' })
    const nope = await call('GET', '/nope', { base: 'https://sync.example.test' })
    expect(blocked.status).toBe(404)
    expect(await blocked.text()).toBe(await nope.text())
    expect((await call('GET', '/head', { token: 'A', base: 'https://sync.example.test' })).status).toBe(404)
  })
  it('workers.dev は検証用の間は使える', async () => {
    setup()
    expect((await call('POST', '/spaces', { token: 'A', base: 'https://obb-sync.foo.workers.dev' })).status).toBe(201)
  })
  it('http は 400。リダイレクトしない', async () => {
    setup()
    const res = await call('GET', '/head', { token: 'A', base: 'http://sync.test' })
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('https_required')
    expect(res.headers.get('Location')).toBeNull()
  })
  it('応答に CORS のヘッダーがなく、HSTS がある', async () => {
    setup()
    for (const r of [await create('A'), await call('GET', '/head', { token: 'A', headers: { Origin: 'https://evil.test' } }), await call('OPTIONS', '/spaces', { headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' } }), await call('GET', '/nope')]) {
      expect([...r.headers.keys()].filter((k) => k.startsWith('access-control'))).toEqual([])
      expect(r.headers.get('Strict-Transport-Security')).toContain('max-age')
      await r.text()
    }
  })
  it('IP ごとの制限は認証より前。Durable Object を起こさない', async () => {
    setup()
    const ip = freshIp()
    const res = await until429(120, () => call('GET', '/head', { auth: 'Bearer malformed', ip }))
    expect(res.status).toBe(429)
    // 正しいトークンでも、同じ IP なら認証の前に止まる
    expect((await call('GET', '/head', { token: 'A', ip })).status).toBe(429)
  })
  it('作成の回数を IP ごとに数える。v6 は /64', async () => {
    setup()
    const base = '2001:db8:1234:5678'
    expect((await until429(10, (i) => create('A', { ip: `${base}::${i + 1}` }))).status).toBe(429)
    expect((await create('A', { ip: '2001:db8:1234:9999::1' })).status).toBe(200)
  })
  it('読み取りだけの非常スイッチ', async () => {
    setup()
    await create('A')
    await push('A', [await record('1')])
    teardown()
    setup({ READ_ONLY: '1' })
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(200)
    expect((await call('GET', '/changes?since=0', { token: 'A' })).status).toBe(200)
    for (const r of [await push('A', [await record('2')]), await create('B'), await call('DELETE', '/space', { token: 'A' })]) {
      expect(r.status).toBe(503)
      expect(await errorOf(r)).toBe('read_only')
    }
  })
  it('領域ごとの回数: 分と日と since=0', async () => {
    setup({ RATE_PER_MINUTE: '20', RATE_PER_DAY: '25', FULL_PULL_PER_HOUR: '3' })
    await create('A')
    for (let i = 0; i < 20; i++) expect((await call('GET', '/head', { token: 'A', ip: freshIp() })).status).toBe(200)
    const over = await call('GET', '/head', { token: 'A', ip: freshIp() })
    expect(over.status).toBe(429)
    expect(await errorOf(over)).toBe('rate_limited')
    clock.now += 60_000
    for (let i = 0; i < 5; i++) expect((await call('GET', '/head', { token: 'A', ip: freshIp() })).status).toBe(200)
    expect((await call('GET', '/head', { token: 'A', ip: freshIp() })).status).toBe(429)
    clock.now += 24 * 60 * 60 * 1000
    expect((await call('GET', '/head', { token: 'A', ip: freshIp() })).status).toBe(200)
  })
})

describe('作成済み', () => {
  beforeEach(() => setup())
  afterEach(teardown)
  it('作成済みの領域への作成で中身が変わらない', async () => {
    const a = (await (await create('A')).json()) as { epoch: string }
    await push('A', [await record('1')])
    const again = await create('A')
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ epoch: a.epoch, created: false })
    const c = (await (await call('GET', '/changes?since=0', { token: 'A' })).json()) as { records: unknown[]; head: number; epoch: string }
    expect(c.records.length).toBe(1)
    expect(c.head).toBe(1)
    expect(c.epoch).toBe(a.epoch)
  })
})

describe('応答とログ', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    teardown()
  })
  it('応答とログにトークンと IP と space_id が出ない', async () => {
    setup()
    const log = vi.spyOn(console, 'log')
    const err = vi.spyOn(console, 'error')
    const warn = vi.spyOn(console, 'warn')
    const info = vi.spyOn(console, 'info')
    const token = await tokenOf('A')
    const id = await spaceIdOf('A')
    const ip = '203.0.113.77'
    const texts: string[] = []
    const keep = async (r: Response) => {
      texts.push(await r.text(), JSON.stringify([...r.headers]))
      return r
    }
    await keep(await create('A', { ip }))
    await keep(await push('A', [await record('1')], requestId(), { ip }))
    await keep(await call('GET', '/changes?since=0', { token: 'A', ip }))
    await keep(await call('GET', '/head', { token: 'A', ip }))
    await keep(await call('GET', '/space', { token: 'A', ip }))
    await keep(await call('GET', '/changes?since=x', { token: 'A', ip }))
    await keep(await call('GET', '/head', { auth: 'Bearer bad', ip }))
    await keep(await call('GET', '/nope', { token: 'A', ip }))
    await keep(await call('DELETE', '/space', { token: 'A', ip }))
    const logged = [...log.mock.calls, ...err.mock.calls, ...warn.mock.calls, ...info.mock.calls].flat().map(String).join('\n')
    expect(logged.length).toBeGreaterThan(0)
    for (const s of [...texts, logged]) {
      expect(s).not.toContain(token)
      expect(s).not.toContain(ip)
    }
    expect(logged).not.toContain(id)
    expect(texts.filter((t) => t.includes(id))).toEqual([])
  })
  it('内部の例外は 500 の決まった形で、スタックを返さず、種類だけを残す', async () => {
    setup()
    const err = vi.spyOn(console, 'error')
    const broken = { ...testEnv, SPACE: { getByName: () => { throw new Error(`secret ${'a'.repeat(64)}`) } } } as never
    const res = await worker.fetch(new Request(`${BASE}/head`, { headers: { Authorization: `Bearer ${await tokenOf('A')}`, 'CF-Connecting-IP': freshIp() } }), broken)
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"internal"}')
    expect(err.mock.calls.flat().join()).not.toContain('secret')
  })
})

describe('alarm', () => {
  afterEach(teardown)
  it('tombstone の片づけと放置削除は本物の alarm で動く', async () => {
    setup({ IDLE_DELETE_DAYS: '10', TOMB_GC_DAYS: '5' })
    const id = await spaceIdOf('A')
    await create('A')
    await push('A', [await record('t', { deleted: true }), await record('k')])
    const stub = asDo(spaceStub(id))
    clock.now += 5 * 24 * 60 * 60 * 1000
    await runDurableObjectAlarm(stub)
    const c = (await (await call('GET', '/changes?since=0', { token: 'A' })).json()) as { gc_floor: number; records: { record_id: string }[] }
    expect(c.gc_floor).toBe(1)
    expect(c.records.map((r) => r.record_id)).toEqual([await recordIdOf('k')])
    clock.now += 10 * 24 * 60 * 60 * 1000
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(404)
    expect((await spaceStub(id).info()).exists).toBe(false)
    expect(await runDurableObjectAlarm(stub)).toBe(false)
  })
})
