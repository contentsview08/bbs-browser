package io.github.yumekui8.bbsnative.bbs

import io.github.yumekui8.bbsnative.data.Http
import io.github.yumekui8.bbsnative.data.HttpResponse
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.Base64

// hono-bbs(自作の掲示板)の読み書き。専ブラの packages/connectors/src/honobbs/connector.ts を Kotlin に写したもの。
// 2ch 互換の窓口(subject.txt・dat)ではなく、掲示板の JSON の API を読む。スレ一覧の時点で 1 レス目(本文・ID・画像)が付いてくる
// - 板の URL は web の URL(https://<web>/boards/<板ID>/)。スレは https://<web>/boards/<板ID>/<スレID(UUID)>
// - API の場所は web のページの <meta name="bbs-api" content="…/api/v1"> から見つける(なければ https://api.<web のホスト>/api/v1)
// - 書き込みで Turnstile が要るときは、エッヂと同じ流れ: POST /auth/turnstile/pair でコードをもらい(Cookie turnstile_pair が付く)、
//   認証ページの URL とコードを出す。人がブラウザで認証してから送り直すと、その Cookie でセッションが使われる
// 本番の板への試し書き込みはしない

private val THREAD_URL = Regex("^(https?://[^/]+)/boards/([A-Za-z0-9_-]+)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?(?:[?#].*)?$")
private val BOARD_URL = Regex("^(https?://[^/]+)/boards/([A-Za-z0-9_-]+)/?(?:[?#].*)?$")
private val SITE_URL = Regex("^(https?://[^/]+)/boards/?(?:[?#].*)?$")
private val FIRST_IMAGE = Regex("https?://\\S+?\\.(?:jpe?g|png|gif|webp)(?:\\?\\S*)?(?=\\s|$)", RegexOption.IGNORE_CASE)

object HonoBbs {
    const val CONNECTOR = "honobbs"

    fun isThreadUrl(url: String) = THREAD_URL.matches(url)
    fun isBoardUrl(url: String) = BOARD_URL.matches(url)
    /** サイトの入口(web の板の一覧 https://<web>/boards) */
    fun isSiteUrl(url: String) = SITE_URL.matches(url.trim())

    /**
     * 入れられた URL が hono-bbs なら、サイトの入口(https://<web>/boards)を返す。違えば null。
     * web のトップ・板・スレの URL、API の URL(https://api.<web>/api/v1…)、ページに <meta name="bbs-api"> があるサイトを受け付ける
     */
    suspend fun detectSite(input: String): String? {
        val url = input.trim().let { if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it)) it else "https://$it" }
        val origin = Regex("^(https?://[^/?#]+)").find(url)?.groupValues?.get(1) ?: return null
        if (SITE_URL.matches(url) || BOARD_URL.matches(url) || THREAD_URL.matches(url)) return "$origin/boards"
        // API の URL: web は api. を外したホストと決めてかかり、API の場所を覚えておく
        val api = Regex("^(https?://[^/?#]+(?:/[^?#]*?)?/api/v\\d+)").find(url)?.groupValues?.get(1)
        if (api != null) {
            val ok = runCatching { val r = Http.get("$api/boards?limit=1"); r.status == 200 && json(r).has("data") }.getOrDefault(false)
            if (!ok) return null
            val web = origin.replaceFirst(Regex("^(https?://)api\\."), "$1")
            synchronized(apiBases) { apiBases[web] = api }
            return "$web/boards"
        }
        // web のトップ: ページに API の場所の印があれば hono-bbs
        val res = runCatching { Http.get("$origin/") }.getOrNull() ?: return null
        if (res.status != 200) return null
        val meta = Regex("<meta\\s+name=[\"']bbs-api[\"']", RegexOption.IGNORE_CASE).containsMatchIn(String(res.body, Charsets.UTF_8))
        return if (meta) "$origin/boards" else null
    }

    /** スレの URL → (板, スレ)。板の名前は仮(開いてから API で分かる) */
    fun parseThreadUrl(url: String): ThreadSummary? {
        val m = THREAD_URL.find(url) ?: return null
        return ThreadSummary(boardUrlOf(m.groupValues[1], m.groupValues[2]), m.groupValues[3], "", 0, 0, null)
    }

    /** 板の URL をそろえる(最後の / あり) */
    fun normalizeBoardUrl(url: String): String? = BOARD_URL.find(url)?.let { boardUrlOf(it.groupValues[1], it.groupValues[2]) }

    private fun boardUrlOf(origin: String, boardId: String) = "$origin/boards/$boardId/"

    private fun parts(boardUrl: String): Pair<String, String> {
        val m = BOARD_URL.find(boardUrl) ?: throw IllegalArgumentException("hono-bbs の板の URL ではありません: $boardUrl")
        return m.groupValues[1] to m.groupValues[2]
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** web のオリジン → API の場所。一度調べたら覚えておく */
    private val apiBases = HashMap<String, String>()

    private suspend fun apiBaseOf(origin: String): String {
        synchronized(apiBases) { apiBases[origin]?.let { return it } }
        val found = runCatching {
            val res = Http.get("$origin/")
            if (res.status != 200) null
            else Regex("<meta\\s+name=[\"']bbs-api[\"']\\s+content=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
                .find(String(res.body, Charsets.UTF_8))?.groupValues?.get(1)?.takeIf { it.startsWith("http") }?.trimEnd('/')
        }.getOrNull()
        val base = found ?: "${origin.replaceFirst(Regex("^(https?://)"), "$1api.")}/api/v1"
        synchronized(apiBases) { apiBases[origin] = base }
        return base
    }

    private fun json(res: HttpResponse) = JSONObject(String(res.body, Charsets.UTF_8))

    private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) getString(k) else null

    /** 「2026/09/20(日) 04:02:29.239」(日本時間)。2ch と同じ形にそろえる(日付の読み取りがそのまま効くように) */
    fun formatDate(iso: String): String = runCatching {
        val t = java.time.Instant.parse(iso).atZone(java.time.ZoneId.of("Asia/Tokyo"))
        val wd = "月火水木金土日"[t.dayOfWeek.value - 1]
        "%04d/%02d/%02d(%s) %02d:%02d:%02d.%03d".format(t.year, t.monthValue, t.dayOfMonth, wd, t.hour, t.minute, t.second, t.nano / 1_000_000)
    }.getOrDefault(iso)

    private fun toPost(p: JSONObject): Post {
        val deleted = p.optBoolean("isDeleted")
        return Post(
            no = p.getInt("postNumber"),
            name = if (deleted) "あぼーん" else p.str("posterName") ?: "",
            // 名前の後ろの情報(sage など)を、2ch のメール欄の位置に出す
            mail = if (deleted) "" else p.str("posterOptionInfo") ?: "",
            date = formatDate(p.getString("createdAt")),
            id = if (deleted) null else p.str("authorId"),
            body = if (deleted) "あぼーん" else p.str("content") ?: "",
        )
    }

    // ── 板 ──

    private class BoardInfo(val name: String, val noname: String?, val maxLength: Int?, val maxLines: Int?)
    private val infoCache = HashMap<String, BoardInfo>()

    private suspend fun boardInfo(boardUrl: String): BoardInfo? {
        synchronized(infoCache) { infoCache[boardUrl]?.let { return it } }
        val (origin, id) = parts(boardUrl)
        val res = Http.get("${apiBaseOf(origin)}/boards/${enc(id)}")
        if (res.status == 404) throw IllegalStateException("hono-bbs の板が見つかりません(HTTP 404)")
        if (res.status != 200) return null
        val d = json(res).getJSONObject("data")
        val info = BoardInfo(
            d.optString("name"), d.str("defaultPosterName")?.ifEmpty { null },
            d.optInt("defaultMaxPostLength").takeIf { it > 0 }, d.optInt("defaultMaxPostLines").takeIf { it > 0 },
        )
        synchronized(infoCache) { infoCache[boardUrl] = info }
        return info
    }

    /** 2ch の SETTING.TXT と同じ形にして返す(既定の名前・本文の上限)。BBS_LINE_NUMBER は 2ch に合わせて行数の半分 */
    suspend fun setting(boardUrl: String): Map<String, String> {
        val i = runCatching { boardInfo(boardUrl) }.getOrNull() ?: return emptyMap()
        return buildMap {
            i.noname?.let { put("BBS_NONAME_NAME", it) }
            i.maxLength?.let { put("BBS_MESSAGE_COUNT", it.toString()) }
            i.maxLines?.let { put("BBS_LINE_NUMBER", ((it + 1) / 2).toString()) }
        }
    }

    /** 板の名前(URL で開いたときに使う) */
    suspend fun boardName(boardUrl: String): String? = runCatching { boardInfo(boardUrl)?.name }.getOrNull()

    /** 板の一覧。サイトの入口は web の URL(https://<web>/boards) */
    suspend fun listBoards(siteUrl: String): List<Board> {
        val origin = SITE_URL.find(siteUrl.trim())?.groupValues?.get(1) ?: throw IllegalArgumentException("hono-bbs の URL ではありません")
        val res = Http.get("${apiBaseOf(origin)}/boards?limit=500")
        if (res.status != 200) throw IllegalStateException("hono-bbs の板の一覧を読めません(HTTP ${res.status})")
        val arr = json(res).getJSONArray("data")
        return (0 until arr.length()).map { arr.getJSONObject(it) }.map { b ->
            Board(boardUrlOf(origin, b.getString("id")), b.optString("name"), b.str("category")?.ifEmpty { null })
        }
    }

    // ── スレ一覧 ──

    suspend fun listThreads(board: Board): List<ThreadSummary> {
        val (origin, id) = parts(board.url)
        val api = apiBaseOf(origin)
        val out = ArrayList<ThreadSummary>()
        var cursor: String? = null
        // 何ページにも分かれていればたどる(板のスレの上限までなので、たどりきれる)
        for (page in 0 until 20) {
            val url = "$api/boards/${enc(id)}/threads?limit=500" + (cursor?.let { "&cursor=${enc(it)}" } ?: "")
            val res = Http.get(url)
            if (res.status == 404) throw IllegalStateException("hono-bbs の板が見つかりません(HTTP 404)")
            if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
            val body = json(res)
            val arr = body.getJSONArray("data")
            for (i in 0 until arr.length()) {
                val t = arr.getJSONObject(i)
                val fp = t.optJSONObject("firstPost")?.takeIf { !it.optBoolean("isDeleted") }
                val content = fp?.str("content")
                out += ThreadSummary(
                    board.url, t.getString("id"), t.optString("title"), t.optInt("postCount"), out.size,
                    runCatching { java.time.Instant.parse(t.getString("createdAt")).toEpochMilli() }.getOrNull(),
                    authorId = fp?.str("authorId"),
                    preview = content,
                    thumb = content?.let { FIRST_IMAGE.find(it)?.value },
                )
            }
            cursor = body.str("nextCursor") ?: break
        }
        return out
    }

    // ── レス ──

    /** レスを取る。cursor があれば、その続き(cursor.postCount = 取り終えた最後のレス番号)だけ */
    suspend fun fetchPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult {
        val (origin, id) = parts(thread.boardUrl)
        val base = "${apiBaseOf(origin)}/boards/${enc(id)}/threads/${enc(thread.key)}"
        val lastNo0 = cursor?.postCount ?: 0
        // 初めて開くときは、スレタイと「もう書けないスレか」を取る
        var title: String? = null
        var archived = false
        if (cursor == null) {
            val tr = Http.get(base)
            if (tr.status == 404) return FetchResult(FetchStatus.ARCHIVED, emptyList(), null)
            if (tr.status == 200) {
                val t = json(tr).getJSONObject("data")
                title = t.str("title")
                archived = t.optBoolean("isArchived")
            }
        }
        val posts = ArrayList<Post>()
        // API の続きの印は {"postNumber": 最後の番号} を base64url にしたもの
        var next: String? = if (lastNo0 > 0) Base64.getUrlEncoder().withoutPadding().encodeToString("{\"postNumber\":$lastNo0}".toByteArray()) else null
        for (page in 0 until 50) {
            val url = "$base/posts?limit=500" + (next?.let { "&cursor=${enc(it)}" } ?: "")
            val res = Http.get(url)
            if (res.status == 404) return FetchResult(FetchStatus.ARCHIVED, emptyList(), cursor)
            if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
            val body = json(res)
            val arr: JSONArray = body.getJSONArray("data")
            for (i in 0 until arr.length()) {
                val p = arr.getJSONObject(i)
                if (p.getInt("postNumber") > lastNo0) posts += toPost(p)
            }
            next = body.str("nextCursor") ?: break
        }
        val lastNo = posts.lastOrNull()?.no ?: lastNo0
        val nextCursor = DatCursor(0, lastNo, null)
        if (posts.isEmpty()) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), nextCursor, title, archived)
        return FetchResult(FetchStatus.UPDATED, posts, nextCursor, title, archived)
    }

    // ── 書き込み ──

    private fun input(input: PostInput) = JSONObject().apply {
        put("content", input.body)
        if (input.name.isNotEmpty()) put("posterName", input.name)
        if (input.mail.isNotEmpty()) put("posterOptionInfo", input.mail)
    }

    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        val (origin, id) = parts(t.boardUrl)
        val api = apiBaseOf(origin)
        return readWrite(Http.postJson("$api/boards/${enc(id)}/threads/${enc(t.key)}/posts", input(input).toString()), api)
    }

    suspend fun createThread(board: Board, title: String, input: PostInput): PostResult {
        val (origin, id) = parts(board.url)
        val api = apiBaseOf(origin)
        return readWrite(Http.postJson("$api/boards/${enc(id)}/threads", input(input).put("title", title).toString()), api)
    }

    /** 書き込みの応答を読む。Turnstile が要るときは、つなぎのコードをもらって、認証の案内を返す */
    private suspend fun readWrite(res: HttpResponse, api: String): PostResult {
        val body = runCatching { json(res) }.getOrNull()
        if (res.status in 200..299) {
            val no = body?.optJSONObject("data")?.optInt("postNumber")?.takeIf { it > 0 }
            return PostResult.Ok("書き込みました", no)
        }
        val error = body?.str("error")
        if (error == "TURNSTILE_REQUIRED" || error == "TURNSTILE_INVALID") {
            val pair = runCatching { json(Http.postJson("$api/auth/turnstile/pair", "{}")).optJSONObject("data") }.getOrNull()
            if (pair != null) {
                return PostResult.Auth(
                    "この掲示板は、書き込みの前に人の確認(Turnstile)が要ります。認証ページを開いて確認が済んだら、もう一度送ってください",
                    pair.str("url"), pair.str("code"),
                )
            }
            return PostResult.Auth("この掲示板は、書き込みの前に人の確認(Turnstile)が要ります", "$api/auth/turnstile", null)
        }
        val msg = body?.str("message")
        return PostResult.Error(if (msg != null) "${error ?: "エラー"}: $msg" else "書き込めませんでした(HTTP ${res.status})")
    }

    /** ブラウザで開く URL */
    fun webUrl(t: ThreadSummary): String {
        val (origin, id) = parts(t.boardUrl)
        return "$origin/boards/$id/${t.key}"
    }
}
