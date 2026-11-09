// 画面の入口で Google ドライブの置き場を選んで使う決まり(docs/sync-drive.md 5・7)。Google のログインは偽物で、本物には繋がない
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps } from '../../logstore/src/index'
import * as S from '../src/index'
import { FAKE_DRIVE_TOKEN, FakeDrive } from './fakeDrive'
import { FakeSyncServer, signTicket } from './fakeServer'
import { testDb } from './scenarioRunner'

const START = 1_800_000_000_000
const thread = (key: string) => ({ connectorId: '2ch-compat', boardUrl: 'https://a.5ch.io/x/', key, title: `t${key}`, postCount: 0, order: 0 })

function world() {
  const w = { now: START, drive: null as unknown as FakeDrive, server: null as unknown as FakeSyncServer }
  w.drive = new FakeDrive(() => w.now)
  w.server = new FakeSyncServer({ now: () => w.now, rate_per_minute: null, full_pull_per_hour: null })
  return w
}

/** Google のログインの偽物。account はログインで返すアカウント、revoked は Google の側で取り消された状態 */
function fakeGoogle(unavailable: string | null = null) {
  const g = { account: 'acct-1', email: 'a@example.test', signedIn: null as string | null, revoked: false, logins: [] as (string | null)[], cancel: false, forgets: 0, revokes: 0 }
  const auth = (transport: S.SyncTransport): S.DriveAuth => ({
    unavailable: async () => unavailable,
    async login(expect) {
      g.logins.push(expect)
      if (g.cancel) throw new S.SyncHostError('cancelled')
      if (expect !== null && expect !== g.account) throw new S.SyncHostError('google_other_account')
      g.signedIn = g.account
      g.revoked = false
      return { account: g.account }
    },
    account: async () => (g.signedIn === null ? null : { account: g.signedIn, email: g.email }),
    async forget() {
      g.forgets++
      g.signedIn = null
    },
    async revoke() {
      g.revokes++
      g.revoked = true
      g.signedIn = null
    },
    remote: S.driveRemote({
      transport,
      accessToken: async () => {
        if (g.signedIn === null || g.revoked) throw new S.SyncApiError('http', 401, 'google_auth_failed')
        return FAKE_DRIVE_TOKEN
      },
    }),
  })
  return { g, auth }
}

function device(w: ReturnType<typeof world>, google = fakeGoogle()) {
  const db = testDb()
  const c = { requests: [] as S.SyncRequest[], material: null as S.SyncKeyMaterial | null, windows: 0 }
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
    drive: google.auth(transport),
    adapters: [new S.FavoriteThreadAdapter(db, (u) => ({ boardUrl: u, connectorId: '2ch-compat' }))],
    now: () => w.now,
    keyHint: () => c.material !== null,
    openStartWindow: async (url) => {
      c.windows++
      return signTicket(/space_id=([0-9a-f]{64})/.exec(url)?.[1] as string, 4_000_000_000)
    },
  })
  const store = new LogStore(db)
  return { c, ctl, db, store, ops: new UserOps(store), g: google.g }
}

async function on(d: ReturnType<typeof device>) {
  await d.ctl.setMaster(true)
  return d
}

const state = async (d: ReturnType<typeof device>, key: string) => (await d.db.select<{ value: string }>('SELECT value FROM sync_state WHERE key = $1', [key]))[0]?.value ?? null

describe('Google ドライブで始める', () => {
  it('置き場を選ぶだけではログインしない。始めるとログインしてから K を作り、許可証の窓を開かずに Drive へ書く', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ops.favoriteThreadAdd(thread('1'))
    await pc.ctl.setStore('drive')
    expect(pc.g.logins).toEqual([])
    expect(pc.c.material).toBeNull()
    const r = await pc.ctl.start()
    expect(r.state).toBe('idle')
    expect(pc.g.logins).toEqual([null])
    expect(pc.c.windows).toBe(0)
    expect(pc.c.material?.ticket).toBeNull()
    const sid = S.spaceId(S.deriveKeys(pc.c.material?.k as Uint8Array).auth_token)
    expect(w.drive.recordsOf(sid)).toHaveLength(1)
    expect(w.server.spaces.size).toBe(0)
    expect(await state(pc, 'google_account')).toBe('acct-1')
    const st = await pc.ctl.status()
    expect(st).toMatchObject({ enabled: true, store: 'drive', drive: { unavailable: null, email: 'a@example.test' } })
    // Drive の通信にはアクセストークンだけが付き、サーバーへは何も送らない
    expect(pc.c.requests.every((x) => x.url.startsWith('https://www.googleapis.com/'))).toBe(true)
  })

  it('ログインをやめたら鍵を作らず、何も送らない', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.setStore('drive')
    pc.g.cancel = true
    await expect(pc.ctl.start()).rejects.toMatchObject({ code: 'cancelled' })
    expect(pc.c.material).toBeNull()
    expect((await pc.ctl.status()).enabled).toBe(false)
    expect(pc.c.requests).toHaveLength(0)
  })

  it('クライアントの入っていないビルドでは選べず、理由を返す', async () => {
    const w = world()
    const pc = await on(device(w, fakeGoogle('google_unavailable')))
    await expect(pc.ctl.setStore('drive')).rejects.toMatchObject({ code: 'google_unavailable' })
    expect((await pc.ctl.status()).store).toBe('server')
    expect(S.syncMessage('google_unavailable')).not.toContain('google_unavailable')
  })

  it('Drive の間は端末の追加のコード(obb1)を出さない', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    await expect(pc.ctl.pairingCode()).rejects.toMatchObject({ code: 'drive_pairing_later' })
  })
})

describe('Google の接続が切れたとき', () => {
  it('取り消し・期限切れで止まり、同じアカウントでログインし直すと K と同期の表のまま続く', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    const k = pc.c.material?.k
    pc.g.revoked = true
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
    expect(w.drive.recordsOf(S.spaceId(S.deriveKeys(k as Uint8Array).auth_token))).toHaveLength(1)
  })

  it('違うアカウントでのログインし直しは止め、前のアカウントの印を残す', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    pc.g.revoked = true
    await pc.ctl.syncNow()
    pc.g.account = 'acct-2'
    await expect(pc.ctl.start()).rejects.toMatchObject({ code: 'google_other_account' })
    expect(await state(pc, 'google_account')).toBe('acct-1')
    expect(S.syncMessage('google_other_account')).toContain('違う Google アカウント')
  })
})

describe('置き場の切り替えとやめ方', () => {
  it('2 台目(同じ K)が Drive の全件を読み、変更が行き来する', async () => {
    const w = world()
    const pc = await on(device(w))
    const pc2 = await on(device(w))
    await pc.ops.favoriteThreadAdd(thread('1'))
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    // QR(obb2)はまだないので、参加した後の状態を直に作る
    pc2.c.material = { k: pc.c.material?.k as Uint8Array, deviceId: 'pc2dev', ticket: null }
    pc2.g.signedIn = 'acct-1'
    await pc2.db.batch([
      S.setState('device_id', 'pc2dev'),
      S.setState('clock', '000000000000.0000.'),
      S.setState('since', '0'),
      S.setState('phase', 'joining'),
      S.setState('enabled', '1'),
      S.setState('store', 'drive'),
      S.setState('google_account', 'acct-1'),
    ])
    expect((await pc2.ctl.syncNow()).state).toBe('idle')
    expect((await pc2.store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['1'])
    await pc2.ops.favoriteThreadRemove(thread('1'))
    await pc2.ops.favoriteThreadAdd(thread('3'))
    await pc2.ctl.syncNow()
    w.now += 60_000
    await pc.ctl.syncNow()
    expect((await pc.store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['3'])
  })

  it('使っている間にサーバーへ戻すと、トークンを手元から消し(取り消しは送らない)、サーバーへ全部を送り直す', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ops.favoriteThreadAdd(thread('1'))
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    await pc.ctl.setStore('server')
    expect(pc.g).toMatchObject({ signedIn: null, revokes: 0 })
    expect(await state(pc, 'google_account')).toBeNull()
    expect(await state(pc, 'drive_token')).toBeNull()
    expect(await state(pc, 'recreate_pending')).toBe('1')
    // サーバーには許可証が要る。窓を通して続ける
    expect((await pc.ctl.syncNow()).state).toBe('blocked')
    expect((await pc.ctl.status()).lastError).toBe('ticket_required')
    expect((await pc.ctl.start()).state).toBe('idle')
    expect(pc.c.windows).toBe(1)
    expect(w.server.spaces.size).toBe(1)
  })

  it('サーバーで使っている間に Drive へ替えると、ログインしてから Drive へ全部を書く', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ops.favoriteThreadAdd(thread('1'))
    await pc.ctl.start()
    expect(w.server.spaces.size).toBe(1)
    await pc.ctl.setStore('drive')
    expect(pc.g.logins).toEqual([null])
    const sid = S.spaceId(S.deriveKeys(pc.c.material?.k as Uint8Array).auth_token)
    expect(w.drive.recordsOf(sid)).toHaveLength(1)
    expect((await pc.ctl.status()).state).toBe('idle')
  })

  it('やめると鍵と Google のトークンを手元から消し、置き場の選択も既定へ戻る。全端末で切ると取り消しを送る', async () => {
    const w = world()
    const pc = await on(device(w))
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    await pc.ctl.leave()
    expect(pc.c.material).toBeNull()
    expect(pc.g).toMatchObject({ signedIn: null, revokes: 0 })
    expect((await pc.ctl.status()).store).toBe('server')

    await on(pc)
    await pc.ctl.setStore('drive')
    await pc.ctl.start()
    await pc.ctl.revokeGoogle()
    expect(pc.g.revokes).toBe(1)
    expect(pc.c.material).toBeNull()
  })
})
