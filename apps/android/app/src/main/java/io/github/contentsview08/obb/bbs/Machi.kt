package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.Http
import io.github.contentsview08.obb.data.HttpResponse
import java.nio.charset.Charset

// まちBBS(machi.to)。専ブラの packages/connectors/src/machi(connector.ts・parse.ts)を Kotlin に写したもの。2026-11-04 に実際の板で確かめた作り:
// - 板の URL は https://machi.to/板/(kanto・tokyo など。地域ごとに 15 ほど)、スレは /bbs/read.cgi/板/キー/
// - スレ一覧は 板/subject.txt(Shift_JIS)。「キー.cgi,スレタイ(レス数)」(2ch と違い dat はない)
// - スレの中身は /bbs/offlaw.cgi/板/キー/(Shift_JIS)。「番号<>名前<>メール<>日付 ID:xxx<>本文<>ホスト」、1 番目のレスだけ本文の後ろにスレタイが入る。
//   差分は末尾に「何番から-」を付けて取り、新着がなければ空で返る。ないスレは HTTP 200 のまま「<ERROR>スレッドを発見できません</ERROR>」
// - 板の設定(SETTING.TXT)は板名も名無しの名前も入っていない。板の名前はトップページの一覧から取る
// - 書き込みはスレのページのフォームと同じく /bbs/write.cgi?guid=ON へ Shift_JIS で送る(NAME・MAIL・MESSAGE・BBS・KEY・TIME・READ=TRUE・CC=あ・submit=書き込む)。
//   書けると「書きこみました」ではなく、スレのページがそのまま返る。parseWrite で読む
// - スレ立てはアプリからはできない(まちBBS は依頼制で、板のページにもスレ立てのフォームがない)
// 板の一覧はトップページ(https://machi.to/)から読める。板は URL で足してもよい。1 つのスレは 1000 レスまで

private val SJIS: Charset = runCatching { Charset.forName("windows-31j") }.getOrElse { Charset.forName("Shift_JIS") }
private const val ORIGIN = "https://machi.to"
/** 昔は kanto.machi.to のように板ごとのホストだった(いまは machi.to に集まり、古いホストもそのまま返る) */
private val HOST = Regex("^https?://(?:[a-z0-9]+\\.)?machi\\.to/")
private val SITE_URL = Regex("^https?://(?:www\\.)?machi\\.to/?(?:index\\.html)?(?:[?#].*)?$")
private val THREAD_URL = Regex("^https?://(?:[a-z0-9]+\\.)?machi\\.to/bbs/(?:read|offlaw|json)\\.cgi/([a-z0-9]+)/([0-9]+)")
private val BOARD_URL = Regex("^https?://(?:[a-z0-9]+\\.)?machi\\.to/([a-z0-9]+)/?(?:subject\\.txt|index\\.html)?(?:[?#].*)?$")
private val SUBJECT_LINE = Regex("^([0-9]+)\\.cgi,(.*)\\(([0-9]+)\\)\\s*$")
private val ERROR_TAG = Regex("<ERROR>([\\s\\S]*?)</ERROR>", RegexOption.IGNORE_CASE)
private val DATE_ID = Regex("^(.*?)\\s*ID:(\\S+)\\s*$")
private val TOP_LINK = Regex("<a\\s+href=\"/([a-z0-9]+)/\"[^>]*>([^<]+)", RegexOption.IGNORE_CASE)
/** 板ではないパス */
private val NOT_BOARD = setOf("bbs", "lib", "cdn-cgi")

/** トップページが読めなかったときの板の名前(2026-11-04 のトップページの並び) */
private val KNOWN_BOARDS = linkedMapOf(
    "hokkaidou" to "北海道地区", "touhoku" to "東北地区", "kanto" to "関東地区", "tokyo" to "東京", "tama" to "多摩", "kana" to "神奈川",
    "kousinetu" to "北陸・甲信越地区", "toukai" to "東海地区", "kinki" to "近畿地区", "osaka" to "大阪", "cyugoku" to "中国地区",
    "sikoku" to "四国地区", "kyusyu" to "九州地区", "okinawa" to "沖縄地区", "tawara" to "まちBBS会議室",
)

object Machi {
    fun canHandle(url: String) = HOST.containsMatchIn(url)
    fun isSiteUrl(url: String) = SITE_URL.matches(url.trim())
    fun isBoardUrl(url: String) = BOARD_URL.find(url)?.let { it.groupValues[1] !in NOT_BOARD } == true
    fun isThreadUrl(url: String) = THREAD_URL.containsMatchIn(url)

    private fun boardUrlOf(bbs: String) = "$ORIGIN/$bbs/"

    /** 板の URL から 板の名前(kanto など) */
    private fun bbsOf(boardUrl: String): String {
        val m = BOARD_URL.find(boardUrl) ?: throw IllegalArgumentException("まちBBS の板の URL ではありません: $boardUrl")
        return m.groupValues[1].also { if (it in NOT_BOARD) throw IllegalArgumentException("まちBBS の板の URL ではありません: $boardUrl") }
    }

    /** 板の URL をそろえる(https・machi.to・最後の / あり)。まちBBS の板でなければ null */
    fun normalizeBoardUrl(url: String): String? = BOARD_URL.find(url.trim())?.groupValues?.get(1)?.takeIf { it !in NOT_BOARD }?.let { boardUrlOf(it) }

    /** スレの URL → スレ(スレタイは開いてから分かる)。まちBBS のスレでなければ null */
    fun parseThreadUrl(url: String): ThreadSummary? {
        val m = THREAD_URL.find(url.trim()) ?: return null
        val key = m.groupValues[2]
        return ThreadSummary(boardUrlOf(m.groupValues[1]), key, "", 0, 0, createdAtOf(key))
    }

    /** スレのキーは立った時刻の UNIX 秒(10 桁のときだけ) */
    private fun createdAtOf(key: String): Long? = if (key.length == 10 && key.all { it.isDigit() }) key.toLong() * 1000 else null

    private fun decode(res: HttpResponse) = String(res.body, SJIS)

    // ── 板 ──

    /** 板の名前。知っている一覧にあればそれ、なければ板のページの <title>(「まちBBS関東掲示板」)、それもなければ URL の名前 */
    private suspend fun boardNameOf(bbs: String): String {
        KNOWN_BOARDS[bbs]?.let { return it }
        runCatching {
            val res = Http.get(boardUrlOf(bbs))
            if (res.status == 200) {
                val title = Regex("<title>([^<]*)</title>", RegexOption.IGNORE_CASE).find(decode(res))?.groupValues?.get(1)?.trim()
                if (!title.isNullOrEmpty()) return title.removePrefix("まちBBS").removeSuffix("掲示板").trim().ifEmpty { title }
            }
        }
        return bbs
    }

    /** 板の名前(URL で開いたときに使う)。板がなければ例外(404。subject.txt が取れるかで確かめる) */
    suspend fun boardName(boardUrl: String): String {
        val bbs = bbsOf(boardUrl)
        val res = Http.get("${boardUrlOf(bbs)}subject.txt")
        if (res.status == 404) throw IllegalStateException("まちBBS の板が見つかりません(HTTP 404)")
        if (res.status != 200) throw IllegalStateException("まちBBS の板を開けません(HTTP ${res.status})")
        val first = decode(res).split('\n').firstOrNull { it.isNotBlank() }
        if (first != null && !Regex("^[0-9]+\\.cgi,").containsMatchIn(first)) throw IllegalStateException("まちBBS の板ではないようです(スレ一覧が読めません)")
        return boardNameOf(bbs)
    }

    /** 板の設定にあたるもの(SETTING.TXT には板名も名無しの名前も入っていないので、板名だけ) */
    suspend fun setting(boardUrl: String): Map<String, String> = runCatching { mapOf("BBS_TITLE" to boardNameOf(bbsOf(boardUrl))) }.getOrDefault(emptyMap())

    /** 板の一覧はトップページ(https://machi.to/)から。読めなければ知っている板 */
    suspend fun listBoards(): List<Board> {
        val parsed = runCatching {
            val res = Http.get("$ORIGIN/")
            if (res.status != 200) emptyList()
            else {
                val seen = HashSet<String>()
                TOP_LINK.findAll(decode(res)).mapNotNull { m ->
                    val bbs = m.groupValues[1]
                    val name = htmlToText(m.groupValues[2]).trim()
                    if (name.isEmpty() || bbs in NOT_BOARD || !seen.add(bbs)) null else bbs to name
                }.toList()
            }
        }.getOrDefault(emptyList())
        val list = parsed.ifEmpty { KNOWN_BOARDS.entries.map { it.key to it.value } }
        return list.map { (bbs, name) -> Board(boardUrlOf(bbs), name, "まちBBS") }
    }

    // ── スレ一覧 ──

    /** subject.txt の 1 行は「キー.cgi,スレタイ(レス数)」 */
    suspend fun listThreads(board: Board): List<ThreadSummary> {
        val url = "${board.url}subject.txt"
        val res = Http.get(url)
        if (res.status == 404) throw IllegalStateException("まちBBS の板が見つかりません(HTTP 404)")
        if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
        val text = decode(res)
        val first = text.split('\n').firstOrNull { it.isNotBlank() }
        if (first != null && !Regex("^[0-9]+\\.cgi,").containsMatchIn(first)) throw IllegalStateException("スレ一覧を読めませんでした: ${board.url}")
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
     * offlaw.cgi の 1 行は「番号<>名前<>メール<>日付 ID:xxx<>本文<>ホスト」。1 番目のレスだけ、本文とホストの間にスレタイが入る。
     * cursor は 2ch 互換の DatCursor を借りる: postCount = 取り終えた最後のレス番号
     */
    suspend fun fetchPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult {
        val from = (cursor?.postCount ?: 0) + 1
        val url = "$ORIGIN/bbs/offlaw.cgi/${bbsOf(thread.boardUrl)}/${thread.key}/" + (if (from > 1) "$from-" else "")
        val res = Http.get(url)
        if (res.status == 404) return FetchResult(FetchStatus.ARCHIVED, emptyList(), cursor)
        if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
        val text = decode(res)
        if (ERROR_TAG.containsMatchIn(text)) return FetchResult(FetchStatus.ARCHIVED, emptyList(), cursor)
        val posts = ArrayList<Post>()
        var title: String? = null
        for (line in text.split('\n')) {
            if (line.isBlank()) continue
            val f = line.split("<>")
            val no = f[0].toIntOrNull()?.takeIf { it > 0 } ?: continue
            if (f.size < 5) continue
            if (f.size >= 7 && title == null) title = htmlToText(f[5]).trim()
            val dateId = f[3]
            val m = DATE_ID.find(dateId)
            posts += Post(
                no = no,
                name = htmlToText(f[1]).trim(),
                mail = htmlToText(f[2]).trim(),
                date = (m?.groupValues?.get(1) ?: dateId).trim(),
                id = m?.groupValues?.get(2)?.ifEmpty { null },
                body = htmlToText(f[4]),
            )
        }
        val lastNo = posts.lastOrNull()?.no ?: cursor?.postCount ?: 0
        val next = DatCursor(0, lastNo, null)
        if (posts.isEmpty()) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), next)
        return FetchResult(FetchStatus.UPDATED, posts, next, title)
    }

    // ── 書き込み ──

    /** スレのページのフォームと同じ項目を Shift_JIS で write.cgi?guid=ON に送る */
    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        val referer = webUrl(t)
        val fields = linkedMapOf(
            "submit" to "書き込む", "NAME" to input.name, "MAIL" to input.mail, "MESSAGE" to input.body,
            "BBS" to bbsOf(t.boardUrl), "KEY" to t.key, "TIME" to (System.currentTimeMillis() / 1000).toString(),
            "READ" to "TRUE", "CC" to "あ",
        )
        val url = "$ORIGIN/bbs/write.cgi?guid=ON"
        val res = Http.postForm(url, encodeShiftJisForm(fields), mapOf("Referer" to referer))
        if (res.status >= 400) return PostResult.Error("HTTP ${res.status}")
        return parseWrite(decode(res))
    }

    /**
     * write.cgi の応答。題や本文に ERROR・エラー があれば失敗。「書きこみました」か、スレのページ(name="posting" の書き込みフォーム・read.cgi のリンク)なら成功。
     * それ以外は失敗(本文の頭を理由に)
     */
    private fun parseWrite(html: String): PostResult {
        val title = htmlToText(Regex("<title>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1) ?: "").trim()
        val bodyHtml = Regex("<body[^>]*>([\\s\\S]*?)</body>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1) ?: html
        val text = htmlToText(bodyHtml.replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "").replace(Regex("\\r?\\n"), "")).replace(Regex("\\s+"), " ").trim()
        val written = Regex("書き?こみました")
        if (written.containsMatchIn(title) || written.containsMatchIn(text)) return PostResult.Ok("書きこみました", null)
        if (Regex("ERROR|ＥＲＲＯＲ|エラー", RegexOption.IGNORE_CASE).containsMatchIn(title)) return PostResult.Error(text.take(300).ifEmpty { title })
        if (Regex("<form[^>]*name=[\"']?posting[\"']?", RegexOption.IGNORE_CASE).containsMatchIn(html) || html.contains("/bbs/read.cgi/")) return PostResult.Ok("書きこみました", null)
        val err = Regex("(?:ERROR|ＥＲＲＯＲ)[:：!！]?\\s*([^。]{0,200})", RegexOption.IGNORE_CASE).find(text)
        return PostResult.Error(err?.value?.trim() ?: title.ifEmpty { text.take(300).ifEmpty { "書き込めませんでした" } })
    }

    /** ブラウザで開く URL */
    fun webUrl(t: ThreadSummary): String = "$ORIGIN/bbs/read.cgi/${bbsOf(t.boardUrl)}/${t.key}/"
}
