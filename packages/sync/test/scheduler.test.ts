// 自動の同期を偽の時計で確かめる。エンジンと偽サーバーは本物と同じ流れ
import { describe, expect, it } from 'vitest'
import { HEAD_INTERVAL_MS, IDLE_STOP_MS, NET_MIN_GAP_MS, NET_SETTLE_MS, paceMs, PUSH_INTERVAL_MS, SyncScheduler, type SchedulerHost } from '../src/index'

class FakeClock {
  now = 1_800_000_000_000
  private seq = 0
  private timers = new Map<number, { at: number; f: () => void }>()
  setTimer = (f: () => void, ms: number) => {
    this.timers.set(++this.seq, { at: this.now + ms, f })
    return this.seq
  }
  clearTimer = (t: unknown) => void this.timers.delete(t as number)
  get pending() {
    return this.timers.size
  }
  async advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.timers.delete(next[0])
      this.now = next[1].at
      next[1].f()
      // 非同期の続きを流す
      for (let i = 0; i < 20; i++) await Promise.resolve()
    }
    this.now = end
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
}

function setup(o: { idleStops?: boolean; changes?: boolean; changed?: boolean; enabled?: boolean; pace?: { head_sec?: number; push_sec?: number } } = {}) {
  const c = new FakeClock()
  const log: string[] = []
  const state = { changes: o.changes ?? false, changed: o.changed ?? false, enabled: o.enabled ?? true, pace: o.pace ?? null }
  const host: SchedulerHost = {
    now: () => c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    enabled: async () => state.enabled,
    cycle: async (r) => {
      log.push(r)
      state.changes = false
    },
    check: async () => {
      log.push('head')
      return state.changed
    },
    hasChanges: async () => state.changes,
    pace: () => state.pace,
    idleStops: o.idleStops ?? false,
  }
  return { c, log, state, s: new SyncScheduler(host) }
}

describe('自動の同期のきっかけ', () => {
  it('前面に来るとすぐ pull し、30 秒ごとに確認する。変化がなければ周を回さない', async () => {
    const { c, log, s } = setup()
    await s.foreground()
    expect(log).toEqual(['foreground'])
    await c.advance(HEAD_INTERVAL_MS - 1)
    expect(log).toEqual(['foreground'])
    await c.advance(1)
    expect(log).toEqual(['foreground', 'head'])
    await c.advance(HEAD_INTERVAL_MS * 3)
    expect(log).toEqual(['foreground', 'head', 'head', 'head', 'head'])
  })
  it('確認で変化があれば周を回す', async () => {
    const { c, log, s, state } = setup()
    await s.foreground()
    state.changed = true
    await c.advance(HEAD_INTERVAL_MS)
    expect(log).toEqual(['foreground', 'head', 'tick'])
  })
  it('変更がないと送らない。変更があれば次の 30 秒で 1 回だけ送る', async () => {
    const { c, log, s, state } = setup()
    await s.foreground()
    await c.advance(PUSH_INTERVAL_MS * 2)
    expect(log.filter((x) => x === 'tick')).toEqual([])
    state.changes = true
    await c.advance(PUSH_INTERVAL_MS)
    expect(log.filter((x) => x === 'tick')).toEqual(['tick'])
    await c.advance(PUSH_INTERVAL_MS * 3)
    expect(log.filter((x) => x === 'tick')).toEqual(['tick'])
  })
  it('裏に回る瞬間に送るものがあれば 1 回だけ試し、裏では何も動かない', async () => {
    const { c, log, s, state } = setup()
    await s.foreground()
    state.changes = true
    await s.background()
    expect(log).toEqual(['foreground', 'background'])
    expect(c.pending).toBe(0)
    state.changes = true
    await c.advance(HEAD_INTERVAL_MS * 20)
    s.activity()
    s.networkBack()
    await c.advance(NET_SETTLE_MS * 2)
    expect(log).toEqual(['foreground', 'background'])
  })
  it('裏に回るときに送るものがなければ通信しない', async () => {
    const { log, s } = setup()
    await s.foreground()
    await s.background()
    expect(log).toEqual(['foreground'])
  })
  it('ネットワークの復帰は 5 秒待ち、前回から 30 秒以上空いていれば同期する', async () => {
    const { c, log, s } = setup({ pace: { head_sec: 3600, push_sec: 3600 } })
    await s.foreground()
    await c.advance(10_000)
    s.networkBack()
    await c.advance(NET_SETTLE_MS)
    expect(log).toEqual(['foreground'])
    await c.advance(NET_MIN_GAP_MS)
    s.networkBack()
    await c.advance(NET_SETTLE_MS - 1)
    expect(log).toEqual(['foreground'])
    await c.advance(1)
    expect(log).toEqual(['foreground', 'network'])
  })
  it('PC は 10 分操作がなければ確認を止め、次の操作で 1 回確認する', async () => {
    const { c, log, s } = setup({ idleStops: true })
    await s.foreground()
    await c.advance(IDLE_STOP_MS)
    const before = log.length
    expect(s.isPaused).toBe(true)
    expect(c.pending).toBe(0)
    await c.advance(HEAD_INTERVAL_MS * 10)
    expect(log.length).toBe(before)
    s.activity()
    await c.advance(0)
    expect(log.length).toBe(before + 1)
    expect(log.at(-1)).toBe('head')
    expect(s.isPaused).toBe(false)
    await c.advance(HEAD_INTERVAL_MS)
    expect(log.length).toBe(before + 2)
  })
  it('操作が続けば止めない。スマホは操作がなくても止めない', async () => {
    const a = setup({ idleStops: true })
    await a.s.foreground()
    for (let i = 0; i < 25; i++) {
      await a.c.advance(HEAD_INTERVAL_MS)
      a.s.activity()
    }
    expect(a.s.isPaused).toBe(false)
    const b = setup()
    await b.s.foreground()
    await b.c.advance(IDLE_STOP_MS * 2)
    expect(b.s.isPaused).toBe(false)
    expect(b.log.at(-1)).toBe('head')
  })
  it('サーバーの指示より短くせず、指示が既定より短くても既定より縮めない', async () => {
    expect(paceMs(null)).toEqual({ head: HEAD_INTERVAL_MS, push: PUSH_INTERVAL_MS })
    expect(paceMs({ head_sec: 120, push_sec: 5 })).toEqual({ head: 120_000, push: PUSH_INTERVAL_MS })
    expect(paceMs({ head_sec: -1, push_sec: Number.NaN })).toEqual({ head: HEAD_INTERVAL_MS, push: PUSH_INTERVAL_MS })
    const { c, log, s } = setup({ pace: { head_sec: 120 } })
    await s.foreground()
    await c.advance(119_000)
    expect(log).toEqual(['foreground'])
    await c.advance(1_000)
    expect(log).toEqual(['foreground', 'head'])
  })
  it('使っていないときは何もしない', async () => {
    const { c, log, s } = setup({ enabled: false, changes: true })
    await s.foreground()
    await c.advance(HEAD_INTERVAL_MS * 4)
    await s.background()
    expect(log).toEqual([])
  })
})

