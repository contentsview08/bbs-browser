// 全件を取り直したときの手元の更新。適用はせず、計画を返す(大量に消えるときは呼び出す側が確認を出し、消す前に一覧を保存する)
import { canonicalJson } from './json'
import { parseHlc } from './hlc'
import { mergePayloads, type SyncPayload } from './merge'

export const PENDING_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const MASS_DELETE_MIN = 10
const MASS_DELETE_RATIO = 5

export interface LocalRecord {
  payload: SyncPayload
  /** サーバーで最後に見た version。0 は一度も同期していないもの(クォータでサーバーから外した手元だけの履歴を含む) */
  version: number
}

export interface RebaseInput {
  local: Readonly<Record<string, LocalRecord>>
  pending: Readonly<Record<string, SyncPayload>>
  full: Readonly<Record<string, LocalRecord>>
  nowMs: number
}

export interface RebasePlan {
  records: Record<string, LocalRecord>
  pending: Record<string, { payload: SyncPayload; base_version: number }>
  removed: string[]
  dropped_pending: string[]
  /** サーバーが全件を空に見せる攻撃や事故に備え、自動で消さない */
  needs_confirmation: boolean
}

export function planRebase({ local, pending, full, nowMs }: RebaseInput): RebasePlan {
  const plan: RebasePlan = { records: {}, pending: {}, removed: [], dropped_pending: [], needs_confirmation: false }
  const ids = [...new Set([...Object.keys(local), ...Object.keys(pending), ...Object.keys(full)])].sort()
  for (const id of ids) {
    const l = Object.hasOwn(local, id) ? local[id] : undefined
    const s = Object.hasOwn(full, id) ? full[id] : undefined
    let p = Object.hasOwn(pending, id) ? pending[id] : undefined
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
      plan.records[id] = { payload: merged, version: s.version }
      if (canonicalJson(merged) !== canonicalJson(s.payload)) plan.pending[id] = { payload: merged, base_version: s.version }
    } else if (p) {
      const merged = l ? mergePayloads(l.payload, p) : p
      plan.records[id] = { payload: merged, version: 0 }
      plan.pending[id] = { payload: merged, base_version: 0 }
    } else if (l && l.version === 0 && !ignoreLocal) {
      plan.records[id] = l
    } else if (l) {
      plan.removed.push(id)
    }
  }
  const synced = Object.values(local).filter((r) => r.version > 0).length
  const lost = plan.removed.length
  plan.needs_confirmation = lost > 0 && (Object.keys(full).length === 0 || (lost >= MASS_DELETE_MIN && lost * MASS_DELETE_RATIO >= synced))
  return plan
}
