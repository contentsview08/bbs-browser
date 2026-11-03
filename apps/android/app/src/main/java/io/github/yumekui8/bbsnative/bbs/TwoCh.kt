package io.github.yumekui8.bbsnative.bbs

import io.github.yumekui8.bbsnative.data.Http
import io.github.yumekui8.bbsnative.data.HttpResponse
import org.json.JSONObject
import java.nio.charset.Charset

// 2ch 互換(bbsmenu / subject.txt / dat)。専ブラの packages/connectors/src/twoch(connector.ts・parse.ts)を Kotlin に写したもの

private val SJIS: Charset = runCatching { Charset.forName("windows-31j") }.getOrElse { Charset.forName("Shift_JIS") }

/** Content-Type の charset から文字コードを決める。書かれていなければ 2ch 互換の慣習どおり Shift_JIS(windows-31j) */
private fun charsetOf(res: HttpResponse): Charset {
    val cs = Regex("charset=([^;]+)", RegexOption.IGNORE_CASE).find(res.headers["content-type"] ?: "")?.groupValues?.get(1)?.trim()?.lowercase()
    return when (cs) {
        "utf-8", "utf8" -> Charsets.UTF_8
        "euc-jp" -> Charset.forName("EUC-JP")
        else -> SJIS
    }
}

private val NAMED = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "hearts" to "♥")
private val ENTITY = Regex("&(#x[0-9a-fA-F]+|#\\d+|[a-zA-Z]+);")

fun decodeEntities(s: String): String {
    if (!s.contains('&')) return s
    return ENTITY.replace(s) { m ->
        val code = m.groupValues[1]
        if (code.startsWith("#")) {
            val n = if (code.length > 1 && (code[1] == 'x' || code[1] == 'X')) code.drop(2).toIntOrNull(16) else code.drop(1).toIntOrNull()
            if (n != null && n in 1..0x10ffff) String(Character.toChars(n)) else m.value
        } else NAMED[code] ?: m.value
    }
}

private val BR = Regex("\\s*<br\\s*/?>\\s?", RegexOption.IGNORE_CASE)
private val TAG = Regex("<[^>]*>")

/** dat の本文の HTML を、表示用のプレーンテキストに直す(前後に 1 つずつ入っている空白も外す) */
fun htmlToText(html: String): String {
    val t = decodeEntities(TAG.replace(BR.replace(html, "\n"), ""))
    return t.removePrefix(" ").removeSuffix(" ")
}

private val BOARD_URL = Regex("^https?://[^/]+/[^/?#]+/$")
fun isBoardUrl(url: String) = BOARD_URL.matches(url)

private val MENU_ITEM = Regex("<b>([^<]+)</b>|<a\\s+href=[\"']?([^\"'\\s>]+)[\"']?[^>]*>([^<]+)</a>", RegexOption.IGNORE_CASE)

/** 一般的な bbsmenu.html。<B>カテゴリ</B> の後に <A HREF=板URL>板名</A> が並ぶ形(PC 版の twoch/parse.ts の parseBbsMenuHtml と同じ) */
fun parseBbsMenuHtml(html: String): List<Board> {
    val out = ArrayList<Board>()
    var category: String? = null
    for (m in MENU_ITEM.findAll(html)) {
        if (m.groupValues[1].isNotEmpty()) { category = decodeEntities(m.groupValues[1].trim()); continue }
        val url = m.groupValues[2]
        val c = category
        if (c != null && isBoardUrl(url)) out += Board(url, decodeEntities(m.groupValues[3].trim()), c)
    }
    return out
}

/** 5ch の bbsmenu.json */
fun parseBbsMenuJson(text: String): List<Board> {
    val out = ArrayList<Board>()
    val list = JSONObject(text).optJSONArray("menu_list") ?: return out
    for (i in 0 until list.length()) {
        val cat = list.getJSONObject(i)
        val items = cat.optJSONArray("category_content") ?: continue
        for (j in 0 until items.length()) {
            val b = items.getJSONObject(j)
            val url = b.optString("url")
            if (isBoardUrl(url)) out += Board(url, b.optString("board_name"), b.optString("category_name").ifEmpty { null })
        }
    }
    return out
}

private val SUBJECT_LINE = Regex("^(\\d+)\\.(?:dat<>|cgi,)(.*)\\((\\d+)\\)\\s*$")
private const val FUTURE_TOLERANCE_MS = 24L * 60 * 60 * 1000

/** dat 番号はスレが立った時刻の UNIX 秒(10 桁のときだけ信用する。未来の日時はお知らせスレなので「不明」) */
private fun createdAtOf(key: String, now: Long): Long? {
    if (key.length != 10 || !key.all { it.isDigit() }) return null
    val t = key.toLong() * 1000
    return if (t > now + FUTURE_TOLERANCE_MS) null else t
}

private fun isAnnouncementKey(key: String, now: Long) = key.length == 10 && key.all { it.isDigit() } && key.toLong() * 1000 > now + FUTURE_TOLERANCE_MS

/** withAuthorId: エッジの subject-metadent.txt か(今はどちらも同じ読み方。スレタイの後ろの角かっこは立てた人) */
fun parseSubjectTxt(text: String, boardUrl: String, @Suppress("UNUSED_PARAMETER") withAuthorId: Boolean): List<ThreadSummary> {
    val now = System.currentTimeMillis()
    val out = ArrayList<ThreadSummary>()
    for (raw in text.split('\n')) {
        val m = SUBJECT_LINE.find(raw.trimEnd()) ?: continue
        val (title, authorId) = splitAuthorId(decodeEntities(m.groupValues[2].trim()))
        val key = m.groupValues[1]
        out += ThreadSummary(boardUrl, key, title, m.groupValues[3].toInt(), out.size, createdAtOf(key, now), authorId, isAnnouncementKey(key, now))
    }
    return out
}

private val TRAILING_BRACKET = Regex("\\s*[\\[［]([^\\[\\]［］]{1,32})[\\]］]\\s*$")
private val ID_STAR = Regex("^(\\S{1,20})★$")
private val BE_DIGITS = Regex("^\\d{6,12}$")

/**
 * スレタイの後ろの角かっこ(「… [xxx]」「… ［xxx］」)を、立てた人として取り出す(PC 版の twoch/parse.ts の splitAuthorId と同じ決まり):
 * エッジの「[ID★]」は ★ を外して ID、5ch の BE の板の 6〜12 桁の数字は「BE:番号」、それ以外(ほかの板の名前や ID)は中身をそのまま。
 * 「[転載禁止]」のような決まり文句・「©」で始まるもの・スレタイが角かっこだけのときは、スレタイのまま
 */
fun splitAuthorId(title: String): Pair<String, String?> {
    val m = TRAILING_BRACKET.find(title) ?: return title to null
    val inner = m.groupValues[1].trim()
    if (inner.isEmpty() || inner.contains("転載") || inner.startsWith("©")) return title to null
    val rest = title.substring(0, m.range.first).trimEnd()
    if (rest.isEmpty()) return title to null
    val id = ID_STAR.find(inner)?.groupValues?.get(1) ?: if (BE_DIGITS.matches(inner)) "BE:$inner" else inner
    return rest to id
}
private val ID_IN_DATE = Regex("\\sID:(\\S+)")
private val ID_BE = Regex("\\s(?:ID|BE):\\S+")

/** dat の 1 行 = 名前<>メール<>日付 ID:xxx<>本文<>スレタイ(1 行目だけ)。崩れた行も番号がずれないよう 1 レスにする */
private fun parseDatLine(line: String, no: Int): Pair<Post, String?> {
    val f = line.split("<>")
    if (f.size < 4) return Post(no, "", "", "", null, htmlToText(line)) to null
    val title = f.getOrNull(4)?.trim()?.takeIf { it.isNotEmpty() }?.let { decodeEntities(it) }
    return Post(
        no = no,
        name = htmlToText(f[0]),
        mail = decodeEntities(f[1]),
        date = ID_BE.replace(f[2], "").trim(),
        id = ID_IN_DATE.find(f[2])?.groupValues?.get(1),
        body = htmlToText(f[3]),
    ) to title
}

private fun parseDat(text: String, startNo: Int): Pair<List<Post>, String?> {
    val lines = text.split('\n').let { if (it.lastOrNull() == "") it.dropLast(1) else it }
    var title: String? = null
    val posts = lines.mapIndexed { i, line ->
        val (p, t) = parseDatLine(line, startNo + i)
        if (title == null && t != null) title = t
        p
    }
    return posts to title
}

/** 最後の改行までだけ使う(書きかけの行を読まない) */
private fun completeLines(b: ByteArray): ByteArray {
    val i = b.lastIndexOf(0x0a.toByte())
    return if (i < 0) ByteArray(0) else b.copyOf(i + 1)
}

/** 5ch・bbspink の過去ログ(dat 落ちしたスレ)。板/oyster/キーの頭 4 桁/キー.dat */
private fun kakoDatUrl(t: ThreadSummary): String? {
    val host = java.net.URI(t.boardUrl).host ?: return null
    if (!Regex("(?:^|\\.)(?:5ch\\.io|5ch\\.net|bbspink\\.com)$").containsMatchIn(host)) return null
    return "${t.boardUrl}oyster/${t.key.take(4)}/${t.key}.dat"
}

private fun ensureOk(res: HttpResponse, url: String) {
    if (res.status !in 200..299) throw IllegalStateException("HTTP ${res.status}: $url")
}

/** subject.txt の中身がスレ一覧の形か(エラーのページを空のスレ一覧と取り違えないため) */
private fun looksLikeSubject(text: String): Boolean {
    val first = text.split('\n').firstOrNull { it.isNotBlank() } ?: return true
    return Regex("^\\d+\\.(?:dat|cgi)<>").containsMatchIn(first)
}

object TwoCh {
    suspend fun listBoards(menuUrl: String): List<Board> {
        if (HonoBbs.isSiteUrl(menuUrl)) return HonoBbs.listBoards(menuUrl)
        val res = Http.get(menuUrl)
        ensureOk(res, menuUrl)
        // bbsmenu.json(5ch)は JSON、それ以外は bbsmenu.html(kenmo.org など。文字コードは Content-Type から)
        return if (menuUrl.substringBefore('?').endsWith(".json")) parseBbsMenuJson(String(res.body, Charsets.UTF_8))
        else parseBbsMenuHtml(String(res.body, charsetOf(res)))
    }

    private suspend fun readSubject(url: String): String {
        val res = Http.get(url)
        if (res.status == 404) throw IllegalStateException("板が見つかりません(HTTP 404)")
        ensureOk(res, url)
        val text = String(res.body, charsetOf(res))
        if (!looksLikeSubject(text)) throw IllegalStateException("スレ一覧を読めませんでした(掲示板の板ではないかもしれません)")
        return text
    }

    /** 板の SETTING.TXT(キー → 値)。取れなければ空。板ごとに 1 回だけ読む */
    private val settingCache = HashMap<String, Map<String, String>>()

    /** 読み終えた SETTING.TXT(まだなら null) */
    fun cachedSetting(boardUrl: String): Map<String, String>? = synchronized(settingCache) { settingCache[boardUrl] }

    suspend fun setting(boardUrl: String): Map<String, String> {
        synchronized(settingCache) { settingCache[boardUrl]?.let { return it } }
        val map = if (HonoBbs.isBoardUrl(boardUrl)) HonoBbs.setting(boardUrl) else if (Shitaraba.isBoardUrl(boardUrl)) Shitaraba.setting(boardUrl) else runCatching {
            val res = Http.get("${boardUrl}SETTING.TXT")
            if (res.status !in 200..299) emptyMap()
            else String(res.body, charsetOf(res)).lineSequence().mapNotNull { l -> l.indexOf('=').takeIf { it > 0 }?.let { l.substring(0, it).trim() to l.substring(it + 1).trim() } }.toMap()
        }.getOrDefault(emptyMap())
        synchronized(settingCache) { settingCache[boardUrl] = map }
        return map
    }

    /** 読み終えた既定の名前(まだなら null) */
    fun cachedNoname(boardUrl: String): String? = cachedSetting(boardUrl)?.get("BBS_NONAME_NAME")?.ifEmpty { null }

    /** 板の既定の名前(SETTING.TXT の BBS_NONAME_NAME)。取れなければ null */
    suspend fun nonameName(boardUrl: String): String? = setting(boardUrl)["BBS_NONAME_NAME"]?.ifEmpty { null }

    /** 本文の長さ(上限と比べる数)。2ch 互換は Shift_JIS のバイト数、hono-bbs は文字数 */
    fun lengthOf(boardUrl: String, text: String): Int =
        if (HonoBbs.isBoardUrl(boardUrl)) text.length else if (Shitaraba.isBoardUrl(boardUrl)) Shitaraba.byteLength(text) else shiftJisByteLength(text)

    /** 本文の上限(バイト数・行数)。SETTING.TXT にあれば。5ch の BBS_LINE_NUMBER は行数の半分を書くので 2 倍する */
    fun cachedLimits(boardUrl: String): Pair<Int?, Int?> {
        val m = cachedSetting(boardUrl) ?: return null to null
        return m["BBS_MESSAGE_COUNT"]?.toIntOrNull() to m["BBS_LINE_NUMBER"]?.toIntOrNull()?.let { it * 2 }
    }

    /** スレ一覧。エッジは、立てた人の ID が付いたスレ一覧(subject-metadent.txt)が読めればそちらを使う */
    suspend fun listThreads(board: Board): List<ThreadSummary> {
        if (HonoBbs.isBoardUrl(board.url)) return HonoBbs.listThreads(board)
        if (Shitaraba.isBoardUrl(board.url)) return Shitaraba.listThreads(board)
        if (board.url.contains("eddibb.cc/")) {
            val meta = runCatching { readSubject("${board.url}subject-metadent.txt") }.getOrNull()
            if (meta != null) return parseSubjectTxt(meta, board.url, true)
        }
        return parseSubjectTxt(readSubject("${board.url}subject.txt"), board.url, false)
    }

    /** dat を取る。cursor があれば、その続き(Range)だけ */
    suspend fun fetchPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult {
        if (HonoBbs.isBoardUrl(thread.boardUrl)) return HonoBbs.fetchPosts(thread, cursor)
        if (Shitaraba.isBoardUrl(thread.boardUrl)) return Shitaraba.fetchPosts(thread, cursor)
        val url = "${thread.boardUrl}dat/${thread.key}.dat"
        if (cursor?.kako == true) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor, archived = true)

        suspend fun archived(): FetchResult {
            val kako = kakoDatUrl(thread)
            if (kako != null) {
                val res = Http.get(kako)
                if (res.status == 200 && res.body.isNotEmpty()) {
                    val body = completeLines(res.body)
                    val (posts, title) = parseDat(String(body, charsetOf(res)), 1)
                    if (posts.isNotEmpty()) {
                        return FetchResult(
                            if (cursor != null) FetchStatus.RESET else FetchStatus.UPDATED,
                            posts, DatCursor(body.size.toLong(), posts.size, null, kako = true), title, archived = true,
                        )
                    }
                }
            }
            return FetchResult(FetchStatus.ARCHIVED, emptyList(), cursor)
        }

        suspend fun fetchAll(): FetchResult {
            val res = Http.get(url)
            if (res.status == 404 || res.status == 302) return archived()
            ensureOk(res, url)
            val body = completeLines(res.body)
            val (posts, title) = parseDat(String(body, charsetOf(res)), 1)
            return FetchResult(
                if (cursor != null) FetchStatus.RESET else FetchStatus.UPDATED,
                posts, DatCursor(body.size.toLong(), posts.size, res.headers["last-modified"]), title,
            )
        }

        if (cursor == null || cursor.bytes == 0L) return fetchAll()
        // 1 バイト手前から取り、先頭が改行なら続きとして正しい(途中で dat が作り直されていない)
        val headers = HashMap<String, String>()
        headers["Range"] = "bytes=${cursor.bytes - 1}-"
        cursor.lastModified?.let { headers["If-Modified-Since"] = it }
        val res = Http.get(url, headers)
        if (res.status == 304) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor)
        if (res.status == 404 || res.status == 302) return archived()
        if (res.status == 416 || res.status == 200) return fetchAll()
        if (res.status != 206) ensureOk(res, url)
        if (res.body.isEmpty() || res.body[0] != 0x0a.toByte()) return fetchAll()
        val added = completeLines(res.body.copyOfRange(1, res.body.size))
        val (posts, _) = parseDat(String(added, charsetOf(res)), cursor.postCount + 1)
        return FetchResult(
            FetchStatus.UPDATED, posts,
            DatCursor(cursor.bytes + added.size, cursor.postCount + posts.size, res.headers["last-modified"] ?: cursor.lastModified),
        )
    }

    /** 書き込む。5ch はスレの URL を Referer に求める */
    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        if (HonoBbs.isBoardUrl(t.boardUrl)) return HonoBbs.createPost(t, input)
        if (Shitaraba.isBoardUrl(t.boardUrl)) return Shitaraba.createPost(t, input)
        val u = java.net.URI(t.boardUrl)
        val fields = linkedMapOf(
            "bbs" to u.path.trim('/'),
            "key" to t.key,
            "time" to (System.currentTimeMillis() / 1000).toString(),
            "FROM" to input.name,
            "mail" to input.mail,
            "MESSAGE" to input.body,
            "submit" to "書き込む",
        )
        return sendBbsCgi("${u.scheme}://${u.host}/test/bbs.cgi", fields, webUrl(t))
    }

    /** スレを立てる */
    suspend fun createThread(board: Board, title: String, input: PostInput): PostResult {
        if (HonoBbs.isBoardUrl(board.url)) return HonoBbs.createThread(board, title, input)
        if (Shitaraba.isBoardUrl(board.url)) return Shitaraba.createThread(board, title, input)
        val u = java.net.URI(board.url)
        val fields = linkedMapOf(
            "bbs" to u.path.trim('/'),
            "subject" to title,
            "time" to (System.currentTimeMillis() / 1000).toString(),
            "FROM" to input.name,
            "mail" to input.mail,
            "MESSAGE" to input.body,
            "submit" to "新規スレッド作成",
        )
        return sendBbsCgi("${u.scheme}://${u.host}/test/bbs.cgi", fields, board.url)
    }

    /** 書き込み確認で承諾したときに送り直す */
    suspend fun submitConfirm(c: PostResult.Confirm): PostResult = sendBbsCgi(c.url, c.fields, c.referer)

    /** 5ch は 5ch.net から 5ch.io へ移った。書き込み(POST)はリダイレクトをたどれないので、送る先と Referer を 5ch.io に直す(前に 5ch.net で開いたスレ・板でも書けるように) */
    private fun to5chIo(url: String) = url.replace(Regex("^(https?://[a-z0-9]+)\\.5ch\\.net/"), "$1.5ch.io/")

    private suspend fun sendBbsCgi(url0: String, fields: Map<String, String>, referer0: String): PostResult {
        val url = to5chIo(url0)
        val referer = to5chIo(referer0)
        val res = Http.postForm(url, encodeShiftJisForm(fields), mapOf("Referer" to referer))
        val html = String(res.body, charsetOf(res))
        val resNumber = res.headers["x-resnum"]?.toIntOrNull()?.takeIf { it > 0 }
        val r = parseBbsCgi(html, url, fields, referer, resNumber)
        if (r is PostResult.Error && res.status >= 400 && r.message.isBlank()) return PostResult.Error("HTTP ${res.status}")
        return r
    }

    /** ブラウザで開く URL */
    fun webUrl(t: ThreadSummary): String {
        if (HonoBbs.isBoardUrl(t.boardUrl)) return HonoBbs.webUrl(t)
        if (Shitaraba.isBoardUrl(t.boardUrl)) return Shitaraba.webUrl(t)
        val u = java.net.URI(t.boardUrl)
        return "${u.scheme}://${u.host}/test/read.cgi/${u.path.trim('/')}/${t.key}/"
    }
}
