// 管理 API: 署名・再送・改ざん・時刻・404 の同一性・全削除の誤操作の防止
import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatHeader, signingString } from '../../src/admin/canonical.mjs'
import { sha256, toBase64Url, toHex, utf8 } from '../../src/encoding'
import { runtime } from '../../src/runtime'
import { BASE, call, clock, freshIp, ledger, push, record, setup, spaceIdOf, spaceStub, teardown } from './support'

const asDo = (s: unknown) => s as DurableObjectStub

interface Keys {
  id: string
  privateKey: CryptoKey
  publicRaw: string
}

async function makeKey(id: string): Promise<Keys> {
  const k = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return { id, privateKey: k.privateKey, publicRaw: toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer)) }
}

let nonceSeq = 0
const newNonce = () => toBase64Url(crypto.getRandomValues(new Uint8Array(16))) + (nonceSeq++).toString(36)

interface SignOptions {
  body?: string
  keys?: Keys
  /** 署名のあとで要求だけを変える */
  sentMethod?: string
  sentPath?: string
  sentBase?: string
  sentBody?: string
  ts?: number
  nonce?: string
  skewSec?: number
  ip?: string
}

async function signed(method: string, path: string, o: SignOptions = {}): Promise<Response> {
  const keys = o.keys ?? key1
  const url = new URL(BASE + path)
  const ts = o.ts ?? Math.floor(clock.now / 1000) + (o.skewSec ?? 0)
  const nonce = o.nonce ?? newNonce()
  const body = o.body ?? (method === 'POST' ? '{}' : '')
  const text = signingString({ method, host: url.host, path: url.pathname, query: url.search, bodySha256: toHex(await sha256(utf8(body))), timestamp: ts, nonce, keyId: keys.id })
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, utf8(text)))
  const sentBody = o.sentBody ?? body
  const sentMethod = o.sentMethod ?? method
  return await SELF.fetch(`${o.sentBase ?? BASE}${o.sentPath ?? path}`, {
    method: sentMethod,
    headers: {
      'X-OBB-Admin': formatHeader({ keyId: keys.id, timestamp: ts, nonce, signature: toBase64Url(sig) }),
      'CF-Connecting-IP': o.ip ?? freshIp(),
      ...(sentBody && { 'Content-Type': 'application/json' }),
    },
    ...(sentBody && sentMethod !== 'GET' && { body: sentBody }),
  })
}

let key1: Keys
let key2: Keys
let removed: Keys

beforeEach(async () => {
  key1 = await makeKey('k1')
  key2 = await makeKey('k2')
  removed = await makeKey('old')
  setup({ ADMIN_KEYS: JSON.stringify({ k1: key1.publicRaw, k2: key2.publicRaw }) })
})
afterEach(teardown)

/** 定義のないパスの応答と、本文とヘッダーまで同じこと */
async function expectHidden(res: Response): Promise<void> {
  const nope = await call('GET', '/definitely-not-defined')
  expect(res.status).toBe(404)
  expect(await res.text()).toBe(await nope.text())
  expect([...res.headers].sort()).toEqual([...nope.headers].sort())
}

const create = (t: string) => call('POST', '/spaces', { token: t, ip: freshIp() })

describe('署名', () => {
  it('正しい署名で通り、複数の鍵が使える', async () => {
    const r1 = await signed('GET', '/admin/v1/capacity')
    expect(r1.status).toBe(200)
    expect((await r1.json()) as object).toMatchObject({ limit: 100, used: 0, creation_open: true })
    expect((await signed('GET', '/admin/v1/capacity', { keys: key2 })).status).toBe(200)
  })
  it('署名なし・壊れた署名・登録のない鍵 ID・外した鍵は、定義のないパスと同じ 404', async () => {
    await expectHidden(await SELF.fetch(`${BASE}/admin/v1/capacity`, { headers: { 'CF-Connecting-IP': freshIp() } }))
    await expectHidden(await SELF.fetch(`${BASE}/admin/v1/capacity`, { headers: { 'X-OBB-Admin': 'kid=k1,ts=1,nonce=x,sig=y', 'CF-Connecting-IP': freshIp() } }))
    const good = await signed('GET', '/admin/v1/capacity', { nonce: newNonce() })
    await good.text()
    const ts = Math.floor(clock.now / 1000)
    const fake = formatHeader({ keyId: 'k1', timestamp: ts, nonce: newNonce(), signature: 'A'.repeat(86) })
    await expectHidden(await SELF.fetch(`${BASE}/admin/v1/capacity`, { headers: { 'X-OBB-Admin': fake, 'CF-Connecting-IP': freshIp() } }))
    await expectHidden(await signed('GET', '/admin/v1/capacity', { keys: removed }))
    await expectHidden(await signed('GET', '/admin/v1/capacity', { keys: { ...removed, id: 'k1' } }))
    // ほかの鍵の署名に鍵 ID だけを移しても通らない
    await expectHidden(await signed('GET', '/admin/v1/nothing'))
    await expectHidden(await signed('PUT', '/admin/v1/capacity'))
    await expectHidden(await SELF.fetch(`${BASE}/admin`, { headers: { 'CF-Connecting-IP': freshIp() } }))
  })
  it('公開鍵を環境変数から外すとすぐ効く', async () => {
    expect((await signed('GET', '/admin/v1/capacity')).status).toBe(200)
    runtime.overrides = { ...runtime.overrides, ADMIN_KEYS: JSON.stringify({ k2: key2.publicRaw }) }
    await expectHidden(await signed('GET', '/admin/v1/capacity'))
    expect((await signed('GET', '/admin/v1/capacity', { keys: key2 })).status).toBe(200)
  })
  it('ADMIN_KEYS が無い・壊れている環境では全部 404', async () => {
    runtime.overrides = { ...runtime.overrides, ADMIN_KEYS: 'broken' }
    await expectHidden(await signed('GET', '/admin/v1/capacity'))
    runtime.overrides = { ...runtime.overrides, ADMIN_KEYS: '{"k1":"short"}' }
    await expectHidden(await signed('GET', '/admin/v1/capacity'))
    runtime.overrides = { ...runtime.overrides, ADMIN_KEYS: '{"__proto__":"x"}' }
    await expectHidden(await signed('GET', '/admin/v1/capacity', { keys: { ...key1, id: '__proto__' } }))
  })
  it('同じ nonce の再送は 404。処理は 1 回だけ', async () => {
    const nonce = newNonce()
    expect((await signed('POST', '/admin/v1/creation', { body: '{"open":false}', nonce })).status).toBe(200)
    await expectHidden(await signed('POST', '/admin/v1/creation', { body: '{"open":false}', nonce }))
    await expectHidden(await signed('POST', '/admin/v1/creation', { body: '{"open":true}', nonce }))
    const cap = (await (await signed('GET', '/admin/v1/capacity')).json()) as { creation_open: boolean }
    expect(cap.creation_open).toBe(false)
    const audit = (await (await signed('GET', '/admin/v1/audit')).json()) as { entries: { action: string }[] }
    expect(audit.entries.filter((e) => e.action === 'creation').length).toBe(1)
  })
  it('nonce の短いものは断り、5 分たつと台帳から消える', async () => {
    await expectHidden(await signed('GET', '/admin/v1/capacity', { nonce: 'short' }))
    const nonce = newNonce()
    expect((await signed('GET', '/admin/v1/capacity', { nonce })).status).toBe(200)
    clock.now += 5 * 60 * 1000
    await (await signed('GET', '/admin/v1/capacity')).text()
    const left = await runInDurableObject(asDo(ledger()), (_o, state) => state.storage.sql.exec('SELECT 1 FROM nonces WHERE nonce = ?', nonce).toArray().length)
    expect(left).toBe(0)
  })
  it('時刻: 59 秒・60 秒のずれは通り、61 秒のずれは 404', async () => {
    for (const s of [59, -59, 60, -60]) expect((await signed('GET', '/admin/v1/capacity', { skewSec: s })).status, String(s)).toBe(200)
    await expectHidden(await signed('GET', '/admin/v1/capacity', { skewSec: 61 }))
    await expectHidden(await signed('GET', '/admin/v1/capacity', { skewSec: -61 }))
  })
  it('method・host・path・query・本文の 1 文字を変えると 404', async () => {
    await create('A')
    await expectHidden(await signed('GET', `/admin/v1/spaces/${await spaceIdOf('A')}`, { sentMethod: 'DELETE' }))
    await expectHidden(await signed('GET', '/admin/v1/capacity', { sentBase: 'https://other.test' }))
    await expectHidden(await signed('GET', '/admin/v1/capacity', { sentPath: '/admin/v1/signals' }))
    await expectHidden(await signed('GET', '/admin/v1/spaces?limit=1', { sentPath: '/admin/v1/spaces?limit=2' }))
    await expectHidden(await signed('GET', '/admin/v1/spaces', { sentPath: '/admin/v1/spaces?limit=2' }))
    await expectHidden(await signed('POST', '/admin/v1/creation', { body: '{"open":false}', sentBody: '{"open":true }' }))
    await expectHidden(await signed('POST', '/admin/v1/creation', { body: '{"open":false}', sentBody: '{"open":true}' }))
    const cap = (await (await signed('GET', '/admin/v1/capacity')).json()) as { creation_open: boolean }
    expect(cap.creation_open).toBe(true)
  })
  it('クエリの順番は署名の中で並べ替える', async () => {
    expect((await signed('GET', '/admin/v1/spaces?sort=created&limit=1', { sentPath: '/admin/v1/spaces?limit=1&sort=created' })).status).toBe(200)
  })
  it('http・大きすぎる本文・レート制限も 404', async () => {
    await expectHidden(await signed('GET', '/admin/v1/capacity', { sentBase: 'http://sync.test' }))
    await expectHidden(await signed('POST', '/admin/v1/creation', { body: 'x'.repeat(256 * 1024 + 1) }))
    const ip = freshIp()
    let last = await signed('GET', '/admin/v1/capacity', { ip })
    // 窓は固定の 60 秒。境目をまたいでも必ず超えるよう上限の 3 倍まで送る
    for (let i = 0; i < 180 && last.status === 200; i++) {
      await last.text()
      last = await signed('GET', '/admin/v1/capacity', { ip })
    }
    await expectHidden(last)
  })
})

describe('一覧と詳細', () => {
  it('一覧のカーソルと並べ方。応答に中身と鍵がない', async () => {
    await create('A')
    clock.now += 1000
    await create('B')
    clock.now += 1000
    await create('C')
    await push('A', [await record('1')])
    const first = (await (await signed('GET', '/admin/v1/spaces?limit=2&sort=created')).json()) as { spaces: { space_id: string }[]; next_cursor: string }
    expect(first.spaces.length).toBe(2)
    const next = (await (await signed('GET', `/admin/v1/spaces?limit=2&sort=created&cursor=${first.next_cursor}`)).json()) as { spaces: { space_id: string }[]; next_cursor: null }
    expect(next.spaces.length).toBe(1)
    expect(next.next_cursor).toBeNull()
    expect((await signed('GET', '/admin/v1/spaces?sort=evil')).status).toBe(400)
    expect((await signed('GET', "/admin/v1/spaces?cursor=1'--")).status).toBe(400)
    const id = await spaceIdOf('A')
    const res = await signed('GET', `/admin/v1/spaces/${id}`)
    const text = await res.text()
    const d = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(d).sort()).toEqual(['created_at', 'last_access_at', 'last_access_day', 'live', 'record_count', 'req_recent', 'source_mac', 'space_id', 'state', 'used_bytes'])
    expect(d.live).toMatchObject({ exists: true, record_count: 1 })
    expect(text).not.toContain('ciphertext')
    expect(text).not.toContain('nonce')
    expect((await signed('GET', `/admin/v1/spaces/${'0'.repeat(64)}`)).status).toBe(404)
  })
})

describe('削除', () => {
  it('1 件の削除で Durable Object の中身まで消え、再作成は断らない', async () => {
    await create('A')
    await push('A', [await record('1')])
    const id = await spaceIdOf('A')
    const res = await signed('DELETE', `/admin/v1/spaces/${id}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { job: { state: string } }).job.state).toBe('done')
    await runInDurableObject(asDo(spaceStub(id)), async (_o, state) => {
      expect(await state.storage.getAlarm()).toBeNull()
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('meta', 'records')").one().n).toBe(0)
    })
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(404)
    expect((await create('A')).status).toBe(201)
  })
  it('複数の削除: 数が違えば 409 で何もしない', async () => {
    await create('A')
    await create('B')
    const ids = [await spaceIdOf('A'), await spaceIdOf('B'), '0'.repeat(64)]
    const wrong = await signed('POST', '/admin/v1/spaces/delete', { body: JSON.stringify({ ids, expected_count: 3 }) })
    expect(wrong.status).toBe(409)
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(200)
    const ok = await signed('POST', '/admin/v1/spaces/delete', { body: JSON.stringify({ ids, expected_count: 2 }) })
    expect(ok.status).toBe(202)
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(404)
    expect((await call('GET', '/head', { token: 'B' })).status).toBe(404)
    for (const b of [{ ids: ['x'], expected_count: 1 }, { ids: [], expected_count: 0 }, { ids: ids, expected_count: -1 }, { ids: ids }, { ids, expected_count: 1, x: 1 }]) {
      expect((await signed('POST', '/admin/v1/spaces/delete', { body: JSON.stringify(b) })).status, JSON.stringify(b)).toBe(400)
    }
  })
  it('全削除: expected_count の違いと確認の文字列の違いでは何もしない', async () => {
    await create('A')
    await create('B')
    const send = (b: unknown) => signed('POST', '/admin/v1/spaces/delete-all', { body: JSON.stringify(b) })
    const wrong = await send({ expected_count: 3, confirm: 'DELETE ALL 3 SPACES' })
    expect(wrong.status).toBe(409)
    expect(await wrong.json()).toEqual({ error: 'count_mismatch', actual: 2 })
    for (const confirm of ['DELETE ALL 3 SPACES', 'delete all 2 spaces', 'DELETE ALL 2 SPACES ', 'DELETE ALL SPACES', '']) expect((await send({ expected_count: 2, confirm })).status, confirm).toBe(400)
    expect((await send({ expected_count: 2 })).status).toBe(400)
    expect((await send({ confirm: 'DELETE ALL 2 SPACES' })).status).toBe(400)
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(200)
    expect((await call('GET', '/head', { token: 'B' })).status).toBe(200)
    const ok = await send({ expected_count: 2, confirm: 'DELETE ALL 2 SPACES' })
    expect(ok.status).toBe(202)
    const job = ((await ok.json()) as { job: { id: string; state: string; done: number; total: number } }).job
    expect(job).toMatchObject({ state: 'done', done: 2, total: 2 })
    const seen = (await (await signed('GET', `/admin/v1/jobs/${job.id}`)).json()) as { job: { state: string } }
    expect(seen.job.state).toBe('done')
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(404)
  })
  it('全削除は始めた時点の一覧だけ。後から作られた領域は残る', async () => {
    runtime.overrides = { ...runtime.overrides, JOB_BATCH: '1' }
    await create('A')
    await create('B')
    await create('C')
    await push('C', [await record('1')])
    const res = await signed('POST', '/admin/v1/spaces/delete-all', { body: JSON.stringify({ expected_count: 3, confirm: 'DELETE ALL 3 SPACES' }) })
    const job = ((await res.json()) as { job: { id: string; state: string; done: number } }).job
    expect(job).toMatchObject({ state: 'running', done: 1 })
    expect((await create('NEW')).status).toBe(201)
    for (let i = 0; i < 5; i++) await runDurableObjectAlarm(asDo(ledger()))
    const after = ((await (await signed('GET', `/admin/v1/jobs/${job.id}`)).json()) as { job: { state: string; done: number } }).job
    expect(after).toMatchObject({ state: 'done', done: 3 })
    expect((await call('GET', '/head', { token: 'NEW' })).status).toBe(200)
    for (const t of ['A', 'B', 'C']) expect((await call('GET', '/head', { token: t })).status, t).toBe(404)
    const cap = (await (await signed('GET', '/admin/v1/capacity')).json()) as { active: number; deleting: number }
    expect(cap).toMatchObject({ active: 1, deleting: 0 })
  })
  it('削除の途中で作り直された領域は消さない', async () => {
    runtime.overrides = { ...runtime.overrides, JOB_BATCH: '1' }
    await create('A')
    await create('B')
    const res = await signed('POST', '/admin/v1/spaces/delete-all', { body: JSON.stringify({ expected_count: 2, confirm: 'DELETE ALL 2 SPACES' }) })
    const job = ((await res.json()) as { job: { id: string } }).job
    // どちらかがもう消えている。消えた方を作り直す
    const a = await spaceStub(await spaceIdOf('A')).info()
    const gone = a.exists ? 'B' : 'A'
    const left = a.exists ? 'A' : 'B'
    expect((await create(gone)).status).toBe(201)
    // 残っている方は実体がまだあるので 200 になる。消される前に作成を送っても、後で消えて端末が作り直す
    await runDurableObjectAlarm(asDo(ledger()))
    await runDurableObjectAlarm(asDo(ledger()))
    expect((await call('GET', '/head', { token: gone })).status).toBe(200)
    expect((await call('GET', '/head', { token: left })).status).toBe(404)
    expect(((await (await signed('GET', `/admin/v1/jobs/${job.id}`)).json()) as { job: { state: string } }).job.state).toBe('done')
  })
  it('実体が消えた後、台帳の片づけの前に作り直された領域は消さない', async () => {
    await create('A')
    const id = await spaceIdOf('A')
    let fails = 1
    await runInDurableObject(asDo(ledger()), (o) => {
      const t = o as unknown as { wipeSpace: (i: string, e: string | null) => Promise<void> }
      const real = t.wipeSpace.bind(o)
      t.wipeSpace = async (i, e) => {
        // 消せたのに結果が届かなかった、という失敗
        await real(i, e)
        if (fails-- > 0) throw new Error('lost')
      }
    })
    const res = await signed('DELETE', `/admin/v1/spaces/${id}`)
    const job = ((await res.json()) as { job: { id: string; state: string } }).job
    expect(job.state).toBe('running')
    expect((await spaceStub(id).info()).exists).toBe(false)
    expect((await create('A')).status).toBe(201)
    await push('A', [await record('1')])
    await runDurableObjectAlarm(asDo(ledger()))
    expect((await spaceStub(id).info()).exists).toBe(true)
    expect((await spaceStub(id).info()).record_count).toBe(1)
    const after = ((await (await signed('GET', `/admin/v1/jobs/${job.id}`)).json()) as { job: { state: string } }).job
    expect(after.state).toBe('done')
    const cap = (await (await signed('GET', '/admin/v1/capacity')).json()) as { active: number; deleting: number }
    expect(cap).toMatchObject({ active: 1, deleting: 0 })
  })
  it('途中の失敗から台帳の alarm がやり直し、枠は最後に空く', async () => {
    runtime.overrides = { ...runtime.overrides, SPACE_LIMIT: '1' }
    await create('A')
    const id = await spaceIdOf('A')
    let fails = 2
    await runInDurableObject(asDo(ledger()), (o) => {
      const real = (o as unknown as { wipeSpace: (i: string, e: string | null) => Promise<void> }).wipeSpace.bind(o)
      ;(o as unknown as { wipeSpace: (i: string, e: string | null) => Promise<void> }).wipeSpace = async (i, e) => {
        if (fails-- > 0) throw new Error('down')
        await real(i, e)
      }
    })
    const res = await signed('DELETE', `/admin/v1/spaces/${id}`)
    const job = ((await res.json()) as { job: { id: string; state: string; failures: number } }).job
    expect(job).toMatchObject({ state: 'running', failures: 1 })
    expect((await create('B')).status).toBe(403)
    await runDurableObjectAlarm(asDo(ledger()))
    expect((await spaceStub(id).info()).exists).toBe(true)
    await runDurableObjectAlarm(asDo(ledger()))
    expect((await spaceStub(id).info()).exists).toBe(false)
    const after = ((await (await signed('GET', `/admin/v1/jobs/${job.id}`)).json()) as { job: { state: string; failures: number } }).job
    expect(after).toMatchObject({ state: 'done', failures: 2 })
    expect((await create('B')).status).toBe(201)
  })
})

describe('作成の停止・締め出し・判断材料・監査', () => {
  it('新規作成の停止と再開。既存の領域は動く', async () => {
    await create('A')
    expect((await signed('POST', '/admin/v1/creation', { body: '{"open":false}' })).status).toBe(200)
    const r = await create('B')
    expect(r.status).toBe(403)
    expect(((await r.json()) as { error: string }).error).toBe('creation_closed')
    expect((await create('A')).status).toBe(200)
    expect((await push('A', [await record('1')])).status).toBe(200)
    expect((await signed('POST', '/admin/v1/creation', { body: '{"open":true}' })).status).toBe(200)
    expect((await create('B')).status).toBe(201)
    expect((await signed('POST', '/admin/v1/creation', { body: '{"open":"x"}' })).status).toBe(400)
  })
  it('作成元の締め出しと解除。判断材料から値が分かる', async () => {
    const ip = freshIp()
    await call('POST', '/spaces', { token: 'A', ip })
    const signals = (await (await signed('GET', '/admin/v1/signals')).json()) as { sources: { mac: string; created: number }[]; hourly: unknown[]; top_usage: unknown[]; top_requests: unknown[]; unused: unknown[] }
    expect(signals.sources.length).toBe(1)
    expect(signals.hourly.length).toBe(1)
    const mac = signals.sources[0].mac
    expect(mac).toMatch(/^[0-9a-f]{64}$/)
    expect((await signed('POST', '/admin/v1/sources/block', { body: JSON.stringify({ value: mac }) })).status).toBe(200)
    const blocked = await call('POST', '/spaces', { token: 'B', ip })
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { error: string }).error).toBe('creation_closed')
    expect((await call('POST', '/spaces', { token: 'B', ip: freshIp() })).status).toBe(201)
    expect((await signed('DELETE', `/admin/v1/sources/block/${mac}`)).status).toBe(200)
    expect((await call('POST', '/spaces', { token: 'C', ip })).status).toBe(201)
    expect((await signed('POST', '/admin/v1/sources/block', { body: JSON.stringify({ value: 'x' }) })).status).toBe(400)
    expect((await signed('POST', '/admin/v1/sources/block', { body: JSON.stringify({ value: mac, days: 15 }) })).status).toBe(400)
  })
  it('締め出しは期限で切れる', async () => {
    const ip = freshIp()
    await call('POST', '/spaces', { token: 'A', ip })
    const mac = ((await (await signed('GET', '/admin/v1/signals')).json()) as { sources: { mac: string }[] }).sources[0].mac
    await signed('POST', '/admin/v1/sources/block', { body: JSON.stringify({ value: mac, days: 1 }) })
    clock.now += 24 * 60 * 60 * 1000
    expect((await call('POST', '/spaces', { token: 'B', ip })).status).toBe(201)
  })
  it('監査ログに鍵 ID・操作・対象・時刻が残り、IP が残らない', async () => {
    await create('A')
    const id = await spaceIdOf('A')
    const ip = '198.18.5.5'
    await signed('DELETE', `/admin/v1/spaces/${id}`, { ip, keys: key2 })
    await signed('POST', '/admin/v1/spaces/delete-all', { body: JSON.stringify({ expected_count: 0, confirm: 'DELETE ALL 0 SPACES' }), ip })
    const res = await signed('GET', '/admin/v1/audit?limit=10')
    const text = await res.text()
    const a = JSON.parse(text) as { entries: { key_id: string; action: string; target: string; at: number; status: number | null }[] }
    expect(a.entries.map((e) => e.action)).toEqual(['audit', 'spaces.delete_all', 'spaces.delete'])
    expect(a.entries[2]).toMatchObject({ key_id: 'k2', target: id, status: 200, at: clock.now })
    expect(a.entries[1]).toMatchObject({ key_id: 'k1', target: 'count:0', status: 202 })
    expect(text).not.toContain(ip)
    const stored = await runInDurableObject(asDo(ledger()), (_o, state) => JSON.stringify(state.storage.sql.exec('SELECT * FROM audit').toArray()))
    expect(stored).not.toContain(ip)
  })
})
