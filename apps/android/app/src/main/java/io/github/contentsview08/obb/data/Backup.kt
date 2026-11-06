package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.ThreadSummary
import org.json.JSONArray
import org.json.JSONObject

// バックアップのファイル: 設定・お気に入り板・お気に入りのスレ・サイト

private const val BACKUP_APP = "bbs-native"

internal class BackupFile(val settings: JSONObject?, val boards: List<Board>, val threads: List<ThreadSummary>, val sites: List<Pair<String, String>>)

internal fun backupJson(settings: JSONObject, boards: List<Board>, threads: List<ThreadSummary>, sites: List<Pair<String, String>>): JSONObject =
    JSONObject().put("app", BACKUP_APP).put("version", 1).put("settings", settings)
        .put("favoriteBoards", JSONArray().apply { for (b in boards) put(JSONObject().put("url", b.url).put("name", b.name)) })
        .put("favoriteThreads", JSONArray().apply { for (t in threads) put(JSONObject().put("boardUrl", t.boardUrl).put("key", t.key).put("title", t.title)) })
        .put("sites", JSONArray().apply { for ((u, n) in sites) put(JSONObject().put("url", u).put("name", n)) })

/** ファイルを読む。別の JSON や壊れた行は例外(何も戻さない) */
internal fun parseBackup(text: String): BackupFile {
    val o = JSONObject(text)
    if (o.optString("app") != BACKUP_APP) throw IllegalArgumentException("このアプリのバックアップではありません")
    fun rows(name: String): List<JSONObject> = o.optJSONArray(name)?.let { a -> List(a.length()) { a.getJSONObject(it) } } ?: emptyList()
    return BackupFile(
        o.optJSONObject("settings"),
        rows("favoriteBoards").map { Board(it.getString("url"), it.getString("name")) },
        rows("favoriteThreads").map { ThreadSummary(it.getString("boardUrl"), it.getString("key"), it.getString("title"), 0, 0, null) },
        rows("sites").map { it.getString("url") to it.getString("name") },
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
            is Number -> if (k in floatKeys || (v !is Int && v !is Long)) put(k, v.toFloat()) else if (v is Int) put(k, v)
        }
    }
}
