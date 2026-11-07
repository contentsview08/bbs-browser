// 自動の同期のきっかけ。前面にいる間だけ動く。時計とタイマーは外から渡すので、偽の時計で試せる
import { HEAD_INTERVAL_MS, IDLE_STOP_MS, NET_MIN_GAP_MS, NET_SETTLE_MS, PUSH_INTERVAL_MS } from '../config'

/** サーバーが応答で指示する「最低これだけ空ける」。アプリはこれより短くしない */
export interface SyncPace {
  head_sec?: number
  push_sec?: number
}

export interface SchedulerHost {
  now(): number
  setTimer(f: () => void, ms: number): unknown
  clearTimer(t: unknown): void
  /** 使っていないときは何もしない */
  enabled(): Promise<boolean>
  /** 周を回す。pull の間隔はエンジンが守る */
  cycle(reason: 'foreground' | 'tick' | 'background' | 'network'): Promise<void>
  /** GET /head。変化があれば true。304 と通信の失敗は false */
  check(): Promise<boolean>
  /** 送るものがあるか(通信しない) */
  hasChanges(): Promise<boolean>
  pace(): SyncPace | null
  /** PC は放置で確認を止める。スマホは前面なら操作がなくても見ている */
  idleStops: boolean
}

export function paceMs(pace: SyncPace | null): { head: number; push: number } {
  const ms = (sec: number | undefined, base: number) => (typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.max(base, Math.ceil(sec * 1000)) : base)
  return { head: ms(pace?.head_sec, HEAD_INTERVAL_MS), push: ms(pace?.push_sec, PUSH_INTERVAL_MS) }
}

export class SyncScheduler {
  private front = false
  private paused = false
  private busy = false
  private timer: unknown = null
  private netTimer: unknown = null
  private lastActivity = 0
  private lastCheck = 0
  private lastPush = 0
  private lastSync = 0

  constructor(private readonly host: SchedulerHost) {}

  get isPaused(): boolean {
    return this.paused
  }

  private schedule(): void {
    if (this.timer !== null) this.host.clearTimer(this.timer)
    this.timer = null
    if (!this.front || this.paused) return
    const { head, push } = paceMs(this.host.pace())
    this.timer = this.host.setTimer(() => void this.tick().catch(() => undefined), Math.min(head, push))
  }

  private async guarded(f: () => Promise<void>): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await f()
    } finally {
      this.busy = false
    }
  }

  private async run(reason: 'foreground' | 'tick' | 'background' | 'network'): Promise<void> {
    this.lastSync = this.host.now()
    this.lastCheck = this.lastSync
    this.lastPush = this.lastSync
    await this.host.cycle(reason)
  }

  private async tick(): Promise<void> {
    this.timer = null
    if (!this.front) return
    const now = this.host.now()
    if (this.host.idleStops && now - this.lastActivity >= IDLE_STOP_MS) {
      this.paused = true
      return
    }
    await this.guarded(async () => {
      if (!(await this.host.enabled())) return
      const { head, push } = paceMs(this.host.pace())
      if (now - this.lastPush >= push && (await this.host.hasChanges())) {
        await this.run('tick')
      } else if (now - this.lastCheck >= head) {
        this.lastCheck = now
        if (await this.host.check()) await this.run('tick')
      }
    }).finally(() => this.schedule())
  }

  /** 前面に戻った。すぐ 1 回 pull して、時計を動かし始める */
  foreground(): Promise<void> {
    this.front = true
    this.paused = false
    this.lastActivity = this.host.now()
    this.schedule()
    return this.guarded(async () => {
      if (await this.host.enabled()) await this.run('foreground')
    })
  }

  /** 裏に回る瞬間。送るものがあれば 1 回だけ試す。止められても送信待ちは DB に残る */
  background(): Promise<void> {
    this.front = false
    this.stopTimers()
    return this.flush()
  }

  /** 送るものがあれば 1 回だけ試す。窓から離れたときと閉じるとき。時計は止めない */
  flush(): Promise<void> {
    return this.guarded(async () => {
      if ((await this.host.enabled()) && (await this.host.hasChanges())) await this.run('background')
    })
  }

  /** 利用者の操作。放置で止めていたら 1 回確認する */
  activity(): void {
    this.lastActivity = this.host.now()
    if (!this.front || !this.paused) return
    this.paused = false
    this.lastCheck = 0
    void this.tick().catch(() => undefined)
  }

  /** ネットワークが戻った。すぐは不安定なので待ち、前回から空いていれば同期する */
  networkBack(): void {
    if (this.netTimer !== null) this.host.clearTimer(this.netTimer)
    this.netTimer = this.host.setTimer(() => {
      this.netTimer = null
      if (!this.front || this.host.now() - this.lastSync < NET_MIN_GAP_MS) return
      void this.guarded(async () => {
        if (await this.host.enabled()) await this.run('network')
      }).catch(() => undefined)
    }, NET_SETTLE_MS)
  }

  private stopTimers(): void {
    if (this.timer !== null) this.host.clearTimer(this.timer)
    if (this.netTimer !== null) this.host.clearTimer(this.netTimer)
    this.timer = null
    this.netTimer = null
  }

  /** 画面が消えるとき */
  dispose(): void {
    this.front = false
    this.stopTimers()
  }
}
