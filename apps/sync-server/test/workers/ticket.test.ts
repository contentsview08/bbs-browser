// 許可証と同期を始めるページ。docs/sync-security.md の否定のテストの一覧
import { runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../src/index'
import { sha256, toBase64Url, utf8 } from '../../src/encoding'
import { runtime } from '../../src/runtime'
import { checkStartQuery, TICKET_RETURN_URL } from '../../src/start'
import { checkTicket, issueTicket, parseTicketKeys } from '../../src/ticket'
import { isTestSecret } from '../../src/turnstile'
import ticketFile from '../../../../packages/conformance/sync-ticket.json'
import { BASE, call, clock, freshIp, ledger, setup, spaceIdOf, spaceStub, teardown, testEnv, ticketOf, TICKET_KEY, TICKET_KID, until429 } from './support'

const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error
const SPACE = 'a'.repeat(64)
const ask = (turnstile: string, space_id = SPACE, o = {}) => call('POST', '/tickets', { body: JSON.stringify({ turnstile, space_id }), ...o })
const create = async (token: string, ticket: string, o = {}) => await call('POST', '/spaces', { token, body: JSON.stringify({ ticket }), ...o })
const verifyWith = (v: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(v), { status }))

describe('許可証の確認(共通の表)', () => {
  const keys = parseTicketKeys(JSON.stringify({ [ticketFile.key.kid]: ticketFile.key.secret })) as Map<string, Uint8Array>
  it.each(ticketFile.cases)('$name', async (c) => {
    expect(await checkTicket(keys, c.space_id, c.now_ms, c.ticket)).toBe(c.result)
  })
  it('発行した形が共通の表と同じ', async () => {
    const c = ticketFile.cases[0]
    const exp = Number(c.ticket.split('.')[2])
    expect(await issueTicket(keys.get(ticketFile.key.kid) as Uint8Array, ticketFile.key.kid, c.space_id, exp)).toBe(c.ticket)
  })
  it('鍵の設定が読めなければ全部を捨てる', () => {
    const good = ticketFile.key.secret
    for (const raw of ['', 'x', '[]', 'null', '{}', '{"k":1}', '{"k":"c2hvcnQ"}', `{"bad.id":"${good}"}`, `{"k":"${good}","j":"c2hvcnQ"}`]) expect(parseTicketKeys(raw), raw).toBeNull()
    expect(parseTicketKeys(`{"k":"${good}","j":"${good}"}`)?.size).toBe(2)
  })
})

describe('POST /spaces の許可証', () => {
  afterEach(teardown)
  it('なし・改ざん・別の領域・期限切れ。領域を作らない', async () => {
    setup()
    expect(await errorOf(await call('POST', '/spaces', { token: 'A', body: '{}' }))).toBe('ticket_required')
    const good = await ticketOf('A')
    const flipped = good.replace(/.$/, (c) => (c === 'A' ? 'E' : 'A'))
    expect(await errorOf(await create('A', flipped))).toBe('ticket_invalid')
    expect(await errorOf(await create('A', good.replace(/\.(\d+)\./, (_m, n) => `.${Number(n) + 1}.`)))).toBe('ticket_invalid')
    expect(await errorOf(await create('A', await ticketOf('B')))).toBe('ticket_invalid')
    expect(await errorOf(await create('A', 'garbage'))).toBe('ticket_invalid')
    expect(await errorOf(await create('A', await ticketOf('A', -1000)))).toBe('ticket_expired')
    expect(await errorOf(await create('A', await ticketOf('A', 0)))).toBe('ticket_expired')
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(404)
  })
  it('期限の境目', async () => {
    setup()
    const t = await ticketOf('A', 60_000)
    clock.now += 59_000
    expect((await create('A', t)).status).toBe(201)
    await call('DELETE', '/space', { token: 'A' })
    clock.now += 1_000
    expect(await errorOf(await create('A', t))).toBe('ticket_expired')
  })
  it('トークンの所持の確認が先。許可証だけでは作れない', async () => {
    setup()
    const t = await ticketOf('A')
    expect((await call('POST', '/spaces', { body: JSON.stringify({ ticket: t }) })).status).toBe(401)
    expect(await errorOf(await create('other', t))).toBe('ticket_invalid')
  })
  it('許可証を確かめてから PoW の問題を出す', async () => {
    setup({ POW_BITS: '6' })
    expect(await errorOf(await call('POST', '/spaces', { token: 'A', body: '{}' }))).toBe('ticket_required')
    const r = (await (await create('A', await ticketOf('A'))).json()) as { error: string; pow?: unknown }
    expect(r.error).toBe('pow_required')
    expect(r.pow).toBeTruthy()
  })
  it('古い鍵: 登録を外すと断り、残している間は新しい署名と両方通る', async () => {
    const oldKey = crypto.getRandomValues(new Uint8Array(32))
    const b64 = (b: Uint8Array) => toBase64Url(b)
    const both = JSON.stringify({ old: b64(oldKey), [TICKET_KID]: b64(TICKET_KEY) })
    setup({ TICKET_KEYS: both })
    const exp = Math.floor(runtime.now() / 1000) + 3600
    const oldTicket = await issueTicket(oldKey, 'old', await spaceIdOf('A'), exp)
    expect((await create('A', oldTicket)).status).toBe(201)
    expect((await create('B', await ticketOf('B'))).status).toBe(201)
    await call('DELETE', '/space', { token: 'A' })
    runtime.overrides = { ...runtime.overrides, TICKET_KEYS: JSON.stringify({ [TICKET_KID]: b64(TICKET_KEY) }) }
    expect(await errorOf(await create('A', oldTicket))).toBe('ticket_invalid')
    // 同じ鍵 ID でも鍵が違えば通らない
    const forged = await issueTicket(oldKey, TICKET_KID, await spaceIdOf('A'), exp)
    expect(await errorOf(await create('A', forged))).toBe('ticket_invalid')
  })
  it('鍵の設定がなければ作成を止める', async () => {
    setup({ TICKET_KEYS: '' })
    const res = await create('A', 'x')
    expect(res.status).toBe(503)
    expect(await errorOf(res)).toBe('unavailable')
    setup({ TICKET_KEYS: '{"k":"short"}' })
    expect((await create('A', 'x')).status).toBe(503)
  })
  it('サーバーは許可証を保存しない。作成の前後で台帳と領域に残らない', async () => {
    setup()
    const t = await ticketOf('A')
    const res = await create('A', t)
    expect(res.status).toBe(201)
    expect(JSON.stringify(await res.clone().json())).not.toContain(t)
    const sig = t.split('.')[4]
    const dump = (state: DurableObjectState) => {
      const tables = state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'").toArray()
      return tables.map((r) => JSON.stringify(state.storage.sql.exec(`SELECT * FROM "${r.name}"`).toArray())).join()
    }
    for (const stub of [ledger(), spaceStub(await spaceIdOf('A'))]) {
      const text = await runInDurableObject(stub as unknown as DurableObjectStub, (_o, state) => dump(state))
      expect(text).not.toContain(sig)
    }
  })
})

describe('POST /tickets', () => {
  afterEach(teardown)
  it('通ると署名した許可証を返す。応答にトークンを求めない', async () => {
    setup()
    const res = await ask('test-pass', await spaceIdOf('A'))
    expect(res.status).toBe(200)
    const v = (await res.json()) as { ticket: string; exp: number }
    expect(v.exp).toBe(Math.floor((clock.now + 365 * 86_400_000) / 1000))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect((await create('A', v.ticket)).status).toBe(201)
  })
  it('期限は環境変数で変わる', async () => {
    setup({ TICKET_TTL_DAYS: '2' })
    const v = (await (await ask('test-pass')).json()) as { exp: number }
    expect(v.exp).toBe(Math.floor((clock.now + 2 * 86_400_000) / 1000))
  })
  it('Turnstile の失敗・再利用は 403', async () => {
    setup()
    for (const t of ['test-fail', 'test-spent', 'whatever']) {
      const res = await ask(t)
      expect(res.status, t).toBe(403)
      expect(await errorOf(res)).toBe('turnstile_invalid')
    }
  })
  it('再利用は検証サービスの答えのとおり、2 回目を断る', async () => {
    setup()
    const seen = new Set<string>()
    runtime.fetch = async (_i, init) => {
      const t = new URLSearchParams(init.body as string).get('response') as string
      const dup = seen.has(t)
      seen.add(t)
      return Response.json(dup ? { success: false, 'error-codes': ['timeout-or-duplicate'] } : { success: true, hostname: 'sync.test', action: 'create-space' })
    }
    expect((await ask('once')).status).toBe(200)
    expect(await errorOf(await ask('once'))).toBe('turnstile_invalid')
  })
  it('hostname と action が違えば断る', async () => {
    setup()
    runtime.fetch = verifyWith({ success: true, hostname: 'evil.test', action: 'create-space' })
    expect(await errorOf(await ask('t'))).toBe('turnstile_invalid')
    runtime.fetch = verifyWith({ success: true, hostname: 'sync.test', action: 'other' })
    expect(await errorOf(await ask('t'))).toBe('turnstile_invalid')
    runtime.fetch = verifyWith({ success: true, hostname: 'sync.test' })
    expect(await errorOf(await ask('t'))).toBe('turnstile_invalid')
    setup({ TURNSTILE_HOSTNAME: 'obb.example' })
    runtime.fetch = verifyWith({ success: true, hostname: 'sync.test', action: 'create-space' })
    expect(await errorOf(await ask('t'))).toBe('turnstile_invalid')
    runtime.fetch = verifyWith({ success: true, hostname: 'obb.example', action: 'create-space' })
    expect((await ask('t')).status).toBe(200)
  })
  it('検証サービスの障害では発行を止め、既存の同期は続く', async () => {
    setup()
    await call('POST', '/spaces', { token: 'A' })
    const down = [
      async () => { throw new Error('down') },
      async () => new Response('bad', { status: 500 }),
      async () => new Response('not json', { status: 200 }),
      verifyWith({ success: false, 'error-codes': ['internal-error'] }),
      verifyWith({ success: false, 'error-codes': ['invalid-input-secret'] }),
      verifyWith({ success: false }),
    ]
    for (const f of down) {
      runtime.fetch = f
      const res = await ask('t')
      expect(res.status).toBe(503)
      expect(await errorOf(res)).toBe('turnstile_unavailable')
    }
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(200)
    // 許可証を持っていれば、障害の間も作り直せる
    expect((await create('B', await ticketOf('B'))).status).toBe(201)
  })
  it('検証サービスへ秘密とトークンだけを送る。space_id と IP を渡さない', async () => {
    setup()
    const f = vi.fn(async (_i: string, _init: RequestInit) => Response.json({ success: true, hostname: 'sync.test', action: 'create-space' }))
    runtime.fetch = f
    await ask('tok', SPACE, { ip: '198.51.100.77' })
    const sent = new URLSearchParams(f.mock.calls[0][1].body as string)
    expect([...sent.keys()].sort()).toEqual(['response', 'secret'])
    expect(f.mock.calls[0][1].body).not.toContain(SPACE)
  })
  it('秘密・鍵・署名の鍵 ID がなければ発行を止める', async () => {
    setup({ TICKET_KEYS: '' })
    expect((await ask('test-pass')).status).toBe(503)
    setup({ TICKET_KID: 'none' })
    expect((await ask('test-pass')).status).toBe(503)
    setup()
    const body = JSON.stringify({ turnstile: 'test-pass', space_id: SPACE })
    const res = await worker.fetch(new Request(`${BASE}/tickets`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'CF-Connecting-IP': freshIp() }, body }), { ...testEnv, TURNSTILE_SECRET: undefined })
    expect(res.status).toBe(503)
  })
  it('テスト用の秘密は印のある環境でだけ受け付け、そのとき hostname と action を見ない', async () => {
    const secret = '1x0000000000000000000000000000000AA'
    expect(isTestSecret(secret)).toBe(true)
    const send = async () => {
      const body = JSON.stringify({ turnstile: 'XXXX.DUMMY.TOKEN.XXXX', space_id: SPACE })
      return await worker.fetch(new Request(`${BASE}/tickets`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'CF-Connecting-IP': freshIp() }, body }), { ...testEnv, TURNSTILE_SECRET: secret })
    }
    setup()
    const f = verifyWith({ success: true, hostname: 'example.com' })
    runtime.fetch = f
    expect((await send()).status).toBe(503)
    expect(f).not.toHaveBeenCalled()
    setup({ TURNSTILE_TEST_KEYS: '1' })
    runtime.fetch = f
    expect((await send()).status).toBe(200)
    // 本物の秘密では、印があっても確かめる
    setup({ TURNSTILE_TEST_KEYS: '1' })
    runtime.fetch = verifyWith({ success: true, hostname: 'example.com' })
    expect(await errorOf(await ask('t'))).toBe('turnstile_invalid')
  })
  it('形の検査。本文の上限。Content-Type', async () => {
    setup()
    const post = (body: string, o = {}) => call('POST', '/tickets', { body, ...o })
    for (const b of ['{broken', '[]', '{}', '{"turnstile":"t"}', `{"space_id":"${SPACE}"}`, `{"turnstile":"","space_id":"${SPACE}"}`, `{"turnstile":1,"space_id":"${SPACE}"}`, '{"turnstile":"t","space_id":"xyz"}', `{"turnstile":"t","space_id":"${'A'.repeat(64)}"}`, `{"turnstile":"t","space_id":"${SPACE}","x":1}`, `{"turnstile":"${'t'.repeat(2049)}","space_id":"${SPACE}"}`]) expect((await post(b)).status, b.slice(0, 40)).toBe(400)
    expect((await post(`{"turnstile":"${'t'.repeat(5000)}","space_id":"${SPACE}"}`)).status).toBe(413)
    expect((await post('{}', { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await post('{}', { headers: { 'Content-Encoding': 'gzip' } })).status).toBe(415)
    expect((await call('GET', '/tickets')).status).toBe(405)
    expect((await call('OPTIONS', '/tickets')).status).toBe(405)
    expect((await call('POST', '/tickets', { body: '{}', base: 'http://sync.test' })).status).toBe(400)
  })
  it('IP ごとに制限する', async () => {
    setup()
    const ip = freshIp()
    expect((await until429(10, () => ask('test-fail', SPACE, { ip }))).status).toBe(429)
    expect((await ask('test-fail', SPACE, { ip: freshIp() })).status).toBe(403)
  })
  it('応答に CORS のヘッダーを出さない。読み取りだけの間も発行は書き込みがないので通る', async () => {
    setup({ READ_ONLY: '1' })
    const res = await ask('test-pass', SPACE, { headers: { Origin: 'https://evil.test' } })
    expect(res.status).toBe(200)
    for (const k of res.headers.keys()) expect(k.toLowerCase().startsWith('access-control')).toBe(false)
  })
  it('トークンとは別の入口。Authorization を読まない', async () => {
    setup()
    expect((await ask('test-pass', SPACE, { auth: 'Bearer nonsense' })).status).toBe(200)
  })
})

describe('GET /start', () => {
  afterEach(teardown)
  const open = async (q = `?space_id=${SPACE}&return=app`, o = {}) => await call('GET', `/start${q}`, o)
  const inlineScript = (html: string) => /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] as string
  it('外部のスクリプトは Turnstile だけ。CSP の中身', async () => {
    setup()
    const res = await open()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    const html = await res.text()
    expect([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])).toEqual(['https://challenges.cloudflare.com/turnstile/v0/api.js'])
    expect([...html.matchAll(/<script/g)].length).toBe(2)
    expect(html).not.toMatch(/<(img|link|iframe|form|object|embed)\b/)
    const csp = Object.fromEntries((res.headers.get('Content-Security-Policy') as string).split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]))
    const digest = btoa(String.fromCharCode(...(await sha256(utf8(inlineScript(html))))))
    expect(csp['default-src']).toBe("'none'")
    expect(csp['script-src']).toBe(`'sha256-${digest}' https://challenges.cloudflare.com`)
    expect(csp['frame-src']).toBe('https://challenges.cloudflare.com')
    expect(csp['connect-src']).toBe("'self' https://challenges.cloudflare.com")
    expect(csp['base-uri']).toBe("'none'")
    expect(csp['form-action']).toBe("'none'")
    expect(csp['frame-ancestors']).toBe("'none'")
    expect(csp['script-src']).not.toContain('unsafe')
  })
  it('Referer・枠・キャッシュ', async () => {
    setup()
    const res = await open()
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Strict-Transport-Security')).toBeTruthy()
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
  it('サイトキーと action を渡す。問い合わせの値をページに書かない', async () => {
    setup()
    const html = await (await open()).text()
    expect(html).toContain('data-sitekey="test-sitekey"')
    expect(html).toContain('data-action="create-space"')
    expect(html).not.toContain(SPACE)
    expect(html).toContain(TICKET_RETURN_URL)
    // 受け渡しの先は固定。問い合わせで変えられない
    expect(TICKET_RETURN_URL.endsWith('.invalid/ticket')).toBe(true)
  })
  it('リターンの形は決まった値だけ。別の URL へ返させない', async () => {
    setup()
    for (const q of ['', `?space_id=${SPACE}`, '?return=app', '?space_id=xyz&return=app', `?space_id=${SPACE}&return=https://evil.test`, `?space_id=${SPACE}&return=app&x=1`, `?space_id=${SPACE}&space_id=${SPACE}&return=app`, `?space_id=<script>&return=app`]) {
      const res = await open(q)
      expect(res.status, q).toBe(400)
      expect(await res.text()).toBe('{"error":"bad_request"}')
    }
    expect(checkStartQuery(`?return=app&space_id=${SPACE}`)).toBe(true)
  })
  it('サイトキーがない・形が違うときはページを出さない', async () => {
    setup({ TURNSTILE_SITEKEY: '' })
    expect((await open()).status).toBe(503)
    setup({ TURNSTILE_SITEKEY: 'x"><script>' })
    expect((await open()).status).toBe(503)
  })
  it('GET だけ。http と許可のないホストを断る', async () => {
    setup()
    expect((await call('POST', `/start?space_id=${SPACE}&return=app`, { body: '{}' })).status).toBe(405)
    expect((await call('GET', `/start?space_id=${SPACE}&return=app`, { base: 'http://sync.test' })).status).toBe(400)
    setup({ ALLOWED_HOSTS: 'obb.example' })
    expect((await open()).status).toBe(404)
  })
  it('IP ごとの制限の下にある', async () => {
    setup()
    const ip = freshIp()
    expect((await until429(120, () => open(undefined, { ip }))).status).toBe(429)
  })
})

describe('作り直し', () => {
  afterEach(teardown)
  it('押し出しのあと、Turnstile を呼ばず同じ許可証で作り直す', async () => {
    setup({ SPACE_LIMIT: '1', EVICT_IDLE_DAYS: '14' })
    const f = vi.fn(runtime.fetch)
    runtime.fetch = f
    const t = (await (await ask('test-pass', await spaceIdOf('A'))).json()) as { ticket: string }
    expect(f).toHaveBeenCalledTimes(1)
    expect((await create('A', t.ticket)).status).toBe(201)
    clock.now += 15 * 86_400_000
    expect((await call('POST', '/spaces', { token: 'B' })).status).toBe(201)
    expect((await call('GET', '/head', { token: 'A' })).status).toBe(404)
    clock.now += 15 * 86_400_000
    expect((await create('A', t.ticket)).status).toBe(201)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

