package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord
import io.github.contentsview08.obb.sync.withoutTombstone

// NG。配列の 1 要素が 1 レコードで、ID は ng:::<rule.id>。tombstone は利用者の操作(ng_diff)からしか作らない

const val NG_KIND = "ng"
const val NG_DIFF = "ng_diff"
const val AREA_NG = "ng"
private const val SEED_PRIORITY = 2L
private val NG_TYPES = setOf("content", "posterName", "posterId", "threadTitle")
private val DATE = Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")

/** 手元に入れる件数の上限。レスごとに全部を当てるので、増やされると画面が固まる */
const val NG_APPLY_MAX = 5000
private val KNOWN_FIELDS = listOf("id", "type", "value", "is_regex", "enabled", "expires_on", "board_url", "board_name", "note", "created_at")

/** 今の NG の置き場は端末で違う(PC は settings 表、スマホは Prefs)。値は本文の形で受け渡す */
interface NgHost {
    fun read(): List<Map<String, Any?>>

    /** id → 新しい本文(null は消す)を今の値に重ねて書く。古い配列で上書きしない */
    fun apply(changes: Map<String, Map<String, Any?>?>)

    /** 既存の検査と、固まる式の検査 */
    fun patternOk(pattern: String, isRegex: Boolean): Boolean

    /** 端末の日付 YYYY-MM-DD */
    fun today(nowMs: Long): String
}

/** 比べるのは知っている項目だけ。新しい版の端末が足した項目で、毎回写し直さない */
private fun known(body: Map<String, Any?>) = canonicalJson(body.filterKeys { it in KNOWN_FIELDS })

private fun isExpired(body: Map<String, Any?>, today: String) = (body["expires_on"] as? String)?.let { it < today } == true

class NgAdapter(private val host: NgHost) : SyncAdapter {
    override val kind = NG_KIND
    override val area = AREA_NG
    override val ops = listOf(NG_DIFF)
    private val changes = LinkedHashMap<String, Map<String, Any?>?>()

    /** 1 件ごとに全部を読み直さない。照合と適用の間だけ持つ */
    private var snapshot: Map<String, Map<String, Any?>>? = null
    private var snapshotFor: AdapterContext? = null
    private var today = ""

    private class Args(val id: String, val rule: Map<String, Any?>?)

    @Suppress("UNCHECKED_CAST")
    private fun argsOf(op: SyncOpRow): Args? = try {
        val a = parseStrictJson(op.args.orEmpty()) as? Map<*, *>
        val id = a?.get("id") as? String
        if (id.isNullOrEmpty()) null else Args(id, a["rule"] as? Map<String, Any?>)
    } catch (_: Exception) {
        null
    }

    private fun targetOf(ctx: AdapterContext, id: String) = OpTarget(recordId(ctx.keys.kId, NG_KIND, null, "", id), RecordRefs(detail = id))

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { targetOf(ctx, it.id) }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        val a = argsOf(op) ?: return null
        val rule = a.rule ?: return makeTombstone(existing ?: mapOf("kind" to NG_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
        // 消した項目(期限など)を残さない。知らない項目だけ持ち続ける
        val base = existing?.let { withoutTombstone(it) + ("body" to it.body.orEmpty().filterKeys { k -> k !in KNOWN_FIELDS }) }
        return updateRecord(base, NG_KIND, rule, stamp, ctx.deviceId)
    }

    private fun load(): Map<String, Map<String, Any?>> = LinkedHashMap<String, Map<String, Any?>>().apply { for (x in host.read()) put(x["id"] as String, x) }

    /** 期限の切れたものは送らない。受け取る端末でも手元に入らない */
    override fun seed(ctx: AdapterContext): List<SeedRow> {
        today = host.today(ctx.now)
        val current = load()
        snapshot = current
        snapshotFor = ctx
        return current.values.mapNotNull { body ->
            val id = body["id"] as String
            if (id.isEmpty() || isExpired(body, today)) return@mapNotNull null
            val wall = body["created_at"] as? Long ?: 1L
            val payload = mapOf("kind" to NG_KIND, "hlc" to Hlc.format(maxOf(1L, minOf(wall, ctx.now)), 0, ctx.deviceId), "device_id" to ctx.deviceId, "body" to body)
            if (checkPayload(payload) == null) return@mapNotNull null
            val t = targetOf(ctx, id)
            SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }
    }

    override fun detailOf(p: SyncPayload): String? = p.body?.get("id") as? String

    override fun owns(r: StoredRecord) = r.refDetail != null

    private fun usable(body: Map<String, Any?>): Boolean {
        val value = body["value"] as? String
        if (value.isNullOrEmpty() || body["type"] !in NG_TYPES) return false
        if (body.containsKey("expires_on") && !DATE.matches(body["expires_on"] as String)) return false
        return host.patternOk(value, body["is_regex"] == true)
    }

    /** 値まで比べる(表の値が正)。手元に入れないと決めたものは、あることにして照合のたびに数え直さない */
    override fun exists(r: StoredRecord): Boolean {
        val local = (snapshot ?: load())[r.refDetail]
        if (r.payload["deleted"] == true) return local != null
        val body = r.payload.body.orEmpty()
        if (!usable(body)) return true
        if (local == null) return isExpired(body, today)
        return known(local) == known(body)
    }

    override fun remove(r: StoredRecord): ApplyPlan {
        r.refDetail?.let { changes[it] = null }
        return ApplyPlan(emptyList(), false)
    }

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) ApplyPlan(emptyList(), false) else remove(r)
        val body = r.payload.body.orEmpty()
        // 読めない式は同期の表に残し、手元に入れない。止めない
        if (!usable(body)) return ApplyPlan(emptyList(), false, "ng_rule")
        val id = body["id"] as String
        if (snapshot == null || snapshotFor !== ctx) {
            snapshot = load()
            snapshotFor = ctx
        }
        val local = snapshot!![id]
        if (local == null && isExpired(body, host.today(ctx.now))) return ApplyPlan(emptyList(), false)
        val rule = body.filterKeys { it in KNOWN_FIELDS }
        if (local != null && known(local) == known(rule)) {
            changes.remove(id)
            return ApplyPlan(emptyList(), false)
        }
        changes[id] = rule
        return ApplyPlan(emptyList(), false)
    }

    /** 周の中の変更を 1 回で書く。needs_apply は先に消えるが、落ちても起動時の照合で値の違いから写し直す */
    override fun afterApply(ctx: AdapterContext): ApplyPlan? {
        snapshot = null
        snapshotFor = null
        if (changes.isEmpty()) return null
        val ids = load().keys
        var room = NG_APPLY_MAX - ids.size
        var over = false
        val writes = LinkedHashMap<String, Map<String, Any?>?>()
        for ((id, rule) in changes) {
            if (rule != null && id !in ids) {
                if (room <= 0) {
                    over = true
                    continue
                }
                room--
            }
            if (rule != null || id in ids) writes[id] = rule
        }
        changes.clear()
        if (writes.isNotEmpty()) host.apply(writes)
        return ApplyPlan(emptyList(), writes.isNotEmpty(), if (over) "ng_too_many" else null)
    }
}
