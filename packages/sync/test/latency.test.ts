// Google ドライブの同期で「端末 A の変更が端末 B の画面に出るまで」の秒数と、1 日の呼び出しの数を、
// 本物のエンジン・スケジューラーと偽の Drive・偽の時計で数える。本物の Google には繋がない
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps } from '../../logstore/src/index'
import * as S from '../src/index'
import { FAKE_DRIVE_TOKEN, FakeDrive } from './fakeDrive'
import { testDb } from './scenarioRunner'

const START = 1_800_000_000_000
const BOARD = 'https://a.5ch.io/x/'
const thread = (key: string) => ({ connectorId: '2ch-compat', boardUrl: BOARD, key, title: `t${key}`, postCount: 0, order: 0 })
const settle = async () => {
  for (let i = 0; i < 400; i++) await Promise.resolve()
}

class Clock {
  now = START
  private seq = 0
  timers = new Map<number, { at: number; f: () => void }>()
  setTimer = (f: () => void, ms: number) => {
    this.timers.set(++this.seq, { at: this.now + ms, f })
    return this.seq
  }
  clearTimer = (t: unknown) => void this.timers.delete(t as number)
  async advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.timers.delete(next[0])
      this.now = next[1].at
      next[1].f()
      await new Promise((r) => setImmediate(r))
      await settle()
    }
    this.now = end
    await new Promise((r) => setImmediate(r))
    await settle()
  }
}

/** 偽の Drive と、端末ごとの呼び出しの数え */
function world(clock: Clock) {
  return { clock, drive: new FakeDrive(() => clock.now), valid: new Set<string>() }
}
type World = ReturnType<typeof world>

function device(w: World, name: string, idleStops: boolean, interval: S.SyncIntervalId) {
  const db = testDb()
  let material: S.SyncKeyMaterial | null = null
  let stored: string | null = null
  const calls = { n: 0, units: 0 }
  /** B の画面に出た時刻(閉じたスレの key → 時刻) */
  const droppedAt = new Map<string, number>()
  /** 周で送った時刻 */
  const pushedAt: number[] = []
  const transport: S.SyncTransport = {
    async send(req) {
      const before = w.drive.units
      const res = w.drive.handle({ method: req.method, url: req.url, headers: req.headers, body: req.body })
      calls.n++
      calls.units += w.drive.units - before
      return res
    },
  }
  const auth: S.DriveAuth = {
    unavailable: async () => null,
    async login() {
      stored = `rt-${name}`
      w.valid.add(stored)
      return { account: 'acct-1' }
    },
    account: async () => (stored === null ? null : { account: 'acct-1', email: 'a@example.test' }),
    forget: async () => void (stored = null),
    revoke: async () => void (stored = null),
    pairingToken: async () => stored as string,
    async adopt(token) {
      stored = token
      return { account: 'acct-1', email: 'a@example.test' }
    },
    remote: S.driveRemote({ transport, accessToken: async () => FAKE_DRIVE_TOKEN }),
  }
  const resolve = (u: string) => ({ boardUrl: u, connectorId: '2ch-compat' })
  const ctl = new S.SyncController({
    db,
    keyStore: { load: async () => material, save: async (v) => void (material = v), clear: async () => void (material = null) },
    transport,
    defaultServerUrl: 'https://sync.test',
    drive: auth,
    adapters: [new S.FavoriteThreadAdapter(db, resolve), ...S.historyAdapters(db, { resolve, retentionDays: () => 0, newResetId: () => crypto.randomUUID().replaceAll('-', '') })],
    now: () => w.clock.now,
    keyHint: () => material !== null,
    openStartWindow: async () => null,
    onCycle: (r) => {
      if (r.pushed > 0) pushedAt.push(w.clock.now)
      for (const d of r.dropped) if (!droppedAt.has(d.key)) droppedAt.set(d.key, w.clock.now)
    },
  })
  const scheduler = new S.SyncScheduler({
    now: () => w.clock.now,
    setTimer: w.clock.setTimer,
    clearTimer: w.clock.clearTimer,
    enabled: () => ctl.autoEnabled(),
    cycle: (reason) => ctl.autoCycle(reason),
    check: () => ctl.autoCheck(),
    hasChanges: () => ctl.hasChanges(),
    pace: () => ctl.pace(),
    interval: () => ctl.intervalMs(),
    idleStops,
  })
  const store = new LogStore(db)
  const ops = new UserOps(store)
  // 利用者の操作が積んだ送信待ちを、画面と同じくスケジューラーへ知らせる(useSync・AppViewModel と同じつなぎ)
  store.onSyncOps(() => scheduler.changed())
  return { name, db, store, ops, ctl, scheduler, calls, droppedAt, pushedAt, interval }
}
type Device = ReturnType<typeof device>

/** PC(放置で止める)とスマホ(止めない)を Drive で対にし、keys のスレを両方で読んだ状態にする */
async function pairTwo(clock: Clock, interval: S.SyncIntervalId, keys: readonly string[]) {
  const w = world(clock)
  const a = device(w, 'phone', false, interval)
  const b = device(w, 'pc', true, interval)
  for (const d of [a, b]) {
    await d.ctl.setMaster(true)
    await d.ctl.setSyncInterval(interval)
  }
  await a.ctl.start()
  const { code } = await a.ctl.pairingCode()
  expect((await b.ctl.join(code)).state).toBe('confirm')
  expect((await b.ctl.resolveConfirm('accept_removal')).state).toBe('idle')
  for (const k of keys) {
    for (const d of [a, b]) {
      await d.db.execute('INSERT OR IGNORE INTO threads (board_url, key, connector_id, title) VALUES ($1, $2, $3, $4)', [BOARD, k, '2ch-compat', `t${k}`])
      await d.ops.markRead(thread(k), 5, clock.now)
    }
  }
  await a.ctl.syncNow()
  await b.ctl.syncNow()
  await a.ctl.syncNow()
  clock.now += 60_000
  a.calls.n = a.calls.units = 0
  b.calls.n = b.calls.units = 0
  return { w, a, b }
}

/**
 * A(スマホ)でログを消してから、B(PC)の画面でそのスレが閉じるまでの秒数。消す時刻を前面に来てからの経過でずらし、最大と平均を返す。
 * active は両方の利用者が 10 秒ごとに操作する。そうでなければ B は前面で放置(A は消す操作だけ)
 */
async function latency(interval: S.SyncIntervalId, active: boolean, offsets: readonly number[]) {
  const out: number[] = []
  /** A が送るまで */
  const sent: number[] = []
  for (const offset of offsets) {
    const clock = new Clock()
    const { a, b } = await pairTwo(clock, interval, ['1'])
    await a.scheduler.foreground()
    // 2 台の時計が揃わないよう、B は少し遅れて前面に来る
    await clock.advance(17_000)
    await b.scheduler.foreground()
    const step = 10_000
    const act = async (ms: number) => {
      for (let t = 0; t < ms; t += step) {
        await clock.advance(Math.min(step, ms - t))
        if (active) {
          a.scheduler.activity()
          b.scheduler.activity()
        }
      }
    }
    await act(offset)
    const t0 = clock.now
    a.scheduler.activity()
    await a.ops.deleteLogs([thread('1')], clock.now)
    for (let i = 0; i < 120 && !b.droppedAt.has('1'); i++) await act(step)
    a.scheduler.dispose()
    b.scheduler.dispose()
    // 届かなかった(放置で確認を止めた)ものは Infinity
    out.push(b.droppedAt.has('1') ? ((b.droppedAt.get('1') as number) - t0) / 1000 : Infinity)
    sent.push(((a.pushedAt.find((t) => t >= t0) as number) - t0) / 1000)
  }
  const mean = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10
  return { max: Math.max(...out), mean: mean(out), all: out, sentMax: Math.max(...sent), sentMean: mean(sent) }
}

/** 1 日の呼び出し(Drive)。docs の (a)(b)(c) と同じ場面 */
async function day(interval: S.SyncIntervalId, scene: 'a' | 'b' | 'c' | 'd') {
  const clock = new Clock()
  const { a: phone, b: pc } = await pairTwo(clock, interval, ['1', '2'])
  if (scene === 'a') {
    // PC 8 時間とスマホ 3 時間、1 分に 1 回読み続ける(同時ではない)
    await pc.scheduler.foreground()
    for (let m = 1; m <= 8 * 60; m++) {
      await clock.advance(60_000)
      await pc.ops.markRead(thread('1'), 5 + m, clock.now)
      pc.scheduler.activity()
    }
    await pc.scheduler.background()
    await phone.scheduler.foreground()
    for (let m = 1; m <= 3 * 60; m++) {
      await clock.advance(60_000)
      await phone.ops.markRead(thread('2'), 5 + m, clock.now)
      phone.scheduler.activity()
    }
    await phone.scheduler.background()
  } else if (scene === 'b') {
    // 読まずに開いているだけ
    await pc.scheduler.foreground()
    await clock.advance(8 * 3_600_000)
    await pc.scheduler.background()
    await phone.scheduler.foreground()
    await clock.advance(3 * 3_600_000)
    await phone.scheduler.background()
  } else if (scene === 'c') {
    // 2 台が同時に前面で 3 時間、PC だけ 1 分に 1 回読む
    await pc.scheduler.foreground()
    await phone.scheduler.foreground()
    for (let m = 1; m <= 3 * 60; m++) {
      await clock.advance(60_000)
      await pc.ops.markRead(thread('1'), 5 + m, clock.now)
      pc.scheduler.activity()
    }
    await clock.advance(300_000)
    await pc.scheduler.background()
    await phone.scheduler.background()
  } else {
    // (a) に、PC で 1 時間に 2 回お気に入りを付け外しする(早めに送る変更)を足す
    await pc.scheduler.foreground()
    for (let m = 1; m <= 8 * 60; m++) {
      await clock.advance(60_000)
      await pc.ops.markRead(thread('1'), 5 + m, clock.now)
      if (m % 30 === 7) await (m % 60 === 7 ? pc.ops.favoriteThreadRemove(thread('2'), clock.now) : pc.ops.favoriteThreadAdd(thread('2'), clock.now))
      pc.scheduler.activity()
    }
    await pc.scheduler.background()
    await phone.scheduler.foreground()
    for (let m = 1; m <= 3 * 60; m++) {
      await clock.advance(60_000)
      await phone.ops.markRead(thread('2'), 5 + m, clock.now)
      phone.scheduler.activity()
    }
    await phone.scheduler.background()
  }
  pc.scheduler.dispose()
  phone.scheduler.dispose()
  return { pushes: { pc: pc.pushedAt.length, phone: phone.pushedAt.length }, pc: { ...pc.calls }, phone: { ...phone.calls }, calls: pc.calls.n + phone.calls.n, units: pc.calls.units + phone.calls.units }
}

const OFFSETS = [0, 45_000, 130_000, 290_000, 470_000, 700_000]
const report = process.env.OBB_SYNC_REPORT === '1'

describe('送信待ちの知らせ', () => {
  it('利用者の操作が送信待ちを積んだときだけ知らせる。読んだ位置と開いた時刻は知らせない', async () => {
    const clock = new Clock()
    const { a } = await pairTwo(clock, '1m', ['1'])
    let n = 0
    const off = a.store.onSyncOps(() => n++)
    await a.ops.markRead(thread('1'), 9, clock.now)
    await a.ops.threadView(thread('1'), clock.now)
    expect(n).toBe(0)
    await a.ops.favoriteThreadAdd(thread('1'), clock.now)
    await a.ops.deleteLogs([thread('1')], clock.now)
    expect(n).toBe(2)
    // 同期を切っている間は積まないので知らせない
    await a.ctl.setMaster(false)
    await a.ops.favoriteThreadRemove(thread('1'), clock.now)
    expect(n).toBe(2)
    off()
  })
})

describe('A の変更が B の画面に出るまで(Drive)', () => {
  it('前面で操作している間は、選んだ間隔 + 送り出しのまとめ(5 秒)+ 1 回の確認の内に出る', async () => {
    const rs = []
    for (const [id, ms] of [['30s', 30_000], ['1m', 60_000], ['5m', 300_000]] as const) {
      const r = await latency(id, true, OFFSETS)
      if (report) console.log(`前面で操作 ${id}: 画面まで 最大 ${r.max} 秒・平均 ${r.mean} 秒(A が送るまで 最大 ${r.sentMax}・平均 ${r.sentMean}) ${JSON.stringify(r.all)}`)
      rs.push({ r, ms })
    }
    // 送り出しのまとめ 5 秒 + 確認の間隔 + 10 秒の刻み(操作の刻みで時計を進めるため)
    for (const { r, ms } of rs) expect(r.max).toBeLessThanOrEqual((S.PUSH_SOON_MS + ms) / 1000 + 10)
  }, 600_000)

  it('B が前面で放置なら、変化なしが続くと確認を延ばす(5 分まで)。PC は 10 分で止める', async () => {
    const r = await latency('30s', false, [0, 45_000, 130_000, 290_000])
    if (report) console.log(`前面で放置 30s: 画面まで 最大 ${r.max} 秒・平均 ${r.mean} 秒(A が送るまで 最大 ${r.sentMax}・平均 ${r.sentMean}) ${JSON.stringify(r.all)}`)
    expect(r.max).toBeLessThanOrEqual(S.HEAD_BACKOFF_MAX_MS / 1000 + S.PUSH_SOON_MS / 1000 + 10)
  }, 600_000)
})

describe.runIf(report)('1 日の Drive の呼び出し(OBB_SYNC_REPORT=1 のときだけ。数字を出す)', () => {
  it.each(['30s', '1m', '5m'] as const)('%s', async (id) => {
    for (const scene of ['a', 'b', 'c', 'd'] as const) {
      const r = await day(id, scene)
      console.log(`${id} (${scene}): 呼び出し ${r.calls}・単位 ${r.units}(PC ${r.pc.n} 回 ${r.pc.units}・スマホ ${r.phone.n} 回 ${r.phone.units})・送信 PC ${r.pushes.pc}・スマホ ${r.pushes.phone}`)
    }
  }, 1_800_000)
})
