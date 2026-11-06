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
)

internal fun backupJson(settings: JSONObject, boards: List<Board>, threads: List<ThreadSummary>, sites: List<Pair<String, String>>, uploads: List<UploadRecord> = emptyList()): JSONObject =
    JSONObject().put("app", BACKUP_APP).put("version", BACKUP_VERSION).put("settings", settings)
        .put("favoriteBoards", JSONArray().apply { for (b in boards) put(JSONObject().put("url", b.url).put("name", b.name)) })
        .put("favoriteThreads", JSONArray().apply { for (t in threads) put(JSONObject().put("boardUrl", t.boardUrl).put("key", t.key).put("title", t.title)) })
        .put("sites", JSONArray().apply { for ((u, n) in sites) put(JSONObject().put("url", u).put("name", n)) })
        .put("uploads", JSONArray().apply { for (u in uploads) put(uploadJson(u)) })

private fun uploadJson(u: UploadRecord): JSONObject = JSONObject().put("url", u.url).put("name", u.name).put("size", u.size).put("uploadedAt", u.uploadedAt)
    .put("withAccount", u.withAccount).put("hash", u.hash).put("deleteUrl", u.deleteUrl)

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
    val read = JSONObject(text)
    val o = if (read.optString("app") == LEGACY_BACKUP_APP) currentFromLegacy(read) else read
    if (o.optString("app") != BACKUP_APP) throw IllegalArgumentException("このアプリのバックアップではありません")
    if (o.optInt("version") > BACKUP_VERSION) throw IllegalArgumentException("新しい版のアプリで書き出したファイルです。アプリを更新してください")
    fun rows(name: String): List<JSONObject> = o.optJSONArray(name)?.let { a -> List(a.length()) { a.getJSONObject(it) } } ?: emptyList()
    val settings = o.optJSONObject("settings")
    // 読めない NG が 1 つでもあると、読むときに全部を捨てることになる
    settings?.optJSONArray("ngRules")?.let { a -> for (i in 0 until a.length()) NgRule.fromJson(a.getJSONObject(i)) }
    return BackupFile(
        settings,
        rows("favoriteBoards").map { Board(it.getString("url"), it.getString("name")) },
        rows("favoriteThreads").map { ThreadSummary(it.getString("boardUrl"), it.getString("key"), it.getString("title"), 0, 0, null) },
        rows("sites").map { it.getString("url") to it.getString("name") },
        rows("uploads").map(::uploadOf),
    )
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
