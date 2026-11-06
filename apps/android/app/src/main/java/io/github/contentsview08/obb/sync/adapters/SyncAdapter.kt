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

class ApplyPlan(val statements: List<SqlStatement>, val changed: Boolean)

interface SyncAdapter {
    val kind: String
    val ops: List<String>

    /** null は作れない操作(URL が壊れているなど)。列を止めずに捨てる */
    fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget?

    /** stamp は Hlc.stamp の値。null はレコードを変えない(足した直後に外して、もう行がないなど) */
    fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload?

    /** 今のデータから作る。HLC は元の時刻で、今の時刻を使わない(古いデータが新しい削除に勝たないように) */
    fun seed(ctx: AdapterContext): List<SeedRow>

    /** 同じ kind でも別のアダプターの持ち物なら false。写さず needs_apply を残す */
    fun owns(r: StoredRecord): Boolean

    /** 手元に今のデータがあるか。手元の行を探せないレコードは false */
    fun exists(r: StoredRecord): Boolean

    fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan

    /** リベースで消えるときの手元の削除 */
    fun remove(r: StoredRecord): ApplyPlan
}
