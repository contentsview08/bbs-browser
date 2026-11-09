package io.github.contentsview08.obb.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.DatCursor
import io.github.contentsview08.obb.bbs.FetchResult
import io.github.contentsview08.obb.bbs.FetchStatus
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.sync.engine.AndroidSyncSql
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** PC 版の DB の connector_id。したらば・まちBBS も 2ch-compat で入れる */
internal fun connectorOf(boardUrl: String) = if (io.github.contentsview08.obb.bbs.HonoBbs.isBoardUrl(boardUrl)) "honobbs" else "2ch-compat"

/** 開いたことのあるスレの状態(スレ一覧の未読の数・既読の位置に使う) */
data class ThreadState(val readNo: Int, val postCount: Int, val archived: Boolean = false)

/** 手元のスレのログ */
class ThreadLog(val title: String, val posts: List<Post>, val readNo: Int, val cursor: DatCursor?, val archived: Boolean)

/** 書き込み履歴の 1 行 */
data class PostHistoryEntry(val id: Long, val thread: ThreadSummary, val no: Int?, val body: String, val postedAt: Long)

/** 閲覧履歴の 1 行 */
data class HistoryEntry(val thread: ThreadSummary, val readNo: Int, val readAt: Long)

/** 新着のあるスレだけを未読の多い順に。手元のレス数は取得するまで増えないので、掲示板のレス数を確かめてあればその数で比べる */
internal fun unreadEntries(entries: List<HistoryEntry>, counts: Map<String, Int>): List<HistoryEntry> {
    fun total(e: HistoryEntry) = counts[e.thread.id] ?: e.thread.postCount
    return entries.filter { total(it) > it.readNo }.sortedByDescending { total(it) - it.readNo }
}

/** 上げた画像 1 枚。PC 版の UploadRecord と同じ項目 */
data class UploadRecord(
    val url: String,
    val name: String,
    val size: Long,
    val uploadedAt: Long,
    val withAccount: Boolean = false,
    val hash: String? = null,
    val deleteUrl: String? = null,
)

/** 上げた画像の履歴の SQL。JVM のテストでも同じ文を流す */
internal object UploadSql {
    /** 同じ画像を使い直すときはハッシュや消すページが分からないので、渡さなければ前の値を残す */
    const val ADD = "INSERT OR REPLACE INTO uploads (url, name, size, uploaded_at, with_account, hash, delete_url) VALUES (?, ?, ?, ?, ?, " +
        "COALESCE(?, (SELECT hash FROM uploads WHERE url = ?)), COALESCE(?, (SELECT delete_url FROM uploads WHERE url = ?)))"
    /** バックアップから戻すときは、手元の行を古い行で置き換えない */
    const val IMPORT = "INSERT OR IGNORE INTO uploads (url, name, size, uploaded_at, with_account, hash, delete_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
    const val FIND_BY_HASH = "SELECT url FROM uploads WHERE hash = ? ORDER BY uploaded_at DESC LIMIT 1"
    const val LIST = "SELECT url, name, size, uploaded_at, with_account, hash, delete_url FROM uploads ORDER BY uploaded_at DESC"
    const val REMOVE = "DELETE FROM uploads WHERE url = ?"

    fun addArgs(u: UploadRecord, now: Long): Array<Any?> =
        arrayOf(u.url, u.name, u.size, now, if (u.withAccount) 1 else 0, u.hash, u.url, u.deleteUrl, u.url)

    fun importArgs(u: UploadRecord): Array<Any?> =
        arrayOf(u.url, u.name, u.size, u.uploadedAt, if (u.withAccount) 1 else 0, u.hash, u.deleteUrl)
}

/** お気に入り板とサイトの SQL。JVM のテストでも同じ文を流す */
internal object FavoriteBoardSql {
    const val ADD = "INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))"
    const val REMOVE = "DELETE FROM favorite_boards WHERE url = ?"
    const val REORDER = "UPDATE favorite_boards SET sort = ? WHERE url = ?"

    fun addArgs(board: Board): List<Any?> = listOf(board.url, connectorOf(board.url), board.name)
}

internal object SiteSql {
    const val ADD = "INSERT OR REPLACE INTO sites (menu_url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sites))"
    const val REMOVE_BOARDS = "DELETE FROM boards WHERE site_menu_url = ?"
    const val REMOVE = "DELETE FROM sites WHERE menu_url = ?"

    fun addArgs(menuUrl: String, name: String): List<Any?> = listOf(menuUrl, if (io.github.contentsview08.obb.bbs.HonoBbs.isSiteUrl(menuUrl)) "honobbs" else "2ch-compat", name)
}

/** スレのログと履歴の SQL。JVM のテストでも同じ文を流す */
/** 同じ板の URL の書き方。行は書いた端末の URL のまま残るので、板の未読はどの書き方の行も読む */
internal fun boardUrlVariants(url: String): List<String> {
    val rest = Regex("^https?://(.*)$").find(url)?.groupValues?.get(1) ?: return listOf(url)
    val fiveCh = Regex("(^|\\.)5ch\\.(io|net)/")
    val hosts = if (fiveCh.containsMatchIn(rest)) listOf(rest.replaceFirst("5ch.net/", "5ch.io/"), rest.replaceFirst("5ch.io/", "5ch.net/")) else listOf(rest)
    return hosts.flatMap { listOf("https://$it", "http://$it") }
}

internal object ThreadLogSql {
    /** 画面の履歴の一覧。同期のテストも同じ文を流す */
    const val HISTORY = "SELECT board_url, key, title, post_count, read_no, read_at, created_at FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC LIMIT ?"

    /**
     * 板の未読の数のもと。同期のテストも同じ文を流す。
     * のぞいただけのスレ(読んでいない・履歴にない・お気に入りでない行)は、開いたスレに数えない
     */
    fun threadStates(urls: Int) = "SELECT key, read_no, post_count, status FROM threads WHERE board_url IN (${List(urls) { "?" }.joinToString(", ")}) " +
        "AND (read_no > 0 OR read_at IS NOT NULL OR EXISTS (SELECT 1 FROM favorite_threads f WHERE f.board_url = threads.board_url AND f.key = threads.key))"

    const val MARK_READ = "UPDATE threads SET read_no = MAX(read_no, ?), read_at = ? WHERE board_url = ? AND key = ?"
    const val VIEW = "UPDATE threads SET read_at = ? WHERE board_url = ? AND key = ?"
    const val REMOVE_HISTORY = "UPDATE threads SET read_at = NULL WHERE board_url = ? AND key = ?"
    val DELETE_LOG = listOf("threads", "posts").map { "DELETE FROM $it WHERE board_url = ? AND key = ?" }

    /** rawQuery の引数は文字列で渡るので、CAST して数で比べる(文字列のままだと、どの数も文字列より小さいので全部消える) */
    const val PRUNE_TARGETS = "SELECT t.board_url, t.key FROM threads t " +
        "WHERE COALESCE(t.read_at, t.fetched_at, 0) < CAST(? AS INTEGER) " +
        "AND NOT EXISTS (SELECT 1 FROM favorite_threads f WHERE f.board_url = t.board_url AND f.key = t.key) " +
        "AND NOT EXISTS (SELECT 1 FROM own_posts o WHERE o.board_url = t.board_url AND o.key = t.key)"

    /**
     * のぞいただけの行(既読も閲覧もない)。一覧から消す手段がなく、残す日数が「消さない」でも溜まるので、
     * 残す日数とは別に短い期間で消す。既読や閲覧の付いた行は PRUNE_TARGETS の決まりに任せる
     */
    const val PRUNE_PEEKED = "SELECT t.board_url, t.key FROM threads t " +
        "WHERE t.read_no = 0 AND t.read_at IS NULL AND COALESCE(t.fetched_at, 0) < CAST(? AS INTEGER) " +
        "AND NOT EXISTS (SELECT 1 FROM favorite_threads f WHERE f.board_url = t.board_url AND f.key = t.key) " +
        "AND NOT EXISTS (SELECT 1 FROM own_posts o WHERE o.board_url = t.board_url AND o.key = t.key)"
}

/** 自分のレスの印の SQL。JVM のテストでも同じ文を流す */
internal object OwnPostSql {
    const val ADD = "INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES (?, ?, ?, ?)"
    const val REMOVE = "DELETE FROM own_posts WHERE board_url = ? AND key = ? AND no = ?"
}

/** 書き込み履歴の SQL。JVM のテストでも同じ文を流す */
internal object PostHistorySql {
    const val ADD = "INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    const val REMOVE = "DELETE FROM post_history WHERE id = ?"
    const val LIST = "SELECT id, board_url, key, thread_title, no, body, posted_at FROM post_history ORDER BY posted_at DESC, id DESC LIMIT ?"

    fun addArgs(t: ThreadSummary, title: String, no: Int?, name: String, mail: String, body: String, now: Long): List<Any?> =
        listOf(connectorOf(t.boardUrl), t.boardUrl, t.key, title, no?.toLong(), name, mail, body, now)
}

/** お気に入りのスレの SQL。JVM のテストでも同じ文を流す */
internal object FavoriteThreadSql {
    const val ADD = "INSERT OR IGNORE INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_threads), ?)"
    const val REMOVE = "DELETE FROM favorite_threads WHERE board_url = ? AND key = ?"

    fun addArgs(t: ThreadSummary, title: String, now: Long): List<Any?> = listOf(t.boardUrl, t.key, connectorOf(t.boardUrl), title, t.createdAt, now)
    fun removeArgs(t: ThreadSummary): List<Any?> = listOf(t.boardUrl, t.key)
}

/**
 * ログの保存(PC 版の packages/logstore にあたる)。テーブルは PC 版と同じ packages/logstore/migrations の SQL で作る
 * (ビルドで assets の migrations/ に入る)。版の番号 = 流したマイグレーションの数
 */
class LogDb(private val context: Context) : SQLiteOpenHelper(context, "obb.db", null, migrationNames(context).size) {

    override fun onCreate(db: SQLiteDatabase) = migrate(db, 0)

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = migrate(db, oldVersion)

    private fun migrate(db: SQLiteDatabase, from: Int) {
        for (name in migrationNames(context).drop(from)) {
            val sql = context.assets.open("migrations/$name").bufferedReader().use { it.readText() }
            for (stmt in splitSql(sql)) db.execSQL(stmt)
        }
    }

    // ── 上げた画像の履歴 ──

    suspend fun addUpload(u: UploadRecord, now: Long = System.currentTimeMillis()) = io {
        writableDatabase.execSQL(UploadSql.ADD, UploadSql.addArgs(u, now))
    }

    suspend fun importUploads(list: List<UploadRecord>) = io {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (u in list) db.execSQL(UploadSql.IMPORT, UploadSql.importArgs(u))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** 同じ中身(hash)の画像を前に上げていれば、その URL(いちばん新しいもの) */
    suspend fun findUploadByHash(hash: String): String? = io {
        readableDatabase.rawQuery(UploadSql.FIND_BY_HASH, arrayOf(hash)).use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }

    suspend fun listUploads(): List<UploadRecord> = io {
        readableDatabase.rawQuery(UploadSql.LIST, null).use { c ->
            buildList {
                while (c.moveToNext()) add(UploadRecord(c.getString(0), c.getString(1), c.getLong(2), c.getLong(3), c.getInt(4) == 1, c.getString(5), c.getString(6)))
            }
        }
    }

    /** 履歴から消す(置き場のファイルを消すのは呼ぶ側) */
    suspend fun removeUpload(url: String) = io {
        writableDatabase.execSQL(UploadSql.REMOVE, arrayOf(url))
    }

    // ── 板 ──

    suspend fun favorites(): List<Board> = io {
        readableDatabase.rawQuery("SELECT url, name FROM favorite_boards ORDER BY sort, rowid", null).use { c ->
            buildList { while (c.moveToNext()) add(Board(c.getString(0), c.getString(1))) }
        }
    }

    suspend fun setFavorite(board: Board, on: Boolean) = io {
        if (on) {
            writableDatabase.execSQL(FavoriteBoardSql.ADD, FavoriteBoardSql.addArgs(board).toTypedArray())
        } else writableDatabase.execSQL(FavoriteBoardSql.REMOVE, arrayOf(board.url))
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
        writableDatabase.execSQL(SiteSql.ADD, SiteSql.addArgs(menuUrl, name).toTypedArray())
    }

    suspend fun removeSite(menuUrl: String) = io {
        writableDatabase.execSQL("DELETE FROM boards WHERE site_menu_url = ?", arrayOf(menuUrl))
        writableDatabase.execSQL("DELETE FROM sites WHERE menu_url = ?", arrayOf(menuUrl))
    }

    /** 板一覧の取得元(bbsmenu) */
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

    suspend fun cachedBoardUrls(): List<String> = io {
        readableDatabase.rawQuery("SELECT DISTINCT url FROM boards", null).use { c ->
            buildList { while (c.moveToNext()) add(c.getString(0)) }
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
                st.bindString(1, menuUrl); st.bindString(2, b.url); st.bindString(3, connectorOf(b.url)); st.bindString(4, b.name)
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
        val urls = boardUrlVariants(boardUrl)
        readableDatabase.rawQuery(ThreadLogSql.threadStates(urls.size), urls.toTypedArray()).use { c ->
            val out = LinkedHashMap<String, ThreadState>()
            while (c.moveToNext()) {
                val st = ThreadState(c.getInt(1), c.getInt(2), c.getString(3) == "archived")
                val key = c.getString(0)
                // 同じスレの行が別の書き方の URL で残っているときは、読んだ方を使う
                val had = out[key]
                out[key] = if (had == null || st.readNo > had.readNo) st else had
            }
            out
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
                arrayOf<Any?>(t.boardUrl, t.key, connectorOf(t.boardUrl), title, t.createdAt),
            )
            if (r.status == FetchStatus.NOT_MODIFIED) {
                // 変わらなくても、dat 落ちと分かったら印を付け直し、続きの印も書く(したらばは新着のないまま過去ログ倉庫に入ったことを印で返す。
                // 次から取りに行かないように)。前の印がある(レスを取ってある)スレだけ。
                // ふつうの変化なしの印は書かない(レスのない印を持つと、次から差分だけを取りに行く)
                val cursor = if (r.archived && r.cursor != null) cursorToJson(r.cursor) else null
                db.execSQL(
                    """UPDATE threads SET title = ?, fetched_at = ?, status = CASE WHEN ? = 1 THEN 'archived' ELSE status END,
                         post_count = CASE WHEN ? IS NOT NULL AND cursor IS NOT NULL THEN ? ELSE post_count END,
                         cursor = CASE WHEN ? IS NOT NULL AND cursor IS NOT NULL THEN ? ELSE cursor END
                       WHERE board_url = ? AND key = ?""",
                    arrayOf<Any?>(title, now, if (r.archived) 1 else 0, cursor, r.cursor?.postCount, cursor, cursor, t.boardUrl, t.key),
                )
                db.setTransactionSuccessful()
                return@io
            }
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

    suspend fun history(limit: Int = io.github.contentsview08.obb.sync.SyncConfig.HISTORY_SHOWN): List<HistoryEntry> = io {
        readableDatabase.rawQuery(
            ThreadLogSql.HISTORY,
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

    /** 自分のレスの印(「自分」の絞り込み・自分への返信の印に使う)。付ける・外すは UserOps(同期に乗せる) */
    /** 同期で届いた印は板の URL の書き方(5ch.io / 5ch.net、http / https)が違うことがあるので、書き方によらず引く */
    suspend fun ownPosts(t: ThreadSummary): Set<Int> = io {
        val urls = boardUrlVariants(t.boardUrl)
        readableDatabase.rawQuery("SELECT no FROM own_posts WHERE board_url IN (${urls.joinToString(", ") { "?" }}) AND key = ?", (urls + t.key).toTypedArray()).use { c ->
            buildSet { while (c.moveToNext()) add(c.getInt(0)) }
        }
    }

    /** 自分のレスの印があるスレ(手で印を付けたスレは書き込み履歴にないので、あなた宛ての確認はこちらも見る) */
    suspend fun ownPostThreads(): List<ThreadSummary> = io {
        readableDatabase.rawQuery(
            "SELECT DISTINCT t.board_url, t.key, t.title, t.post_count, t.created_at FROM own_posts o JOIN threads t ON t.board_url = o.board_url AND t.key = o.key",
            emptyArray(),
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(ThreadSummary(c.getString(0), c.getString(1), c.getString(2), c.getInt(3), 0, if (c.isNull(4)) null else c.getLong(4)))
            }
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

    /** お気に入りのスレ(手元の既読・見た時刻・レス数つき。開いたことがなければ 0) */
    suspend fun favoriteThreads(): List<HistoryEntry> = io {
        readableDatabase.rawQuery(
            "SELECT f.board_url, f.key, f.title, COALESCE(t.post_count, 0), COALESCE(t.read_no, 0), COALESCE(t.read_at, 0), f.created_at FROM favorite_threads f LEFT JOIN threads t ON t.board_url = f.board_url AND t.key = f.key ORDER BY f.sort, f.added_at",
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

    /** お気に入りのスレを足す・外す利用者の操作はここだけを通す。読み書きの列もこの DB と同じ(既読を書いた直後の一覧の読みが、古い値を見ない) */
    val syncSql by lazy { AndroidSyncSql { writableDatabase } }
    val userOps by lazy { UserOps(syncSql, dispatcher = lane) }

    // ── 書き込み履歴 ──

    suspend fun postHistory(limit: Int = 300): List<PostHistoryEntry> = io {
        readableDatabase.rawQuery(PostHistorySql.LIST, arrayOf(limit.toString())).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val key = c.getString(2)
                    val created = if (key.length == 10 && key.all { it.isDigit() }) key.toLong() * 1000 else null
                    add(PostHistoryEntry(c.getLong(0), ThreadSummary(c.getString(1), key, c.getString(3), 0, 0, created), if (c.isNull(4)) null else c.getInt(4), c.getString(5), c.getLong(6)))
                }
            }
        }
    }

    /** 同期の表から既読と履歴を戻す。自動整理のあとに開き直すと既読が戻る */
    suspend fun restoreThreadRead(t: ThreadSummary) = io {
        runCatching { io.github.contentsview08.obb.sync.adapters.restoreThreadRead(syncSql, t.boardUrl, t.key, connectorOf(t.boardUrl), t.title, t.createdAt) }
    }

    /** 開いているスレのために、DB の既読だけを読む */
    suspend fun readNo(t: ThreadSummary): Int? = io {
        readableDatabase.rawQuery("SELECT read_no FROM threads WHERE board_url = ? AND key = ?", arrayOf(t.boardUrl, t.key)).use { c -> if (c.moveToFirst()) c.getInt(0) else null }
    }

    /**
     * しばらく開いていないスレのログを消す(最後に読んだ時刻、なければ取った時刻が before より前のもの。PC 版の pruneLogs と同じ)。
     * お気に入りのスレ・自分が書き込んだスレと、keep のスレ(開いている画面)は残す。消したスレ(板の URL とキー)を返す。
     */
    suspend fun pruneLogs(before: Long, keep: Collection<ThreadSummary> = emptyList(), peekedOnly: Boolean = false): List<Pair<String, String>> = io {
        val db = writableDatabase
        val kept = keep.map { it.boardUrl to it.key }.toSet()
        val rows = db.rawQuery(if (peekedOnly) ThreadLogSql.PRUNE_PEEKED else ThreadLogSql.PRUNE_TARGETS, arrayOf(before.toString()))
            .use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) } }
            .filter { it !in kept }
        db.beginTransaction()
        try {
            for ((b, k) in rows) for (sql in ThreadLogSql.DELETE_LOG) db.execSQL(sql, arrayOf(b, k))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        rows
    }

    /** ファビコンのキャッシュ(data: URL と取った時刻) */
    fun favicon(key: String): Pair<String, Long>? =
        readableDatabase.rawQuery("SELECT data, fetched_at FROM favicons WHERE key = ?", arrayOf(key)).use { c -> if (c.moveToFirst()) c.getString(0) to c.getLong(1) else null }

    fun setFavicon(key: String, data: String) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO favicons (key, data, fetched_at) VALUES (?, ?, ?)", arrayOf<Any>(key, data, System.currentTimeMillis()))
    }

    /**
     * 読み書きは 1 本の列に通す。別々の launch から呼んでも呼んだ順に DB へ届く
     * (Dispatchers.IO のままだと、既読を書く前に一覧を読んでしまい、読み終えたスレに未読の数が残る)
     */
    private val lane = Dispatchers.IO.limitedParallelism(1)

    private suspend fun <T> io(block: () -> T): T = withContext(lane) { block() }
}


private fun migrationNames(context: Context): List<String> = (context.assets.list("migrations") ?: emptyArray()).filter { it.endsWith(".sql") }.sorted()

/** SQL のファイルを文ごとに分ける(行頭の -- のコメントを外し、行末の ; で区切る) */
internal fun splitSql(sql: String): List<String> {
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

internal fun cursorToJson(c: DatCursor): String = JSONObject().apply {
    put("bytes", c.bytes)
    put("postCount", c.postCount)
    c.lastModified?.let { put("lastModified", it) }
    if (c.kako) put("kako", true)
}.toString()

internal fun cursorFromJson(s: String): DatCursor? = runCatching {
    val o = JSONObject(s)
    DatCursor(o.getLong("bytes"), o.getInt("postCount"), o.optString("lastModified").ifEmpty { null }, o.optBoolean("kako"))
}.getOrNull()
