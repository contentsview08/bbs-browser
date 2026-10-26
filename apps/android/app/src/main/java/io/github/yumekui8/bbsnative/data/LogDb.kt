package io.github.yumekui8.bbsnative.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import io.github.yumekui8.bbsnative.bbs.Board
import io.github.yumekui8.bbsnative.bbs.DatCursor
import io.github.yumekui8.bbsnative.bbs.FetchResult
import io.github.yumekui8.bbsnative.bbs.FetchStatus
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val CONNECTOR = "2ch-compat"

/** 開いたことのあるスレの状態(スレ一覧の未読の数・既読の位置に使う) */
data class ThreadState(val readNo: Int, val postCount: Int)

/** 手元のスレのログ */
class ThreadLog(val title: String, val posts: List<Post>, val readNo: Int, val cursor: DatCursor?, val archived: Boolean)

/** 書き込み履歴の 1 行 */
data class PostHistoryEntry(val thread: ThreadSummary, val no: Int?, val body: String, val postedAt: Long)

/** 閲覧履歴の 1 行 */
data class HistoryEntry(val thread: ThreadSummary, val readNo: Int, val readAt: Long)

/**
 * ログの保存(専ブラの packages/logstore にあたる)。テーブルは専ブラと同じ SQL(assets/migrations、専ブラの
 * packages/logstore/migrations の写し)で作るので、形は PC 版と同じ。版の番号 = 流したマイグレーションの数
 */
class LogDb(private val context: Context) : SQLiteOpenHelper(context, "bbs-native.db", null, migrationNames(context).size) {

    override fun onCreate(db: SQLiteDatabase) = migrate(db, 0)

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = migrate(db, oldVersion)

    private fun migrate(db: SQLiteDatabase, from: Int) {
        for (name in migrationNames(context).drop(from)) {
            val sql = context.assets.open("migrations/$name").bufferedReader().use { it.readText() }
            for (stmt in splitSql(sql)) db.execSQL(stmt)
        }
    }

    // ── 板 ──

    suspend fun favorites(): List<Board> = io {
        readableDatabase.rawQuery("SELECT url, name FROM favorite_boards ORDER BY sort, rowid", null).use { c ->
            buildList { while (c.moveToNext()) add(Board(c.getString(0), c.getString(1))) }
        }
    }

    suspend fun setFavorite(board: Board, on: Boolean) = io {
        if (on) {
            writableDatabase.execSQL(
                "INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))",
                arrayOf(board.url, CONNECTOR, board.name),
            )
        } else writableDatabase.execSQL("DELETE FROM favorite_boards WHERE url = ?", arrayOf(board.url))
    }

    /** お気に入り板の並びを入れ替える(urls の順に並べ直す) */
    suspend fun reorderFavorites(urls: List<String>) = io {
        val db = writableDatabase
        db.beginTransaction()
        try {
            urls.forEachIndexed { i, u -> db.execSQL("UPDATE favorite_boards SET sort = ? WHERE url = ?", arrayOf<Any>(i, u)) }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** 板一覧の取得元(bbsmenu)を足す・外す */
    suspend fun addSite(menuUrl: String, name: String) = io {
        writableDatabase.execSQL(
            "INSERT OR REPLACE INTO sites (menu_url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sites))",
            arrayOf(menuUrl, CONNECTOR, name),
        )
    }

    suspend fun removeSite(menuUrl: String) = io {
        writableDatabase.execSQL("DELETE FROM boards WHERE site_menu_url = ?", arrayOf(menuUrl))
        writableDatabase.execSQL("DELETE FROM sites WHERE menu_url = ?", arrayOf(menuUrl))
    }

    /** 板一覧の取得元(bbsmenu)。はじめは 5ch だけ(DB を作るときに入る) */
    suspend fun siteMenuUrls(): List<Pair<String, String>> = io {
        readableDatabase.rawQuery("SELECT menu_url, name FROM sites ORDER BY sort", null).use { c ->
            buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) }
        }
    }

    suspend fun cachedBoards(menuUrl: String): List<Board> = io {
        readableDatabase.rawQuery("SELECT url, name, category FROM boards WHERE site_menu_url = ? ORDER BY sort", arrayOf(menuUrl)).use { c ->
            buildList { while (c.moveToNext()) add(Board(c.getString(0), c.getString(1), c.getString(2))) }
        }
    }

    suspend fun replaceBoards(menuUrl: String, boards: List<Board>) = io {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("boards", "site_menu_url = ?", arrayOf(menuUrl))
            val st = db.compileStatement("INSERT OR REPLACE INTO boards (site_menu_url, url, connector_id, name, category, sort) VALUES (?, ?, ?, ?, ?, ?)")
            boards.forEachIndexed { i, b ->
                st.clearBindings()
                st.bindString(1, menuUrl); st.bindString(2, b.url); st.bindString(3, CONNECTOR); st.bindString(4, b.name)
                if (b.category != null) st.bindString(5, b.category) else st.bindNull(5)
                st.bindLong(6, i.toLong())
                st.executeInsert()
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // ── スレ ──

    /** 板の中で開いたことのあるスレの状態(キー → 既読の位置・手元のレス数) */
    suspend fun threadStates(boardUrl: String): Map<String, ThreadState> = io {
        readableDatabase.rawQuery("SELECT key, read_no, post_count FROM threads WHERE board_url = ?", arrayOf(boardUrl)).use { c ->
            buildMap { while (c.moveToNext()) put(c.getString(0), ThreadState(c.getInt(1), c.getInt(2))) }
        }
    }

    suspend fun loadThread(t: ThreadSummary): ThreadLog? = io {
        val db = readableDatabase
        val head = db.rawQuery("SELECT title, read_no, cursor, status FROM threads WHERE board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key)).use { c ->
            if (c.moveToFirst()) arrayOf(c.getString(0), c.getInt(1), c.getString(2), c.getString(3)) else null
        } ?: return@io null
        val posts = db.rawQuery("SELECT no, name, mail, date, id, body FROM posts WHERE board_url = ? AND key = ? ORDER BY no", arrayOf(t.boardUrl, t.key)).use { c ->
            ArrayList<Post>(c.count).apply {
                while (c.moveToNext()) add(Post(c.getInt(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5)))
            }
        }
        ThreadLog(head[0] as String, posts, head[1] as Int, (head[2] as String?)?.let(::cursorFromJson), head[3] == "archived")
    }

    /** 取ってきたレスを保存する。RESET なら手元のレスを置き換える */
    suspend fun saveFetch(t: ThreadSummary, r: FetchResult, title: String) = io {
        val db = writableDatabase
        val now = System.currentTimeMillis()
        db.beginTransaction()
        try {
            db.execSQL(
                "INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at) VALUES (?, ?, ?, ?, ?)",
                arrayOf<Any?>(t.boardUrl, t.key, CONNECTOR, title, t.createdAt),
            )
            if (r.status == FetchStatus.RESET) db.delete("posts", "board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key))
            if (r.posts.isNotEmpty()) {
                val st = db.compileStatement("INSERT OR REPLACE INTO posts (board_url, key, no, name, mail, date, id, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                for (p in r.posts) {
                    st.clearBindings()
                    st.bindString(1, t.boardUrl); st.bindString(2, t.key); st.bindLong(3, p.no.toLong())
                    st.bindString(4, p.name); st.bindString(5, p.mail); st.bindString(6, p.date)
                    if (p.id != null) st.bindString(7, p.id) else st.bindNull(7)
                    st.bindString(8, p.body)
                    st.executeInsert()
                }
            }
            val v = ContentValues()
            v.put("title", title)
            v.put("fetched_at", now)
            if (r.cursor != null) {
                v.put("cursor", cursorToJson(r.cursor))
                v.put("post_count", r.cursor.postCount)
            }
            if (r.status == FetchStatus.ARCHIVED || r.archived) v.put("status", "archived")
            db.update("threads", v, "board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** どこまで読んだか(戻らない。read_at は閲覧履歴の並びに使う) */
    suspend fun markRead(t: ThreadSummary, no: Int) = io {
        writableDatabase.execSQL(
            "UPDATE threads SET read_no = MAX(read_no, ?), read_at = ? WHERE board_url = ? AND key = ?",
            arrayOf<Any>(no, System.currentTimeMillis(), t.boardUrl, t.key),
        )
    }

    /** 開いた(閲覧履歴の一番上に) */
    suspend fun touch(t: ThreadSummary) = io {
        writableDatabase.execSQL("UPDATE threads SET read_at = ? WHERE board_url = ? AND key = ?", arrayOf<Any>(System.currentTimeMillis(), t.boardUrl, t.key))
    }

    suspend fun history(limit: Int = 300): List<HistoryEntry> = io {
        readableDatabase.rawQuery(
            "SELECT board_url, key, title, post_count, read_no, read_at, created_at FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val t = ThreadSummary(c.getString(0), c.getString(1), c.getString(2), c.getInt(3), 0, if (c.isNull(6)) null else c.getLong(6))
                    add(HistoryEntry(t, c.getInt(4), c.getLong(5)))
                }
            }
        }
    }

    // ── 書き込み ──

    /** 自分の書き込みとして覚える(「自分」の絞り込み・自分への返信の印に使う) */
    suspend fun addOwnPost(t: ThreadSummary, no: Int) = io {
        writableDatabase.execSQL("INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES (?, ?, ?, ?)", arrayOf<Any>(t.boardUrl, t.key, no, System.currentTimeMillis()))
    }

    suspend fun ownPosts(t: ThreadSummary): Set<Int> = io {
        readableDatabase.rawQuery("SELECT no FROM own_posts WHERE board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key)).use { c ->
            buildSet { while (c.moveToNext()) add(c.getInt(0)) }
        }
    }

    /** 書きかけ(スレごと)。空なら消す */
    suspend fun saveDraft(t: ThreadSummary, body: String) = io {
        if (body.isBlank()) writableDatabase.delete("drafts", "board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key))
        else writableDatabase.execSQL("INSERT OR REPLACE INTO drafts (board_url, key, body, updated_at) VALUES (?, ?, ?, ?)", arrayOf<Any>(t.boardUrl, t.key, body, System.currentTimeMillis()))
    }

    suspend fun draft(t: ThreadSummary): String = io {
        readableDatabase.rawQuery("SELECT body FROM drafts WHERE board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key)).use { c -> if (c.moveToFirst()) c.getString(0) else "" }
    }

    // ── お気に入りのスレ ──

    /** お気に入りのスレ(手元の既読・レス数つき。開いたことがなければ 0) */
    suspend fun favoriteThreads(): List<HistoryEntry> = io {
        readableDatabase.rawQuery(
            "SELECT f.board_url, f.key, f.title, COALESCE(t.post_count, 0), COALESCE(t.read_no, 0), f.added_at, f.created_at FROM favorite_threads f LEFT JOIN threads t ON t.board_url = f.board_url AND t.key = f.key ORDER BY f.sort, f.added_at",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val t = ThreadSummary(c.getString(0), c.getString(1), c.getString(2), c.getInt(3), 0, if (c.isNull(6)) null else c.getLong(6))
                    add(HistoryEntry(t, c.getInt(4), c.getLong(5)))
                }
            }
        }
    }

    suspend fun isFavoriteThread(t: ThreadSummary): Boolean = io {
        readableDatabase.rawQuery("SELECT 1 FROM favorite_threads WHERE board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key)).use { it.moveToFirst() }
    }

    suspend fun setFavoriteThread(t: ThreadSummary, title: String, on: Boolean) = io {
        if (on) {
            writableDatabase.execSQL(
                "INSERT OR IGNORE INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_threads), ?)",
                arrayOf<Any?>(t.boardUrl, t.key, CONNECTOR, title, t.createdAt, System.currentTimeMillis()),
            )
        } else writableDatabase.delete("favorite_threads", "board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key))
    }

    // ── 書き込み履歴 ──

    suspend fun addPostHistory(t: ThreadSummary, title: String, no: Int?, name: String, mail: String, body: String) = io {
        writableDatabase.execSQL(
            "INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            arrayOf<Any?>(CONNECTOR, t.boardUrl, t.key, title, no, name, mail, body, System.currentTimeMillis()),
        )
    }

    suspend fun postHistory(limit: Int = 300): List<PostHistoryEntry> = io {
        readableDatabase.rawQuery(
            "SELECT board_url, key, thread_title, no, body, posted_at FROM post_history ORDER BY posted_at DESC LIMIT ?", arrayOf(limit.toString()),
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val key = c.getString(1)
                    val created = if (key.length == 10 && key.all { it.isDigit() }) key.toLong() * 1000 else null
                    add(PostHistoryEntry(ThreadSummary(c.getString(0), key, c.getString(2), 0, 0, created), if (c.isNull(3)) null else c.getInt(3), c.getString(4), c.getLong(5)))
                }
            }
        }
    }

    suspend fun deleteThread(t: ThreadSummary) = io {
        val db = writableDatabase
        db.delete("posts", "board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key))
        db.delete("threads", "board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key))
    }

    /**
     * しばらく開いていないスレのログを消す(最後に読んだ時刻、なければ取った時刻が before より前のもの。PC 版の pruneLogs と同じ)。
     * お気に入りのスレ・自分が書き込んだスレは残す。消したスレの数を返す。
     * rawQuery の引数は文字列で渡るので、CAST して数で比べる(文字列のままだと、どの数も文字列より小さいので全部消える)
     */
    suspend fun pruneLogs(before: Long): Int = io {
        val db = writableDatabase
        val rows = db.rawQuery(
            """SELECT t.board_url, t.key FROM threads t
               WHERE COALESCE(t.read_at, t.fetched_at, 0) < CAST(? AS INTEGER)
                 AND NOT EXISTS (SELECT 1 FROM favorite_threads f WHERE f.board_url = t.board_url AND f.key = t.key)
                 AND NOT EXISTS (SELECT 1 FROM own_posts o WHERE o.board_url = t.board_url AND o.key = t.key)""",
            arrayOf(before.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) } }
        db.beginTransaction()
        try {
            for ((b, k) in rows) {
                db.delete("posts", "board_url = ? AND key = ?", arrayOf(b, k))
                db.delete("threads", "board_url = ? AND key = ?", arrayOf(b, k))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        rows.size
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }
}

private fun migrationNames(context: Context): List<String> = (context.assets.list("migrations") ?: emptyArray()).filter { it.endsWith(".sql") }.sorted()

/** SQL のファイルを文ごとに分ける(行頭の -- のコメントを外し、行末の ; で区切る) */
private fun splitSql(sql: String): List<String> {
    val out = ArrayList<String>()
    val cur = StringBuilder()
    for (line in sql.lines()) {
        val t = line.trim()
        if (t.startsWith("--") || t.isEmpty()) continue
        cur.append(line).append('\n')
        if (t.endsWith(";")) {
            out += cur.toString().trim().removeSuffix(";")
            cur.clear()
        }
    }
    if (cur.isNotBlank()) out += cur.toString().trim()
    return out
}

private fun cursorToJson(c: DatCursor): String = JSONObject().apply {
    put("bytes", c.bytes)
    put("postCount", c.postCount)
    c.lastModified?.let { put("lastModified", it) }
    if (c.kako) put("kako", true)
}.toString()

private fun cursorFromJson(s: String): DatCursor? = runCatching {
    val o = JSONObject(s)
    DatCursor(o.getLong("bytes"), o.getInt("postCount"), o.optString("lastModified").ifEmpty { null }, o.optBoolean("kako"))
}.getOrNull()
