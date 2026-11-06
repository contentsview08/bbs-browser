package io.github.contentsview08.obb.sync

// レコードの種類ごとのマージ。どれも可換・結合的・冪等(sync-merge.json とプロパティテストで確かめる)

/** 暗号文の中身。kind・hlc・device_id・deleted・body と、知らないフィールド。知らないものはそのまま持ち続けて再送する */
typealias SyncPayload = Map<String, Any?>

const val LAST_VIEWED_FIELD = "last_viewed_at"

val SyncPayload.hlc: String get() = this["hlc"] as String
val SyncPayload.kind: String get() = this["kind"] as String

@Suppress("UNCHECKED_CAST")
val SyncPayload.body: Map<String, Any?>? get() = this["body"] as? Map<String, Any?>

private fun compareCanonical(a: Any?, b: Any?): Int = canonicalJson(a).compareTo(canonicalJson(b)).coerceIn(-1, 1)

private fun compareLww(a: SyncPayload, b: SyncPayload): Int {
    val h = Hlc.compare(a.hlc, b.hlc)
    return if (h != 0) h else compareCanonical(a, b)
}

/** HLC が同じで中身が違うのは、端末を戻したときなどに起きる。中身でも決めて順番によらない結果にする */
fun mergeLww(a: SyncPayload, b: SyncPayload): SyncPayload = if (compareLww(a, b) >= 0) a else b

private fun withoutField(p: SyncPayload, field: String): SyncPayload {
    val body = p.body ?: return p
    if (!body.containsKey(field)) return p
    val rest = body - field
    // field だけの本体は、本体がないのと同じに比べる
    return if (rest.isNotEmpty()) p + ("body" to rest) else p - "body"
}

/**
 * ほかは LWW、field だけ max にする。2 つの決まりの直積なので tombstone をまたいでも結合的でいられる。
 * 勝ち負けは field を除いて比べる(比べる値がマージで変わると結合的でなくなる)
 */
fun mergeWithMax(a: SyncPayload, b: SyncPayload, field: String): SyncPayload {
    val x = withoutField(a, field)
    val y = withoutField(b, field)
    val winner = if (compareLww(x, y) >= 0) x else y
    val values = listOfNotNull(a.body?.get(field) as? Long, b.body?.get(field) as? Long)
    if (values.isEmpty()) return winner
    return winner + ("body" to (winner.body.orEmpty() + (field to values.max())))
}

/** payload.kind に応じたマージ。知らない種類は LWW(新しい版の端末の値を消さない) */
fun mergePayloads(a: SyncPayload, b: SyncPayload): SyncPayload =
    if (a.kind == "last_view" || b.kind == "last_view") mergeWithMax(a, b, LAST_VIEWED_FIELD) else mergeLww(a, b)

/** レコードの更新。知らないフィールドを残す。stamp は Hlc.stamp に existing の hlc を floor として渡して作る */
fun updateRecord(existing: SyncPayload?, kind: String, changes: Map<String, Any?>, stamp: String, deviceId: String): SyncPayload =
    (existing.orEmpty() - "deleted") + mapOf(
        "kind" to kind,
        "hlc" to stamp,
        "device_id" to deviceId,
        "body" to (existing?.body.orEmpty() + changes),
    )

/** 外した項目の中身を残さない。keep は max で持ち続けるフィールド(残さないと tombstone をまたいで max が崩れる) */
fun makeTombstone(existing: SyncPayload, stamp: String, deviceId: String, keep: List<String> = emptyList()): SyncPayload {
    val kept = existing.body.orEmpty().filterKeys { it in keep }
    val base = (existing - "body") + mapOf("hlc" to stamp, "device_id" to deviceId, "deleted" to true)
    return if (kept.isNotEmpty()) base + ("body" to kept) else base
}

private val ORDER_KEY = Regex("[0-9]*[1-9]")

fun isOrderKey(v: Any?): Boolean = v is String && v.length <= 1024 && ORDER_KEY.matches(v)

/** a < b の 0.xxx の小数の桁を返す(b が null なら上限は 1)。a・b とも末尾は 0 でない */
private fun midpoint(a: String, b: String?): String {
    if (b != null) {
        var n = 0
        while (n < b.length && (a.getOrNull(n) ?: '0') == b[n]) n++
        if (n > 0) return b.substring(0, n) + midpoint(a.drop(n), b.substring(n))
    }
    val da = a.firstOrNull()?.digitToInt() ?: 0
    val db = b?.get(0)?.digitToInt() ?: 10
    if (db - da > 1) return ((da + db + 1) / 2).toString()
    if (b != null && b.length > 1) return b.substring(0, 1)
    return da.toString() + midpoint(a.drop(1), null)
}

/**
 * 順序キーは 0.xxx の小数の桁の文字列。文字列の比較がそのまま数の大小になり、浮動小数点と違って桁が尽きない。
 * 末尾へ足すときは 1 ずつ進め、続けて足しても桁が増えにくくする
 */
fun orderKeyBetween(a: String?, b: String?): String {
    if ((a != null && !isOrderKey(a)) || (b != null && !isOrderKey(b)) || (a != null && b != null && a >= b)) throw SyncError("bad_order_key")
    if (a == null && b == null) return "5"
    if (b == null) {
        val k = a!!
        val i = k.indexOfFirst { it != '9' }
        return if (i < 0) k + "1" else k.substring(0, i) + (k[i].digitToInt() + 1)
    }
    return midpoint(a.orEmpty(), b)
}

class Ordered(val key: String, val id: String)

/** 順序キーで並べる。同じキーは ID で決める(2 台で同じ位置へ動かしたとき) */
val ORDERED_COMPARATOR: Comparator<Ordered> = compareBy<Ordered> { it.key }.thenBy { it.id }
