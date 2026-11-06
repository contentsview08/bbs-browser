// 全件を取り直したときの手元の更新。適用はせず、計画を返す(大量に消えるときは呼び出す側が確認を出し、消す前に一覧を保存する)
import { canonicalJson } from './json'
import { parseHlc } from './hlc'
import { mergePayloads, type SyncPayload } from './merge'

export const PENDING_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
export const TOMB_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const MASS_DELETE_MIN = 10
const MASS_DELETE_RATIO = 5

export interface LocalRecord {
  payload: SyncPayload
  /** サーバーで最後に見た version。0 は一度も同期していないもの(クォータでサーバーから外した手元だけの履歴を含む) */
  version: number
  /** この端末で tombstone になった時刻 */
  tomb_at?: number
}

export interface RebaseInput {
  local: Readonly<Record<string, LocalRecord>>
  pending: Readonly<Record<string, SyncPayload>>
  full: Readonly<Record<string, LocalRecord>>
  /** 全件を最後まで受け取れたか。途中までなら、届いていないものを消えたと決めない */
  complete: boolean
  nowMs: number
}

export interface PendingRecord {
  payload: SyncPayload
  base_version: number
}

export interface RebasePlan {
  records: Record<string, LocalRecord>
  pending: Record<string, PendingRecord>
  removed: string[]
  dropped_pending: string[]
  /** サーバーが全件を空に見せる攻撃や事故に備え、自動で消さない */
  needs_confirmation: boolean
}

export interface RecreateInput {
  local: Readonly<Record<string, LocalRecord>>
  full: Readonly<Record<string, LocalRecord>>
  nowMs: number
}

export interface RecreatePlan {
  records: Record<string, LocalRecord>
  pending: Record<string, PendingRecord>
  /** 期限の切れた tombstone。同期の表から消すだけで、今のデータに触らない */
  expired: string[]
}

const isTomb = (p: SyncPayload) => p.deleted === true

/** tomb_at がなければ、いま tombstone になったものとして扱う */
export const isTombExpired = (tombAt: number | undefined, nowMs: number): boolean => tombAt !== undefined && nowMs - tombAt > TOMB_MAX_AGE_MS

/** マージの結果に tomb_at を付ける。tombstone のあいだは最初の時刻を保つ(新しい tombstone で保持の期限を延ばさない) */
export function settleRecord(payload: SyncPayload, version: number, prev: LocalRecord | undefined, nowMs: number): LocalRecord {
  if (!isTomb(payload)) return { payload, version }
  return { payload, version, tomb_at: prev && isTomb(prev.payload) && prev.tomb_at !== undefined ? prev.tomb_at : nowMs }
}

export function planRebase({ local, pending, full, complete, nowMs }: RebaseInput): RebasePlan {
  const plan: RebasePlan = { records: {}, pending: {}, removed: [], dropped_pending: [], needs_confirmation: false }
  let lost = 0
  const ids = [...new Set([...Object.keys(local), ...Object.keys(pending), ...Object.keys(full)])].sort()
  for (const id of ids) {
    const l = Object.hasOwn(local, id) ? local[id] : undefined
    const s = Object.hasOwn(full, id) ? full[id] : undefined
    let p = Object.hasOwn(pending, id) ? pending[id] : undefined
    if (!s && !complete) {
      if (p) {
        const merged = l ? mergePayloads(l.payload, p) : p
        const version = l?.version ?? 0
        plan.records[id] = settleRecord(merged, version, l, nowMs)
        plan.pending[id] = { payload: merged, base_version: version }
      } else if (l) {
        plan.records[id] = l
      }
      continue
    }
    // 古い未送信は、もう消えた tombstone より前の変更かもしれない。手元の値も未送信を含むので一緒に捨てる
    let ignoreLocal = false
    if (p && nowMs - parseHlc(p.hlc).wall > PENDING_MAX_AGE_MS) {
      plan.dropped_pending.push(id)
      p = undefined
      ignoreLocal = true
    }
    if (s) {
      let merged = s.payload
      if (l && !ignoreLocal) merged = mergePayloads(merged, l.payload)
      if (p) merged = mergePayloads(merged, p)
      plan.records[id] = settleRecord(merged, s.version, l, nowMs)
      if (canonicalJson(merged) !== canonicalJson(s.payload)) plan.pending[id] = { payload: merged, base_version: s.version }
    } else if (p) {
      const merged = l ? mergePayloads(l.payload, p) : p
      plan.records[id] = settleRecord(merged, 0, l, nowMs)
      plan.pending[id] = { payload: merged, base_version: 0 }
    } else if (l && isTomb(l.payload)) {
      // サーバーの片づけの後も残す。領域を作り直すとき、削除済みが他の端末の古い値から戻らないように
      if (isTombExpired(l.tomb_at, nowMs)) plan.removed.push(id)
      else plan.records[id] = settleRecord(l.payload, 0, l, nowMs)
    } else if (l && l.version === 0 && !ignoreLocal) {
      plan.records[id] = l
    } else if (l) {
      plan.removed.push(id)
      lost++
    }
  }
  // tombstone は手元のデータではないので、分母にも数えない(数えると本当に消える分の割合が薄まる)
  const synced = Object.values(local).filter((r) => r.version > 0 && !isTomb(r.payload)).length
  plan.needs_confirmation = lost > 0 && (Object.keys(full).length === 0 || (lost >= MASS_DELETE_MIN && lost * MASS_DELETE_RATIO >= synced))
  return plan
}

/**
 * 領域が消えたときの合わせ直し。全件は空か途中までなので、手元を消さない。
 * 手元の全部を送るので、古い種まきの値も捨てない。他の端末が先に送ったものは 409 のマージで揃う
 */
export function planRecreate({ local, full, nowMs }: RecreateInput): RecreatePlan {
  const plan: RecreatePlan = { records: {}, pending: {}, expired: [] }
  const ids = [...new Set([...Object.keys(local), ...Object.keys(full)])].sort()
  for (const id of ids) {
    const l = Object.hasOwn(local, id) ? local[id] : undefined
    const s = Object.hasOwn(full, id) ? full[id] : undefined
    if (s) {
      const merged = l ? mergePayloads(s.payload, l.payload) : s.payload
      plan.records[id] = settleRecord(merged, s.version, l, nowMs)
      if (canonicalJson(merged) !== canonicalJson(s.payload)) plan.pending[id] = { payload: merged, base_version: s.version }
    } else if (l) {
      if (isTomb(l.payload) && isTombExpired(l.tomb_at, nowMs)) {
        plan.expired.push(id)
      } else {
        plan.records[id] = settleRecord(l.payload, 0, l, nowMs)
        plan.pending[id] = { payload: l.payload, base_version: 0 }
      }
    }
  }
  return plan
}
