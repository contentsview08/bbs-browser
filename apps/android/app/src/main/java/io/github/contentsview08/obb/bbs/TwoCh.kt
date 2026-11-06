package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.Http
import io.github.contentsview08.obb.data.HttpResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

// 2ch 互換(bbsmenu / subject.txt / dat)。PC 版の packages/connectors/src/twoch(connector.ts・parse.ts)を Kotlin に写したもの

/** 読み取ったバイト列を文字にする。文字コードは bbs/Encoding.kt で見分ける */
private fun textOf(res: HttpResponse, body: ByteArray = res.body): String = decodeText(body, res.headers["content-type"])

private val NAMED = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "hearts" to "♥")
private val ENTITY = Regex("&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);")

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
        if (c != null && isBoardUrl(url)) out += Board(UrlRoute.to5chIo(url), decodeEntities(m.groupValues[3].trim()), c)
    }
    return out.distinctBy { it.url }
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
            if (isBoardUrl(url)) out += Board(UrlRoute.to5chIo(url), b.optString("board_name"), b.optString("category_name").ifEmpty { null })
        }
    }
    return out.distinctBy { it.url }
}

private val SUBJECT_LINE = Regex("^([0-9]+)\\.(?:dat<>|cgi,)(.*)\\(([0-9]+)\\)\\s*$")
private const val FUTURE_TOLERANCE_MS = 24L * 60 * 60 * 1000

/** したらば・まちBBS のキーは立った時刻の UNIX 秒(10 桁のときだけ) */
internal fun createdAtOf(key: String): Long? = if (key.length == 10 && key.all { it.isDigit() }) key.toLong() * 1000 else null

private val CGI_SUBJECT_HEAD = Regex("^[0-9]+\\.cgi,")
private val CGI_SUBJECT_LINE = Regex("^([0-9]+)\\.cgi,(.*)\\(([0-9]+)\\)\\s*$")

/** したらば・まちBBS の subject.txt。1 行は「キー.cgi,スレタイ(レス数)」。同じキーは 1 つにする */
internal fun parseCgiSubject(text: String, boardUrl: String): List<ThreadSummary> {
    val first = text.split('\n').firstOrNull { it.isNotBlank() }
    if (first != null && !CGI_SUBJECT_HEAD.containsMatchIn(first)) throw IllegalStateException("スレ一覧を読めませんでした: $boardUrl")
    val out = ArrayList<ThreadSummary>()
    val seen = HashSet<String>()
    for (line in text.split('\n')) {
        val m = CGI_SUBJECT_LINE.find(line) ?: continue
        val key = m.groupValues[1]
        if (!seen.add(key)) continue
        out += ThreadSummary(boardUrl, key, htmlToText(m.groupValues[2]).trim(), m.groupValues[3].toInt(), out.size, createdAtOf(key))
    }
    return out
}

/** SETTING.TXT の形(「キー=値」の行) */
internal fun parseSettingText(text: String): Map<String, String> =
    text.lineSequence().mapNotNull { l -> l.indexOf('=').takeIf { it > 0 }?.let { l.substring(0, it).trim() to l.substring(it + 1).trim() } }.toMap()

/** dat 番号はスレが立った時刻の UNIX 秒(10 桁のときだけ信用する。未来の日時はお知らせスレなので「不明」) */
internal fun createdAtOf(key: String, now: Long): Long? {
    if (key.length != 10 || !key.all { it.isDigit() }) return null
    val t = key.toLong() * 1000
    return if (t > now + FUTURE_TOLERANCE_MS) null else t
}

private fun isAnnouncementKey(key: String, now: Long) = key.length == 10 && key.all { it.isDigit() } && key.toLong() * 1000 > now + FUTURE_TOLERANCE_MS

/** subject.txt・エッヂの subject-metadent.txt(どちらも同じ読み方。スレタイの後ろの角かっこは立てた人) */
fun parseSubjectTxt(text: String, boardUrl: String): List<ThreadSummary> {
    val now = System.currentTimeMillis()
    val out = ArrayList<ThreadSummary>()
    val seen = HashSet<String>()
    for (raw in text.split('\n')) {
        val m = SUBJECT_LINE.find(raw.trimEnd()) ?: continue
        val (title, authorId) = splitAuthorId(decodeEntities(m.groupValues[2].trim()))
        val key = m.groupValues[1]
        // 同じ番号が 2 行あると、一覧のキーが重なって落ちる
        if (!seen.add(key)) continue
        out += ThreadSummary(boardUrl, key, title, m.groupValues[3].toInt(), out.size, createdAtOf(key, now), authorId, isAnnouncementKey(key, now))
    }
    return out
}

private val TRAILING_BRACKET = Regex("\\s*[\\[［]([^\\[\\]［］]{1,32})[\\]］]\\s*$")
private val ID_STAR = Regex("^(\\S{1,20})★$")
private val BE_DIGITS = Regex("^[0-9]{6,12}$")

/**
 * スレタイの後ろの角かっこ(「… [xxx]」「… ［xxx］」)を、立てた人として取り出す(PC 版の twoch/parse.ts の splitAuthorId と同じ決まり):
 * エッヂの「[ID★]」は ★ を外して ID、5ch の BE の板の 6〜12 桁の数字は「BE:番号」、それ以外(ほかの板の名前や ID)は中身をそのまま。
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

/** dat の形か(最初の行に区切りの <> がある)。200 で返るエラーのページをレスとして読まない */
internal fun looksLikeDat(text: String): Boolean = text.lineSequence().firstOrNull { it.isNotBlank() }?.contains("<>") == true

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

/** 板名と書き込み先・スレの URL。板の前に道があれば(https://host/bbs/板/)、test はその下にある(PC 版の boardPathOf と同じ) */
internal class BoardPath(val bbs: String, private val root: String) {
    val postUrl get() = "$root/test/bbs.cgi"
    fun threadUrl(key: String) = "$root/test/read.cgi/$bbs/$key/"
}

internal fun boardPathOf(boardUrl: String): BoardPath {
    val u = java.net.URI(boardUrl)
    val parts = u.rawPath.split('/').filter { it.isNotEmpty() }
    val prefix = parts.dropLast(1).joinToString("") { "/$it" }
    return BoardPath(parts.lastOrNull() ?: "", "${u.scheme}://${u.rawAuthority}$prefix")
}

private fun ensureOk(res: HttpResponse, url: String) {
    if (res.status !in 200..299) throw IllegalStateException("HTTP ${res.status}: $url")
}

/** subject.txt の中身がスレ一覧の形か(エラーのページを空のスレ一覧と取り違えないため) */
internal fun looksLikeSubject(text: String): Boolean {
    val first = text.split('\n').firstOrNull { it.isNotBlank() } ?: return true
    return Regex("^[0-9]+\\.(?:dat|cgi)<>").containsMatchIn(first)
}

object TwoCh {
    /** itest の板のページから、その板のあるサーバー(mercury.bbspink.com など)を探す。PC 版の serverOf と同じ */
    suspend fun itestServer(domain: String, board: String): String {
        val page = "https://itest.$domain/subback/$board"
        val res = Http.get(page)
        ensureOk(res, page)
        val m = Regex("https?://([a-z0-9]+)\\.${Regex.escape(domain)}/${Regex.escape(board)}/").find(String(res.body, Charsets.UTF_8))
        if (m == null || m.groupValues[1] == "itest") throw IllegalStateException("板のサーバーが分かりませんでした: $page")
        return "${m.groupValues[1]}.$domain"
    }

    suspend fun listBoards(menuUrl: String): List<Board> = withContext(Dispatchers.Default) { readBoards(menuUrl) }

    private suspend fun readBoards(menuUrl: String): List<Board> {
        if (HonoBbs.isSiteUrl(menuUrl)) return HonoBbs.listBoards(menuUrl)
        if (Machi.isSiteUrl(menuUrl)) return Machi.listBoards()
        val res = Http.get(menuUrl)
        ensureOk(res, menuUrl)
        // bbsmenu.json(5ch)は JSON、それ以外は bbsmenu.html(kenmo.org など。文字コードは Content-Type から)
        return if (menuUrl.substringBefore('?').endsWith(".json")) parseBbsMenuJson(String(res.body, Charsets.UTF_8))
        else parseBbsMenuHtml(textOf(res))
    }

    /** 板が UTF-8 か。読んだ本文から覚える(書き込みをその板の文字コードで送るため) */
    private val utf8Boards = HashMap<String, Boolean>()
    private fun boardKey(boardUrl: String) = UrlRoute.to5chIo(boardUrl).replace(Regex("^https?://"), "").trimEnd('/') + "/"

    /** ASCII だけの本文は手がかりにならないので覚えない */
    private fun rememberBoardEncoding(boardUrl: String, body: ByteArray) {
        if (body.any { it < 0 }) synchronized(utf8Boards) { utf8Boards[boardKey(boardUrl)] = looksLikeUtf8(body) }
    }

    /** 書き込む前に、板が UTF-8 かを確かめる。まだ分からなければ SETTING.TXT を 1 度だけ見る。読めなければ Shift_JIS で送る */
    private suspend fun isUtf8Board(postUrl: String, bbs: String?): Boolean {
        if (bbs.isNullOrEmpty()) return false
        val boardUrl = postUrl.replace(Regex("test/bbs\\.cgi.*$"), "$bbs/")
        val key = boardKey(boardUrl)
        synchronized(utf8Boards) { utf8Boards[key]?.let { return it } }
        runCatching {
            val res = Http.get("${boardUrl}SETTING.TXT")
            if (res.status in 200..299) rememberBoardEncoding(boardUrl, res.body)
        }
        return synchronized(utf8Boards) { utf8Boards.getOrPut(key) { false } }
    }

    private suspend fun readSubject(url: String): String {
        val res = Http.get(url)
        if (res.status == 404) throw IllegalStateException("板が見つかりません(HTTP 404)")
        ensureOk(res, url)
        val text = textOf(res)
        rememberBoardEncoding(url.substringBeforeLast('/') + "/", res.body)
        if (!looksLikeSubject(text)) throw IllegalStateException("スレ一覧を読めませんでした(掲示板の板ではないかもしれません)")
        return text
    }

    /** 板の SETTING.TXT(キー → 値)。取れなければ空。板ごとに 1 回だけ読む */
    private val settingCache = HashMap<String, Map<String, String>>()

    /** 読み終えた SETTING.TXT(まだなら null) */
    fun cachedSetting(boardUrl: String): Map<String, String>? = synchronized(settingCache) { settingCache[boardUrl] }

    suspend fun setting(boardUrl: String): Map<String, String> {
        synchronized(settingCache) { settingCache[boardUrl]?.let { return it } }
        // null は読めなかったとき。覚えず、次に板を開いたときに読み直す
        val map = if (HonoBbs.isBoardUrl(boardUrl)) HonoBbs.setting(boardUrl) else if (Shitaraba.isBoardUrl(boardUrl)) Shitaraba.setting(boardUrl) else if (Machi.isBoardUrl(boardUrl)) Machi.setting(boardUrl) else runCatching {
            val res = Http.get("${boardUrl}SETTING.TXT")
            if (res.status in 200..299) rememberBoardEncoding(boardUrl, res.body)
            if (res.status == 404) emptyMap<String, String>() // SETTING.TXT のない板
            else if (res.status !in 200..299) null
            else parseSettingText(textOf(res))
        }.getOrNull()
        if (map == null) return emptyMap()
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

    /** hono-bbs の行数の上限。半分にして持つと奇数が 1 行ずれるので、そのまま持つ */
    const val MAX_LINES_KEY = "OBB_MAX_LINES"

    /** 書き込みの上限。SETTING.TXT を読み終えていれば */
    fun cachedLimits(boardUrl: String): PostLimits = cachedSetting(boardUrl)?.let(::postLimitsOf) ?: PostLimits()

    /** 上限を超えているものの説明(なければ空)。したらばは PC 版と同じく止めない */
    fun overLimits(boardUrl: String, body: String, name: String, mail: String, subject: String? = null): List<String> =
        if (Shitaraba.isBoardUrl(boardUrl)) emptyList()
        else postLimitOver(cachedLimits(boardUrl), { lengthOf(boardUrl, it) }, body, name, mail, subject)

    /** 板があるか。スレ一覧(subject.txt)が読めて、スレ一覧の形なら板(スレが 0 件の板もある。youtu.be/xxx のような板でない URL を見分ける) */
    suspend fun isBoard(boardUrl: String): Boolean = runCatching {
        val res = Http.get("${boardUrl}subject.txt")
        res.status in 200..299 && looksLikeSubject(textOf(res))
    }.getOrDefault(false)

    /** スレ一覧。エッヂは、立てた人の ID が付いたスレ一覧(subject-metadent.txt)が読めればそちらを使う */
    suspend fun listThreads(board: Board): List<ThreadSummary> = withContext(Dispatchers.Default) { readThreads(board) }

    private suspend fun readThreads(board: Board): List<ThreadSummary> {
        if (HonoBbs.isBoardUrl(board.url)) return HonoBbs.listThreads(board)
        if (Shitaraba.isBoardUrl(board.url)) return Shitaraba.listThreads(board)
        if (Machi.isBoardUrl(board.url)) return Machi.listThreads(board)
        if (board.url.contains("eddibb.cc/")) {
            val meta = runCatching { readSubject("${board.url}subject-metadent.txt") }.getOrNull()
            if (meta != null) return parseSubjectTxt(meta, board.url)
        }
        return parseSubjectTxt(readSubject("${board.url}subject.txt"), board.url)
    }

    /** dat を取る。cursor があれば、その続き(Range)だけ */
    suspend fun fetchPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult = withContext(Dispatchers.Default) { readPosts(thread, cursor) }

    private suspend fun readPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult {
        if (HonoBbs.isBoardUrl(thread.boardUrl)) return HonoBbs.fetchPosts(thread, cursor)
        if (Shitaraba.isBoardUrl(thread.boardUrl)) return Shitaraba.fetchPosts(thread, cursor)
        if (Machi.isBoardUrl(thread.boardUrl)) return Machi.fetchPosts(thread, cursor)
        val url = "${thread.boardUrl}dat/${thread.key}.dat"
        if (cursor?.kako == true) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor, archived = true)

        suspend fun archived(): FetchResult {
            val kako = kakoDatUrl(thread)
            if (kako != null) {
                val res = Http.get(kako)
                if (res.status == 200 && res.body.isNotEmpty()) {
                    val body = completeLines(res.body)
                    val text = textOf(res, body)
                    val (posts, title) = if (looksLikeDat(text)) parseDat(text, 1) else emptyList<Post>() to null
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
            val text = textOf(res, body)
            // 200 で返るエラーのページで置き換えると、手元のログが全部消える。板の文字コードとしても覚えない
            if (text.isNotBlank() && !looksLikeDat(text)) {
                if (cursor != null) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor)
                throw IllegalStateException("スレを読めませんでした: $url")
            }
            rememberBoardEncoding(thread.boardUrl, body)
            val (posts, title) = parseDat(text, 1)
            // 空か改行なしの本文で置き換えると、手元のログが全部消える
            if (cursor != null && posts.isEmpty()) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor)
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
        val (posts, _) = parseDat(textOf(res, added), cursor.postCount + 1)
        return FetchResult(
            FetchStatus.UPDATED, posts,
            DatCursor(cursor.bytes + added.size, cursor.postCount + posts.size, res.headers["last-modified"] ?: cursor.lastModified),
        )
    }

    /** 書き込む。5ch はスレの URL を Referer に求める */
    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        if (HonoBbs.isBoardUrl(t.boardUrl)) return HonoBbs.createPost(t, input)
        if (Shitaraba.isBoardUrl(t.boardUrl)) return Shitaraba.createPost(t, input)
        if (Machi.isBoardUrl(t.boardUrl)) return Machi.createPost(t, input)
        val path = boardPathOf(t.boardUrl)
        val fields = linkedMapOf(
            "bbs" to path.bbs,
            "key" to t.key,
            "time" to (System.currentTimeMillis() / 1000).toString(),
            "FROM" to input.name,
            "mail" to input.mail,
            "MESSAGE" to input.body,
            "submit" to "書き込む",
        )
        return sendBbsCgi(path.postUrl, fields, webUrl(t))
    }

    /** スレを立てる */
    suspend fun createThread(board: Board, title: String, input: PostInput): PostResult {
        if (HonoBbs.isBoardUrl(board.url)) return HonoBbs.createThread(board, title, input)
        if (Shitaraba.isBoardUrl(board.url)) return Shitaraba.createThread(board, title, input)
        // まちBBS は依頼制(アプリからは立てられない)
        if (Machi.isBoardUrl(board.url)) return PostResult.Error("まちBBS のスレは、アプリからは立てられません(まちBBS のスレ立て依頼から)")
        val path = boardPathOf(board.url)
        val fields = linkedMapOf(
            "bbs" to path.bbs,
            "subject" to title,
            "time" to (System.currentTimeMillis() / 1000).toString(),
            "FROM" to input.name,
            "mail" to input.mail,
            "MESSAGE" to input.body,
            "submit" to "新規スレッド作成",
        )
        return sendBbsCgi(path.postUrl, fields, board.url)
    }

    /** 書き込み確認で承諾したときに送り直す */
    suspend fun submitConfirm(c: PostResult.Confirm): PostResult = sendBbsCgi(c.url, c.fields, c.referer)

    private suspend fun sendBbsCgi(url0: String, fields: Map<String, String>, referer0: String): PostResult {
        // 前に 5ch.net で開いたスレ・板でも書けるように、送る先と Referer を 5ch.io に直す
        val url = UrlRoute.to5chIo(url0)
        val referer = UrlRoute.to5chIo(referer0)
        val form = if (isUtf8Board(url, fields["bbs"])) encodeUtf8Form(fields) else encodeShiftJisForm(fields)
        val res = Http.postForm(url, form, mapOf("Referer" to referer))
        val html = textOf(res)
        val resNumber = res.headers["x-resnum"]?.toIntOrNull()?.takeIf { it > 0 }
        val r = parseBbsCgi(html, url, fields, referer, resNumber)
        if (r is PostResult.Error && res.status >= 400 && r.message == POST_FAILED) return PostResult.Error("HTTP ${res.status}")
        return r
    }

    /** ブラウザで開く URL */
    fun webUrl(t: ThreadSummary): String {
        if (HonoBbs.isBoardUrl(t.boardUrl)) return HonoBbs.webUrl(t)
        if (Shitaraba.isBoardUrl(t.boardUrl)) return Shitaraba.webUrl(t)
        if (Machi.isBoardUrl(t.boardUrl)) return Machi.webUrl(t)
        return boardPathOf(t.boardUrl).threadUrl(t.key)
    }

    /** レスの番号付きの URL。番号で開けない形ならスレの URL のまま(PC 版の utils/share.ts と同じ) */
    fun postWebUrl(threadUrl: String, no: Int): String {
        val path = threadUrl.substringBefore('?').substringBefore('#')
        if ("/read.cgi/" !in path && !Regex("/boards/[^/]+/[^/]+/?$").containsMatchIn(path)) return threadUrl
        return "${path.trimEnd('/')}/$no"
    }
}
