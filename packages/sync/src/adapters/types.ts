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
  /** bad_counts に数える理由。手元に入れないと決めたとき */
  bad?: string
}

/** 1 つの操作で変わるレコードの 1 つ。make の stamp は hlcStamp の値 */
export interface OpEffect {
  target: OpTarget
  make: (existing: SyncPayload | null, stamp: string) => SyncPayload | null
}

export interface SyncAdapter {
  readonly kind: string
  /** 適用で変わったとき画面が読み直す単位(CycleResult.applied のキー) */
  readonly area: string
  readonly ops: readonly string[]
  /** false は起動時の照合の対象にしない(手元で消えているのが正しいことがある種類) */
  readonly reconciles?: boolean
  /** null は作れない操作(URL が壊れているなど)。列を止めずに捨てる */
  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null
  /** stamp は hlcStamp の値。null はレコードを変えない(足した直後に外して、もう行がないなど) */
  fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null>
  /** 今のデータから作る。HLC は元の時刻で、今の時刻を使わない(古いデータが新しい削除に勝たないように) */
  seed(ctx: AdapterContext): Promise<SeedRow[]>
  /** 1 つの操作で複数のレコードが変わる種類はこちら。null は作れない操作。ある間は target は適用を待たせるためだけに使う */
  expand?(op: SyncOpRow, ctx: AdapterContext): Promise<OpEffect[] | null>
  /** 本文から ref_detail を取る。tombstone には本文がないので、ここで覚えた値で手元の行を探す */
  detailOf?(p: SyncPayload): string | null
  /** 同じ kind でも別のアダプターの持ち物なら false。写さず needs_apply を残す */
  owns(r: StoredRecord): boolean
  /** 手元に今のデータがあるか。手元の行を探せないレコードは false */
  exists(r: StoredRecord): Promise<boolean>
  apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan>
  /** リベースで消えるときの手元の削除 */
  remove(r: StoredRecord): Promise<ApplyPlan>
  /** 周の適用の最後に 1 回。並べ直しのように 1 件ずつでは決まらないもの */
  afterApply?(ctx: AdapterContext): Promise<ApplyPlan>
}
