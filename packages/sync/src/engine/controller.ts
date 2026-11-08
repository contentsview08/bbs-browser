// 画面から使う同期の入口。鍵・窓・HTTP は親が渡す。使っていない間は鍵保管にも通信にも触らない
import { NG_KIND } from '../adapters/ng'
import type { AdapterContext, SyncAdapter } from '../adapters/types'
import { deriveKeys, generateMasterKey, spaceId } from '../keys'
import { syncMessage } from '../messages'
import { encodePairingCode, parsePairingCode, type PairingCode } from '../pairing'
import { type CycleResult, type ConfirmChoice, type SyncConfirm, SyncEngine, type SyncKeyStore } from './engine'
import type { CycleReason, SyncPace } from './scheduler'
import { masterOn, offKindsOf, parseSwitches, type SyncGroup, type SyncSwitches } from './kinds'
import { syncMismatches, syncSummary, type MismatchSummary, type SyncSummary } from './summary'
import { delState, setState, SyncTables, type SqlStatement, type SyncSqlDb } from './tables'
import { checkServerUrl, SyncApiError, ticketSpaceId, type SyncTransport } from './transport'

export const PAIRING_SHOW_MS = 60_000
/** 参加で手元を送る前の確認の種類 */
export const JOIN_DATA_CONFIRM = 'join_data'

/** 利用者の操作を続けられない理由。文は syncMessage */
export class SyncHostError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SyncHostError'
  }
}

export interface SyncStatus {
  /** 領域に入っている(鍵がある) */
  enabled: boolean
  /** 同期自体のスイッチ */
  master: boolean
  kinds: SyncSwitches
  state: string
  /** 領域の先頭。鍵は出さない */
  space: string | null
  /** 送信待ちの件数(まだレコードにしていない操作を含む) */
  pending: number
  lastError: string | null
  lastErrorText: string | null
  lastPullAt: number | null
  lastPushAt: number | null
  serverUrl: string
  /** 開発用の上書き。なければ既定値 */
  serverOverride: string | null
  confirm: SyncConfirm | null
}

export interface SyncControllerDeps {
  db: SyncSqlDb
  keyStore: SyncKeyStore
  transport: SyncTransport
  defaultServerUrl: string
  adapters: readonly SyncAdapter[]
  now: () => number
  allowLocalhost?: boolean
  leaseOwner?: string
  /** 最初から入っている掲示板・板の URL。まっさらな端末にもあるので、参加の確認では手元のデータに数えない */
  presetUrls?: readonly string[]
  /** 鍵保管に値があるかもしれない。使ったことのない人の鍵保管を起動のたびに開かないための控え */
  keyHint: () => boolean
  /** /start の窓を開く。許可証か、閉じたら null */
  openStartWindow: (url: string) => Promise<string | null>
  onCycle?: (r: CycleResult) => void
}

/**
 * 参加のとき、種まきで相手へ送るものが手元にあるか。閲覧履歴・既読・お気に入り(スレ・板)・書き込み履歴・自分のレスの印・
 * 上げた画像の履歴・サイト・NG を見る(設定は数えない)。最初から入っている掲示板・板は、まっさらな端末にもあるので数えない。
 * 既読は履歴から外したスレの分も種まきで送るので、read_at がなくても read_no があれば数える
 */
export async function hasLocalData(db: SyncSqlDb, adapters: readonly SyncAdapter[], ctx: AdapterContext, presetUrls: readonly string[]): Promise<boolean> {
  const any = async (sql: string, params: unknown[] = []) => Number((await db.select<{ n: number }>(`SELECT COUNT(*) AS n ${sql}`, params))[0]?.n ?? 0) > 0
  const notPreset = (col: string) => (presetUrls.length > 0 ? ` WHERE ${col} NOT IN (${presetUrls.map((_, i) => `$${i + 1}`).join(', ')})` : '')
  if (await any('FROM threads WHERE read_at IS NOT NULL OR read_no > 0')) return true
  if (await any('FROM favorite_threads')) return true
  if (await any('FROM post_history')) return true
  if (await any('FROM own_posts')) return true
  if (await any('FROM uploads')) return true
  if (await any(`FROM favorite_boards${notPreset('url')}`, [...presetUrls])) return true
  if (await any(`FROM sites${notPreset('menu_url')}`, [...presetUrls])) return true
  const ng = adapters.find((a) => a.kind === NG_KIND)
  return ((await ng?.localLines?.(ctx)) ?? []).length > 0
}

export class SyncController {
  private readonly t: SyncTables
  private engineValue: SyncEngine | null = null
  private engineUrl = ''
  private spaceHead: string | null = null
  /** 確認を待っている参加。答えが出るまで鍵も URL も書かない */
  private pendingJoin: { code: PairingCode; confirm: SyncConfirm } | null = null

  constructor(private readonly deps: SyncControllerDeps) {
    this.t = new SyncTables(deps.db)
  }

  private async overrideUrl(): Promise<string | null> {
    return this.t.state('server_url')
  }

  private async serverUrl(): Promise<string> {
    return (await this.overrideUrl()) ?? this.deps.defaultServerUrl
  }

  private async engine(): Promise<SyncEngine> {
    const url = await this.serverUrl()
    if (this.engineValue === null || this.engineUrl !== url) {
      // 古い先へ走っている周を残さない
      await this.engineValue?.halt()
      this.engineUrl = url
      this.engineValue = new SyncEngine({
        db: this.deps.db,
        keyStore: this.deps.keyStore,
        transport: this.deps.transport,
        serverUrl: url,
        adapters: this.deps.adapters,
        now: this.deps.now,
        leaseOwner: this.deps.leaseOwner,
        allowLocalhost: this.deps.allowLocalhost,
      })
    }
    return this.engineValue
  }

  private async isEnabled(): Promise<boolean> {
    return (await this.t.state('enabled')) === '1'
  }

  private async isMasterOn(): Promise<boolean> {
    return masterOn(await this.t.state('master'), await this.t.state('enabled'))
  }

  private async onAdapters(): Promise<readonly SyncAdapter[]> {
    const off = offKindsOf(parseSwitches(await this.t.state('kinds')))
    return this.deps.adapters.filter((a) => !off.has(a.kind))
  }

  private async run(manual: boolean, quick = false): Promise<CycleResult> {
    const r = await (await this.engine()).runCycle({ manual, quick })
    this.deps.onCycle?.(r)
    return r
  }

  private async loadKeys() {
    try {
      return await this.deps.keyStore.load()
    } catch {
      throw new SyncHostError('key_store_unavailable')
    }
  }

  private async pair(k: Uint8Array, ticket: string): Promise<void> {
    const engine = await this.engine()
    try {
      await engine.pair(k, ticket)
    } catch (e) {
      if (e instanceof SyncApiError) throw e
      throw new SyncHostError('key_store_unavailable')
    }
  }

  async status(): Promise<SyncStatus> {
    const enabled = await this.isEnabled()
    const num = async (key: string) => {
      const v = await this.t.state(key)
      return v === null ? null : Number(v)
    }
    const kinds = parseSwitches(await this.t.state('kinds'))
    const off = [...offKindsOf(kinds)]
    const marks = off.map((_, i) => `$${i + 1}`).join(', ')
    // 切っている種類は送らないので数えない
    const [row] = await this.deps.db.select<{ n: number }>(`SELECT (SELECT COUNT(*) FROM sync_records WHERE pending = 1${off.length > 0 ? ` AND kind NOT IN (${marks})` : ''}) + (SELECT COUNT(*) FROM sync_ops) AS n`, off)
    const master = await this.isMasterOn()
    const rawConfirm = await this.t.state('pending_confirm')
    const lastError = await this.t.state('last_error')
    // 切っている間は鍵保管を開かない
    if (enabled && master && this.spaceHead === null) {
      const m = await this.deps.keyStore.load().catch(() => null)
      if (m) this.spaceHead = spaceId(deriveKeys(m.k).auth_token).slice(0, 12)
    }
    return {
      enabled,
      master,
      kinds,
      state: !master ? 'off' : enabled ? (this.engineValue?.state === 'off' || !this.engineValue ? ((await this.t.state('phase')) ?? 'idle') : this.engineValue.state) : this.pendingJoin ? 'confirm' : 'off',
      space: enabled ? this.spaceHead : null,
      pending: Number(row?.n ?? 0),
      lastError,
      lastErrorText: lastError === null ? null : syncMessage(lastError),
      lastPullAt: await num('last_pull_at'),
      lastPushAt: await num('last_push_at'),
      serverUrl: await this.serverUrl(),
      serverOverride: await this.overrideUrl(),
      confirm: this.pendingJoin?.confirm ?? (rawConfirm === null ? null : (JSON.parse(rawConfirm) as SyncConfirm)),
    }
  }

  /** 同期を始める。1 台目は K を作り、窓を閉じたら捨てる。止まっている領域は同じ K で確認を通し直す */
  async start(): Promise<CycleResult> {
    if (!(await this.isMasterOn())) throw new SyncHostError('sync_off')
    const url = checkServerUrl(await this.serverUrl(), this.deps.allowLocalhost)
    const material = await this.loadKeys()
    const resuming = material !== null && (await this.isEnabled())
    const k = resuming ? material.k : generateMasterKey()
    const id = spaceId(deriveKeys(k).auth_token)
    const ticket = await this.deps.openStartWindow(`${url}/start?space_id=${id}&return=app`)
    if (ticket === null) throw new SyncHostError('cancelled')
    if (ticketSpaceId(ticket) !== id) throw new SyncHostError('bad_ticket')
    if (resuming) await (await this.engine()).setTicket(ticket)
    else await this.pair(k, ticket)
    this.spaceHead = id.slice(0, 12)
    return this.run(true)
  }

  /** QR とコピー用のコードの中身。表示は 60 秒で消す */
  async pairingCode(): Promise<{ code: string; showMs: number }> {
    if (!(await this.isEnabled())) throw new SyncHostError('already_on')
    const m = await this.loadKeys()
    if (m === null) throw new SyncHostError('key_store_unavailable')
    if (m.ticket === null) throw new SyncHostError('ticket_required')
    return { code: encodePairingCode({ k: m.k, serverUrl: await this.serverUrl(), ticket: m.ticket }), showMs: PAIRING_SHOW_MS }
  }

  /**
   * QR・コードで参加する。手元の全部が相手の鍵で読める形で相手のサーバーへ行くので、送るものがあるか、
   * ふだんと違うサーバーなら先に確認を返す(state が confirm。答えは resolveConfirm)。まっさらな端末で既定のサーバーならそのまま入る
   */
  async join(code: string): Promise<CycleResult> {
    if (!(await this.isMasterOn())) throw new SyncHostError('sync_off')
    if (await this.isEnabled()) throw new SyncHostError('already_on')
    const c = parsePairingCode(code, this.deps.allowLocalhost)
    await this.loadKeys()
    this.pendingJoin = null
    const otherServer = c.serverUrl !== this.deps.defaultServerUrl
    const ctx: AdapterContext = { keys: deriveKeys(c.k), deviceId: '', now: this.deps.now() }
    if (otherServer || (await hasLocalData(this.deps.db, this.deps.adapters, ctx, this.deps.presetUrls ?? []))) {
      const confirm: SyncConfirm = { type: JOIN_DATA_CONFIRM, lost: 0, host: otherServer ? new URL(c.serverUrl).host : null }
      this.pendingJoin = { code: c, confirm }
      return { state: 'confirm', pulled: 0, pushed: 0, conflicts: 0, applied: {}, dropped: [], confirm }
    }
    return this.finishJoin(c)
  }

  /** URL は pair が通ってから書く。失敗した参加の先を残さない */
  private async finishJoin(c: PairingCode): Promise<CycleResult> {
    await this.engineValue?.halt()
    await this.pair(c.k, c.ticket)
    await this.writeServerUrl(c.serverUrl)
    this.spaceHead = spaceId(deriveKeys(c.k).auth_token).slice(0, 12)
    return this.run(true)
  }

  syncNow(): Promise<CycleResult> {
    return this.run(true)
  }

  /** 前面に戻ったとき。pull の間隔はエンジンが守る。使っていないなら何もしない */
  async foreground(): Promise<CycleResult | null> {
    if (!(await this.autoEnabled())) return null
    return this.run(false)
  }

  /** オフの間は通信も積みも起きない。鍵と領域は残すので、オンに戻せば続きから動く */
  async setMaster(on: boolean): Promise<void> {
    await (await this.engine()).setMaster(on)
    if (on && (await this.isEnabled())) await this.run(true)
  }

  async setKind(group: SyncGroup, on: boolean): Promise<void> {
    await (await this.engine()).setKind(group, on)
    if (on && (await this.isEnabled()) && (await this.isMasterOn())) await this.run(true)
  }

  /** 鍵と同期の表を消し、サーバーの URL も既定へ戻す。手元のデータは消さない */
  async leave(): Promise<void> {
    this.pendingJoin = null
    await (await this.engine()).leave()
    this.spaceHead = null
  }

  /** 自動の同期の口。周の結果は手動と同じ流れで画面へ渡す。確認の時計と裏に回る瞬間の周は、直前の確認が「変化なし」なら pull を省く */
  async autoCycle(reason: CycleReason = 'tick'): Promise<void> {
    await this.run(false, reason === 'tick' || reason === 'background')
  }

  async autoCheck(): Promise<boolean> {
    return (await this.engine()).checkHead()
  }

  async hasChanges(): Promise<boolean> {
    return (await this.engine()).hasChanges()
  }

  async autoEnabled(): Promise<boolean> {
    if ((await this.t.state('master')) === '0') return false
    return (await this.isEnabled()) || this.deps.keyHint()
  }

  pace(): SyncPace | null {
    return this.engineValue?.pace ?? null
  }

  private async adapterContext(): Promise<AdapterContext | null> {
    if (!(await this.isEnabled()) || !(await this.isMasterOn())) return null
    const m = await this.deps.keyStore.load().catch(() => null)
    return m && { keys: deriveKeys(m.k), deviceId: m.deviceId, now: this.deps.now() }
  }

  /** 種類ごとの件数とハッシュ。本文や URL は出さない */
  async summary(): Promise<SyncSummary | null> {
    const ctx = await this.adapterContext()
    return ctx && syncSummary(this.deps.db, await this.onAdapters(), ctx)
  }

  /** 手元と同期の表の違いを数える。件数によって時間がかかるので押したときだけ */
  async mismatches(): Promise<MismatchSummary | null> {
    const ctx = await this.adapterContext()
    return ctx && syncMismatches(this.deps.db, await this.onAdapters(), ctx)
  }

  async resolveConfirm(choice: ConfirmChoice): Promise<CycleResult> {
    const join = this.pendingJoin
    if (join) {
      this.pendingJoin = null
      if (choice === 'keep_local') return { state: 'off', pulled: 0, pushed: 0, conflicts: 0, applied: {}, dropped: [] }
      return this.finishJoin(join.code)
    }
    await (await this.engine()).resolveConfirm(choice)
    return this.run(true)
  }

  private async writeServerUrl(url: string): Promise<void> {
    const override = url === this.deps.defaultServerUrl ? delState('server_url') : setState('server_url', url)
    await this.deps.db.batch([override])
  }

  /**
   * 空で既定値に戻す。使っている間に変えたら、新しい先に領域がないかもしれないので全件を合わせ直す。
   * 手元のレコードを消さず、version は計画が決め直す
   */
  async setServerUrl(url: string): Promise<void> {
    const next = url.trim() === '' ? this.deps.defaultServerUrl : checkServerUrl(url.trim(), this.deps.allowLocalhost)
    const current = await this.serverUrl()
    if (next === current) return
    await this.engineValue?.halt()
    const stmts: SqlStatement[] = [next === this.deps.defaultServerUrl ? delState('server_url') : setState('server_url', next)]
    if (await this.isEnabled()) stmts.push(setState('since', '0'), setState('recreate_pending', '1'), delState('epoch'), delState('gc_floor'), delState('push_inflight'), delState('last_error'))
    await this.deps.db.batch(stmts)
  }
}
