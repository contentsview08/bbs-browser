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

class SeedRow(
    recordId: String,
    refs: RecordRefs,
    val payload: SyncPayload,
    val priority: Long,
    /** 作ったあと手元へ写し直す。新しいリセットがあれば手元を下げるため */
    val reapply: Boolean = false,
) : OpTarget(recordId, refs)

class ApplyPlan(
    val statements: List<SqlStatement>,
    val changed: Boolean,
    /** bad_counts に数える理由。手元に入れないと決めたとき */
    val bad: String? = null,
    /** ログの削除が写って手元の行を消したスレ。画面はこれだけを閉じる(行がないことから削除を推し量らない) */
    val dropped: List<DroppedThread> = emptyList(),
)

/** boardUrl は手元の threads の行の書き方 */
data class DroppedThread(val boardUrl: String, val key: String)

/** 1 つの操作で変わるレコードの 1 つ。make の stamp は Hlc.stamp の値 */
class OpEffect(
    val target: OpTarget,
    /** レコードの HLC に加えて、これより必ず後にする(リセットは知っている全端末の読みより後) */
    val floor: String? = null,
    val make: (existing: SyncPayload?, stamp: String) -> SyncPayload?,
)

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

    /**
     * 手元にあるのにレコードのない行。古い HLC で作って送る。レコードがあるもの(tombstone を含む)は engine が飛ばす。
     * 種まきのあとに足された種類と、DB の入れ替えや取りこぼしで増えた行を、手で消さずに揃えるため
     */
    fun fill(ctx: AdapterContext): List<SeedRow> = emptyList()

    /** 手元の件数が表と合わない理由ごとの数。要約に出す */
    fun explain(ctx: AdapterContext): Map<String, Int> = emptyMap()

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

    /** 手元の今のデータの要約の単位。なければ area。同じ表を見るものをまとめる */
    val localArea: String? get() = null

    /** 手元の今のデータを 1 行ずつ。端末で揃うかを見比べるための値で、画面には件数とハッシュだけを出す。null は要約に入れない */
    fun localLines(ctx: AdapterContext): List<String>? = null

    /** false は「手元にあるのにレコードがない」を数えない(手元の値が他の端末の記録から来ている種類) */
    val seedsAll: Boolean get() = true

    /** 手元が同期の表と違うか。apply に副作用のある種類だけ書き換える */
    fun differs(r: StoredRecord, ctx: AdapterContext): Boolean = apply(r, ctx).changed
}
