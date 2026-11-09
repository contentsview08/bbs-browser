// 画面の入口で Google ドライブだけで同期する決まり(docs/sync-drive.md 5・7)。Google のログインとトークンは偽物で、本物には繋がない
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps } from '../../logstore/src/index'
import * as S from '../src/index'
import presets from '../../presets/sites.json'
import { FAKE_DRIVE_TOKEN, FakeDrive } from './fakeDrive'
import { FakeSyncServer, signTicket } from './fakeServer'
import { testDb } from './scenarioRunner'

const PRESET_URLS = [...presets.sites.map((x) => x.menu), ...presets.boards.map((x) => x.url)]
const START = 1_800_000_000_000
const thread = (key: string) => ({ connectorId: '2ch-compat', boardUrl: 'https://a.5ch.io/x/', key, title: `t${key}`, postCount: 0, order: 0 })

/** Google の側。valid は使える更新用のトークンとそのアカウント */
function world() {
  const w = {
    now: START,
    drive: null as unknown as FakeDrive,
    server: null as unknown as FakeSyncServer,
    google: { valid: new Map<string, { account: string; email: string }>(), issued: 0 },
  }
  w.drive = new FakeDrive(() => w.now)
  w.server = new FakeSyncServer({ now: () => w.now, rate_per_minute: null, full_pull_per_hour: null })
  return w
}

type World = ReturnType<typeof world>

/** 端末ごとの Google の部品の偽物。stored は手元の鍵保管に置いた更新用のトークン */
function fakeGoogle(w: World, unavailable: string | null = null) {
  const g = { account: 'acct-1', email: 'a@example.test', stored: null as string | null, logins: [] as (string | null)[], adopts: 0, cancel: false, forgets: 0, revokes: 0 }
  const accountOf = (t: string | null) => (t === null ? null : (w.google.valid.get(t) ?? null))
  const auth = (transport: S.SyncTransport): S.DriveAuth => ({
    unavailable: async () => unavailable,
    async login(expect) {
      g.logins.push(expect)
      if (g.cancel) throw new S.SyncHostError('cancelled')
      if (expect !== null && expect !== g.account) throw new S.SyncHostError('google_other_account')
      const t = `rt-${++w.google.issued}`
      w.google.valid.set(t, { account: g.account, email: g.email })
      g.stored = t
      return { account: g.account }
    },
    account: async () => accountOf(g.stored),
    async forget() {
      g.forgets++
      g.stored = null
    },
    async revoke() {
      g.revokes++
      if (g.stored !== null) w.google.valid.delete(g.stored)
      g.stored = null
    },
    async pairingToken() {
      if (g.stored === null) throw new S.SyncHostError('google_auth_failed')
      return g.stored
    },
    async adopt(token, expect) {
      g.adopts++
      const a = accountOf(token)
      if (a === null) throw new S.SyncHostError('google_pairing_failed')
      if (expect !== null && expect !== a.account) throw new S.SyncHostError('google_other_account')
      g.stored = token
      return a
    },
    remote: S.driveRemote({
      transport,
      accessToken: async () => {
        if (accountOf(g.stored) === null) throw new S.SyncApiError('http', 401, 'google_auth_failed')
        return FAKE_DRIVE_TOKEN
      },
    }),
  })
  return { g, auth }
}

/** from を渡すと、その端末の DB と鍵保管のまま開き直す(版を上げたときの起動) */
function device(w: World, opts: { unavailable?: string | null; drive?: boolean; from?: { db: S.SyncSqlDb & ReturnType<typeof testDb>; c: { material: S.SyncKeyMaterial | null } } } = {}) {
  const google = fakeGoogle(w, opts.unavailable ?? null)
  const db = opts.from?.db ?? testDb()
  const c = { requests: [] as S.SyncRequest[], material: (opts.from?.c.material ?? null) as S.SyncKeyMaterial | null, windows: 0 }
  const keyStore: S.SyncKeyStore = {
    load: async () => c.material,
    save: async (v) => void (c.material = v),
    clear: async () => void (c.material = null),
  }
  const transport: S.SyncTransport = {
    async send(req) {
      c.requests.push(req)
      const u = new URL(req.url)
      if (u.host === 'www.googleapis.com') return w.drive.handle({ method: req.method, url: req.url, headers: req.headers, body: req.body })
      return w.server.handle({ method: req.method, path: u.pathname + u.search, headers: req.headers, body: req.body })
    },
  }
  const ctl = new S.SyncController({
    db,
    keyStore,
    transport,
    defaultServerUrl: 'https://sync.test',
    drive: opts.drive === false ? undefined : google.auth(transport),
    adapters: [new S.FavoriteThreadAdapter(db, (u) => ({ boardUrl: u, connectorId: '2ch-compat' }))],
    now: () => w.now,
    presetUrls: PRESET_URLS,
    keyHint: () => c.material !== null,
    openStartWindow: async (url) => {
      c.windows++
      return signTicket(/space_id=([0-9a-f]{64})/.exec(url)?.[1] as string, 4_000_000_000)
    },
  })
  const store = new LogStore(db)
  return { c, ctl, db, store, ops: new UserOps(store), g: google.g }
}

type Device = ReturnType<typeof device>

async function on(d: Device) {
  await d.ctl.setMaster(true)
  return d
}

const state = async (d: Device, key: string) => (await d.db.select<{ value: string }>('SELECT value FROM sync_state WHERE key = $1', [key]))[0]?.value ?? null
const spaceOf = (d: Device) => S.spaceId(S.deriveKeys(d.c.material?.k as Uint8Array).auth_token)
const favorites = async (d: Device) => (await d.store.listFavoriteThreads()).map((f) => f.thread.key).sort()

/** 1 台目を始めて、2 台目をコードで参加させる */
async function pair(w: World) {
  const pc = await on(device(w))
  const pc2 = await on(device(w))
  await pc.ops.favoriteThreadAdd(thread('1'))
  await pc.ctl.start()
  const { code } = await pc.ctl.pairingCode()
  expect((await pc2.ctl.join(code)).state).toBe('idle')
  return { pc, pc2 }
}

describe('Google ドライブで始める', () => {
  it('始めるとログインしてから K を作り、許可証の窓を開かずに Drive へ書く', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ops.favoriteThreadAdd(thread('1'))
    expect(pc.g.logins).toEqual([])
    const r = await pc.ctl.start()
    expect(r.state).toBe('idle')
    expect(pc.g.logins).toEqual([null])
    expect(pc.c.windows).toBe(0)
    expect(pc.c.material?.ticket).toBeNull()
    expect(w.drive.recordsOf(spaceOf(pc))).toHaveLength(1)
    expect(w.server.spaces.size).toBe(0)
    expect(await state(pc, 'google_account')).toBe('acct-1')
    expect(await state(pc, 'store')).toBe('drive')
    const st = await pc.ctl.status()
    expect(st).toMatchObject({ enabled: true, store: 'drive', drive: { unavailable: null, email: 'a@example.test' } })
    // Drive の通信にはアクセストークンだけが付き、サーバーへは何も送らない
    expect(pc.c.requests.every((x) => x.url.startsWith('https://www.googleapis.com/'))).toBe(true)
  })

  it('ログインをやめたら鍵を作らず、何も送らない', async () => {
    const w = world()
    const pc = await on(device(w))
    pc.g.cancel = true
    await expect(pc.ctl.start()).rejects.toMatchObject({ code: 'cancelled' })
    expect(pc.c.material).toBeNull()
    expect((await pc.ctl.status()).enabled).toBe(false)
    expect(pc.c.requests).toHaveLength(0)
  })

  it('クライアントの入っていないビルドでは始められず、理由を返す', async () => {
    const w = world()
    const pc = await on(device(w, { unavailable: 'google_unavailable' }))
    await expect(pc.ctl.start()).rejects.toMatchObject({ code: 'google_unavailable' })
    expect((await pc.ctl.status()).drive?.unavailable).toBe('google_unavailable')
    expect(pc.c.windows).toBe(0)
    expect(S.syncMessage('google_unavailable')).not.toContain('google_unavailable')
  })
})

describe('端末の追加(obb2)', () => {
  it('コードは K と更新用のトークンで、参加した端末はログインせずに同じ領域を読み書きする', async () => {
    const w = world()
    const pc = await on(device(w))
    const pc2 = await on(device(w))
    await pc.ops.favoriteThreadAdd(thread('1'))
    await pc.ctl.start()
    const { code, showMs } = await pc.ctl.pairingCode()
    expect(showMs).toBe(S.PAIRING_SHOW_MS)
    const parsed = S.parseDrivePairingCode(code)
    expect(parsed.k).toEqual(pc.c.material?.k)
    expect(parsed.refreshToken).toBe(pc.g.stored)
    expect((await pc2.ctl.join(code)).state).toBe('idle')
    expect(pc2.g.logins).toEqual([])
    expect(pc2.g.stored).toBe(pc.g.stored)
    expect(pc2.c.windows).toBe(0)
    expect(spaceOf(pc2)).toBe(spaceOf(pc))
    expect(pc2.c.material?.deviceId).not.toBe(pc.c.material?.deviceId)
    expect(await state(pc2, 'google_account')).toBe('acct-1')
    expect(await favorites(pc2)).toEqual(['1'])
    expect((await pc2.ctl.status()).drive?.email).toBe('a@example.test')

    await pc2.ops.favoriteThreadRemove(thread('1'))
    await pc2.ops.favoriteThreadAdd(thread('3'))
    await pc2.ctl.syncNow()
    w.now += 60_000
    await pc.ctl.syncNow()
    expect(await favorites(pc)).toEqual(['3'])
    expect(w.server.spaces.size).toBe(0)
  })

  it('トークンも鍵も同期の表に入らない', async () => {
    const w = world()
    const { pc, pc2 } = await pair(w)
    const token = pc.g.stored as string
    for (const d of [pc, pc2]) {
      const rows = await d.db.select<{ key: string; value: string }>('SELECT key, value FROM sync_state')
      expect(rows.some((r) => r.value.includes(token))).toBe(false)
      expect(rows.some((r) => r.value.includes(S.toBase64Url(d.c.material?.k as Uint8Array)))).toBe(false)
    }
  })

  it('手元にデータがあれば、Google アカウントを出して確認する。やめると確かめたトークンも残さない', async () => {
    const w = world()
    const pc = await on(device(w))
    const pc2 = await on(device(w))
    await pc.ctl.start()
    await pc2.ops.favoriteThreadAdd(thread('9'))
    const { code } = await pc.ctl.pairingCode()
    const r = await pc2.ctl.join(code)
    expect(r.state).toBe('confirm')
    expect(r.confirm).toMatchObject({ type: S.JOIN_DATA_CONFIRM, host: null, account: 'a@example.test' })
    expect((await pc2.ctl.status()).state).toBe('confirm')
    expect(pc2.c.material).toBeNull()
    const sent = pc2.c.requests.length
    expect((await pc2.ctl.resolveConfirm('keep_local')).state).toBe('off')
    expect(pc2.g.stored).toBeNull()
    expect(pc2.c.material).toBeNull()
    expect(pc2.c.requests).toHaveLength(sent)

    // 参加すると手元のものも届く
    expect((await pc2.ctl.join(code)).state).toBe('confirm')
    expect((await pc2.ctl.resolveConfirm('accept_removal')).state).toBe('idle')
    w.now += 60_000
    await pc.ctl.syncNow()
    expect(await favorites(pc)).toEqual(['9'])
  })

  it('形の違うコード・サーバーのコード(obb1)・使えないトークンは断り、何も残さない', async () => {
    const w = world()
    const pc2 = await on(device(w))
    await expect(pc2.ctl.join('obb2.x')).rejects.toMatchObject({ kind: 'bad_code' })
    await expect(pc2.ctl.join('obb1.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc.aHR0cHM6Ly9zeW5jLnRlc3Q.v1.x')).rejects.toMatchObject({ kind: 'bad_code' })
    const dead = S.encodeDrivePairingCode({ k: new Uint8Array(32).fill(7), refreshToken: 'rt-dead' })
    await expect(pc2.ctl.join(dead)).rejects.toMatchObject({ code: 'google_pairing_failed' })
    expect(S.syncMessage('google_pairing_failed')).toContain('端末を追加')
    expect(pc2.c.material).toBeNull()
    expect(pc2.g.stored).toBeNull()
    expect(pc2.c.requests).toHaveLength(0)
  })

  it('同期していない端末・Google との接続が切れた端末はコードを出さない', async () => {
    const w = world()
    const pc = await on(device(w))
    await expect(pc.ctl.pairingCode()).rejects.toMatchObject({ code: 'already_on' })
    await pc.ctl.start()
    pc.g.stored = null
    await expect(pc.ctl.pairingCode()).rejects.toMatchObject({ code: 'google_auth_failed' })
  })

  it('使っている端末へは別の K のコードで参加しない', async () => {
    const w = world()
    const { pc2 } = await pair(w)
    const other = await on(device(w))
    other.g.account = 'acct-1'
    await other.ctl.start()
    await expect(pc2.ctl.join((await other.ctl.pairingCode()).code)).rejects.toMatchObject({ code: 'already_on' })
  })
})

describe('Google の接続が切れたとき', () => {
  it('取り消し・期限切れで止まり、同じアカウントでログインし直すと K と同期の表のまま続く', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.start()
    const k = pc.c.material?.k
    w.google.valid.clear()
    await pc.ops.favoriteThreadAdd(thread('2'))
    expect((await pc.ctl.syncNow()).state).toBe('blocked')
    const st = await pc.ctl.status()
    expect(st.lastError).toBe('google_auth_failed')
    expect(st.lastErrorText).toContain('Google でログイン')
    // 自動の周は止まったまま
    await pc.ctl.autoCycle()
    expect((await pc.ctl.status()).state).toBe('blocked')
    const r = await pc.ctl.start()
    expect(r.state).toBe('idle')
    expect(pc.g.logins.at(-1)).toBe('acct-1')
    expect(pc.c.material?.k).toEqual(k)
    expect((await pc.ctl.status()).lastError).toBeNull()
    expect(w.drive.recordsOf(spaceOf(pc))).toHaveLength(1)
  })

  it('配り直し: 2 台目は新しいコードを読むと、同期の表のままトークンだけを置き換える', async () => {
    const w = world()
    const { pc, pc2 } = await pair(w)
    const device2 = pc2.c.material?.deviceId
    w.google.valid.clear()
    expect((await pc2.ctl.syncNow()).state).toBe('blocked')
    await pc.ctl.start()
    const { code } = await pc.ctl.pairingCode()
    expect((await pc2.ctl.join(code)).state).toBe('idle')
    expect(pc2.g.stored).toBe(pc.g.stored)
    expect(pc2.c.material?.deviceId).toBe(device2)
    expect((await pc2.ctl.status()).lastError).toBeNull()
  })

  it('違うアカウントでのログインし直しは止め、前のアカウントの印を残す', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.start()
    w.google.valid.clear()
    await pc.ctl.syncNow()
    pc.g.account = 'acct-2'
    await expect(pc.ctl.start()).rejects.toMatchObject({ code: 'google_other_account' })
    expect(await state(pc, 'google_account')).toBe('acct-1')
    expect(S.syncMessage('google_other_account')).toContain('違う Google アカウント')
  })

  it('違うアカウントのトークンでの配り直しは断る', async () => {
    const w = world()
    const { pc2 } = await pair(w)
    const other = await on(device(w))
    other.g.account = 'acct-2'
    await other.ctl.start()
    const code = S.encodeDrivePairingCode({ k: pc2.c.material?.k as Uint8Array, refreshToken: other.g.stored as string })
    const before = pc2.g.stored
    await expect(pc2.ctl.join(code)).rejects.toMatchObject({ code: 'google_other_account' })
    expect(pc2.g.stored).toBe(before)
  })
})

describe('同期サーバーで使っていた端末', () => {
  it('起動すると同期をやめた状態に戻し、手元のデータは残して、Google で始め直す案内を出す', async () => {
    const w = world()
    const old = await on(device(w, { drive: false }))
    await old.ops.favoriteThreadAdd(thread('1'))
    expect((await old.ctl.start()).state).toBe('idle')
    expect(w.server.spaces.size).toBe(1)
    // 同じ DB と鍵のまま、Drive だけの版で開く
    const pc = device(w, { from: old })
    const st = await pc.ctl.status()
    expect(st).toMatchObject({ enabled: false, master: true, store: 'drive', lastError: 'server_sync_ended', space: null })
    expect(st.lastErrorText).toContain('Google でログイン')
    expect(pc.c.material).toBeNull()
    expect(pc.c.requests).toHaveLength(0)
    expect(await favorites(pc)).toEqual(['1'])
    // 自動の周も動かない
    await pc.ctl.autoCycle()
    expect(pc.c.requests).toHaveLength(0)
    // Google で始め直すと、手元の全部を Drive へ書く
    expect((await pc.ctl.start()).state).toBe('idle')
    expect(pc.c.windows).toBe(0)
    expect(w.drive.recordsOf(spaceOf(pc))).toHaveLength(1)
    expect((await pc.ctl.status()).lastError).toBeNull()
  })

  it('切っていた端末はスイッチもオフのまま戻す', async () => {
    const w = world()
    const old = await on(device(w, { drive: false }))
    await old.ctl.start()
    await old.ctl.setMaster(false)
    const pc = device(w, { from: old })
    expect(await pc.ctl.status()).toMatchObject({ enabled: false, master: false, lastError: 'server_sync_ended' })
    expect(pc.c.material).toBeNull()
  })

  it('Drive で使っている端末は開き直してもそのまま', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.start()
    const again = device(w, { from: pc })
    again.g.stored = pc.g.stored
    expect(await again.ctl.status()).toMatchObject({ enabled: true, lastError: null })
    expect((await again.ctl.syncNow()).state).toBe('idle')
  })
})

describe('やめ方', () => {
  it('やめると鍵と Google のトークンを手元から消す(取り消しは送らない)。全端末で切ると取り消しを送り、ほかの端末も止まる', async () => {
    const w = world()
    const { pc, pc2 } = await pair(w)
    await pc2.ctl.leave()
    expect(pc2.c.material).toBeNull()
    expect(pc2.g).toMatchObject({ stored: null, revokes: 0 })
    expect((await pc.ctl.syncNow()).state).toBe('idle')

    const pc3 = await on(device(w))
    expect((await pc3.ctl.join((await pc.ctl.pairingCode()).code)).state).toBe('idle')
    await pc.ctl.revokeGoogle()
    expect(pc.g.revokes).toBe(1)
    expect(pc.c.material).toBeNull()
    expect((await pc3.ctl.syncNow()).state).toBe('blocked')
    expect((await pc3.ctl.status()).lastError).toBe('google_auth_failed')
  })
})

describe('ドライブで使っている量', () => {
  it('appDataFolder の全ファイルの大きさをページを辿って足す。使っていない間は通信しない', async () => {
    const w = world()
    const pc = await on(device(w))
    expect(await pc.ctl.driveUsage()).toBeNull()
    expect(pc.c.requests).toHaveLength(0)
    const { pc2 } = await pair(w)
    for (let i = 0; i < 3; i++) await pc2.ops.favoriteThreadAdd(thread(String(10 + i)))
    await pc2.ctl.syncNow()
    w.drive.pageCap = 1
    const sum = [...w.drive.files.values()].reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0)
    expect(w.drive.files.size).toBeGreaterThan(1)
    const before = w.drive.calls['files.list'] ?? 0
    expect(await pc2.ctl.driveUsage()).toBe(sum)
    expect((w.drive.calls['files.list'] ?? 0) - before).toBe(w.drive.files.size)
    const list = pc2.c.requests.at(-1) as S.SyncRequest
    expect(new URL(list.url).searchParams.get('fields')).toBe('nextPageToken,files(size)')
  })

  it('表し方は KB・MB・GB の小数 1 桁', () => {
    expect(S.formatDriveUsage(0)).toBe('0.0 KB')
    expect(S.formatDriveUsage(512)).toBe('0.5 KB')
    expect(S.formatDriveUsage(1536)).toBe('1.5 KB')
    expect(S.formatDriveUsage(1024 * 1024 - 1)).toBe('1.0 MB')
    expect(S.formatDriveUsage(1234567)).toBe('1.2 MB')
    expect(S.formatDriveUsage(10 * 1024 * 1024)).toBe('10.0 MB')
    expect(S.formatDriveUsage(3.5 * 1024 ** 3)).toBe('3.5 GB')
    expect(S.formatDriveUsage(2048 * 1024 ** 3)).toBe('2048.0 GB')
    expect(`${S.DRIVE_LABELS.usage}: ${S.formatDriveUsage(1234567)}`).toBe('ドライブで使っている量: 1.2 MB')
  })
})

describe('同期の間隔', () => {
  it('既定は 1 分。選んだ間隔は端末に残り、同期をやめても消えず、同期の表には出ない', async () => {
    const w = world()
    const { pc, pc2 } = await pair(w)
    expect((await pc.ctl.status()).interval).toBe('1m')
    expect(pc.ctl.intervalMs()).toBe(60_000)
    await pc.ctl.setSyncInterval('manual')
    expect(pc.ctl.intervalMs()).toBeNull()
    expect((await pc.ctl.status()).interval).toBe('manual')
    // ほかの端末へは届かない
    await pc.ctl.syncNow()
    await pc2.ctl.syncNow()
    expect((await pc2.ctl.status()).interval).toBe('1m')
    await pc.ctl.leave()
    const again = device(w, { from: pc })
    expect((await again.ctl.status()).interval).toBe('manual')
    // 手動のみでも今すぐ同期は動く
    await pc2.ctl.setSyncInterval('15m')
    expect((await pc2.ctl.syncNow()).state).toBe('idle')
    expect(S.SYNC_INTERVALS.map((x) => S.SYNC_INTERVAL_LABELS[x.id])).toEqual(['30 秒', '1 分', '5 分', '15 分', '手動のみ'])
  })
})

describe('obb2 のコード(共通テスト)', () => {
  const cases = JSON.parse(readFileSync(new URL('../../conformance/sync-pairing-drive.json', import.meta.url), 'utf-8'))
  for (const c of cases) {
    it(c.name, () => {
      if (c.error) {
        expect(() => S.parseDrivePairingCode(c.code)).toThrow(expect.objectContaining({ kind: c.error }))
        return
      }
      const p = S.parseDrivePairingCode(c.code)
      expect(S.toHex(p.k)).toBe(c.k_hex)
      expect(p.refreshToken).toBe(c.refresh_token)
      if (c.encode) expect(S.encodeDrivePairingCode(p)).toBe(c.code)
    })
  }
})
