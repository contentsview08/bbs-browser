// 今のデータ ↔ ペイロードの変換の口。エンジンは種類を知らない
import type { SqlStatement, StoredRecord, SyncOpRow } from '../engine/tables'
import type { SyncKeys } from '../keys'
import type { SyncPayload } from '../merge'

export interface AdapterContext {
  keys: SyncKeys
  deviceId: string
  now: number
}

export interface RecordRefs {
  ref_board: string | null
  ref_thread: string | null
  ref_detail: string | null
  ref_local: number | null
}

export interface OpTarget {
  record_id: string
  refs: RecordRefs
}

export interface SeedRow extends OpTarget {
  payload: SyncPayload
  priority: number
}

export interface ApplyPlan {
  statements: SqlStatement[]
  changed: boolean
}

export interface SyncAdapter {
  readonly kind: string
  readonly ops: readonly string[]
  /** null は作れない操作(URL が壊れているなど)。列を止めずに捨てる */
  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null
  /** stamp は hlcStamp の値。null はレコードを変えない(足した直後に外して、もう行がないなど) */
  fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null>
  /** 今のデータから作る。HLC は元の時刻で、今の時刻を使わない(古いデータが新しい削除に勝たないように) */
  seed(ctx: AdapterContext): Promise<SeedRow[]>
  /** 同じ kind でも別のアダプターの持ち物なら false。写さず needs_apply を残す */
  owns(r: StoredRecord): boolean
  /** 手元に今のデータがあるか。手元の行を探せないレコードは false */
  exists(r: StoredRecord): Promise<boolean>
  apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan>
  /** リベースで消えるときの手元の削除 */
  remove(r: StoredRecord): Promise<ApplyPlan>
}
