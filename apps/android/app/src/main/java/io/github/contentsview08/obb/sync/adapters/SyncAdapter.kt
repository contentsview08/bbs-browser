package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.SyncKeys
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow

// 今のデータ ↔ ペイロードの変換の口。エンジンは種類を知らない

class AdapterContext(val keys: SyncKeys, val deviceId: String, val now: Long)

open class OpTarget(val recordId: String, val refs: RecordRefs)

class SeedRow(recordId: String, refs: RecordRefs, val payload: SyncPayload, val priority: Long) : OpTarget(recordId, refs)

class ApplyPlan(
    val statements: List<SqlStatement>,
    val changed: Boolean,
    /** bad_counts に数える理由。手元に入れないと決めたとき */
    val bad: String? = null,
)

/** 1 つの操作で変わるレコードの 1 つ。make の stamp は Hlc.stamp の値 */
class OpEffect(val target: OpTarget, val make: (existing: SyncPayload?, stamp: String) -> SyncPayload?)

interface SyncAdapter {
    val kind: String

    /** 適用で変わったとき画面が読み直す単位(CycleResult.applied の値) */
    val area: String
    val ops: List<String>

    /** false は起動時の照合の対象にしない(手元で消えているのが正しいことがある種類) */
    val reconciles: Boolean get() = true

    /** true なら操作は expand で処理する。target は適用を待たせるためだけに使う */
    val expands: Boolean get() = false

    /** null は作れない操作(URL が壊れているなど)。列を止めずに捨てる */
    fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget?

    /** stamp は Hlc.stamp の値。null はレコードを変えない(足した直後に外して、もう行がないなど) */
    fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload?

    /** 今のデータから作る。HLC は元の時刻で、今の時刻を使わない(古いデータが新しい削除に勝たないように) */
    fun seed(ctx: AdapterContext): List<SeedRow>

    /** 1 つの操作で複数のレコードが変わる種類。null は作れない操作 */
    fun expand(op: SyncOpRow, ctx: AdapterContext): List<OpEffect>? = null

    /** 本文から ref_detail を取る。tombstone には本文がないので、ここで覚えた値で手元の行を探す */
    fun detailOf(p: SyncPayload): String? = null

    /** 同じ kind でも別のアダプターの持ち物なら false。写さず needs_apply を残す */
    fun owns(r: StoredRecord): Boolean

    /** 手元に今のデータがあるか。手元の行を探せないレコードは false */
    fun exists(r: StoredRecord): Boolean

    fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan

    /** リベースで消えるときの手元の削除 */
    fun remove(r: StoredRecord): ApplyPlan

    /** 周の適用の最後に 1 回。並べ直しのように 1 件ずつでは決まらないもの */
    fun afterApply(ctx: AdapterContext): ApplyPlan? = null
}
