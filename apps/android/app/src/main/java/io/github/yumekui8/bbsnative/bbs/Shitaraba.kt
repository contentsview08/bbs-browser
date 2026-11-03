package io.github.yumekui8.bbsnative.bbs

import io.github.yumekui8.bbsnative.data.Http
import io.github.yumekui8.bbsnative.data.HttpResponse
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

// したらば(jbbs.shitaraba.net)。専ブラの packages/connectors/src/shitaraba(connector.ts・parse.ts)を Kotlin に写したもの。
// - 板の URL は https://jbbs.shitaraba.net/カテゴリ/番号/、スレは /bbs/read.cgi/カテゴリ/番号/キー/
// - スレ一覧は 板/subject.txt(EUC-JP)。「キー.cgi,スレタイ(レス数)」、最後の行は最初の行の繰り返し
// - スレの中身は /bbs/rawmode.cgi/カテゴリ/番号/キー/(EUC-JP)。「番号<>名前<>メール<>日付<>本文<>スレタイ<>ID」。
//   差分は末尾に「何番から-」を付けて取り、新着がなければ空で返る
// - 過去ログ倉庫に入ったスレは、ヘッダー ERROR に「STORAGE IN」が付いて中身が返る。ないスレは 404 と「THREAD NOT FOUND」
// - 板の設定(板名・名無しの名前)は /bbs/api/setting.cgi/カテゴリ/番号/
// - 書き込みは /bbs/write.cgi/カテゴリ/番号/キー/(スレ立ては キー の代わりに new)へ EUC-JP のフォームで送る。
//   本番の板への試し書き込みはしないので、応答の読み方(書きこみました / ERROR)は確かめていない
// 板の一覧(bbsmenu)はないので、板は URL で足してもらう。1 つのスレは 1000 レスまで

private val EUC: Charset = Charset.forName("EUC-JP")
private const val ORIGIN = "https://jbbs.shitaraba.net"
private val HOST = Regex("^https?://jbbs\\.(?:shitaraba\\.net|livedoor\\.jp)/")
private val THREAD_URL = Regex("^https?://jbbs\\.(?:shitaraba\\.net|livedoor\\.jp)/bbs/(?:read|rawmode)\\.cgi/([a-z]+)/(\\d+)/(\\d+)")
private val BOARD_URL = Regex("^https?://jbbs\\.(?:shitaraba\\.net|livedoor\\.jp)/([a-z]+)/(\\d+)/?(?:subject\\.txt)?(?:[?#].*)?$")
private val SUBJECT_LINE = Regex("^(\\d+)\\.cgi,(.*)\\((\\d+)\\)\\s*$")

object Shitaraba {
    fun canHandle(url: String) = HOST.containsMatchIn(url)
    fun isBoardUrl(url: String) = BOARD_URL.matches(url)
    fun isThreadUrl(url: String) = THREAD_URL.containsMatchIn(url)

    private fun boardUrlOf(dir: String, bbs: String) = "$ORIGIN/$dir/$bbs/"

    /** 板の URL から カテゴリ と 番号 */
    private fun dirOf(boardUrl: String): Pair<String, String> {
        val m = BOARD_URL.find(boardUrl) ?: throw IllegalArgumentException("したらばの板の URL ではありません: $boardUrl")
        return m.groupValues[1] to m.groupValues[2]
    }

    /** 板の URL をそろえる(https・最後の / あり)。したらばの板でなければ null */
    fun normalizeBoardUrl(url: String): String? = BOARD_URL.find(url.trim())?.let { boardUrlOf(it.groupValues[1], it.groupValues[2]) }

    /** スレの URL → スレ(スレタイは開いてから分かる)。したらばのスレでなければ null */
    fun parseThreadUrl(url: String): ThreadSummary? {
        val m = THREAD_URL.find(url.trim()) ?: return null
        val key = m.groupValues[3]
        return ThreadSummary(boardUrlOf(m.groupValues[1], m.groupValues[2]), key, "", 0, 0, createdAtOf(key))
    }

    /** スレのキーは立った時刻の UNIX 秒(10 桁のときだけ) */
    private fun createdAtOf(key: String): Long? = if (key.length == 10 && key.all { it.isDigit() }) key.toLong() * 1000 else null

    private fun decode(res: HttpResponse) = String(res.body, EUC)
    /** 応答のヘッダーの ERROR(過去ログ倉庫・スレなし など) */
    private fun errorOf(res: HttpResponse) = res.headers["error"] ?: ""

    // ── 板の設定 ──

    /** setting.cgi は「キー=値」の行。板名は BBS_TITLE、既定の名前は BBS_NONAME_NAME(2ch の SETTING.TXT と同じ鍵なので、そのまま使える) */
    suspend fun setting(boardUrl: String): Map<String, String> = runCatching {
        val (dir, bbs) = dirOf(boardUrl)
        val res = Http.get("$ORIGIN/bbs/api/setting.cgi/$dir/$bbs/")
        if (res.status != 200) emptyMap() else parseSetting(decode(res))
    }.getOrDefault(emptyMap())

    private fun parseSetting(text: String): Map<String, String> =
        text.lineSequence().mapNotNull { l -> l.indexOf('=').takeIf { it > 0 }?.let { l.substring(0, it).trim() to l.substring(it + 1).trim() } }.toMap()

    /** 板の名前(URL で開いたときに使う)。板がなければ例外(404) */
    suspend fun boardName(boardUrl: String): String {
        val (dir, bbs) = dirOf(boardUrl)
        val res = Http.get("$ORIGIN/bbs/api/setting.cgi/$dir/$bbs/")
        if (res.status == 404) throw IllegalStateException("したらばの板が見つかりません(HTTP 404)")
        if (res.status != 200) throw IllegalStateException("したらばの板を開けません(HTTP ${res.status})")
        val s = parseSetting(decode(res))
        if (s["BBS"].isNullOrEmpty() && s["TOP"].isNullOrEmpty()) throw IllegalStateException("したらばの板ではないようです(板の設定が読めません)")
        return s["BBS_TITLE"]?.ifEmpty { null } ?: "$dir/$bbs"
    }

    // ── スレ一覧 ──

    /** subject.txt の 1 行は「キー.cgi,スレタイ(レス数)」。最後の行は最初の行の繰り返しなので、同じキーは 1 つにする */
    suspend fun listThreads(board: Board): List<ThreadSummary> {
        val url = "${board.url}subject.txt"
        val res = Http.get(url)
        if (res.status == 404) throw IllegalStateException("したらばの板が見つかりません(HTTP 404)")
        if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
        val text = decode(res)
        val first = text.split('\n').firstOrNull { it.isNotBlank() }
        if (first != null && !Regex("^\\d+\\.cgi,").containsMatchIn(first)) throw IllegalStateException("スレ一覧を読めませんでした: ${board.url}")
        val out = ArrayList<ThreadSummary>()
        val seen = HashSet<String>()
        for (line in text.split('\n')) {
            val m = SUBJECT_LINE.find(line) ?: continue
            val key = m.groupValues[1]
            if (!seen.add(key)) continue
            out += ThreadSummary(board.url, key, htmlToText(m.groupValues[2]).trim(), m.groupValues[3].toInt(), out.size, createdAtOf(key))
        }
        return out
    }

    // ── レス ──

    /**
     * rawmode.cgi の 1 行は「番号<>名前<>メール<>日付<>本文<>スレタイ<>ID」。スレタイは 1 番目のレスにだけ。
     * cursor は 2ch 互換の DatCursor を借りる: postCount = 取り終えた最後のレス番号、kako = 過去ログ倉庫(もう変わらないので取りに行かない)
     */
    suspend fun fetchPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult {
        if (cursor?.kako == true) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor, archived = true)
        val (dir, bbs) = dirOf(thread.boardUrl)
        val from = (cursor?.postCount ?: 0) + 1
        val url = "$ORIGIN/bbs/rawmode.cgi/$dir/$bbs/${thread.key}/" + (if (from > 1) "$from-" else "")
        val res = Http.get(url)
        val error = errorOf(res)
        if (res.status == 404 || error.contains("THREAD NOT FOUND", ignoreCase = true)) return FetchResult(FetchStatus.ARCHIVED, emptyList(), cursor)
        if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
        val posts = ArrayList<Post>()
        var title: String? = null
        for (line in decode(res).split('\n')) {
            if (line.isBlank()) continue
            val f = line.split("<>")
            val no = f[0].toIntOrNull()?.takeIf { it > 0 } ?: continue
            val t = f.getOrNull(5) ?: ""
            if (t.isNotEmpty() && title == null) title = htmlToText(t).trim()
            posts += Post(
                no = no,
                name = htmlToText(f.getOrNull(1) ?: "").trim(),
                mail = htmlToText(f.getOrNull(2) ?: "").trim(),
                date = htmlToText(f.getOrNull(3) ?: "").trim(),
                id = f.getOrNull(6)?.trim()?.ifEmpty { null },
                body = htmlToText((f.getOrNull(4) ?: "").removePrefix(" ").removeSuffix(" ")),
            )
        }
        // 過去ログ倉庫に入ったスレ。中身は返るので保存し、dat 落ちとして扱う
        val kako = error.contains("STORAGE IN", ignoreCase = true)
        val lastNo = posts.lastOrNull()?.no ?: cursor?.postCount ?: 0
        val next = DatCursor(0, lastNo, null, kako = kako)
        if (posts.isEmpty()) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), next, archived = kako)
        return FetchResult(FetchStatus.UPDATED, posts, next, title, archived = kako)
    }

    // ── 書き込み ──

    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        val (dir, bbs) = dirOf(t.boardUrl)
        val fields = linkedMapOf(
            "DIR" to dir, "BBS" to bbs, "KEY" to t.key, "TIME" to (System.currentTimeMillis() / 1000).toString(),
            "NAME" to input.name, "MAIL" to input.mail, "MESSAGE" to input.body, "submit" to "書き込む",
        )
        return sendWrite("$ORIGIN/bbs/write.cgi/$dir/$bbs/${t.key}/", fields, webUrl(t))
    }

    suspend fun createThread(board: Board, title: String, input: PostInput): PostResult {
        val (dir, bbs) = dirOf(board.url)
        val fields = linkedMapOf(
            "DIR" to dir, "BBS" to bbs, "TIME" to (System.currentTimeMillis() / 1000).toString(), "SUBJECT" to title,
            "NAME" to input.name, "MAIL" to input.mail, "MESSAGE" to input.body, "submit" to "新規スレッド作成",
        )
        return sendWrite("$ORIGIN/bbs/write.cgi/$dir/$bbs/new/", fields, board.url)
    }

    /** write.cgi の応答。書けたら Ok、ERROR やエラーの文言があれば Error(理由を添える) */
    private suspend fun sendWrite(url: String, fields: Map<String, String>, referer: String): PostResult {
        val res = Http.postForm(url, encodeEucJpForm(fields), mapOf("Referer" to referer))
        val html = decode(res)
        val title = Regex("<title>([^<]*)</title>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)?.trim() ?: ""
        val text = htmlToText(html.replace(Regex("<head>[\\s\\S]*?</head>", RegexOption.IGNORE_CASE), "")).replace(Regex("\\s+"), " ").trim()
        val written = Regex("書き?こみました")
        if (written.containsMatchIn(title) || written.containsMatchIn(text)) return PostResult.Ok("書きこみました", null)
        val err = Regex("ERROR[:：]?\\s*([^\\n]{0,200})", RegexOption.IGNORE_CASE).find(text)
        val message = err?.value?.trim() ?: title.ifEmpty { text.take(200).ifEmpty { "書き込めませんでした" } }
        return PostResult.Error(if (res.status >= 400 && message.isBlank()) "HTTP ${res.status}" else message)
    }

    /** EUC-JP で送ったときのバイト数(書き込む前に長すぎないか確かめる目安) */
    fun byteLength(text: String): Int = encodeEucJp(text.replace("\n", "\r\n")).size

    /** ブラウザで開く URL */
    fun webUrl(t: ThreadSummary): String {
        val (dir, bbs) = dirOf(t.boardUrl)
        return "$ORIGIN/bbs/read.cgi/$dir/$bbs/${t.key}/"
    }
}

/** EUC-JP にない字は「&#番号;」にして送る(PC 版の eucjp.ts と同じ) */
private fun encodeEucJp(text: String): ByteArray {
    val enc = EUC.newEncoder().onUnmappableCharacter(CodingErrorAction.REPORT).onMalformedInput(CodingErrorAction.REPORT)
    val out = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        val ch = String(Character.toChars(cp))
        val bytes: ByteArray? = runCatching {
            val bb: ByteBuffer = enc.encode(CharBuffer.wrap(ch))
            ByteArray(bb.remaining()).also { bb.get(it) }
        }.getOrNull()
        out.write(bytes ?: "&#$cp;".toByteArray(Charsets.US_ASCII))
        i += Character.charCount(cp)
    }
    return out.toByteArray()
}

/** application/x-www-form-urlencoded(EUC-JP)。改行は CRLF に */
private fun encodeEucJpForm(fields: Map<String, String>): ByteArray =
    fields.entries.joinToString("&") { (k, v) ->
        val bytes = encodeEucJp(v.replace("\r\n", "\n").replace("\n", "\r\n"))
        "$k=" + URLEncoder.encode(String(bytes, Charsets.ISO_8859_1), "ISO-8859-1")
    }.toByteArray(Charsets.US_ASCII)
