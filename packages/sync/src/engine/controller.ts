// 画面から使う同期の入口。鍵・窓・HTTP は親が渡す。使っていない間は鍵保管にも通信にも触らない
import { NG_KIND } from '../adapters/ng'
import type { AdapterContext, SyncAdapter } from '../adapters/types'
import { toHex } from '../bytes'
import { DEFAULT_SYNC_INTERVAL, SYNC_INTERVALS, syncIntervalMs, type SyncIntervalId } from '../config'
import { deriveKeys, generateMasterKey, spaceId } from '../keys'
import { syncMessage } from '../messages'
import { encodeDrivePairingCode, encodePairingCode, parseDrivePairingCode, parsePairingCode, type PairingCode } from '../pairing'
import { type CycleResult, type ConfirmChoice, type SyncConfirm, SyncEngine, type SyncKeyStore } from './engine'
import type { CycleReason, SyncPace } from './scheduler'
import { masterOn, offKindsOf, parseSwitches, type SyncGroup, type SyncSwitches } from './kinds'
import { syncMismatches, syncSummary, type MismatchSummary, type SyncSummary } from './summary'
import { delState, setState, SyncTables, type SqlStatement, type SyncSqlDb } from './tables'
import type { DriveRemoteFactory } from './drive'
import type { SyncRemoteFactory } from './remote'
import { checkServerUrl, SyncApiError, ticketSpaceId, type SyncTransport } from './transport'

export const PAIRING_SHOW_MS = 60_000
/** 参加の確認のためにトークンを置いた印(同期の表の外の控え)。答えずに終わったら次の起動で消す */
const ADOPTED = 'google_adopted'
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
  /** 置き場の種類。Google ドライブを渡された端末(PC)はいつも drive */
  store: SyncStore
  /** Google ドライブの置き場の様子。Drive を渡されていない端末は null */
  drive: DriveStatus | null
  /** 利用者の選んだ同期の間隔 */
  interval: SyncIntervalId
}

export type SyncStore = 'server' | 'drive'

export interface DriveStatus {
  /** 使えない理由(ビルドにクライアントがないなど)。使えるなら null */
  unavailable: string | null
  /** ログインしているアカウントのメール。使っている間だけ見る(使っていない人の鍵保管を開かない) */
  email: string | null
}

/** Google のログインとトークンは親(PC では Rust)が持つ。トークンはここを通らない */
export interface DriveAuth {
  /** 使えない理由のコード(ビルドにクライアントがないなど)。使えるなら null */
  unavailable(): Promise<string | null>
  /**
   * 既定のブラウザでログインし、更新用のトークンを親の鍵保管に置く。expect は前のアカウント(permissionId)で、
   * 違うアカウントなら置き換えずに google_other_account で断る
   */
  login(expect: string | null): Promise<{ account: string }>
  /** ログインしているアカウント。通信しない */
  account(): Promise<{ account: string; email: string } | null>
  /** 手元のトークンを消す。Google へ取り消しは送らない(同じ許可を使う他の端末を止めないため) */
  forget(): Promise<void>
  /** Google へ取り消しを送り、手元のトークンも消す。全端末が止まる */
  revoke(): Promise<void>
  /** 端末を足すコード(obb2)に入れる更新用のトークン。コードを作るときだけ受け取り、持ち続けない */
  pairingToken(): Promise<string>
  /**
   * コードで受け取った更新用のトークンを Google に確かめて、親の鍵保管に置く(この端末は Google のログインをしない)。
   * expect と違うアカウントなら置かずに google_other_account。使えないトークンは google_pairing_failed
   */
  adopt(refreshToken: string, expect: string | null): Promise<{ account: string; email: string }>
  remote: DriveRemoteFactory
}

export interface SyncControllerDeps {
  db: SyncSqlDb
  keyStore: SyncKeyStore
  transport: SyncTransport
  defaultServerUrl: string
  /** 置き場の差し替え(テスト用)。あれば置き場の種類によらずこれを使う */
  remote?: SyncRemoteFactory
  /**
   * Google ドライブの置き場。渡すと置き場は Drive だけになり、同期サーバーで使っていた端末は同期をやめた状態に戻す。
   * 渡さなければ同期サーバー(サーバーの撤去までの試験用)
   */
  drive?: DriveAuth
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

const parseInterval = (v: string | null): SyncIntervalId => SYNC_INTERVALS.find((x) => x.id === v)?.id ?? DEFAULT_SYNC_INTERVAL

export class SyncController {
  private readonly t: SyncTables
  private engineValue: SyncEngine | null = null
  private engineUrl = ''
  private spaceHead: string | null = null
  /** 確認を待っている参加。答えが出るまで鍵も URL も書かない */
  private pendingJoin: (({ kind: 'server'; code: PairingCode } | { kind: 'drive'; k: Uint8Array; account: string }) & { confirm: SyncConfirm }) | null = null
  private engineQueue: Promise<unknown> = Promise.resolve()
  /** 同期サーバーで使っていた端末を戻したか(起動して最初の 1 回だけ見る) */
  private serverChecked = false
  /** 同期の間隔。時計(SyncScheduler)が同期で読むので手元に持つ */
  private intervalId: SyncIntervalId = DEFAULT_SYNC_INTERVAL
  /** このビルドで Google ドライブを使えるか(クライアントが入っているか)。起動の間は変わらないので 1 回だけ聞く */
  private driveOk: boolean | null = null

  constructor(private readonly deps: SyncControllerDeps) {
    this.t = new SyncTables(deps.db)
  }

  private async overrideUrl(): Promise<string | null> {
    return this.t.state('server_url')
  }

  private async serverUrl(): Promise<string> {
    return (await this.overrideUrl()) ?? this.deps.defaultServerUrl
  }

  /** Drive を渡され、ビルドにクライアントが入っているか。入っていない版(CI のリリースに入れ忘れたなど)ではサーバーのまま動かす */
  private async driveUsable(): Promise<boolean> {
    if (!this.deps.drive) return false
    this.driveOk ??= await this.deps.drive.unavailable().then((why) => why === null, () => false)
    return this.driveOk
  }

  /**
   * Drive を渡された端末は drive。ただしサーバーで使っている端末は、ビルドにクライアントがなければサーバーのまま動かす
   * (Drive へ移すと始められない)。使っていない端末は drive(始めるのも参加も Drive。使えなければ理由を返す)
   */
  private async store(): Promise<SyncStore> {
    if (!this.deps.drive) return 'server'
    if ((await this.t.state('store')) === 'drive' || !(await this.isEnabled())) return 'drive'
    return (await this.driveUsable()) ? 'drive' : 'server'
  }

  private async needDrive(): Promise<DriveAuth> {
    const d = this.deps.drive
    if (!d) throw new SyncHostError('google_unavailable')
    const why = await d.unavailable()
    if (why !== null) throw new SyncHostError(why)
    return d
  }

  /** ログインして、アカウントを同期の表に置く。前のアカウントと違えば止める(6 章) */
  private async driveLogin(): Promise<void> {
    const before = await this.t.state('google_account')
    const { account } = await (await this.needDrive()).login(before)
    if (before !== null && before !== account) throw new SyncHostError('google_other_account')
    await this.deps.db.batch([setState('google_account', account)])
  }

  /** 作り直しを順に行う。呼び出しが重なっても、同じ先へのエンジンは 1 つだけ(同じ leaseOwner の 2 つの周が並ばないように) */
  private engine(): Promise<SyncEngine> {
    const next = this.engineQueue.then(() => this.ensureEngine())
    this.engineQueue = next.catch(() => undefined)
    return next
  }

  private async ensureEngine(): Promise<SyncEngine> {
    const store = await this.store()
    // Drive の置き場では URL を使わないが、置き場が替わったらエンジンを作り直す
    const url = store === 'drive' ? 'drive:' : await this.serverUrl()
    if (this.engineValue === null || this.engineUrl !== url) {
      // 古い先へ走っている周を残さない
      await this.engineValue?.halt()
      this.engineUrl = url
      this.engineValue = new SyncEngine({
        db: this.deps.db,
        keyStore: this.deps.keyStore,
        transport: this.deps.transport,
        serverUrl: store === 'drive' ? this.deps.defaultServerUrl : url,
        remote: this.deps.remote ?? (store === 'drive' ? this.deps.drive?.remote : undefined),
        adapters: this.deps.adapters,
        now: this.deps.now,
        leaseOwner: this.deps.leaseOwner,
        allowLocalhost: this.deps.allowLocalhost,
        interval: () => this.intervalMs(),
      })
    }
    if (!this.serverChecked) {
      this.serverChecked = true
      this.intervalId = parseInterval(await this.t.state('interval'))
      await this.retireServer(this.engineValue)
      await this.forgetAdopted()
    }
    return this.engineValue
  }

  /** 参加の確認に答えずに終わったとき、確かめるために置いたトークンが残る。次の起動で消す */
  private async forgetAdopted(): Promise<void> {
    if ((await this.t.state(ADOPTED)) === null) return
    if (!(await this.isEnabled())) await this.deps.drive?.forget().catch(() => undefined)
    await this.deps.db.batch([delState(ADOPTED)])
  }

  /**
   * 同期サーバーで使っていた端末を、同期をやめた状態に戻す(本人の決定: 同期は Google ドライブだけ。移す期間は設けない)。
   * 手元のデータは消さない。スイッチはそのまま残し、Google で始め直す案内を最後のエラーに出す
   */
  private async retireServer(engine: SyncEngine): Promise<void> {
    if (!(await this.driveUsable()) || !(await this.isEnabled()) || (await this.t.state('store')) === 'drive') return
    const on = await this.isMasterOn()
    // 種類ごとのスイッチは端末の好みなので、やめても残す(Google で始め直したときに既定へ戻らないように)
    const kinds = await this.t.state('kinds')
    await engine.leave()
    this.spaceHead = null
    await this.deps.db.batch([setState('master', on ? '1' : '0'), setState('last_error', 'server_sync_ended'), ...(kinds !== null ? [setState('kinds', kinds)] : [])])
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

  private async pair(k: Uint8Array, ticket: string | null): Promise<void> {
    const engine = await this.engine()
    try {
      await engine.pair(k, ticket)
    } catch (e) {
      if (e instanceof SyncApiError) throw e
      throw new SyncHostError('key_store_unavailable')
    }
  }

  async status(): Promise<SyncStatus> {
    if (!this.serverChecked) await this.engine()
    const enabled = await this.isEnabled()
    const num = async (key: string) => {
      const v = await this.t.state(key)
      return v === null ? null : Number(v)
    }
    const kinds = parseSwitches(await this.t.state('kinds'))
    const pending = await this.t.pendingCount([...offKindsOf(kinds)], this.deps.adapters.flatMap((a) => [...a.ops]))
    const master = await this.isMasterOn()
    const rawConfirm = await this.t.state('pending_confirm')
    const lastError = await this.t.state('last_error')
    const store = await this.store()
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
      pending,
      lastError,
      lastErrorText: lastError === null ? null : syncMessage(lastError),
      lastPullAt: await num('last_pull_at'),
      lastPushAt: await num('last_push_at'),
      serverUrl: await this.serverUrl(),
      serverOverride: await this.overrideUrl(),
      confirm: this.pendingJoin?.confirm ?? (rawConfirm === null ? null : (JSON.parse(rawConfirm) as SyncConfirm)),
      store,
      interval: this.intervalId,
      drive: this.deps.drive ? { unavailable: await this.deps.drive.unavailable(), email: enabled ? ((await this.deps.drive.account().catch(() => null))?.email ?? null) : null } : null,
    }
  }

  /** 同期を始める。1 台目は K を作り、窓を閉じたら捨てる。止まっている領域は同じ K で確認を通し直す */
  async start(): Promise<CycleResult> {
    if (!(await this.isMasterOn())) throw new SyncHostError('sync_off')
    if ((await this.store()) === 'drive') return this.startDrive()
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

  /**
   * Google ドライブで始める(docs/sync-drive.md 5.2)。先にログインし、通ってから K を作る(ログインをやめたら何も残さない)。
   * 使っている最中(期限切れ・取り消しで止まった)なら、K と同期の表はそのままでトークンだけを置き直す
   */
  private async startDrive(): Promise<CycleResult> {
    await this.needDrive()
    const material = await this.loadKeys()
    const resuming = material !== null && (await this.isEnabled())
    await this.driveLogin()
    if (!resuming) {
      const k = generateMasterKey()
      await this.pair(k, null)
      await this.deps.db.batch([setState('store', 'drive')])
      this.spaceHead = spaceId(deriveKeys(k).auth_token).slice(0, 12)
    }
    return this.run(true)
  }

  /** Google へ取り消しを送り、この端末で同期をやめる(5.7「全端末で Google の接続を切る」)。Drive のファイルは残る */
  async revokeGoogle(): Promise<void> {
    await (await this.needDrive()).revoke()
    await this.leave()
  }

  /** Google ドライブで使っている量(バイト)。Drive で使っている間だけ。周とは別に 1 回 files.list を辿るので、画面を開いたときと同期の後だけ呼ぶ */
  async driveUsage(): Promise<number | null> {
    // 止まっている(ログインし直しを待つ)間は呼ばない。取り直しに失敗するだけなので
    if ((await this.store()) !== 'drive' || !(await this.isEnabled()) || !(await this.isMasterOn()) || (await this.t.state('phase')) === 'blocked') return null
    return (await this.needDrive()).remote.usage()
  }

  /** QR とコピー用のコードの中身。表示は 60 秒で消す。Drive では K と更新用のトークン(obb2) */
  async pairingCode(): Promise<{ code: string; showMs: number }> {
    if (!(await this.isEnabled())) throw new SyncHostError('already_on')
    const m = await this.loadKeys()
    if (m === null) throw new SyncHostError('key_store_unavailable')
    if ((await this.store()) === 'drive') {
      const refreshToken = await (await this.needDrive()).pairingToken()
      return { code: encodeDrivePairingCode({ k: m.k, refreshToken }), showMs: PAIRING_SHOW_MS }
    }
    if (m.ticket === null) throw new SyncHostError('ticket_required')
    return { code: encodePairingCode({ k: m.k, serverUrl: await this.serverUrl(), ticket: m.ticket }), showMs: PAIRING_SHOW_MS }
  }

  /**
   * QR・コードで参加する。手元の全部が相手の鍵で読める形で相手のサーバーへ行くので、送るものがあるか、
   * ふだんと違うサーバーなら先に確認を返す(state が confirm。答えは resolveConfirm)。まっさらな端末で既定のサーバーならそのまま入る
   */
  async join(code: string): Promise<CycleResult> {
    if (!(await this.isMasterOn())) throw new SyncHostError('sync_off')
    if ((await this.store()) === 'drive') return this.joinDrive(code)
    if (await this.isEnabled()) throw new SyncHostError('already_on')
    const c = parsePairingCode(code, this.deps.allowLocalhost)
    await this.loadKeys()
    this.pendingJoin = null
    const otherServer = c.serverUrl !== this.deps.defaultServerUrl
    const ctx: AdapterContext = { keys: deriveKeys(c.k), deviceId: '', now: this.deps.now() }
    if (otherServer || (await hasLocalData(this.deps.db, this.deps.adapters, ctx, this.deps.presetUrls ?? []))) {
      const confirm: SyncConfirm = { type: JOIN_DATA_CONFIRM, lost: 0, host: otherServer ? new URL(c.serverUrl).host : null }
      this.pendingJoin = { kind: 'server', code: c, confirm }
      return { state: 'confirm', pulled: 0, pushed: 0, conflicts: 0, applied: {}, dropped: [], confirm }
    }
    return this.finishJoin(c)
  }

  /**
   * obb2 で参加する(docs/sync-drive.md 5.5)。先にトークンを Google に確かめ、アカウントを確認に出す。
   * 手元が空でも確認を出す(どの Google アカウントの同期に入るかを、参加の前に見せる)。
   * 使っている最中でも、K が同じならトークンだけを置き直す(5.7 の配り直し。同期の表はそのまま)
   */
  private async joinDrive(code: string): Promise<CycleResult> {
    const c = parseDrivePairingCode(code)
    const d = await this.needDrive()
    if (await this.isEnabled()) {
      const m = await this.loadKeys()
      if (m === null || toHex(m.k) !== toHex(c.k)) throw new SyncHostError('already_on')
      const { account } = await d.adopt(c.refreshToken, await this.t.state('google_account'))
      await this.deps.db.batch([setState('google_account', account)])
      return this.run(true)
    }
    await this.loadKeys()
    this.pendingJoin = null
    const { account, email } = await d.adopt(c.refreshToken, null)
    // 答えずに終わったら、次の起動で置いたトークンを消す(forgetAdopted)
    await this.deps.db.batch([setState(ADOPTED, '1')])
    const ctx: AdapterContext = { keys: deriveKeys(c.k), deviceId: '', now: this.deps.now() }
    const data = await hasLocalData(this.deps.db, this.deps.adapters, ctx, this.deps.presetUrls ?? [])
    const confirm: SyncConfirm = { type: JOIN_DATA_CONFIRM, lost: 0, host: null, account: email || null, data }
    this.pendingJoin = { kind: 'drive', k: c.k, account, confirm }
    return { state: 'confirm', pulled: 0, pushed: 0, conflicts: 0, applied: {}, dropped: [], confirm }
  }

  private async finishDriveJoin(k: Uint8Array, account: string): Promise<CycleResult> {
    await this.pair(k, null)
    await this.deps.db.batch([setState('store', 'drive'), setState('google_account', account), delState(ADOPTED)])
    this.spaceHead = spaceId(deriveKeys(k).auth_token).slice(0, 12)
    return this.run(true)
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
    // Google のトークンも手元から消す(取り消しは送らない。同じトークンを使うほかの端末を止めないため)
    await this.deps.drive?.forget()
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
    const on = (await this.isEnabled()) || this.deps.keyHint()
    // 起動して最初のきっかけの前に、選んだ間隔を読み、サーバーで使っていた端末を戻す(時計が既定の間隔で 1 回動かないように)。
    // 参加の確認に答えずに終わった端末も、置いたトークンを消すためにここで見る
    if (!this.serverChecked && (on || (await this.t.state(ADOPTED)) !== null)) {
      await this.engine()
      return (await this.isEnabled()) || this.deps.keyHint()
    }
    return on
  }

  /** 確認の間隔(ms)。手動のみは null */
  intervalMs(): number | null {
    return syncIntervalMs(this.intervalId)
  }

  /** 同期の間隔を選ぶ。端末ごとの設定で、同期の表の外(sync_state)に置き、やめても残る */
  async setSyncInterval(id: SyncIntervalId): Promise<void> {
    await this.engine()
    const next = parseInterval(id)
    await this.deps.db.batch([setState('interval', next)])
    this.intervalId = next
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
      if (choice === 'keep_local') {
        // 確かめるために置いたトークンを残さない
        if (join.kind === 'drive') {
          await this.deps.drive?.forget()
          await this.deps.db.batch([delState(ADOPTED)])
        }
        return { state: 'off', pulled: 0, pushed: 0, conflicts: 0, applied: {}, dropped: [] }
      }
      return join.kind === 'drive' ? this.finishDriveJoin(join.k, join.account) : this.finishJoin(join.code)
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
