// 同期エンジン。周の順は必ず draining → pull → apply → push。通信・時計・鍵保管は外から渡すので、偽物で試せる
import { randomBytes } from '@noble/ciphers/utils.js'
import type { AdapterContext, ApplyPlan, OpEffect, OpTarget, RecordRefs, SyncAdapter } from '../adapters/types'
import { toBase64Url, toHex } from '../bytes'
import {
  APPLY_BATCH,
  APPLY_SPLIT_AFTER,
  backoffDelayMs,
  JOIN_CONFIRM_MIN,
  LEASE_MS,
  PULL_MIN_GAP_MS,
  PUSH_BATCH_BYTES,
  PUSH_BATCH_RECORDS,
  PUSH_MAX_ROUNDS,
  REBASE_LIMIT,
  REBASE_WINDOW_MS,
  TRIM_BATCH,
  TRIM_ROUNDS,
  RECREATE_RETRY_MS,
  SCHEMA_VERSION,
  WRITE_BATCH,
} from '../config'
import { openRecords, sealPayload, type KindTag } from '../crypto'
import { SyncError } from '../errors'
import { compareHlc, HLC_ZERO, hlcObserve, hlcStamp } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { paceMs, type SyncPace } from './scheduler'
import { checkDeviceId, deriveKeys, generateDeviceId, normalizeBoardUrl, spaceId, type SyncKeys } from '../keys'
import { LAST_VIEWED_FIELD, makeTombstone, mergePayloads, type SyncPayload } from '../merge'
import { planRebase, planRecreate, settleRecord, type LocalRecord } from '../rebase'
import { checkPayload } from '../schema'
import {
  asLocal,
  clearNeedsApply,
  delOp,
  delRecord,
  delState,
  isDeleted,
  setState,
  SyncTables,
  writeRecord,
  type SqlStatement,
  type StoredRecord,
  type SyncSqlDb,
} from './tables'
import { kindsOfGroups, masterOn, offKindsOf, parseSwitches, SECRET_KIND, SYNC_GROUPS, type SyncGroup, type SyncSwitches } from './kinds'
import { SyncApi, SyncApiError, ticketSpaceId, type SyncTransport } from './transport'

export interface SyncKeyMaterial {
  k: Uint8Array
  deviceId: string
  /** 領域の作成の許可証。k と一緒に動くので一緒に置く。これだけでは領域を作れない(トークンが要る) */
  ticket: string | null
}

/** OS の鍵保管に置く。k を同期の表にも settings にも置かない */
export interface SyncKeyStore {
  load(): Promise<SyncKeyMaterial | null>
  save(v: SyncKeyMaterial): Promise<void>
  clear(): Promise<void>
}

function checkTicketFor(k: Uint8Array, ticket: string): void {
  if (ticketSpaceId(ticket) !== spaceId(deriveKeys(k).auth_token)) throw new SyncApiError('bad_ticket')
}

export type SyncEngineState =
  | 'off'
  | 'joining'
  | 'confirm'
  | 'seeding'
  | 'idle'
  | 'draining'
  | 'pulling'
  | 'merging'
  | 'applying'
  | 'pushing'
  | 'backoff'
  | 'offline'
  | 'rebasing'
  | 'recreating'
  | 'recreate_waiting'
  | 'blocked'

export type ConfirmChoice = 'accept_removal' | 'keep_local'

export interface SyncEngineDeps {
  db: SyncSqlDb
  keyStore: SyncKeyStore
  transport: SyncTransport
  serverUrl: string
  adapters: readonly SyncAdapter[]
  now: () => number
  newDeviceId?: () => string
  newRequestId?: () => string
  /** 0 以上 1 未満 */
  jitter?: () => number
  /** 同じ DB を別の起動が動かさないようにする。スマホは 1 つの起動なので使わない */
  leaseOwner?: string
  allowLocalhost?: boolean
  onState?: (s: SyncEngineState) => void
}

export interface CycleResult {
  state: SyncEngineState
  pulled: number
  pushed: number
  conflicts: number
  /** 画面が読み直すもの。キーはアダプターの area。適用で手元が変わったときだけ立つ */
  applied: Record<string, boolean>
  /** 周を始めなかった理由 */
  skipped?: 'backoff' | 'lease' | 'waiting' | 'halting'
}

/** 領域がない・作り直された。newEpoch は応答で分かった新しい値 */
class SpaceGone extends Error {
  constructor(readonly newEpoch?: string) {
    super('space_gone')
  }
}
class NeedsRebase extends Error {
  constructor(readonly gcFloor: number) {
    super('needs_rebase')
  }
}
class CycleStop extends Error {
  constructor(readonly state: SyncEngineState) {
    super('stop')
  }
}

interface ServerMeta {
  kind_tag: KindTag
  schema_version: number
}

interface FullRead {
  full: Record<string, LocalRecord>
  meta: Map<string, ServerMeta>
  head: number
  gcFloor: number
  /** 途中で打ち切ったときの原因。読めた分は使う */
  failure: unknown
}

interface InflightEntry {
  record_id: string
  hlc: string
}

const LAST_VIEW = 'last_view'
/** 外す順。書き込みと画像は閲覧履歴の後。docs/sync-client.md の「容量を超えるとき」 */
const TRIM_ORDER: readonly (readonly string[])[] = [[LAST_VIEW, 'read_dev'], ['image'], ['post']]

/** 応答に待ち時間がないときの、権限系の読み直しの間隔 */
const REFETCH_RETRY_MS = 3_600_000

const emptyRefs: RecordRefs = { ref_board: null, ref_thread: null, ref_detail: null, ref_local: null }

function refsFromBody(p: SyncPayload, detail: string | null): RecordRefs {
  const board = p.body?.board_url
  const thread = p.body?.thread
  return { ...emptyRefs, ref_board: typeof board === 'string' ? normalizeBoardUrl(board) : null, ref_thread: typeof thread === 'string' ? thread : null, ref_detail: detail }
}

/** 一度分かった ref は消さない。tombstone は本文を残さないので、ここから何のレコードかを知る */
const keepRefs = (a: RecordRefs | undefined, b: RecordRefs): RecordRefs => ({
  ref_board: b.ref_board ?? a?.ref_board ?? null,
  ref_thread: b.ref_thread ?? a?.ref_thread ?? null,
  ref_detail: b.ref_detail ?? a?.ref_detail ?? null,
  ref_local: b.ref_local ?? a?.ref_local ?? null,
})

const refsOf = (r: StoredRecord | undefined): RecordRefs | undefined =>
  r && { ref_board: r.ref_board, ref_thread: r.ref_thread, ref_detail: r.ref_detail, ref_local: r.ref_local }

const same = (a: SyncPayload, b: SyncPayload) => canonicalJson(a) === canonicalJson(b)

/** 権限系だけ k_secret で封をする */
const tagOfKind = (kind: string): KindTag => (kind === SECRET_KIND ? 's' : 'h')

export class SyncEngine {
  private readonly t: SyncTables
  private readonly db: SyncSqlDb
  private readonly deps: SyncEngineDeps
  private readonly kinds: string[]
  private readonly opNames: string[]
  private readonly newDeviceId: () => string
  private readonly newRequestId: () => string
  private readonly jitter: () => number

  private current: SyncEngineState = 'off'
  private running: Promise<CycleResult> | null = null
  private again = false
  private againManual = false
  private againQuick = false
  private deviceChecked = false
  private reconciled = false
  private filled = false
  private attempts = 0
  private retryAt = 0
  private applyFailures = 0
  /** 別の領域へ移る途中。走っている周を次の区切りで止め、古い領域の受信を新しい表に混ぜない */
  private halting = false
  /** 直前の確認が「変化なし」(304 か同じ version)だった時刻。自動の周で pull を省く根拠 */
  private headFreshAt = 0
  private paceValue: SyncPace | null = null

  // 周の間だけ持つ
  private keys!: SyncKeys
  private api!: SyncApi
  private spaceIdValue = ''
  private deviceId = ''
  private result!: CycleResult
  /** この周で切っている種類。周の途中で切り替えるときは halt で周を終わらせてから書く */
  private offKinds: ReadonlySet<string> = new Set()

  constructor(deps: SyncEngineDeps) {
    this.deps = deps
    this.db = deps.db
    this.t = new SyncTables(deps.db)
    this.kinds = [...new Set(deps.adapters.map((a) => a.kind))]
    this.opNames = deps.adapters.flatMap((a) => [...a.ops])
    this.newDeviceId = deps.newDeviceId ?? generateDeviceId
    this.newRequestId = deps.newRequestId ?? (() => toBase64Url(randomBytes(16)))
    this.jitter = deps.jitter ?? Math.random
  }

  get state(): SyncEngineState {
    return this.current
  }

  /** サーバーの指示。覚えておくので、304 の間も効く */
  get pace(): SyncPace | null {
    return this.paceValue
  }

  /** 送るものがあるか。通信しない。切っている種類の送信待ちは数えない(自動の同期を空回りさせない) */
  async hasChanges(): Promise<boolean> {
    if (!(await this.isMasterOn())) return false
    const off = [...offKindsOf(await this.switches())]
    const marks = off.map((_, i) => `$${i + 1}`).join(', ')
    const [row] = await this.db.select<{ n: number }>(`SELECT (SELECT COUNT(*) FROM sync_ops) + (SELECT COUNT(*) FROM sync_records WHERE pending = 1${off.length > 0 ? ` AND kind NOT IN (${marks})` : ''}) AS n`, off)
    return Number(row?.n ?? 0) > 0
  }

  private async isMasterOn(): Promise<boolean> {
    return masterOn(await this.t.state('master'), await this.t.state('enabled'))
  }

  async switches(): Promise<SyncSwitches> {
    return parseSwitches(await this.t.state('kinds'))
  }

  /** 同期自体のスイッチ。切っても鍵と領域は残す。戻したら切っていた間の手元の行を補う */
  async setMaster(on: boolean): Promise<void> {
    await this.halt()
    const stmts: SqlStatement[] = [setState('master', on ? '1' : '0')]
    if (on && (await this.t.state('enabled')) === '1') {
      const sw = await this.switches()
      stmts.push(setState('kinds_resume', canonicalJson(SYNC_GROUPS.flatMap((g) => (sw[g.id] ? [g.id] : [])))))
    }
    await this.db.batch(stmts)
    this.headFreshAt = 0
  }

  /**
   * 種類ごとのスイッチ。切ってもサーバーのデータは消さない。
   * 権限系を切ったら同期の表の平文を残さない(手元の削除ページは残るので、オンに戻せば作り直せる)
   */
  async setKind(group: SyncGroup, on: boolean): Promise<void> {
    await this.halt()
    const sw = await this.switches()
    if (sw[group] === on) return
    sw[group] = on
    const saved = Object.fromEntries(SYNC_GROUPS.flatMap((g) => (sw[g.id] === g.default ? [] : [[g.id, sw[g.id]]])))
    const raw = await this.t.state('kinds_resume')
    const resume = new Set((raw ? parseStrictJson(raw) : []) as string[])
    if (on) resume.add(group)
    else resume.delete(group)
    const stmts: SqlStatement[] = [setState('kinds', canonicalJson(saved)), resume.size > 0 ? setState('kinds_resume', canonicalJson([...resume])) : delState('kinds_resume')]
    if (group === 'secret') {
      if (on) stmts.push(setState('secret_refetch', '0'))
      else stmts.push(delState('secret_refetch'), { sql: 'DELETE FROM sync_records WHERE kind = $1', params: [SECRET_KIND] }, { sql: "DELETE FROM sync_ops WHERE op IN ('secret_put', 'secret_remove')" }, delState('push_inflight'))
    }
    await this.db.batch(stmts)
  }

  /** 走っている周を止めて、終わるまで待つ。表を消す・別の領域へ移るときはこれを先に通す */
  async halt(): Promise<void> {
    this.halting = true
    this.again = false
    this.againManual = false
    try {
      await this.running?.catch(() => undefined)
    } finally {
      this.halting = false
    }
  }

  /** 確認に付ける ETag。覚えずに手元の since と epoch から作る(周が失敗しても、送った分だけ since を進めても、ずれない) */
  private async headEtag(): Promise<string | null> {
    const epoch = await this.t.state('epoch')
    return epoch === null ? null : `"${epoch}:${Number((await this.t.state('since')) ?? 0)}"`
  }

  /** GET /head。変化があれば true(次に周を回す)。変化なし・通信の失敗は false。周の中では呼ばない */
  async checkHead(): Promise<boolean> {
    if (this.running || (await this.t.state('enabled')) !== '1' || !(await this.isMasterOn())) return false
    if ((await this.t.state('phase')) !== 'idle' || this.deps.now() < this.retryAt) return false
    const material = await this.deps.keyStore.load()
    if (!material) return false
    if (!(await this.takeLease())) return false
    const keys = deriveKeys(material.k)
    const api = new SyncApi(this.deps.serverUrl, toHex(keys.auth_token), this.deps.transport, this.deps.allowLocalhost)
    try {
      const head = await api.head(await this.headEtag())
      if (api.pace) this.paceValue = api.pace
      if (head.version === null) {
        this.headFreshAt = this.deps.now()
        return false
      }
      const since = Number((await this.t.state('since')) ?? 0)
      const changed = head.version > since || (head.gc_floor as number) > since || head.epoch !== (await this.t.state('epoch'))
      this.headFreshAt = changed ? 0 : this.deps.now()
      return changed
    } catch (e) {
      // 404・401 は周の流れ(作り直し・止める)で扱う
      if (e instanceof SyncApiError && e.kind === 'http' && (e.status === 404 || e.status === 401)) {
        this.headFreshAt = 0
        return true
      }
      if (e instanceof SyncApiError && e.kind === 'http' && e.status === 429) this.waitFor(e)
      else this.retryAt = this.deps.now() + backoffDelayMs(this.attempts++, this.jitter())
      return false
    }
  }

  /** 429 の応答の指示より早く試さない */
  private waitFor(e: SyncApiError): void {
    const sec = e.detail?.retry_after_sec
    const told = typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.ceil(sec * 1000) : 0
    this.retryAt = this.deps.now() + Math.max(told, backoffDelayMs(this.attempts++, this.jitter()))
  }

  private enter(s: SyncEngineState): void {
    this.current = s
    this.deps.onState?.(s)
  }

  /**
   * 走っている間のきっかけは「もう 1 周」の印にする。
   * quick は確認の時計と裏に回る瞬間の周。直前の確認が「変化なし」なら pull を省く(前面復帰・手動は省かない)
   */
  runCycle(o: { manual?: boolean; quick?: boolean } = {}): Promise<CycleResult> {
    if (this.running) {
      this.againQuick = this.again ? this.againQuick && o.quick === true : o.quick === true
      this.again = true
      this.againManual ||= o.manual === true
      return this.running
    }
    this.running = this.loop(o.manual === true, o.quick === true).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async loop(manual: boolean, quick: boolean): Promise<CycleResult> {
    let r = await this.cycle(manual, quick)
    while (this.again) {
      const m = this.againManual
      const q = this.againQuick
      this.again = false
      this.againManual = false
      this.againQuick = false
      const next = await this.cycle(m, q)
      // 画面が読み直す印を前の周の分まで渡す
      r = { ...next, pulled: r.pulled + next.pulled, pushed: r.pushed + next.pushed, conflicts: r.conflicts + next.conflicts, applied: { ...r.applied, ...next.applied } }
    }
    return r
  }

  /** 使い始め。鍵と端末 ID を保管してから enabled を立てる。ここから利用者の操作が積まれ始める */
  async pair(k: Uint8Array, ticket: string | null): Promise<void> {
    if (ticket !== null) checkTicketFor(k, ticket)
    await this.halt()
    this.headFreshAt = 0
    this.paceValue = null
    const deviceId = this.newDeviceId()
    await this.deps.keyStore.save({ k, deviceId, ticket })
    await this.db.batch([setState('device_id', deviceId), setState('clock', HLC_ZERO), setState('since', '0'), setState('phase', 'joining'), setState('enabled', '1'), delState('master'), delState('kinds_resume')])
    this.deviceChecked = true
    this.reconciled = false
    this.filled = false
  }

  /** 同期を始めるページから受け取った許可証を置く。止まっていれば次の手動の同期で続く */
  async setTicket(ticket: string): Promise<void> {
    const material = await this.deps.keyStore.load()
    if (!material) throw new SyncApiError('bad_ticket')
    checkTicketFor(material.k, ticket)
    await this.deps.keyStore.save({ ...material, ticket })
  }

  /** この端末で同期をやめる。手元のデータは消さない */
  async leave(): Promise<void> {
    await this.halt()
    this.headFreshAt = 0
    this.paceValue = null
    await this.clearTables()
    await this.deps.keyStore.clear()
    this.enter('off')
  }

  /** サーバーの URL の上書きは同期の中身ではないので残す */
  private clearTables(): Promise<void> {
    return this.db.batch([{ sql: 'DELETE FROM sync_records' }, { sql: 'DELETE FROM sync_ops' }, { sql: "DELETE FROM sync_state WHERE key <> 'server_url'" }])
  }

  /**
   * 確認の答え。合流で keep_local は「進まない」なのでやめる。
   * リベースの keep_local は手元を消さず、領域が消えたときと同じく全部を合わせ直して送る
   */
  async resolveConfirm(choice: ConfirmChoice): Promise<void> {
    const raw = await this.t.state('pending_confirm')
    if (raw === null) return
    const plan = parseStrictJson(raw) as { type: string; lost: number }
    if (plan.type === 'join') {
      if (choice === 'keep_local') await this.leave()
      else await this.db.batch([delState('pending_confirm'), setState('phase', 'idle')])
    } else if (choice === 'accept_removal') {
      await this.db.batch([delState('pending_confirm'), setState('phase', 'idle'), setState('rebase_accepted', String(plan.lost))])
    } else {
      await this.db.batch([delState('pending_confirm'), setState('phase', 'idle'), setState('recreate_pending', '1'), setState('since', '0')])
    }
  }

  private async cycle(manual: boolean, quick: boolean): Promise<CycleResult> {
    const result: CycleResult = { state: 'off', pulled: 0, pushed: 0, conflicts: 0, applied: {} }
    this.result = result
    if (this.halting) {
      result.skipped = 'halting'
      return result
    }
    const finish = (s: SyncEngineState) => {
      this.enter(s)
      result.state = s
      return result
    }
    // 切っている間は鍵保管にも通信にも触らない
    if ((await this.t.state('master')) === '0') return finish('off')
    if (!this.deviceChecked && !(await this.checkDevice())) return finish('off')
    if ((await this.t.state('enabled')) !== '1') return finish('off')
    const material = await this.deps.keyStore.load()
    if (!material) return finish('off')
    if (!(await this.takeLease())) {
      result.skipped = 'lease'
      return finish(this.current)
    }
    this.keys = deriveKeys(material.k)
    this.spaceIdValue = spaceId(this.keys.auth_token)
    this.deviceId = material.deviceId
    this.offKinds = offKindsOf(await this.switches())

    let phase = (await this.t.state('phase')) ?? 'joining'
    if (phase === 'confirm') return finish('confirm')
    if (phase === 'blocked') {
      if (!manual) return finish('blocked')
      phase = (await this.t.state('phase_before')) ?? 'idle'
      await this.db.batch([setState('phase', phase), delState('phase_before')])
    }
    if (phase === 'recreate_waiting' && !manual) {
      const tried = Number((await this.t.state('recreate_tried_at')) ?? 0)
      if (this.deps.now() - tried < RECREATE_RETRY_MS) {
        result.skipped = 'waiting'
        return finish('recreate_waiting')
      }
    }
    if (!manual && this.deps.now() < this.retryAt) {
      result.skipped = 'backoff'
      return finish(this.current === 'offline' ? 'offline' : 'backoff')
    }
    try {
      this.api = new SyncApi(this.deps.serverUrl, toHex(this.keys.auth_token), this.deps.transport, this.deps.allowLocalhost)
      this.enter('draining')
      await this.drain()
      await this.flow(manual, quick)
      if (this.api.pace) this.paceValue = this.api.pace
      this.attempts = 0
      this.retryAt = 0
      await this.db.execute('DELETE FROM sync_state WHERE key = $1', ['last_error'])
      return finish('idle')
    } catch (e) {
      return finish(await this.failed(e))
    }
  }

  private async failed(e: unknown): Promise<SyncEngineState> {
    if (e instanceof CycleStop) return e.state
    let code = 'internal'
    let next: SyncEngineState = 'backoff'
    if (e instanceof SyncApiError) {
      if (e.kind === 'bad_url') return this.block('bad_url')
      if (e.kind === 'http' && e.status === 401) return this.block('auth_failed')
      code = e.kind === 'http' ? (e.code || `http_${e.status}`) : e.kind
      if (e.kind === 'network') next = 'offline'
      // 再送しない 4xx。次のきっかけでまた試す
      if (e.kind === 'http' && e.status >= 400 && e.status < 500 && e.status !== 429) {
        await this.noteError(code)
        return 'idle'
      }
    }
    await this.noteError(code)
    if (e instanceof SyncApiError && e.kind === 'http' && e.status === 429) this.waitFor(e)
    else this.retryAt = this.deps.now() + backoffDelayMs(this.attempts++, this.jitter())
    return next
  }

  private async noteError(code: string): Promise<void> {
    try {
      await this.putState('last_error', code)
    } catch {
      // DB が止まっているときは画面に出す値を諦める
    }
  }

  private async block(code: string): Promise<SyncEngineState> {
    const phase = (await this.t.state('phase')) ?? 'idle'
    await this.db.batch([setState('phase', 'blocked'), ...(phase === 'blocked' ? [] : [setState('phase_before', phase)]), setState('last_error', code)])
    return 'blocked'
  }

  /** 別の PC へ DB を入れると同じ device_id が 2 台でき、read_dev がぶつかる */
  private async checkDevice(): Promise<boolean> {
    this.deviceChecked = true
    const material = await this.deps.keyStore.load()
    const inDb = await this.t.state('device_id')
    switch (checkDeviceId(material?.deviceId ?? null, inDb)) {
      case 'none':
        return false
      case 'ok':
        return true
      case 'clear':
        await this.clearTables()
        return false
      case 'rejoin': {
        const deviceId = this.newDeviceId()
        await this.deps.keyStore.save({ ...(material as SyncKeyMaterial), deviceId })
        await this.clearTables()
        await this.db.batch([setState('device_id', deviceId), setState('clock', HLC_ZERO), setState('since', '0'), setState('phase', 'joining'), setState('enabled', '1')])
        return true
      }
    }
  }

  private async takeLease(): Promise<boolean> {
    const owner = this.deps.leaseOwner
    if (owner === undefined) return true
    const now = this.deps.now()
    await this.db.batch([
      { sql: "INSERT OR IGNORE INTO sync_state (key, value) VALUES ('engine_lease', '0:')" },
      {
        sql: "UPDATE sync_state SET value = $1 WHERE key = 'engine_lease' AND (CAST(value AS INTEGER) < $2 OR substr(value, instr(value, ':') + 1) = $3)",
        params: [`${now + LEASE_MS}:${owner}`, now, owner],
      },
    ])
    const v = await this.t.state('engine_lease')
    return v !== null && v.slice(v.indexOf(':') + 1) === owner
  }

  private putState(key: string, value: string): Promise<void> {
    const { sql, params } = setState(key, value)
    return this.db.execute(sql, params)
  }

  /** 長い周の途中で別の起動に渡っていたら、そこで止める */
  private async keepLease(): Promise<void> {
    if (this.halting) throw new CycleStop('idle')
    if (!(await this.takeLease())) throw new CycleStop('idle')
  }

  private refsOfBody(p: SyncPayload): RecordRefs {
    const adapter = this.deps.adapters.find((a) => a.kind === p.kind && a.detailOf)
    return refsFromBody(p, adapter?.detailOf?.(p) ?? null)
  }

  private onAdapters(): SyncAdapter[] {
    return this.deps.adapters.filter((a) => !this.offKinds.has(a.kind))
  }

  private ctx(): AdapterContext {
    return { keys: this.keys, deviceId: this.deviceId, now: this.deps.now() }
  }

  /** sync_ops を前から処理する。適用と入れ違った操作でも手元が揃うよう、needs_apply を立てて写し直す */
  private async drain(): Promise<void> {
    for (;;) {
      const ops = await this.t.ops(this.opNames, WRITE_BATCH)
      if (ops.length === 0) return
      const ctx = this.ctx()
      let clock = (await this.t.state('clock')) ?? HLC_ZERO
      const stmts: SqlStatement[] = []
      const touched = new Map<string, StoredRecord>()
      const put = async (target: OpTarget, make: OpEffect['make'], atMs: number, floor?: string): Promise<void> => {
        const existing = touched.get(target.record_id) ?? (await this.t.record(target.record_id)) ?? undefined
        const before = existing?.payload.hlc
        const stamped = hlcStamp(clock, atMs, this.deviceId, floor !== undefined && (before === undefined || compareHlc(floor, before) > 0) ? floor : before)
        const payload = make(existing?.payload ?? null, stamped.stamp)
        if (payload === null) return
        if (checkPayload(payload) === null) {
          await this.countBad('local')
          return
        }
        clock = stamped.clock
        const settled = settleRecord(payload, existing?.version ?? 0, existing && asLocal(existing), ctx.now)
        touched.set(target.record_id, {
          record_id: target.record_id,
          kind: payload.kind,
          kind_tag: existing?.kind_tag ?? tagOfKind(payload.kind),
          schema_version: existing?.schema_version ?? SCHEMA_VERSION,
          payload,
          hlc: payload.hlc,
          version: settled.version,
          pending: true,
          priority: 0,
          needs_apply: true,
          ...keepRefs(refsOf(existing), target.refs),
          tomb_at: settled.tomb_at ?? null,
        })
      }
      for (const op of ops) {
        const adapter = this.deps.adapters.find((a) => a.ops.includes(op.op)) as SyncAdapter
        // 権限系は切ったあとに残った操作も処理しない。ほかの種類は切る前の変更なので、送信待ちとして持ち続ける
        if (adapter.kind === SECRET_KIND && this.offKinds.has(SECRET_KIND)) {
          stmts.push(delOp(op.seq))
          continue
        }
        if (adapter.expand) {
          // 前の操作の結果を読むので、先に書いてから 1 件だけで処理する
          if (touched.size > 0) break
          stmts.push(delOp(op.seq))
          const effects = await adapter.expand(op, ctx)
          if (effects === null) await this.countBad('local')
          for (const e of effects ?? []) await put(e.target, e.make, op.at_ms, e.floor)
          break
        }
        stmts.push(delOp(op.seq))
        const target = adapter.target(op, ctx)
        if (!target) {
          await this.countBad('local')
          continue
        }
        // fromOp は読み取りがあるので、先に作って中で使う
        const existing = touched.get(target.record_id) ?? (await this.t.record(target.record_id)) ?? undefined
        const stamp = hlcStamp(clock, op.at_ms, this.deviceId, existing?.payload.hlc).stamp
        const made = await adapter.fromOp(op, existing?.payload ?? null, stamp, ctx)
        await put(target, () => made, op.at_ms)
      }
      for (const r of touched.values()) stmts.push(writeRecord(r))
      stmts.push(setState('clock', clock))
      await this.db.batch(stmts)
    }
  }

  private async countBad(reason: string): Promise<void> {
    const raw = await this.t.state('bad_counts')
    const counts = (raw ? parseStrictJson(raw) : {}) as Record<string, number>
    counts[reason] = (counts[reason] ?? 0) + 1
    await this.putState('bad_counts', canonicalJson(counts))
  }

  private async flow(manual: boolean, quick: boolean): Promise<void> {
    // 作り直しとリベースは周の中で 1 度ずつあれば足りる。それ以上はサーバーがおかしいので次の周へ回す
    for (let i = 0; i < 4; i++) {
      try {
        await this.step(manual, quick)
        return
      } catch (e) {
        if (e instanceof SpaceGone) await this.onSpaceGone(e)
        else if (e instanceof NeedsRebase) await this.rebase()
        else throw e
      }
    }
    throw new SyncApiError('bad_response')
  }

  private async step(manual: boolean, quick: boolean): Promise<void> {
    let phase = (await this.t.state('phase')) ?? 'joining'
    if (phase === 'recreate_waiting') throw new SpaceGone()
    let pulled = false
    let seeded = false
    if ((await this.t.state('recreate_pending')) === '1') {
      await this.finishRecreate()
      pulled = true
    }
    if (phase === 'joining') {
      this.enter('joining')
      await this.pull(true)
      await this.putState('phase', 'seeding')
      phase = 'seeding'
      pulled = true
    }
    // 権限系のレコードは切っている間は開かずに読み飛ばしたので、最初から読み直す
    if (Number((await this.t.state('secret_refetch')) ?? Infinity) <= this.deps.now()) pulled = (await this.refetchSecrets()) || pulled
    if (phase === 'seeding') {
      this.enter('seeding')
      await this.seedAndPlan()
      phase = 'idle'
      seeded = true
      await this.db.batch([delState('kinds_resume')])
    } else {
      await this.catchUp()
    }
    if (!seeded && !this.reconciled) {
      await this.reconcile()
    }
    this.reconciled = true
    if (!seeded && (manual || !this.filled)) await this.fillMissing()
    this.filled = true
    const now = this.deps.now()
    if (!pulled && (manual || (now - Number((await this.t.state('last_pull_at')) ?? 0) >= PULL_MIN_GAP_MS && !(quick && this.headIsFresh(now))))) await this.pull(false)
    await this.applyAll()
    await this.pushAll()
    // 409 のマージでサーバーの値が勝つと、手元へ写すものが増える
    if (this.result.conflicts > 0) await this.applyAll()
  }

  /**
   * 直前の確認が「変化なし」で、確認の間隔がまだ過ぎていないか。
   * 確認の時計は前の確認が終わってから数えるので、次の周は間隔よりわずかに遅れて来る。その分 PULL_MIN_GAP_MS を足す。
   * 省いた間に他の端末が同じレコードを書いていれば 409 で分かり、マージして読み直す
   */
  private headIsFresh(now: number): boolean {
    return this.headFreshAt > 0 && now - this.headFreshAt < paceMs(this.paceValue).head + PULL_MIN_GAP_MS
  }

  /** pull。joining の全件の読み取りではリベースを見ない(since = 0 がすでに全件なので) */
  private async pull(joining: boolean): Promise<void> {
    let since = Number((await this.t.state('since')) ?? 0)
    for (;;) {
      this.enter('pulling')
      await this.keepLease()
      const page = await this.call(() => this.api.changes(since))
      await this.checkEpoch(page.epoch)
      if (!joining && since > 0 && page.gc_floor > since) throw new NeedsRebase(page.gc_floor)
      const last = page.records.reduce((m, r) => (typeof r.version === 'number' && Number.isSafeInteger(r.version) ? Math.max(m, r.version) : m), since)
      const next = page.more ? last : Math.max(last, page.head)
      if (page.more && next <= since) throw new SyncApiError('no_progress')
      this.enter('merging')
      if (this.halting) throw new CycleStop('idle')
      await this.mergePage(page.records, next, page.gc_floor)
      since = next
      if (!page.more) return
    }
  }

  /** 404 だけ領域がないと読み替える。ほかの失敗はそのまま周の失敗にする */
  private async call<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f()
    } catch (e) {
      if (e instanceof SyncApiError && e.kind === 'http' && e.status === 404) throw new SpaceGone()
      throw e
    }
  }

  /** 全応答の epoch を見る。初めて見る値はそのまま覚える */
  private async checkEpoch(epoch: string): Promise<void> {
    const known = await this.t.state('epoch')
    if (known === null) await this.putState('epoch', epoch)
    else if (known !== epoch) throw new SpaceGone(epoch)
  }

  /** 権限系を切っている端末は開かない。version は呼ぶ側が数えるので、読み飛ばしてもページングは進む */
  private readable(raw: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    return this.offKinds.has(SECRET_KIND) ? raw.filter((r) => r.kind_tag !== 's') : [...raw]
  }

  private async mergePage(raw: Record<string, unknown>[], since: number, gcFloor: number): Promise<void> {
    const now = this.deps.now()
    const readable = this.readable(raw)
    const opened = openRecords(this.keys, this.spaceIdValue, readable)
    const metaOf = new Map(readable.map((r) => [r.record_id as string, r]))
    const local = await this.t.records(opened.records.map((r) => r.record_id))
    let clock = (await this.t.state('clock')) ?? HLC_ZERO
    const stmts: SqlStatement[] = []
    for (const rec of opened.records) {
      const m = metaOf.get(rec.record_id) as Record<string, unknown>
      const row = this.merged(local.get(rec.record_id), rec.record_id, rec.payload, rec.version, { kind_tag: m.kind_tag as KindTag, schema_version: m.schema_version as number }, now)
      local.set(rec.record_id, row)
      stmts.push(writeRecord(row))
      clock = hlcObserve(clock, rec.payload.hlc, now)
    }
    for (const f of opened.failed) await this.countBad(f.reason)
    // since はレコードと同じバッチで進むので、途中までは有効
    stmts.push(setState('since', String(since)), setState('clock', clock), setState('gc_floor', String(gcFloor)), setState('last_pull_at', String(now)))
    await this.db.batch(stmts)
    this.result.pulled += opened.records.length
  }

  /** 受け取った 1 件を手元と合わせる。手元の方が新しければ送り直す。変わったものだけ写す */
  private merged(l: StoredRecord | undefined, id: string, server: SyncPayload, version: number, meta: ServerMeta, now: number): StoredRecord {
    const payload = l ? mergePayloads(l.payload, server) : server
    const fromServer = same(payload, server)
    const settled = settleRecord(payload, Math.max(l?.version ?? 0, version), l && asLocal(l), now)
    return {
      record_id: id,
      kind: payload.kind,
      kind_tag: fromServer ? meta.kind_tag : (l as StoredRecord).kind_tag,
      schema_version: fromServer ? meta.schema_version : (l as StoredRecord).schema_version,
      payload,
      hlc: payload.hlc,
      version: settled.version,
      pending: !fromServer,
      priority: l?.priority ?? 5,
      needs_apply: !l || !same(l.payload, payload) || l.needs_apply,
      ...keepRefs(refsOf(l), this.refsOfBody(payload)),
      tomb_at: settled.tomb_at ?? null,
    }
  }

  /** 全件の読み取りには 1 時間の回数の制限がある。断られても権限系の分だけ後回しにして、ほかの同期を止めない */
  private async refetchSecrets(): Promise<boolean> {
    const before = (await this.t.state('since')) ?? '0'
    await this.putState('since', '0')
    try {
      await this.pull(true)
    } catch (e) {
      if (!(e instanceof SyncApiError && e.kind === 'http' && e.status === 429)) throw e
      const sec = e.detail?.retry_after_sec
      const wait = typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.ceil(sec * 1000) : REFETCH_RETRY_MS
      await this.db.batch([setState('since', before), setState('secret_refetch', String(this.deps.now() + wait))])
      return false
    }
    await this.db.batch([delState('secret_refetch')])
    return true
  }

  /** 今のデータをレコードと合わせる。元の時刻の HLC なので、後から消したものには負け、切っていた間に増えたものは勝つ */
  private async seedOne(adapter: SyncAdapter, ctx: AdapterContext): Promise<void> {
    const rows = await adapter.seed(ctx)
    // 件数の多い人でも 1 回の呼び出しを小さく保つ。ID が決まっているので途中で切れてもやり直せる
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      const chunk = rows.slice(i, i + WRITE_BATCH)
      const local = await this.t.records(chunk.map((r) => r.record_id))
      const stmts: SqlStatement[] = []
      for (const r of chunk) {
        const l = local.get(r.record_id)
        const payload = l ? mergePayloads(l.payload, r.payload) : r.payload
        const changed = !l || !same(l.payload, payload)
        const settled = settleRecord(payload, l?.version ?? 0, l && asLocal(l), ctx.now)
        stmts.push(
          writeRecord({
            record_id: r.record_id,
            kind: payload.kind,
            kind_tag: l?.kind_tag ?? tagOfKind(payload.kind),
            schema_version: l?.schema_version ?? SCHEMA_VERSION,
            payload,
            hlc: payload.hlc,
            version: settled.version,
            pending: changed || (l?.pending ?? false),
            priority: l?.priority ?? r.priority,
            needs_apply: l?.needs_apply ?? false,
            ...keepRefs(refsOf(l), r.refs),
            tomb_at: settled.tomb_at ?? null,
          }),
        )
      }
      if (stmts.length > 0) await this.db.batch(stmts)
    }
  }

  /**
   * スイッチをオンに戻したあと。切っていた間に増えた手元の行を種まきで補い、切っていた間に受け取った分と手元の違いを全部写し直す。
   * 切っていた間の手元の削除は積んでいないので、同期の表の値へ戻る
   */
  private async catchUp(): Promise<void> {
    const raw = await this.t.state('kinds_resume')
    if (raw === null) return
    const groups = (parseStrictJson(raw) as string[]).filter((g) => !kindsOfGroups([g]).some((k) => this.offKinds.has(k)))
    const ctx = this.ctx()
    const kinds = kindsOfGroups(groups)
    for (const adapter of this.deps.adapters) if (kinds.includes(adapter.kind)) await this.seedOne(adapter, ctx)
    const marks = kinds.map((_, i) => `$${i + 1}`).join(', ')
    await this.db.batch([...(kinds.length > 0 ? [{ sql: `UPDATE sync_records SET needs_apply = 1 WHERE kind IN (${marks})`, params: kinds }] : []), delState('kinds_resume')])
  }

  /** 種まきと合流の残り。古い HLC なので新しい削除に勝たない。ID が決まっているのでやり直しても重ならない */
  private async seedAndPlan(): Promise<void> {
    const ctx = this.ctx()
    for (const adapter of this.onAdapters()) await this.seedOne(adapter, ctx)
    // 消えるものがなければ全件を見ない(種類ごとの exists は 1 件ごとに DB を読むので)
    const count = async (where: (r: StoredRecord) => boolean): Promise<number> => {
      let n = 0
      for (const adapter of this.onAdapters()) {
        for (const r of await this.t.recordsOfKind(adapter.kind)) {
          if (where(r) && adapter.owns(r) && (await adapter.exists(r))) n++
        }
      }
      return n
    }
    const lost = await count((r) => r.needs_apply && isDeleted(r.payload) && r.payload.trim !== true)
    const total = lost > 0 ? await count(() => true) : 0
    if (lost > 0 && (lost >= JOIN_CONFIRM_MIN || lost * 2 >= total)) {
      await this.db.batch([setState('phase', 'confirm'), setState('pending_confirm', canonicalJson({ type: 'join', lost, total }))])
      throw new CycleStop('confirm')
    }
    await this.putState('phase', 'idle')
  }

  /**
   * 起動後 1 回の照合。取りこぼしの保険なので、レコードのないものだけ低い HLC で作り、ほかは同期の表を正として写し直す。
   * レコードのあるものを手元から作らない(適用の時刻を持つ行が、まだ届いていない削除に勝ってしまう)
   */
  private async reconcile(): Promise<void> {
    const ctx = this.ctx()
    const stmts: SqlStatement[] = []
    for (const adapter of this.onAdapters()) {
      if (adapter.reconciles === false) continue
      const rows = await adapter.seed(ctx)
      const local = await this.t.records(rows.map((r) => r.record_id))
      for (const r of rows) {
        if (local.has(r.record_id)) continue
        const settled = settleRecord(r.payload, 0, undefined, ctx.now)
        stmts.push(writeRecord({ record_id: r.record_id, kind: r.payload.kind, kind_tag: tagOfKind(r.payload.kind), schema_version: SCHEMA_VERSION, payload: r.payload, hlc: r.payload.hlc, version: 0, pending: true, priority: r.priority, needs_apply: false, ...r.refs, tomb_at: settled.tomb_at ?? null }))
      }
      for (const r of await this.t.recordsOfKind(adapter.kind)) {
        if (r.needs_apply || !adapter.owns(r) || r.payload.trim === true) continue
        if ((await adapter.exists(r)) === isDeleted(r.payload)) stmts.push({ sql: 'UPDATE sync_records SET needs_apply = 1 WHERE record_id = $1', params: [r.record_id] })
      }
    }
    if (stmts.length > 0) await this.db.batch(stmts)
  }

  /** 手元にあってレコードのない行を、種まきと同じ古い HLC で作る。消した記録があるものは作らないので、消したものは戻らない */
  private async fillMissing(): Promise<void> {
    const ctx = this.ctx()
    for (const adapter of this.onAdapters()) {
      const rows = (await adapter.fill?.(ctx)) ?? []
      for (let i = 0; i < rows.length; i += WRITE_BATCH) {
        const chunk = rows.slice(i, i + WRITE_BATCH)
        const local = await this.t.records(chunk.map((r) => r.record_id))
        const stmts = chunk.flatMap((r) => {
          if (!local.has(r.record_id)) return [writeRecord({ record_id: r.record_id, kind: r.payload.kind, kind_tag: tagOfKind(r.payload.kind), schema_version: SCHEMA_VERSION, payload: r.payload, hlc: r.payload.hlc, version: 0, pending: true, priority: r.priority, needs_apply: r.reapply === true, ...r.refs, tomb_at: null })]
          return r.reapply === true ? [{ sql: 'UPDATE sync_records SET needs_apply = 1 WHERE record_id = $1', params: [r.record_id] }] : []
        })
        if (stmts.length > 0) await this.db.batch(stmts)
      }
    }
  }

  private async applyAll(): Promise<void> {
    this.enter('applying')
    await this.keepLease()
    const ctx = this.ctx()
    // まだ処理していない操作のあるレコードは、次の周に回す(操作の結果を古いレコードで上書きしない)
    const waiting = new Set<string>()
    for (const op of await this.t.ops(this.opNames, 1000)) {
      const t = this.deps.adapters.find((a) => a.ops.includes(op.op))?.target(op, ctx)
      if (t) waiting.add(t.record_id)
    }
    let after = ''
    for (;;) {
      // 切っている種類は needs_apply を残し、オンに戻したときに写す
      const rows = await this.t.toApply(this.kinds.filter((k) => !this.offKinds.has(k)), after, APPLY_BATCH)
      if (rows.length === 0) break
      after = rows[rows.length - 1].record_id
      const items: { id: string; area: string; plan: ApplyPlan }[] = []
      for (const r of rows) {
        if (waiting.has(r.record_id)) continue
        const adapter = this.deps.adapters.find((a) => a.kind === r.kind && a.owns(r))
        if (!adapter) {
          // 本文も ref もない tombstone は手元のどれか分からない。後で種まきが同じ ID を作れば ref が埋まって写せる
          if (r.ref_board === null && r.ref_detail === null && isDeleted(r.payload)) items.push({ id: r.record_id, area: '', plan: { statements: [], changed: false } })
          continue
        }
        items.push({ id: r.record_id, area: adapter.area, plan: await adapter.apply(r, ctx) })
      }
      await this.writeApplied(items)
    }
    for (const adapter of this.onAdapters()) {
      const plan = await adapter.afterApply?.(ctx)
      if (!plan) continue
      if (plan.statements.length > 0) await this.db.batch(plan.statements)
      if (plan.changed) this.result.applied[adapter.area] = true
      if (plan.bad) await this.countBad(plan.bad)
    }
  }

  private async writeApplied(items: { id: string; area: string; plan: ApplyPlan }[]): Promise<void> {
    if (items.length === 0) return
    const done = async (x: { area: string; plan: ApplyPlan }) => {
      if (x.plan.changed) this.result.applied[x.area] = true
      if (x.plan.bad) await this.countBad(x.plan.bad)
    }
    try {
      await this.db.batch(items.flatMap((x) => [...x.plan.statements, clearNeedsApply(x.id)]))
      this.applyFailures = 0
      for (const x of items) await done(x)
    } catch (e) {
      // 全部戻っているので needs_apply が残る。続けて失敗するなら 1 件ずつ分けて、原因のレコードだけを除ける
      if (++this.applyFailures < APPLY_SPLIT_AFTER) throw e
      for (const x of items) {
        try {
          await this.db.batch([...x.plan.statements, clearNeedsApply(x.id)])
          await done(x)
        } catch {
          await this.db.execute('UPDATE sync_records SET needs_apply = 0 WHERE record_id = $1', [x.id])
          await this.countBad('apply')
        }
      }
      this.applyFailures = 0
    }
  }

  /**
   * 容量超過。優先の低い古いものからサーバーで外す。手元は消さない(trim の tombstone は適用で何もしない)。
   * read_reset は外さない(外すと、消したログの既読が戻る)。お気に入り・NG・設定も外さない。外せるものがなければ false
   */
  private async trimForQuota(): Promise<boolean> {
    for (const group of TRIM_ORDER) {
      const kinds = group.filter((k) => !this.offKinds.has(k))
      if (kinds.length === 0) continue
      const marks = kinds.map((_, i) => `$${i + 2}`).join(', ')
      const rows = await this.t.selectRecords(`deleted = 0 AND kind IN (${marks}) AND (version > 0 OR pending = 1) ORDER BY hlc, record_id LIMIT $1`, [TRIM_BATCH, ...kinds])
      if (rows.length === 0) continue
      const now = this.deps.now()
      let clock = (await this.t.state('clock')) ?? HLC_ZERO
      const stmts: SqlStatement[] = []
      for (const r of rows) {
        // まだ送っていないものは送らないだけでよい
        if (r.version === 0) {
          stmts.push({ sql: 'UPDATE sync_records SET pending = 0 WHERE record_id = $1', params: [r.record_id] })
          continue
        }
        const stamped = hlcStamp(clock, now, this.deviceId, r.payload.hlc)
        clock = stamped.clock
        const payload = makeTombstone(r.payload, stamped.stamp, this.deviceId, r.kind === LAST_VIEW ? [LAST_VIEWED_FIELD] : [], true)
        const settled = settleRecord(payload, r.version, asLocal(r), now)
        stmts.push(writeRecord({ ...r, payload, hlc: payload.hlc, version: settled.version, pending: true, priority: 0, needs_apply: false, tomb_at: settled.tomb_at ?? null }))
      }
      stmts.push(setState('clock', clock), delState('push_inflight'))
      await this.db.batch(stmts)
      await this.countBad('quota_trim')
      return true
    }
    return false
  }

  private async pushAll(): Promise<void> {
    this.enter('pushing')
    let trims = 0
    for (let round = 0; round < PUSH_MAX_ROUNDS; round++) {
      await this.keepLease()
      const prepared = await this.prepareBatch()
      if (prepared === null) return
      const { requestId, rows, sent } = prepared
      const body: Record<string, unknown>[] = []
      for (const r of rows) {
        try {
          const { nonce, ciphertext } = sealPayload(this.keys, { space_id: this.spaceIdValue, record_id: r.record_id, kind_tag: r.kind_tag, schema_version: r.schema_version }, r.payload)
          body.push({ record_id: r.record_id, base_version: r.version, kind_tag: r.kind_tag, schema_version: r.schema_version, deleted: isDeleted(r.payload), nonce, ciphertext })
        } catch (e) {
          if (!(e instanceof SyncError)) throw e
          // 大きすぎるものは送れない。列を止めない
          await this.db.execute('UPDATE sync_records SET pending = 0 WHERE record_id = $1', [r.record_id])
          await this.countBad(e.code)
        }
      }
      if (body.length === 0) {
        await this.db.execute('DELETE FROM sync_state WHERE key = $1', ['push_inflight'])
        continue
      }
      let res
      try {
        res = await this.call(() => this.api.pushRecords(requestId, body))
      } catch (e) {
        if (e instanceof SyncApiError && e.status === 413 && e.code === 'quota_exceeded' && trims < TRIM_ROUNDS && (await this.trimForQuota())) {
          trims++
          continue
        }
        throw e
      }
      if (this.halting) throw new CycleStop('idle')
      await this.checkEpoch(res.epoch)
      await this.settlePush(res.results, sent, body.length)
    }
  }

  /** 送信中の一覧を先に保存する。応答が来ないまま落ちたら、同じ request_id で送り直す(サーバーが二重に採番しない) */
  private async prepareBatch(): Promise<{ requestId: string; rows: StoredRecord[]; sent: Map<string, string> } | null> {
    const raw = await this.t.state('push_inflight')
    if (raw !== null) {
      const inflight = parseStrictJson(raw) as { request_id: string; records: InflightEntry[] }
      const local = await this.t.records(inflight.records.map((x) => x.record_id))
      const rows = inflight.records.flatMap((x) => {
        const r = local.get(x.record_id)
        return r?.pending && !this.offKinds.has(r.kind) ? [r] : []
      })
      if (rows.length > 0) return { requestId: inflight.request_id, rows, sent: new Map(inflight.records.map((x) => [x.record_id, x.hlc])) }
      await this.db.execute('DELETE FROM sync_state WHERE key = $1', ['push_inflight'])
    }
    const candidates = await this.t.pendingRecords(PUSH_BATCH_RECORDS, [...this.offKinds])
    if (candidates.length === 0) return null
    let bytes = 0
    const rows: StoredRecord[] = []
    for (const r of candidates) {
      // 暗号文は平文の 4/3 倍と少しになる
      bytes += Math.ceil((canonicalJson(r.payload).length + 256 + 16) * 4 / 3) + 256
      if (rows.length > 0 && bytes > PUSH_BATCH_BYTES) break
      rows.push(r)
    }
    const requestId = this.newRequestId()
    const sent = new Map(rows.map((r) => [r.record_id, r.payload.hlc]))
    await this.putState('push_inflight', canonicalJson({ request_id: requestId, records: rows.map((r) => ({ record_id: r.record_id, hlc: r.payload.hlc })) }))
    return { requestId, rows, sent }
  }

  private async settlePush(results: { record_id: string; status: number; version?: number; record?: Record<string, unknown> }[], sent: Map<string, string>, expected: number): Promise<void> {
    const now = this.deps.now()
    const stmts: SqlStatement[] = []
    const since = Number((await this.t.state('since')) ?? 0)
    const local = await this.t.records(results.map((r) => r.record_id))
    for (const res of results) {
      const l = local.get(res.record_id)
      if (!l) continue
      if (res.status === 200) {
        const version = res.version as number
        // 送信中に変わったレコードは version だけ進め、pending を残す
        stmts.push({
          sql: 'UPDATE sync_records SET version = MAX(version, $1), pending = CASE WHEN hlc = $2 THEN 0 ELSE pending END WHERE record_id = $3',
          params: [version, sent.get(res.record_id) ?? '', res.record_id],
        })
        this.result.pushed++
        continue
      }
      // 409。応答のレコードとマージして、新しい version で送り直す
      this.result.conflicts++
      const opened = openRecords(this.keys, this.spaceIdValue, [res.record])
      const raw = res.record as Record<string, unknown>
      const version = typeof raw.version === 'number' && Number.isSafeInteger(raw.version) ? raw.version : l.version
      // 別のレコードの暗号文をすり替えて返されても混ぜない。送信待ちのまま次で送り直す
      if (raw.record_id !== res.record_id) {
        await this.countBad('swapped')
      } else if (opened.records.length === 1) {
        const row = this.merged(l, res.record_id, opened.records[0].payload, opened.records[0].version, { kind_tag: raw.kind_tag as KindTag, schema_version: raw.schema_version as number }, now)
        stmts.push(writeRecord(row))
      } else {
        // 読めないサーバーの値は使えない。手元の値で上書きできるよう version だけ進める
        for (const f of opened.failed) await this.countBad(f.reason)
        stmts.push({ sql: 'UPDATE sync_records SET version = MAX(version, $1) WHERE record_id = $2', params: [version, res.record_id] })
      }
    }
    stmts.push(delState('push_inflight'), setState('last_push_at', String(now)))
    // 全部 200 で version が since の続きに隙間なく並べば、増えたのは自分の送ったものだけ。読み戻さずに済むよう since を進め、次の確認を 304 にする
    const advanced = pushedRun(results, expected, since)
    if (advanced !== null) stmts.push(setState('since', String(advanced)))
    await this.db.batch(stmts)
    if (advanced !== null) this.headFreshAt = now
  }

  /** 全件を読む。途中で切れたら読めた分を返し、呼び出す側が complete: false で扱う */
  private async readFull(): Promise<FullRead> {
    const out: FullRead = { full: {}, meta: new Map(), head: 0, gcFloor: 0, failure: null }
    let since = 0
    for (;;) {
      let page
      try {
        page = await this.call(() => this.api.changes(since))
      } catch (e) {
        if (e instanceof SpaceGone) throw e
        out.failure = e
        return out
      }
      await this.checkEpoch(page.epoch)
      const readable = this.readable(page.records)
      const opened = openRecords(this.keys, this.spaceIdValue, readable)
      for (const f of opened.failed) await this.countBad(f.reason)
      const metaOf = new Map(readable.map((r) => [r.record_id as string, r]))
      for (const r of opened.records) {
        out.full[r.record_id] = { payload: r.payload, version: r.version }
        const m = metaOf.get(r.record_id) as Record<string, unknown>
        out.meta.set(r.record_id, { kind_tag: m.kind_tag as KindTag, schema_version: m.schema_version as number })
      }
      const last = page.records.reduce((m, r) => (typeof r.version === 'number' && Number.isSafeInteger(r.version) ? Math.max(m, r.version) : m), since)
      out.head = Math.max(last, page.head)
      out.gcFloor = page.gc_floor
      if (!page.more) return out
      if (last <= since) {
        out.failure = new SyncApiError('no_progress')
        return out
      }
      since = last
    }
  }

  /** gc_floor と epoch の変更はサーバーが決める値なので、回数を制限する */
  private async countRebase(): Promise<void> {
    const now = this.deps.now()
    const raw = await this.t.state('rebase_log')
    const log = ((raw ? parseStrictJson(raw) : []) as number[]).filter((at) => now - at < REBASE_WINDOW_MS)
    if (log.length >= REBASE_LIMIT) throw new CycleStop(await this.block('too_many_rebases'))
    await this.putState('rebase_log', JSON.stringify([...log, now]))
  }

  private async onSpaceGone(e: SpaceGone): Promise<void> {
    const known = await this.t.state('epoch')
    let epoch = e.newEpoch
    if (epoch === undefined) {
      const ticket = (await this.deps.keyStore.load())?.ticket ?? null
      if (ticket === null) throw new CycleStop(await this.block('ticket_required'))
      try {
        epoch = (await this.api.createSpace(ticket)).epoch
      } catch (err) {
        if (err instanceof SyncApiError && err.kind === 'http' && err.status === 403) {
          await this.noteError(err.code || 'http_403')
          // 許可証の問題は待っても直らない。利用者が通し直すまで止まる
          if (known === null || err.code.startsWith('ticket_')) throw new CycleStop(await this.block(err.code || 'http_403'))
          await this.db.batch([setState('phase', 'recreate_waiting'), setState('recreate_tried_at', String(this.deps.now())), setState('last_error', err.code || 'http_403')])
          throw new CycleStop('recreate_waiting')
        }
        throw err
      }
    }
    const phase = await this.t.state('phase')
    if (known === null) {
      // 初めて作った領域。合わせ直すものがない
      await this.putState('epoch', epoch)
      return
    }
    await this.countRebase()
    this.enter('recreating')
    await this.db.batch([
      setState('epoch', epoch),
      setState('since', '0'),
      setState('recreate_pending', '1'),
      setState('phase', phase === 'recreate_waiting' ? 'idle' : (phase ?? 'idle')),
      delState('push_inflight'),
      delState('recreate_tried_at'),
    ])
  }

  private rowFromPlan(l: StoredRecord | undefined, id: string, settled: LocalRecord, meta: ServerMeta | undefined, pending: boolean, priority?: number): StoredRecord {
    const fromServer = meta !== undefined
    return {
      record_id: id,
      kind: settled.payload.kind,
      kind_tag: l?.kind_tag ?? (fromServer ? meta.kind_tag : tagOfKind(settled.payload.kind)),
      schema_version: l?.schema_version ?? (fromServer ? meta.schema_version : SCHEMA_VERSION),
      payload: settled.payload,
      hlc: settled.payload.hlc,
      version: settled.version,
      pending,
      priority: priority ?? l?.priority ?? 5,
      needs_apply: !l || !same(l.payload, settled.payload) || l.needs_apply,
      ...keepRefs(refsOf(l), this.refsOfBody(settled.payload)),
      tomb_at: settled.tomb_at ?? null,
    }
  }

  private async writeChunks(stmts: SqlStatement[], last: SqlStatement[]): Promise<void> {
    let i = 0
    for (; stmts.length - i > WRITE_BATCH; i += WRITE_BATCH) await this.db.batch(stmts.slice(i, i + WRITE_BATCH))
    await this.db.batch([...stmts.slice(i), ...last])
  }

  /** 領域が消えたときの合わせ直し。手元を消さない。途中で切れたら since = 0 のまま次の周で読み直す */
  private async finishRecreate(): Promise<void> {
    this.enter('recreating')
    const read = await this.readFull()
    if (read.failure) throw read.failure
    const now = this.deps.now()
    const all = await this.t.allRecords()
    const byId = new Map(all.map((r) => [r.record_id, r]))
    const plan = planRecreate({ local: Object.fromEntries(all.map((r) => [r.record_id, asLocal(r)])), full: read.full, nowMs: now })
    const stmts: SqlStatement[] = []
    for (const [id, settled] of Object.entries(plan.records)) {
      const pending = Object.hasOwn(plan.pending, id)
      // tombstone を先に送る。他の端末の古い値が先に領域へ入っても、すぐ負けるように
      const priority = pending && isDeleted(settled.payload) ? 0 : undefined
      stmts.push(writeRecord(this.rowFromPlan(byId.get(id), id, settled, read.meta.get(id), pending, priority)))
    }
    for (const id of plan.expired) stmts.push(delRecord(id))
    await this.writeChunks(stmts, [delState('recreate_pending'), setState('since', String(read.head)), setState('gc_floor', String(read.gcFloor)), setState('last_pull_at', String(now))])
    this.result.pulled += Object.keys(read.full).length
  }

  /** since < gc_floor。全件を正にして、消えたものを手元から消す */
  private async rebase(): Promise<void> {
    this.enter('rebasing')
    await this.countRebase()
    const read = await this.readFull()
    const complete = read.failure === null
    const now = this.deps.now()
    const all = await this.t.allRecords()
    const byId = new Map(all.map((r) => [r.record_id, r]))
    const plan = planRebase({
      local: Object.fromEntries(all.map((r) => [r.record_id, asLocal(r)])),
      pending: Object.fromEntries(all.filter((r) => r.pending).map((r) => [r.record_id, r.payload])),
      full: read.full,
      complete,
      nowMs: now,
    })
    const liveRemoved = plan.removed.filter((id) => !isDeleted((byId.get(id) as StoredRecord).payload))
    if (complete && plan.needs_confirmation) {
      const accepted = await this.t.state('rebase_accepted')
      if (accepted === null || liveRemoved.length > Number(accepted)) {
        await this.db.batch([setState('phase', 'confirm'), setState('pending_confirm', canonicalJson({ type: 'rebase', lost: liveRemoved.length, empty: Object.keys(read.full).length === 0 }))])
        throw new CycleStop('confirm')
      }
    }
    const stmts: SqlStatement[] = []
    if (plan.removed.length > 0) {
      stmts.push(setState('rebase_backup', canonicalJson(liveRemoved.map((id) => {
        const r = byId.get(id) as StoredRecord
        return { record_id: id, kind: r.kind, ref_board: r.ref_board, ref_thread: r.ref_thread, ref_detail: r.ref_detail }
      }))))
    }
    for (const [id, settled] of Object.entries(plan.records)) {
      stmts.push(writeRecord(this.rowFromPlan(byId.get(id), id, settled, read.meta.get(id), Object.hasOwn(plan.pending, id))))
    }
    for (const id of plan.removed) {
      const r = byId.get(id) as StoredRecord
      // すでに tombstone のものは今のデータに触らない。行を消すだけ
      if (!isDeleted(r.payload)) {
        const adapter = this.onAdapters().find((a) => a.kind === r.kind && a.owns(r))
        if (adapter) {
          const removal = await adapter.remove(r)
          stmts.push(...removal.statements)
          if (removal.changed) this.result.applied[adapter.area] = true
        }
      }
      stmts.push(delRecord(id))
    }
    if (!complete) {
      // 読めた分のマージだけを残す。since は進めないので、次の周でまた最初から読む
      if (stmts.length > 0) await this.writeChunks(stmts, [])
      throw read.failure
    }
    await this.writeChunks(stmts, [delState('rebase_accepted'), setState('since', String(Math.max(read.head, read.gcFloor))), setState('gc_floor', String(read.gcFloor)), setState('last_pull_at', String(now))])
    this.result.pulled += Object.keys(read.full).length
  }
}

/** 送った全部が 200 で、version が since + 1 から連番で隙間なく並んでいれば、その最後の version。それ以外は null */
export function pushedRun(results: readonly { status: number; version?: number }[], expected: number, since: number): number | null {
  if (expected === 0 || results.length !== expected) return null
  const versions: number[] = []
  for (const r of results) {
    if (r.status !== 200 || typeof r.version !== 'number' || !Number.isSafeInteger(r.version)) return null
    versions.push(r.version)
  }
  versions.sort((a, b) => a - b)
  for (let i = 0; i < versions.length; i++) if (versions[i] !== since + 1 + i) return null
  return since + versions.length
}
