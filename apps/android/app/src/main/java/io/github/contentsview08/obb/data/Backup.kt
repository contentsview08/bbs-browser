package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.ThreadSummary
import org.json.JSONArray
import org.json.JSONObject

// バックアップのファイル: 設定・お気に入り板・お気に入りのスレ・サイト・上げた画像の履歴。設定と履歴の名前と形は PC 版と同じ

internal const val BACKUP_APP = "OBB"
internal const val BACKUP_VERSION = 1

internal class BackupFile(
    val settings: JSONObject?,
    val boards: List<Board>,
    val threads: List<ThreadSummary>,
    val sites: List<Pair<String, String>>,
    val uploads: List<UploadRecord>,
    /** 板・スレ・サイトのうち、この端末で扱えない URL(家の中のアドレス・ふたば・板の形でないもの)で外した行の数 */
    val dropped: Int = 0,
)

internal fun backupJson(settings: JSONObject, boards: List<Board>, threads: List<ThreadSummary>, sites: List<Pair<String, String>>, uploads: List<UploadRecord> = emptyList()): JSONObject =
    JSONObject().put("app", BACKUP_APP).put("version", BACKUP_VERSION).put("settings", settings)
        .put("favoriteBoards", JSONArray().apply { for (b in boards) put(JSONObject().put("url", b.url).put("name", b.name)) })
        .put("favoriteThreads", JSONArray().apply { for (t in threads) put(JSONObject().put("boardUrl", t.boardUrl).put("key", t.key).put("title", t.title)) })
        .put("sites", JSONArray().apply { for ((u, n) in sites) put(JSONObject().put("url", u).put("name", n)) })
        .put("uploads", JSONArray().apply { for (u in uploads) put(uploadJson(u)) })

// 削除ページの URL(deleteUrl)は、知った人が画像を消せる秘密なので書き出さない(読み込みは受ける)
private fun uploadJson(u: UploadRecord): JSONObject = JSONObject().put("url", u.url).put("name", u.name).put("size", u.size).put("uploadedAt", u.uploadedAt)
    .put("withAccount", u.withAccount).put("hash", u.hash)

private fun uploadOf(o: JSONObject) = UploadRecord(
    o.getString("url"), o.optString("name"), o.optLong("size"), o.getLong("uploadedAt"), o.optBoolean("withAccount"),
    o.optString("hash").ifEmpty { null }, o.optString("deleteUrl").ifEmpty { null },
)

/** 設定を書き出す形に。JSON を入れて持つ項目は JSON のまま書く(PC のファイルと同じ) */
internal fun exportedSettings(all: Map<String, *>, known: Set<String>): JSONObject {
    val o = JSONObject()
    for ((k, v) in all) {
        if (k !in known || !Prefs.inBackup(k)) continue
        if (k in Prefs.JSON_KEYS && v is String) parsedJson(v)?.let { o.put(k, it) } else o.put(k, v)
    }
    return o
}

private fun parsedJson(s: String): Any? = runCatching {
    when (s.firstOrNull()) {
        '[' -> JSONArray(s)
        '{' -> JSONObject(s)
        else -> null
    }
}.getOrNull()

/** ファイルを読む。別の JSON や壊れた行は例外(何も戻さない) */
internal fun parseBackup(text: String): BackupFile {
    val o = JSONObject(text)
    if (o.optString("app") != BACKUP_APP) throw IllegalArgumentException("このアプリのバックアップではありません")
    if (o.optInt("version") > BACKUP_VERSION) throw IllegalArgumentException("新しい版のアプリで書き出したファイルです。アプリを更新してください")
    fun rows(name: String): List<JSONObject> = o.optJSONArray(name)?.let { a -> List(a.length()) { a.getJSONObject(it) } } ?: emptyList()
    val settings = o.optJSONObject("settings")
    // 読めない NG が 1 つでもあると、読むときに全部を捨てることになる
    settings?.optJSONArray("ngRules")?.let { a -> for (i in 0 until a.length()) NgRule.fromJson(a.getJSONObject(i)) }
    // 板・スレ・サイトの URL は、同期で受けるときと同じ検査を通す(ファイルは人の手で書き換えられる)
    var dropped = 0
    fun <T> kept(list: List<T?>): List<T> = list.filterNotNull().also { dropped += list.size - it.size }
    val boards = kept(rows("favoriteBoards").map { r -> resolveSyncBoard(r.getString("url"))?.let { Board(it.boardUrl, r.getString("name")) } })
    val threads = kept(rows("favoriteThreads").map { r ->
        resolveSyncBoard(r.getString("boardUrl"))?.let { ThreadSummary(it.boardUrl, r.getString("key"), r.getString("title"), 0, 0, null) }
    })
    val sites = kept(rows("sites").map { r -> r.getString("url").takeIf { resolveSyncSite(it) != null }?.let { it to r.getString("name") } })
    return BackupFile(settings, boards, threads, sites, rows("uploads").map(::uploadOf), dropped)
}

/**
 * 設定を保存する型(Boolean・Int・Float・String)にそろえる。入れない項目と読めない値は外す。
 * JSON は小数の 1.0 を 1 と書くので、数の型は値の見た目ではなく floatKeys で決める
 */
internal fun restoredSettings(o: JSONObject, floatKeys: Set<String>): Map<String, Any> = buildMap {
    for (k in o.keys()) {
        if (!Prefs.inBackup(k)) continue
        when (val v = o.get(k)) {
            is Boolean -> put(k, v)
            is String -> put(k, v)
            is JSONArray, is JSONObject -> if (k in Prefs.JSON_KEYS) put(k, v.toString())
            is Number -> if (k in floatKeys || (v !is Int && v !is Long)) put(k, v.toFloat()) else if (v is Int) put(k, v)
        }
    }
}
