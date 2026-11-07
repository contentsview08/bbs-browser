// 画面から使う同期の入口。鍵・窓・HTTP は親が渡す。使っていない間は鍵保管にも通信にも触らない
import type { AdapterContext, SyncAdapter } from '../adapters/types'
import { deriveKeys, generateMasterKey, spaceId } from '../keys'
import { syncMessage } from '../messages'
import { encodePairingCode, parsePairingCode } from '../pairing'
import { type CycleResult, type ConfirmChoice, SyncEngine, type SyncKeyStore } from './engine'
import type { SyncPace } from './scheduler'
import { masterOn, offKindsOf, parseSwitches, type SyncGroup, type SyncSwitches } from './kinds'
import { syncMismatches, syncSummary, type MismatchSummary, type SyncSummary } from './summary'
import { delState, setState, SyncTables, type SqlStatement, type SyncSqlDb } from './tables'
import { checkServerUrl, SyncApiError, ticketSpaceId, type SyncTransport } from './transport'

export const PAIRING_SHOW_MS = 60_000

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
  confirm: { type: string; lost: number } | null
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
  /** 鍵保管に値があるかもしれない。使ったことのない人の鍵保管を起動のたびに開かないための控え */
  keyHint: () => boolean
  /** /start の窓を開く。許可証か、閉じたら null */
  openStartWindow: (url: string) => Promise<string | null>
  onCycle?: (r: CycleResult) => void
}

export class SyncController {
  private readonly t: SyncTables
  private engineValue: SyncEngine | null = null
  private engineUrl = ''
  private spaceHead: string | null = null

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

  private async run(manual: boolean): Promise<CycleResult> {
    const r = await (await this.engine()).runCycle({ manual })
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
      state: !master ? 'off' : enabled ? (this.engineValue?.state === 'off' || !this.engineValue ? ((await this.t.state('phase')) ?? 'idle') : this.engineValue.state) : 'off',
      space: enabled ? this.spaceHead : null,
      pending: Number(row?.n ?? 0),
      lastError,
      lastErrorText: lastError === null ? null : syncMessage(lastError),
      lastPullAt: await num('last_pull_at'),
      lastPushAt: await num('last_push_at'),
      serverUrl: await this.serverUrl(),
      serverOverride: await this.overrideUrl(),
      confirm: rawConfirm === null ? null : (JSON.parse(rawConfirm) as { type: string; lost: number }),
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

  async join(code: string): Promise<CycleResult> {
    if (!(await this.isMasterOn())) throw new SyncHostError('sync_off')
    if (await this.isEnabled()) throw new SyncHostError('already_on')
    const c = parsePairingCode(code, this.deps.allowLocalhost)
    await this.loadKeys()
    await this.engineValue?.halt()
    await this.writeServerUrl(c.serverUrl)
    await this.pair(c.k, c.ticket)
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

  async leave(): Promise<void> {
    await (await this.engine()).leave()
    this.spaceHead = null
  }

  /** 自動の同期の口。周の結果は手動と同じ流れで画面へ渡す */
  async autoCycle(): Promise<void> {
    await this.run(false)
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
