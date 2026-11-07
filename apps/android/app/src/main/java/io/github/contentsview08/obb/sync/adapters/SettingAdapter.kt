package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.normalizeBoardUrl
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord

// 設定の許可リスト。載っている項目だけを送り、受ける。新しい項目は既定で同期しない。ID は setting:::<名前>

const val SETTING_KIND = "setting"
const val OP_SETTING = "setting"
const val AREA_SETTINGS = "settings"
const val BOARD_META_KEY = "boardMeta"
private const val SEED_PRIORITY = 2L
private const val SEED_WALL = 1L
private const val WORDS_MAX = 4096

class AllowedSetting(val name: String, val type: String, val values: List<String>?, val default: Any?)

class SettingOp(val name: String, val value: Any)

/** packages/sync/settings-allowlist.json の中身。PC と同じファイルを読む */
@Suppress("UNCHECKED_CAST")
class SettingAllowlist(json: String) {
    private val root = parseStrictJson(json) as Map<String, Any?>
    val items: List<AllowedSetting> = (root["items"] as List<Map<String, Any?>>).map { AllowedSetting(it["name"] as String, it["type"] as String, it["values"] as List<String>?, it["default"]) }
    private val boardMeta = root["board_meta"] as Map<String, Any?>
    val boardMetaPrefix = boardMeta["prefix"] as String
    val boardMetaFields = boardMeta["fields"] as List<String>
    val never = root["never"] as List<String>
    private val byName = items.associateBy { it.name }

    fun item(name: String): AllowedSetting? = byName[name]

    /** 同期の対象の設定の名前か。板ごとの設定は boardMeta の 1 つの名前で持つ */
    fun watches(key: String) = key == BOARD_META_KEY || key in byName

    fun defaultOf(item: AllowedSetting, device: String): Any? = (item.default as? Map<String, Any?>)?.get(device) ?: item.default.takeIf { it !is Map<*, *> }

    private fun wordsValue(v: Any?): String? = if (v is List<*> && v.all { it is String }) canonicalJson(v) else null

    /** 手元の値 → レコードの値。配列は JSON の文字列にする(scalar は真偽・整数・文字列だけ)。許可リストにない項目と範囲の外は null */
    fun toWire(name: String, value: Any?): Any? {
        if (name.startsWith(boardMetaPrefix)) return boardMetaToWire(value)
        val item = byName[name] ?: return null
        return when (item.type) {
            "bool" -> value as? Boolean
            "enum" -> (value as? String)?.takeIf { item.values.orEmpty().contains(it) }
            "words" -> wordsValue(value)?.takeIf { it.length <= WORDS_MAX }
            else -> null
        }
    }

    /** 板ごとの設定は許可された項目だけを送る。名前欄・メール欄の既定値とファビコンは手元に残す */
    fun boardMetaToWire(meta: Any?): String? {
        val m = meta as? Map<String, Any?> ?: return null
        val picked = LinkedHashMap<String, Any?>()
        (m["alias"] as? String)?.takeIf { it.isNotEmpty() }?.let { picked["alias"] = it }
        (m["omitNoname"] as? Boolean)?.let { picked["omitNoname"] = it }
        (m["nonames"] as? List<*>)?.takeIf { it.isNotEmpty() && it.all { x -> x is String } }?.let { picked["nonames"] = it }
        return canonicalJson(picked).takeIf { it.length <= WORDS_MAX }
    }

    /** レコードの値 → 手元の値。読めない値は null(手元に入れず、同期の表には残す) */
    fun fromWire(name: String, wire: Any?): Any? {
        if (name.startsWith(boardMetaPrefix)) {
            if (normalizeBoardUrl(name.substring(boardMetaPrefix.length)) == null || wire !is String) return null
            return try {
                val o = parseStrictJson(wire) as? Map<*, *> ?: return null
                boardMetaToWire(o)?.let { parseStrictJson(it) }
            } catch (_: Exception) {
                null
            }
        }
        val item = byName[name] ?: return null
        if (item.type == "words") {
            if (wire !is String) return null
            return try {
                parseStrictJson(wire).takeIf { wordsValue(it) != null }
            } catch (_: Exception) {
                null
            }
        }
        return if (toWire(name, wire) == null) null else wire
    }

    /** 設定の書き込みから、送る操作を作る。許可リストにない項目は何も作らない。板ごとの設定は変わった板だけ */
    fun opsOf(key: String, value: Any?, before: Any?): List<SettingOp> {
        if (key == BOARD_META_KEY) {
            val now = value as? Map<String, Any?> ?: emptyMap()
            val old = before as? Map<String, Any?> ?: emptyMap()
            return (old.keys + now.keys).sorted().mapNotNull { url ->
                val wire = boardMetaToWire(now[url] ?: emptyMap<String, Any?>())
                if (wire == null || wire == boardMetaToWire(old[url] ?: emptyMap<String, Any?>())) null else SettingOp(boardMetaPrefix + url, wire)
            }
        }
        val wire = toWire(key, value) ?: return emptyList()
        return if (key in byName) listOf(SettingOp(key, wire)) else emptyList()
    }

    fun idName(name: String): String {
        if (!name.startsWith(boardMetaPrefix)) return name
        val url = name.substring(boardMetaPrefix.length)
        return boardMetaPrefix + (normalizeBoardUrl(url) ?: url)
    }
}

/** 今の設定の置き場は端末で違う(PC は settings 表、スマホは Prefs)。値は手元の形で受け渡す */
interface SettingsHost {
    /** "pc" か "phone"。既定値が端末で違う項目に使う */
    val device: String

    /** 許可リストの項目の今の値。板ごとの設定は boardMeta/<板 URL> */
    fun read(): Map<String, Any?>

    /** 周の中の変更を 1 回で書く。板ごとの設定は許可された項目だけを手元の値に重ねる */
    fun apply(changes: Map<String, Any?>)
}

class SettingAdapter(private val allow: SettingAllowlist, private val host: SettingsHost, private val db: SyncSql) : SyncAdapter {
    override val kind = SETTING_KIND
    override val area = AREA_SETTINGS
    override val ops = listOf(OP_SETTING)
    private val changes = LinkedHashMap<String, Any?>()

    private fun targetOf(ctx: AdapterContext, name: String) = OpTarget(recordId(ctx.keys.kId, SETTING_KIND, null, "", allow.idName(name)), RecordRefs(detail = name))

    private fun argsOf(op: SyncOpRow): Pair<String, Any>? = try {
        val a = parseStrictJson(op.args.orEmpty()) as? Map<*, *>
        val name = a?.get("name") as? String
        val value = a?.get("value")
        if (name == null || (value !is String && value !is Boolean && value !is Number) || allow.fromWire(name, value) == null) null else name to value
    } catch (_: Exception) {
        null
    }

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { targetOf(ctx, it.first) }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? =
        argsOf(op)?.let { (name, value) -> updateRecord(existing, SETTING_KIND, mapOf("key" to name, "value" to value), stamp, ctx.deviceId) }

    /** 領域に設定があれば手元の値をレコードにしない(合流は領域の値を使う)。1 台目は既定と違うものだけ */
    override fun seed(ctx: AdapterContext): List<SeedRow> {
        val n = db.query("SELECT COUNT(*) AS n FROM sync_records WHERE kind = ?", listOf(SETTING_KIND)).firstOrNull()?.get("n") as Long? ?: 0L
        if (n > 0) return emptyList()
        val hlc = Hlc.format(SEED_WALL, 0, ctx.deviceId)
        val out = ArrayList<SeedRow>()
        for ((name, value) in host.read()) {
            val item = allow.item(name)
            val wire = allow.toWire(name, value) ?: continue
            if (item != null && wire == allow.toWire(name, allow.defaultOf(item, host.device))) continue
            if (item == null && wire == "{}") continue
            val payload = mapOf("kind" to SETTING_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to mapOf("key" to name, "value" to wire))
            if (checkPayload(payload) != null) {
                val t = targetOf(ctx, name)
                out += SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
            }
        }
        return out
    }

    override fun detailOf(p: SyncPayload): String? = p.body?.get("key") as? String

    override fun owns(r: StoredRecord) = r.refDetail != null

    /** 手元の URL は端末で違うことがあるので、板ごとの設定は正規化して探す */
    private fun localOf(all: Map<String, Any?>, name: String): Pair<String, Any?> {
        if (!name.startsWith(allow.boardMetaPrefix)) return name to all[name]
        val want = allow.idName(name)
        for ((k, v) in all) if (k.startsWith(allow.boardMetaPrefix) && allow.idName(k) == want) return k to v
        return name to null
    }

    private fun same(r: StoredRecord): Boolean {
        val name = r.refDetail!!
        val wire = r.payload.body?.get("value")
        if (allow.fromWire(name, wire) == null) return true
        return allow.toWire(name, localOf(host.read(), name).second) == wire
    }

    /** 値まで比べる(表の値が正)。手元に入れないと決めたものは、あることにする */
    override fun exists(r: StoredRecord) = same(r)

    override fun differs(r: StoredRecord, ctx: AdapterContext) = !same(r)

    override fun remove(r: StoredRecord) = ApplyPlan(emptyList(), false)

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return ApplyPlan(emptyList(), false)
        val name = r.refDetail!!
        val value = allow.fromWire(name, r.payload.body?.get("value")) ?: return ApplyPlan(emptyList(), false, "setting_value")
        if (same(r)) {
            changes.remove(name)
            return ApplyPlan(emptyList(), false)
        }
        changes[localOf(host.read(), name).first] = value
        return ApplyPlan(emptyList(), false)
    }

    override fun afterApply(ctx: AdapterContext): ApplyPlan? {
        if (changes.isEmpty()) return null
        host.apply(LinkedHashMap(changes))
        changes.clear()
        return ApplyPlan(emptyList(), true)
    }

    override fun localLines(ctx: AdapterContext): List<String> = host.read().mapNotNull { (name, value) ->
        allow.toWire(name, value)?.let { canonicalJson(listOf(allow.idName(name), it)) }
    }
}
