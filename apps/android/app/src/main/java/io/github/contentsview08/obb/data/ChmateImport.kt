package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Post
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.nio.charset.Charset
import java.util.zip.ZipInputStream

/**
 * ChMate(Android の専ブラ)のバックアップ(ZIP)を、OBB に取り込める形に読み替える(PC 版の utils/chmate.ts と同じ決まり)。
 *
 * ZIP の中身(2026-11 の ChMate で確かめた形):
 * - `dat/<板>_<キー>.dat`: スレのログ(Shift_JIS の dat。板は `host%2Fboard` か、5ch の板ならディレクトリ名だけ)
 * - `dat/<板>_<キー>.idx`: 1 行目 `最終更新(ms)\tETag`、2 行目 自分の書き込みのレス番号 `no:1,no:1,…`
 * - `archive/<板>/<スレタイ>/…`: 保存したスレ(dat と同じ形)
 * - `databases/roidon.sqlite`: `bookmarks`(見たスレ。flag の 1 のビットが ★ = お気に入り。read_state の JSON の r が既読の番号)、
 *   `boards`(ディレクトリ名 → サーバー。flag の 1 のビットがお気に入りの板)
 * - `ng/_id.json` `_word.json` `_name.json` `_title.json` `_be.json`: NG(`w` 言葉、`f` 旗(32 なら正規表現)、`ct` 作った時刻、`b` 板)
 * - `files/postDataList.json`: 書き込みの履歴、`files/keyword_group_list.json`: スレタイのキーワード
 * 取り込まないもの: アプリの設定(prefs。見た目の好みは別のアプリなので)、BE の NG(OBB に BE の NG はない)
 */
class ChmateDat(val name: String, val text: String, val idx: String?)
/** bookmarks 表の 1 行(見たスレ)。flag の 1 のビットが ★(お気に入り) */
class ChmateBookmark(val name: String, val created: Long, val title: String, val readState: String, val access: Long, val flag: Long = 0)
/** boards 表の 1 行。flag の 1 のビットがお気に入りの板 */
class ChmateBoardRow(val name: String, val server: String, val title: String, val flag: Long)
class ChmateRaw(
    val texts: Map<String, String>,
    val dats: List<ChmateDat>,
    val bookmarks: List<ChmateBookmark>,
    /** boards 表: ディレクトリ名 → サーバー(5ch の板) */
    val boards: Map<String, String>,
    val skipped: List<String>,
    /** boards 表のうち、お気に入りの板(flag の 1 のビット) */
    val favoriteBoards: List<ChmateBoardRow> = emptyList(),
)

class ChmateThread(
    val boardUrl: String,
    val key: String,
    val title: String,
    val posts: List<Post>,
    /** 既読の番号。ChMate の読んだ位置は使わず、持ってきたレスは全部読んだことにする(何百スレもの未読が一度に出ないように) */
    val readNo: Int,
    /** 自分の書き込みのレス番号(idx の 2 行目) */
    val ownNos: List<Int>,
    val favorite: Boolean,
    /** 最後に見た時刻(ms)。idx の最終更新か、お気に入りの access */
    val viewedAt: Long,
)
class ChmatePost(val boardUrl: String, val key: String, val title: String, val no: Int?, val name: String, val mail: String, val body: String, val at: Long)
class ChmateImport(val threads: List<ChmateThread>, val favoriteBoards: List<io.github.contentsview08.obb.bbs.Board>, val ngRules: List<NgRule>, val posts: List<ChmatePost>, val keywords: List<String>, val notes: List<String>)

object Chmate {
    /** ZIP 全体・1 つのファイル・dat の数の上限(PC 版と同じ) */
    private const val MAX_ENTRY_BYTES = 64L * 1024 * 1024
    private const val MAX_DATS = 20000
    /** ChMate の NG のファイル名 → OBB の NG の種類(BE は OBB にない) */
    private val NG_FILES = listOf("ng/_id.json" to "posterId", "ng/_word.json" to "content", "ng/_name.json" to "posterName", "ng/_title.json" to "threadTitle", "ng/_be.json" to null)
    private const val NG_FLAG_REGEX = 32
    /** bookmarks・boards の flag: 1 のビットが ★(お気に入り) */
    private const val FLAG_FAVORITE = 1L
    private fun isFavorite(flag: Long?) = ((flag ?: 0L) and FLAG_FAVORITE) != 0L
    private val DAT_NAME = Regex("^(.+)_(\\d+)\\.(?:dat|idx)$")
    private val THREAD_URL = Regex("^https?://([^/]+)/test/read\\.cgi/([^/]+)/(\\d+)")
    private val CONFIRMED_NO = Regex("/(\\d+)/?$")
    /** ChMate は掲示板の文字コードにかかわらず Shift_JIS(Windows-31J)で保存する */
    private val SJIS: Charset = runCatching { Charset.forName("windows-31j") }.getOrElse { Charset.forName("Shift_JIS") }

    /** ChMate の板の名前 → 板の URL。`host%2Fboard`(外部の板)はそのまま、ディレクトリ名だけ(5ch の板)は boards 表のサーバーを引く。分からなければ null */
    fun boardUrl(name: String, servers: Map<String, String>): String? {
        if (name.isEmpty()) return null
        if (name.contains("%2F")) {
            val decoded = java.net.URLDecoder.decode(name, "UTF-8").trim('/')
            return if (decoded.contains('/')) "https://$decoded/" else null
        }
        val server = servers[name] ?: return null
        return "https://$server/$name/"
    }

    /** dat のファイル名 `<板>_<キー>.dat` → 板とキー */
    fun splitDatName(name: String): Pair<String, String>? = DAT_NAME.find(name)?.let { it.groupValues[1] to it.groupValues[2] }

    /** idx の中身 → 最終更新(ms)と自分の書き込みのレス番号 */
    fun parseIdx(idx: String?): Pair<Long, List<Int>> {
        val lines = (idx ?: "").split('\n')
        val lastModified = lines.getOrNull(0)?.substringBefore('\t')?.toLongOrNull() ?: 0L
        val own = (lines.getOrNull(1) ?: "").split(',').mapNotNull { it.substringBefore(':').toIntOrNull() }.filter { it > 0 }.distinct().sorted()
        return lastModified to own
    }

    /** 書き込みの履歴の url `https://host/test/read.cgi/board/key/` → 板の URL とキー */
    fun splitThreadUrl(url: String): Pair<String, String>? = THREAD_URL.find(url)?.let { "https://${it.groupValues[1]}/${it.groupValues[2]}/" to it.groupValues[3] }

    private fun arrayOf(text: String?): List<JSONObject> {
        if (text == null) return emptyList()
        val a = runCatching { JSONArray(text) }.getOrNull() ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    }

    /** 読み替え。parseDat は dat の本文 → レスとスレタイ(TwoCh.parseDat) */
    fun parse(raw: ChmateRaw, now: Long, parseDat: (String) -> Pair<List<Post>, String?>): ChmateImport {
        val notes = raw.skipped.toMutableList()
        val unknownBoards = LinkedHashSet<String>()
        fun boardUrlOf(name: String): String? = boardUrl(name, raw.boards) ?: run { if (name.isNotEmpty()) unknownBoards += name; null }
        val favorites = raw.bookmarks.associateBy { "${it.name}_${it.created}" }
        // お気に入りの板。5ch の板は boards 表の自分の行にサーバーがある
        val favoriteBoards = raw.favoriteBoards.filter { isFavorite(it.flag) }.mapNotNull { b ->
            val url = if (b.name.contains("%2F")) boardUrlOf(b.name) else if (b.server.isNotEmpty()) "https://${b.server}/${b.name}/" else null
            url?.let { io.github.contentsview08.obb.bbs.Board(it, b.title.ifEmpty { b.name }) }
        }

        val threads = ArrayList<ChmateThread>()
        val seen = HashSet<String>()
        for (d in raw.dats) {
            val (board, key) = splitDatName(d.name) ?: run { notes += "${d.name}: 名前から板とキーが分かりません"; continue }
            val boardUrl = boardUrlOf(board) ?: continue
            if (!seen.add("$boardUrl$key")) continue
            val (posts, title) = parseDat(d.text)
            val fav = favorites["${board}_$key"]
            val (lastModified, ownNos) = parseIdx(d.idx)
            threads += ChmateThread(
                boardUrl, key, title ?: fav?.title ?: "", posts, posts.size, ownNos.filter { it <= posts.size }, isFavorite(fav?.flag),
                if (lastModified > 0) lastModified else if ((fav?.access ?: 0L) > 0) fav!!.access else now,
            )
        }
        // dat のない ★ のスレ(ログは消したがお気に入りには残っている)も、お気に入りとしては取り込む
        for (b in raw.bookmarks) {
            if (!isFavorite(b.flag)) continue
            val boardUrl = boardUrlOf(b.name) ?: continue
            if (!seen.add("$boardUrl${b.created}")) continue
            threads += ChmateThread(boardUrl, b.created.toString(), b.title, emptyList(), 0, emptyList(), true, if (b.access > 0) b.access else now)
        }

        val ngRules = ArrayList<NgRule>()
        var beCount = 0
        for ((file, target) in NG_FILES) {
            val rows = arrayOf(raw.texts[file])
            if (target == null) { beCount += rows.size; continue }
            for (r in rows) {
                val pattern = r.optString("w", "")
                if (pattern.isEmpty()) continue
                val flags = r.optInt("f", 0)
                val b = r.optString("b", "")
                val board = if (b.isNotEmpty()) boardUrlOf(b) else null
                ngRules += NgRule(
                    target = target, pattern = pattern, isRegex = (flags and NG_FLAG_REGEX) != 0, enabled = true, boardUrl = board, note = "ChMate から",
                    createdAt = r.optLong("ct", 0L).takeIf { it > 0 } ?: now,
                )
            }
        }
        if (beCount > 0) notes += "BE の NG $beCount 件は OBB にないので取り込みません"

        // 書き込みの履歴(posted が 0 のものは送れなかった下書き)
        val posts = ArrayList<ChmatePost>()
        for (r in arrayOf(raw.texts["files/postDataList.json"])) {
            val (boardUrl, key) = splitThreadUrl(r.optString("url", "")) ?: continue
            val at = r.optLong("posted", 0L)
            if (at <= 0) continue
            val no = CONFIRMED_NO.find(r.optString("confirmed", ""))?.groupValues?.get(1)?.toIntOrNull()
            posts += ChmatePost(boardUrl, key, r.optString("targetTitle", ""), no, r.optString("name", ""), r.optString("mail", ""), r.optString("body", ""), at)
        }

        val keywords = ArrayList<String>()
        runCatching { JSONObject(raw.texts["files/keyword_group_list.json"] ?: "{}").optJSONArray("items") }.getOrNull()?.let { items ->
            for (i in 0 until items.length()) {
                val w = items.optJSONObject(i)?.optString("keyword", "")?.trim() ?: ""
                if (w.isNotEmpty() && w !in keywords) keywords += w
            }
        }

        if (unknownBoards.isNotEmpty()) notes += "板のサーバーが分からず読まなかった板: ${unknownBoards.take(5).joinToString("・")}${if (unknownBoards.size > 5) " ほか ${unknownBoards.size - 5}" else ""}"
        return ChmateImport(threads, favoriteBoards, ngRules, posts, keywords, notes)
    }

    /** 取り込んだ数の言い方(PC 版と同じ) */
    fun describe(threads: Int, favorites: Int, posts: Int, ngAdded: Int, keywords: Int, skippedBoards: Int, favoriteBoards: Int = 0): String = listOfNotNull(
        if (threads > 0) "スレのログ $threads" else null,
        if (favoriteBoards > 0) "お気に入り板 $favoriteBoards" else null,
        if (favorites > 0) "お気に入りのスレ $favorites" else null,
        if (posts > 0) "書き込みの履歴 $posts" else null,
        if (ngAdded > 0) "NG $ngAdded" else null,
        if (keywords > 0) "キーワード $keywords" else null,
        if (skippedBoards > 0) "対応していない掲示板のスレ $skippedBoards は読みませんでした" else null,
    ).joinToString("・")

    /**
     * ZIP をほどく。dat は Shift_JIS から直し、roidon.sqlite はキャッシュの一時ファイルに写して bookmarks・boards を読む(読み終えたら消す)
     */
    fun readZip(input: InputStream, cacheDir: File): ChmateRaw {
        val texts = HashMap<String, String>()
        val dats = HashMap<String, String>()
        val idxs = HashMap<String, String>()
        val skipped = ArrayList<String>()
        var sqlite: ByteArray? = null
        ZipInputStream(input.buffered()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name.replace('\\', '/')
                val base = name.substringAfterLast('/')
                val inLogs = name.startsWith("dat/") || name.startsWith("archive/")
                val wanted = (inLogs && (base.endsWith(".dat") || base.endsWith(".idx"))) ||
                    ((name.startsWith("ng/") || name.startsWith("files/")) && name.endsWith(".json")) || name.endsWith("databases/roidon.sqlite")
                if (!wanted) continue
                val bytes = readLimited(zip, MAX_ENTRY_BYTES) ?: run { skipped += "$name: 大きすぎるので読みません"; continue }
                when {
                    inLogs && base.endsWith(".dat") -> if (dats.size < MAX_DATS) dats[base] = String(bytes, SJIS) else skipped += "$name: ログが多すぎるので読みません"
                    inLogs && base.endsWith(".idx") -> idxs[base] = String(bytes, Charsets.UTF_8)
                    name.endsWith("roidon.sqlite") -> sqlite = bytes
                    else -> texts[name] = String(bytes, Charsets.UTF_8)
                }
            }
        }
        val datList = dats.keys.sorted().map { ChmateDat(it, dats.getValue(it), idxs[it.removeSuffix(".dat") + ".idx"]) }
        val bookmarks = ArrayList<ChmateBookmark>()
        val boards = HashMap<String, String>()
        val favoriteBoards = ArrayList<ChmateBoardRow>()
        val db = sqlite
        if (db == null) skipped += "databases/roidon.sqlite がないので、お気に入りのスレは読めません"
        else if (!db.copyOfRange(0, minOf(16, db.size)).contentEquals("SQLite format 3\u0000".toByteArray(Charsets.ISO_8859_1))) skipped += "roidon.sqlite が SQLite のファイルではありません"
        else {
            val tmp = File(cacheDir, "chmate-import.sqlite")
            try {
                tmp.writeBytes(db)
                android.database.sqlite.SQLiteDatabase.openDatabase(tmp.path, null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY).use { sdb ->
                    runCatching {
                        sdb.rawQuery("SELECT name, created, title, read_state, access, flag FROM bookmarks", null).use { c ->
                            while (c.moveToNext()) bookmarks += ChmateBookmark(c.getString(0) ?: "", c.getLong(1), c.getString(2) ?: "", c.getString(3) ?: "", c.getLong(4), c.getLong(5))
                        }
                    }.onFailure { skipped += "お気に入りのスレ(bookmarks)を読めません: ${it.message}" }
                    runCatching {
                        sdb.rawQuery("SELECT name, server, title, flag FROM boards", null).use { c ->
                            while (c.moveToNext()) {
                                val n = c.getString(0) ?: ""
                                val s = c.getString(1) ?: ""
                                if (n.isNotEmpty() && s.isNotEmpty() && !n.contains("%2F")) boards[n] = s
                                if (isFavorite(c.getLong(3))) favoriteBoards += ChmateBoardRow(n, s, c.getString(2) ?: "", c.getLong(3))
                            }
                        }
                    }.onFailure { skipped += "板一覧(boards)を読めません: ${it.message}" }
                }
            } catch (e: Exception) {
                skipped += "roidon.sqlite を開けません: ${e.message}"
            } finally {
                tmp.delete()
            }
        }
        return ChmateRaw(texts, datList, bookmarks, boards, skipped, favoriteBoards)
    }

    /** 上限までを読む。超えていたら null */
    private fun readLimited(zip: ZipInputStream, limit: Long): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = zip.read(buf)
            if (n < 0) break
            total += n
            if (total > limit) return null
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
