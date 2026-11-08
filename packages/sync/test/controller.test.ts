// 画面の入口の決まり。使っていない間の無通信、鍵が DB に入らないこと、許可証の窓、ペアリング、前面の同期
import { readdirSync, readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps, type SqlDb } from '../../logstore/src/index'
import * as S from '../src/index'
import presets from '../../presets/sites.json'
import { FakeSyncServer, signTicket } from './fakeServer'

const PRESET_URLS = [...presets.sites.map((x) => x.menu), ...presets.boards.map((x) => x.url)]

const dir = new URL('../../logstore/migrations/', import.meta.url)
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, dir), 'utf-8'))
const SQL = await initSqlJs()
const conv = (sql: string) => sql.replace(/\$(\d+)/g, '?$1')

function newDb() {
  const raw = new SQL.Database()
  for (const m of migrations) raw.exec(m)
  const db: SqlDb = {
    async execute(sql, params = []) {
      raw.run(conv(sql), params as initSqlJs.BindParams)
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const st = raw.prepare(conv(sql))
      st.bind(params as initSqlJs.BindParams)
      const rows: T[] = []
      while (st.step()) rows.push(st.getAsObject() as T)
      st.free()
      return rows
    },
    async batch(statements) {
      raw.exec('BEGIN')
      try {
        for (const s of statements) raw.run(conv(s.sql), (s.params ?? []) as initSqlJs.BindParams)
        raw.exec('COMMIT')
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
  }
  return { raw, db }
}

const URL_A = 'https://sync.test'
type TestServer = FakeSyncServer & { nowForTest: () => number; advance: (ms: number) => void }
const thread = (key: string) => ({ connectorId: '2ch-compat', boardUrl: 'https://a.5ch.io/x/', key, title: `t${key}`, postCount: 0, order: 0 })

function device(server: TestServer, o: { keyFail?: boolean; window?: (url: string) => string | null } = {}) {
  const { raw, db } = newDb()
  // 画面で「同期を使う」をオンにしたあとの状態
  raw.exec("INSERT INTO sync_state (key, value) VALUES ('master', '1')")
  const c = { requests: [] as S.SyncRequest[], keyReads: 0, windows: [] as string[], material: null as S.SyncKeyMaterial | null }
  const keyStore: S.SyncKeyStore = {
    load: async () => {
      c.keyReads++
      if (o.keyFail) throw new Error('no secret service')
      return c.material
    },
    save: async (v) => {
      if (o.keyFail) throw new Error('no secret service')
      c.material = v
    },
    clear: async () => void (c.material = null),
  }
  const transport: S.SyncTransport = {
    async send(req) {
      c.requests.push(req)
      const u = new URL(req.url)
      return server.handle({ method: req.method, path: u.pathname + u.search, headers: req.headers, body: req.body })
    },
  }
  const ctl = new S.SyncController({
    db,
    keyStore,
    transport,
    defaultServerUrl: URL_A,
    adapters: [new S.FavoriteThreadAdapter(db, (u) => ({ boardUrl: u, connectorId: '2ch-compat' }))],
    now: () => server.nowForTest(),
    presetUrls: PRESET_URLS,
    keyHint: () => c.material !== null,
    openStartWindow: async (url) => {
      c.windows.push(url)
      if (o.window) return o.window(url)
      const id = /space_id=([0-9a-f]{64})/.exec(url)?.[1] as string
      return signTicket(id, 4_000_000_000)
    },
  })
  return { c, ctl, raw, db, store: new LogStore(db), ops: new UserOps(new LogStore(db)) }
}

function newServer(): TestServer {
  let now = 1_800_000_000_000
  const server = new FakeSyncServer({ now: () => now, rate_per_minute: null, full_pull_per_hour: null }) as TestServer
  server.nowForTest = () => now
  server.advance = (ms) => (now += ms)
  return server
}

describe('使っていない間', () => {
  it('通信せず、鍵保管を開かず、操作を積まない', async () => {
    const d = device(newServer())
    await d.ops.favoriteThreadAdd(thread('1'))
    expect(await d.ctl.foreground()).toBeNull()
    const st = await d.ctl.status()
    expect(st.enabled).toBe(false)
    expect(st.state).toBe('off')
    expect(d.c.requests).toHaveLength(0)
    expect(d.c.keyReads).toBe(0)
    expect(await d.db.select('SELECT * FROM sync_ops')).toHaveLength(0)
  })
})

describe('スイッチ', () => {
  it('既定はオフで、オンにするまで始められない', async () => {
    const d = device(newServer())
    d.raw.exec("DELETE FROM sync_state WHERE key = 'master'")
    const st = await d.ctl.status()
    expect(st.master).toBe(false)
    expect(st.kinds).toEqual({ history: true, favorites: true, sites: true, posts: true, images: true, ng: true, settings: true, secret: false })
    await expect(d.ctl.start()).rejects.toMatchObject({ code: 'sync_off' })
    await expect(d.ctl.join('obb1.x')).rejects.toMatchObject({ code: 'sync_off' })
    expect(d.c.windows).toHaveLength(0)
    await d.ctl.setMaster(true)
    expect((await d.ctl.status()).master).toBe(true)
    await d.ctl.start()
    expect((await d.ctl.status()).enabled).toBe(true)
  })

  it('オフの間は通信も積みも鍵保管も触らず、鍵は残る。オンで続きから動く', async () => {
    const server = newServer()
    const d = device(server)
    await d.ctl.start()
    await d.ctl.setMaster(false)
    d.c.requests.length = 0
    const reads = d.c.keyReads
    await d.ops.favoriteThreadAdd(thread('1'))
    expect(await d.ctl.foreground()).toBeNull()
    expect(await d.ctl.autoEnabled()).toBe(false)
    expect(await d.ctl.autoCheck()).toBe(false)
    expect(await d.ctl.hasChanges()).toBe(false)
    await d.ctl.syncNow()
    expect(d.c.requests).toHaveLength(0)
    expect(d.c.keyReads).toBe(reads)
    expect(await d.db.select('SELECT * FROM sync_ops')).toHaveLength(0)
    const st = await d.ctl.status()
    expect(st.state).toBe('off')
    expect(st.enabled).toBe(true)
    expect(d.c.material).not.toBeNull()
    await d.ctl.setMaster(true)
    expect(d.c.requests.length).toBeGreaterThan(0)
    expect(await d.db.select<{ n: number }>("SELECT COUNT(*) AS n FROM sync_records WHERE kind = 'favorite' AND pending = 0")).toEqual([{ n: 1 }])
  })

  it('切っている種類の送信待ちは数えず、自動の同期を起こさない', async () => {
    const d = device(newServer())
    await d.ctl.start()
    await d.ops.favoriteThreadAdd(thread('1'))
    expect(await d.ctl.hasChanges()).toBe(true)
    await d.ctl.syncNow()
    await d.raw.exec("UPDATE sync_records SET pending = 1 WHERE kind = 'favorite'")
    await d.ctl.setKind('favorites', false)
    expect(await d.ctl.hasChanges()).toBe(false)
    expect((await d.ctl.status()).pending).toBe(0)
  })

  it('この版で処理できない操作は送信待ちに数えない', async () => {
    const d = device(newServer())
    await d.ctl.start()
    d.raw.exec("INSERT INTO sync_ops (op, target, num, args, at_ms) VALUES ('future_op', 'x', NULL, NULL, 1)")
    expect(await d.ctl.hasChanges()).toBe(false)
    expect((await d.ctl.status()).pending).toBe(0)
    await d.ops.favoriteThreadAdd(thread('1'))
    expect(await d.ctl.hasChanges()).toBe(true)
  })

  it('スイッチは同期の許可リストと設定の書き出しに入らない', () => {
    const allow = JSON.parse(readFileSync(new URL('../settings-allowlist.json', import.meta.url), 'utf-8'))
    const names = [...allow.items.map((i: { name: string }) => i.name), ...allow.board_meta.fields]
    for (const n of ['syncKinds', 'syncMaster', 'kinds', 'master', 'secret']) expect(names).not.toContain(n)
    expect(allow.never).toEqual(expect.arrayContaining(['syncKinds', 'syncMaster']))
  })
})

describe('同期を始める', () => {
  it('窓を閉じたら鍵を残さず、何も送らない', async () => {
    const d = device(newServer(), { window: () => null })
    await expect(d.ctl.start()).rejects.toMatchObject({ code: 'cancelled' })
    expect(d.c.material).toBeNull()
    expect(d.c.requests).toHaveLength(0)
    expect((await d.ctl.status()).enabled).toBe(false)
  })

  it('別の領域の許可証は受け取らない', async () => {
    const d = device(newServer(), { window: () => signTicket('a'.repeat(64), 4_000_000_000) })
    await expect(d.ctl.start()).rejects.toMatchObject({ code: 'bad_ticket' })
    expect(d.c.material).toBeNull()
  })

  it('鍵保管が使えなければ窓を開かず、理由を出す', async () => {
    const d = device(newServer(), { keyFail: true })
    await expect(d.ctl.start()).rejects.toMatchObject({ code: 'key_store_unavailable' })
    expect(d.c.windows).toHaveLength(0)
    expect(S.syncMessage('key_store_unavailable')).toContain('鍵を安全に保存できない')
  })

  it('http のサーバーには窓を開かない', async () => {
    const d = device(newServer())
    await d.db.execute("INSERT INTO sync_state (key, value) VALUES ('server_url', 'http://sync.test')")
    await expect(d.ctl.start()).rejects.toMatchObject({ kind: 'bad_url' })
    expect(d.c.windows).toHaveLength(0)
  })

  it('鍵と許可証は DB に入らず、トークンは Bearer だけに出る', async () => {
    const d = device(newServer())
    await d.store.addFavoriteThread(thread('1'))
    await d.ctl.start()
    const m = d.c.material as S.SyncKeyMaterial
    const bytes = new TextDecoder('latin1').decode(d.raw.export())
    expect(bytes).not.toContain(S.toBase64Url(m.k))
    expect(bytes).not.toContain(S.toHex(m.k))
    expect(bytes).not.toContain(m.ticket as string)
    expect(bytes).not.toContain(S.toHex(S.deriveKeys(m.k).auth_token))
    const st = await d.ctl.status()
    expect(JSON.stringify(st)).not.toContain(S.toBase64Url(m.k))
    expect(st.space).toHaveLength(12)
    for (const r of d.c.requests) expect(r.url).not.toContain(S.toHex(S.deriveKeys(m.k).auth_token))
  })
})

describe('端末の追加', () => {
  it('コードで参加すると、削除も届く', async () => {
    const server = newServer()
    const a = device(server)
    const b = device(server)
    await a.ctl.start()
    await a.ops.favoriteThreadAdd(thread('1'))
    await a.ctl.syncNow()
    const { code, showMs } = await a.ctl.pairingCode()
    expect(showMs).toBe(60_000)
    await b.ctl.join(code)
    expect(b.c.windows).toHaveLength(0)
    expect((await b.store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['1'])

    await b.ops.favoriteThreadRemove(thread('1'))
    await b.ctl.syncNow()
    await a.ctl.syncNow()
    expect(await a.store.listFavoriteThreads()).toEqual([])
  })

  it('使っている端末へは参加しない', async () => {
    const a = device(newServer())
    await a.ctl.start()
    await expect(a.ctl.join((await a.ctl.pairingCode()).code)).rejects.toMatchObject({ code: 'already_on' })
  })

  it('ふだんと違うサーバーのコードは確認を出し、参加するとそのサーバーへ行く', async () => {
    const server = newServer()
    const b = device(server)
    const k = new Uint8Array(32).fill(3)
    const ticket = signTicket(S.spaceId(S.deriveKeys(k).auth_token), 4_000_000_000)
    const r = await b.ctl.join(S.encodePairingCode({ k, serverUrl: 'https://other.test', ticket }))
    expect(r.state).toBe('confirm')
    expect(r.confirm).toEqual({ type: 'join_data', lost: 0, host: 'other.test' })
    // 答えが出るまで鍵も URL も書かず、通信もしない
    const st = await b.ctl.status()
    expect(st.state).toBe('confirm')
    expect(st.confirm?.type).toBe('join_data')
    expect(st.serverOverride).toBeNull()
    expect(b.c.material).toBeNull()
    expect(b.c.requests).toHaveLength(0)
    await b.ctl.resolveConfirm('accept_removal')
    expect((await b.ctl.status()).serverOverride).toBe('https://other.test')
    expect(b.c.requests.length).toBeGreaterThan(0)
    expect(b.c.requests.every((r) => r.url.startsWith('https://other.test/'))).toBe(true)
  })

  it('手元にデータがあれば確認を出し、やめると何も送らない', async () => {
    const server = newServer()
    const a = device(server)
    const b = device(server)
    await a.ctl.start()
    const { code } = await a.ctl.pairingCode()
    await b.ops.favoriteThreadAdd(thread('9'))
    const r = await b.ctl.join(code)
    expect(r.confirm).toEqual({ type: 'join_data', lost: 0, host: null })
    await b.ctl.resolveConfirm('keep_local')
    const st = await b.ctl.status()
    expect(st.enabled).toBe(false)
    expect(st.state).toBe('off')
    expect(st.confirm).toBeNull()
    expect(b.c.material).toBeNull()
    expect(b.c.requests).toHaveLength(0)
    expect((await b.store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['9'])
    // もう一度読めば、参加できる
    await b.ctl.join(code)
    await b.ctl.resolveConfirm('accept_removal')
    expect((await b.ctl.status()).enabled).toBe(true)
    await a.ctl.syncNow()
    expect((await a.store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['9'])
  })

  it('最初から入っている掲示板・板は手元のデータに数えない', async () => {
    const server = newServer()
    const a = device(server)
    const b = device(server)
    await a.ctl.start()
    // 移行の SQL が入れる 5ch とエッヂが残っている
    expect(await b.db.select('SELECT 1 FROM sites')).toHaveLength(1)
    expect(await b.db.select('SELECT 1 FROM favorite_boards')).toHaveLength(1)
    const r = await b.ctl.join((await a.ctl.pairingCode()).code)
    expect(r.confirm).toBeUndefined()
    expect((await b.ctl.status()).enabled).toBe(true)
  })
})

describe('前面の同期', () => {
  it('pull の間隔を空け、手動は例外にする', async () => {
    const server = newServer()
    const a = device(server)
    await a.ctl.start()
    const before = a.c.requests.length
    await a.ctl.foreground()
    expect(a.c.requests.filter((r) => r.url.includes('/changes')).length).toBe(a.c.requests.slice(0, before).filter((r) => r.url.includes('/changes')).length)
    await a.ctl.syncNow()
    expect(a.c.requests.length).toBeGreaterThan(before)
    const n = a.c.requests.length
    server.advance(10_001)
    await a.ctl.foreground()
    expect(a.c.requests.length).toBeGreaterThan(n)
  })

  it('起動直後に入口が重なっても、エンジンは 1 つだけ作る', async () => {
    const d = device(newServer())
    const make = () => (d.ctl as unknown as { engine(): Promise<object> }).engine()
    const [a, b, c] = await Promise.all([make(), make(), make()])
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('通信できなくても手元は残り、戻ると追いつく', async () => {
    const server = newServer()
    const a = device(server)
    const b = device(server)
    await a.ctl.start()
    await b.ctl.join((await a.ctl.pairingCode()).code)
    const realHandle = server.handle.bind(server)
    server.handle = () => {
      throw new Error('機内モード')
    }
    await a.ops.favoriteThreadAdd(thread('1'))
    const off = await a.ctl.syncNow()
    expect(off.state).toBe('offline')
    expect((await a.ctl.status()).pending).toBeGreaterThan(0)
    expect((await a.store.listFavoriteThreads()).length).toBe(1)
    server.handle = realHandle
    expect((await a.ctl.syncNow()).state).toBe('idle')
    expect((await a.ctl.status()).pending).toBe(0)
    server.advance(10_001)
    await b.ctl.foreground()
    expect((await b.store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['1'])
  })

  it('DB を入れ替えて鍵だけ残っていたら、新しい device_id で合流し直す', async () => {
    const server = newServer()
    const a = device(server)
    await a.ctl.start()
    const old = (a.c.material as S.SyncKeyMaterial).deviceId
    const ctl2 = new S.SyncController({ db: a.db, keyStore: { load: async () => a.c.material, save: async (v) => void (a.c.material = v), clear: async () => void (a.c.material = null) }, transport: { send: async (req) => { const u = new URL(req.url); return server.handle({ method: req.method, path: u.pathname + u.search, headers: req.headers, body: req.body }) } }, defaultServerUrl: URL_A, adapters: [new S.FavoriteThreadAdapter(a.db, (u) => ({ boardUrl: u, connectorId: '2ch-compat' }))], now: () => server.nowForTest(), keyHint: () => true, openStartWindow: async () => null })
    await a.db.execute('DELETE FROM sync_state')
    await ctl2.foreground()
    expect((a.c.material as S.SyncKeyMaterial).deviceId).not.toBe(old)
    expect((await ctl2.status()).enabled).toBe(true)
  })

  it('鍵保管が空で DB だけ残っていたら、使っていない状態へ戻す', async () => {
    const server = newServer()
    const a = device(server)
    await a.ctl.start()
    a.c.material = null
    const ctl2 = new S.SyncController({ db: a.db, keyStore: { load: async () => null, save: async () => undefined, clear: async () => undefined }, transport: { send: async () => { throw new Error('通信しない') } }, defaultServerUrl: URL_A, adapters: [], now: () => server.nowForTest(), keyHint: () => false, openStartWindow: async () => null })
    expect((await ctl2.foreground())?.state).toBe('off')
    expect((await ctl2.status()).enabled).toBe(false)
  })
})

describe('離脱とサーバーの URL', () => {
  it('手元のお気に入りを残し、鍵と同期の表を消し、URL は既定へ戻す', async () => {
    const a = device(newServer())
    await a.ctl.setServerUrl('https://other.test')
    await a.ctl.start()
    await a.ops.favoriteThreadAdd(thread('1'))
    await a.ctl.syncNow()
    await a.ctl.leave()
    expect(a.c.material).toBeNull()
    expect(await a.db.select('SELECT * FROM sync_records')).toHaveLength(0)
    expect((await a.store.listFavoriteThreads()).length).toBe(1)
    expect((await a.ctl.status()).serverOverride).toBeNull()
    const n = a.c.requests.length
    await a.ops.favoriteThreadAdd(thread('2'))
    await a.ctl.foreground()
    expect(a.c.requests).toHaveLength(n)
    expect(await a.db.select('SELECT * FROM sync_ops')).toHaveLength(0)
  })

  it('https 以外を断り、空で既定値に戻す', async () => {
    const a = device(newServer())
    await expect(a.ctl.setServerUrl('http://evil.test')).rejects.toMatchObject({ kind: 'bad_url' })
    await a.ctl.setServerUrl('https://other.test/')
    expect((await a.ctl.status()).serverUrl).toBe('https://other.test')
    await a.ctl.setServerUrl('')
    expect((await a.ctl.status()).serverOverride).toBeNull()
  })

  it('使っている間に変えると、新しい先へ全部送り直す', async () => {
    const server = newServer()
    const a = device(server)
    await a.ctl.start()
    await a.ops.favoriteThreadAdd(thread('1'))
    await a.ctl.syncNow()
    await a.ctl.setServerUrl('https://other.test')
    // 新しい先にはまだ領域がない
    server.spaces.clear()
    const before = a.c.requests.length
    const r = await a.ctl.syncNow()
    expect(r.state).toBe('idle')
    const after = a.c.requests.slice(before)
    expect(after.every((x) => x.url.startsWith('https://other.test/'))).toBe(true)
    expect(after.some((x) => x.url.endsWith('/records'))).toBe(true)
  })
})

describe('ペアリングのコードと画面の文(共通テスト)', () => {
  const pairing = JSON.parse(readFileSync(new URL('../../conformance/sync-pairing.json', import.meta.url), 'utf-8'))
  for (const c of pairing) {
    it(c.name, () => {
      if (c.error) {
        expect(() => S.parsePairingCode(c.code, c.allow_localhost)).toThrow(expect.objectContaining({ kind: c.error }))
        return
      }
      const p = S.parsePairingCode(c.code, c.allow_localhost)
      expect(S.toHex(p.k)).toBe(c.k_hex)
      expect(p.serverUrl).toBe(c.server_url)
      expect(p.ticket).toBe(c.ticket)
      if (c.encode) expect(S.encodePairingCode(p)).toBe(c.code)
    })
  }

  it('画面の言葉がスマホと同じ', () => {
    const ui = JSON.parse(readFileSync(new URL('../../conformance/sync-ui.json', import.meta.url), 'utf-8'))
    expect(S.SYNC_LABELS).toEqual(ui.labels)
    expect(S.SYNC_NOTES).toEqual(ui.notes)
    expect(S.SYNC_MESSAGES).toEqual(ui.messages)
    expect(S.SYNC_GROUPS.map((g) => ({ id: g.id, label: S.SYNC_GROUP_LABELS[g.id], default: g.default, kinds: g.kinds }))).toEqual(ui.groups)
    expect(S.PAIRING_SHOW_MS).toBe(ui.pairing_show_ms)
  })

  it('既定の URL は https で、検査を通る', () => {
    const { default: url } = JSON.parse(readFileSync(new URL('../server-url.json', import.meta.url), 'utf-8'))
    expect(S.checkServerUrl(url)).toBe(url)
  })
})
