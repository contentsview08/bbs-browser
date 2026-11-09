// 自動の同期のきっかけ。前面にいる間だけ動く。時計とタイマーは外から渡すので、偽の時計で試せる
import { HEAD_BACKOFF_MAX_MS, HEAD_INTERVAL_MS, IDLE_STOP_MS, NET_MIN_GAP_MS, NET_SETTLE_MS, NUDGE_MIN_GAP_MS, PACE_MAX_MS, PUSH_INTERVAL_MS } from '../config'

/** サーバーが応答で指示する「最低これだけ空ける」。アプリはこれより短くしない */
export interface SyncPace {
  head_sec?: number
  push_sec?: number
}

export type CycleReason = 'foreground' | 'tick' | 'background' | 'network'

export interface SchedulerHost {
  now(): number
  setTimer(f: () => void, ms: number): unknown
  clearTimer(t: unknown): void
  /** 使っていないときは何もしない */
  enabled(): Promise<boolean>
  /** 周を回す。pull の間隔はエンジンが守る */
  cycle(reason: CycleReason): Promise<void>
  /** GET /head。変化があれば true。304 と通信の失敗は false */
  check(): Promise<boolean>
  /** 送るものがあるか(通信しない) */
  hasChanges(): Promise<boolean>
  pace(): SyncPace | null
  /** 利用者の選んだ確認の間隔。null は手動のみ(自動では確かめず、この端末の変更を送るだけ)。ないときは既定の HEAD_INTERVAL_MS */
  interval?(): number | null
  /** PC は放置で確認を止める。スマホは前面なら操作がなくても見ている */
  idleStops: boolean
}

/** 既定(head は利用者の選んだ間隔)より短くせず、PACE_MAX_MS より長くしない */
export function paceMs(pace: SyncPace | null, head = HEAD_INTERVAL_MS): { head: number; push: number } {
  const ms = (sec: number | undefined, base: number) => (typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.min(PACE_MAX_MS, Math.max(base, Math.ceil(sec * 1000))) : base)
  return { head: ms(pace?.head_sec, head), push: ms(pace?.push_sec, PUSH_INTERVAL_MS) }
}

/** 「変化なし」が続いた回数から確認の間隔を決める。基本の間隔より短くせず、上限で止める */
export function headWaitMs(head: number, misses: number): number {
  return Math.max(head, Math.min(HEAD_BACKOFF_MAX_MS, head * 2 ** Math.min(misses, 16)))
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
  /** 確認が「変化なし」だった回数。間隔を伸ばす元。周を回す・操作・前面復帰で 0 に戻す */
  private misses = 0

  constructor(private readonly host: SchedulerHost) {}

  get isPaused(): boolean {
    return this.paused
  }

  /** 手動のみなら null */
  private headBase(): number | null {
    const v = this.host.interval ? this.host.interval() : HEAD_INTERVAL_MS
    return v === null ? null : Math.max(1_000, v)
  }

  private paces(): { head: number | null; push: number } {
    const base = this.headBase()
    const p = paceMs(this.host.pace(), base ?? HEAD_INTERVAL_MS)
    return { head: base === null ? null : p.head, push: p.push }
  }

  /** 間隔を選び直したとき。次の確認を新しい間隔で掛け直す */
  intervalChanged(): void {
    this.misses = 0
    this.schedule()
  }

  /** 次の確認と次の送信の早い方で起きる。確認を遠ざけている間も、送るものの有無は送信の間隔で見る */
  private schedule(): void {
    if (this.timer !== null) this.host.clearTimer(this.timer)
    this.timer = null
    if (!this.front || this.paused) return
    const { head, push } = this.paces()
    const now = this.host.now()
    const untilCheck = head === null ? Infinity : Math.max(0, this.lastCheck + headWaitMs(head, this.misses) - now)
    const untilPush = Math.max(0, this.lastPush + push - now)
    this.timer = this.host.setTimer(() => void this.tick().catch(() => undefined), Math.min(untilPush, untilCheck))
  }

  /** 走っている間のきっかけは捨てる(走っているものが終わりに時計を掛け直す) */
  private async guarded(f: () => Promise<void>): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await f()
    } finally {
      this.busy = false
      this.schedule()
    }
  }

  private async run(reason: CycleReason): Promise<void> {
    this.lastSync = this.host.now()
    this.lastCheck = this.lastSync
    this.lastPush = this.lastSync
    this.misses = 0
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
      const { head, push } = this.paces()
      const checkDue = head !== null && now - this.lastCheck >= headWaitMs(head, this.misses)
      const pushDue = now - this.lastPush >= push
      // 送るものがなくても・使っていなくても、次はここから数える(時計が空回りしないように)
      if (checkDue) this.lastCheck = now
      if (pushDue) this.lastPush = now
      if (!(await this.host.enabled())) return
      if (pushDue && (await this.host.hasChanges())) {
        await this.run('tick')
      } else if (checkDue) {
        if (await this.host.check()) await this.run('tick')
        else this.misses++
      }
    })
  }

  /** 直前に周を回していれば、窓の行き来では回さない */
  private recentlySynced(): boolean {
    return this.lastSync > 0 && this.host.now() - this.lastSync < NUDGE_MIN_GAP_MS
  }

  /** 前面に戻った。すぐ 1 回 pull して(直前に回していなければ)、時計を動かし始める */
  foreground(): Promise<void> {
    this.front = true
    this.paused = false
    this.lastActivity = this.host.now()
    this.lastCheck = this.lastActivity
    this.lastPush = this.lastActivity
    this.misses = 0
    if (this.recentlySynced()) {
      this.schedule()
      return Promise.resolve()
    }
    return this.guarded(async () => {
      // 手動のみでは、前面に戻っても確かめに行かない。送るものがあれば送る
      if ((await this.host.enabled()) && (this.headBase() !== null || (await this.host.hasChanges()))) await this.run('foreground')
    })
  }

  /** 裏に回る瞬間。送るものがあれば 1 回だけ試す。止められても送信待ちは DB に残る */
  background(): Promise<void> {
    this.front = false
    this.stopTimers()
    return this.flush(true)
  }

  /** 送るものがあれば 1 回だけ試す。時計は止めない。force は閉じるときと裏へ回るとき(次の機会がないので間隔によらず送る) */
  flush(force = false): Promise<void> {
    if (!force && this.recentlySynced()) return Promise.resolve()
    return this.guarded(async () => {
      if ((await this.host.enabled()) && (await this.host.hasChanges())) await this.run('background')
    })
  }

  /** 利用者の操作。伸ばしていた確認の間隔を基本に戻す。放置で止めていたら 1 回確認する */
  activity(): void {
    this.lastActivity = this.host.now()
    if (!this.front) return
    const stretched = this.misses > 0
    this.misses = 0
    if (this.paused) {
      this.paused = false
      this.lastCheck = 0
      void this.tick().catch(() => undefined)
    } else if (stretched) this.schedule()
  }

  /** ネットワークが戻った。すぐは不安定なので待ち、前回から空いていれば同期する */
  networkBack(): void {
    if (this.netTimer !== null) this.host.clearTimer(this.netTimer)
    this.netTimer = this.host.setTimer(() => {
      this.netTimer = null
      if (!this.front || this.host.now() - this.lastSync < NET_MIN_GAP_MS) return
      void this.guarded(async () => {
        if ((await this.host.enabled()) && (this.headBase() !== null || (await this.host.hasChanges()))) await this.run('network')
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
