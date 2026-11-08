package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.Http
import io.github.contentsview08.obb.data.HttpResponse
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.Base64

// hono-bbs(自作の掲示板)の読み書き。PC 版の packages/connectors/src/honobbs/connector.ts を Kotlin に写したもの。
// 2ch 互換の窓口(subject.txt・dat)ではなく、掲示板の JSON の API を読む。スレ一覧の時点で 1 レス目(本文・ID・画像)が付いてくる
// - 板の URL は web の URL(https://<web>/boards/<板ID>/)。スレは https://<web>/boards/<板ID>/<スレID(UUID)>
// - API の場所は web のページの <meta name="bbs-api" content="…/api/v1"> から見つける(なければ https://api.<web のホスト>/api/v1)
// - 書き込みで Turnstile が要るときは、エッヂと同じ流れ: POST /auth/turnstile/pair でコードをもらい(Cookie turnstile_pair が付く)、
//   認証ページの URL とコードを出す。人がブラウザで認証してから送り直すと、その Cookie でセッションが使われる
// - アカウント(ユーザー ID とパスワード。設定 → サイトごとの設定): 5ch の BE と違って Cookie ではなく、ログインでもらったセッション ID を
//   Authorization: Bearer で書き込みに付ける。サイト(origin)はいくつもあり得るので、ログインはサイトごとに、書き込みのときに要るぶんだけ行う
// 本番の板への試し書き込みはしない

private val THREAD_URL = Regex("^(https?://[^/]+)/boards/([A-Za-z0-9_-]+)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/([0-9][0-9,-]*n?))?/?(?:[?#].*)?$")
private val BOARD_URL = Regex("^(https?://[^/]+)/boards/([A-Za-z0-9_-]+)/?(?:[?#].*)?$")
private val SITE_URL = Regex("^(https?://[^/]+)/boards/?(?:[?#].*)?$")
private val FIRST_IMAGE = Regex("https?://\\S+?\\.(?:jpe?g|png|gif|webp)(?:\\?\\S*)?(?=\\s|$)", RegexOption.IGNORE_CASE)
private val PRIVATE_NAME = Regex("\\.(?:local|localhost|lan|home|internal|intranet|corp|home\\.arpa)$")
private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.\\d{1,3}\\.\\d{1,3}$")
private val HEX_PART = Regex("(?:^|\\.)0x", RegexOption.IGNORE_CASE)

/** 家の中・自分の端末を指す名前とアドレス(数字の変わった書き方・IPv6 も含める) */
private fun isPrivateHost(host: String): Boolean {
    val h = host.lowercase().trimEnd('.')
    if (h == "localhost" || PRIVATE_NAME.containsMatchIn(h)) return true
    if (h.startsWith("[") || h.contains(':') || !h.contains('.')) return true
    IPV4.matchEntire(h)?.let { m ->
        val a = m.groupValues[1].toInt()
        val b = m.groupValues[2].toInt()
        return a == 0 || a == 10 || a == 127 || (a == 100 && b in 64..127) || (a == 169 && b == 254) || (a == 172 && b in 16..31) || (a == 192 && b == 168) || a >= 224
    }
    return h.all { it.isDigit() || it == '.' } || HEX_PART.containsMatchIn(h)
}

object HonoBbs {
    fun isBoardUrl(url: String) = BOARD_URL.matches(url)
    /** /boards/板/スレ/番号 の番号(123・123-456・123,456・123n の先頭) */
    fun resNoIn(url: String): Int? =
        THREAD_URL.find(url)?.groupValues?.get(4)?.takeWhile { it.isDigit() }?.toIntOrNull()?.takeIf { it > 0 }
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
        val api = Regex("^(https?://[^/?#]+(?:/[^?#]*?)?/api/v[0-9]+)").find(url)?.groupValues?.get(1)
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

    /** hono-bbs の板なら、その掲示板の API の場所(画像の置き場もここ)。hono-bbs の板でなければ null */
    suspend fun apiFor(boardUrl: String): String? = if (isBoardUrl(boardUrl)) runCatching { apiBaseOf(parts(boardUrl).first) }.getOrNull() else null

    /** web のオリジン → API の場所。一度調べたら覚えておく */
    private val apiBases = HashMap<String, String>()

    /**
     * <meta name="bbs-api"> の行き先を受けてよいか。API の場所は相手のページが決めるので、
     * 同じホストかその下(api.<ホスト>)か、家の中・自分の端末でないところだけにする(リンクを押しただけで家の中の機器へ通信しないように)。
     * http(s) の URL の形のものだけ(ページに別の仕組みの URL が書かれていても API にしない)
     */
    fun apiBaseAllowed(origin: String, api: String): Boolean {
        val page = origin.toHttpUrlOrNull() ?: return false
        // toHttpUrlOrNull は http・https 以外を受けない
        val target = api.toHttpUrlOrNull() ?: return false
        if (target.host == page.host || target.host.endsWith(".${page.host}")) return true
        return !isPrivateHost(target.host)
    }

    private suspend fun apiBaseOf(origin: String): String {
        synchronized(apiBases) { apiBases[origin]?.let { return it } }
        val res = runCatching { Http.get("$origin/") }.getOrNull()?.takeIf { it.status == 200 }
        val found = res?.let {
            Regex("<meta\\s+name=[\"']bbs-api[\"']\\s+content=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
                .find(String(it.body, Charsets.UTF_8))?.groupValues?.get(1)
                ?.takeIf { u -> apiBaseAllowed(origin, u) }?.trimEnd('/')
        }
        val base = found ?: "${origin.replaceFirst(Regex("^(https?://)"), "$1api.")}/api/v1"
        // ページを読めなかったときの決めつけは覚えない(一時的な失敗で、再起動まで違う API へ行き続けないように)
        if (res != null) synchronized(apiBases) { apiBases[origin] = base }
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

    /** 2ch の SETTING.TXT と同じ形にして返す(既定の名前・本文の上限)。読めなければ null */
    suspend fun setting(boardUrl: String): Map<String, String>? {
        val i = runCatching { boardInfo(boardUrl) }.getOrNull() ?: return null
        return buildMap {
            i.noname?.let { put("BBS_NONAME_NAME", it) }
            i.maxLength?.let { put("BBS_MESSAGE_COUNT", it.toString()) }
            i.maxLines?.let { put(TwoCh.MAX_LINES_KEY, it.toString()) }
        }
    }

    /** 板の名前(URL で開いたときに使う)。板がなければ例外(404) */
    suspend fun boardName(boardUrl: String): String? = boardInfo(boardUrl)?.name

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

    // ── スレの状態のまとめ取り ──

    /**
     * 持っているスレ(閲覧履歴・お気に入り)のいまのレス数と dat 落ちを、板をまたいでまとめて取る(POST /threads/status。200 件ずつ)。
     * 返す Map の鍵はスレの key(id)。返らなかったスレは「消えた・見えない」(dat 落ち扱い)。hono-bbs の docs/endpoints/threads-status.md
     */
    suspend fun threadStatus(threads: List<ThreadSummary>): Map<String, Pair<Int, Boolean>> {
        val out = HashMap<String, Pair<Int, Boolean>>()
        for ((origin, list) in threads.groupBy { parts(it.boardUrl).first }) {
            val api = apiBaseOf(origin)
            val ids = list.map { it.key }.distinct()
            for (chunk in ids.chunked(200)) {
                val body = JSONObject().put("ids", JSONArray(chunk)).toString()
                val res = Http.postJson("$api/threads/status", body)
                if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $api/threads/status")
                val arr = json(res).getJSONArray("data")
                for (i in 0 until arr.length()) {
                    val s = arr.getJSONObject(i)
                    out[s.getString("id")] = s.optInt("postCount") to s.optBoolean("isArchived")
                }
            }
        }
        return out
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
        return out.distinctBy { it.key }
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

    // ── アカウント(PC 版の connector.ts の login・authHeader と同じ) ──

    class Account(val user: String, val password: String)

    /** 設定で保存したアカウント(起動時と変えたときに AppViewModel が入れる)。null なら使わない */
    @Volatile var account: Account? = null
    /** サイト(origin)ごとのログインのセッション(ID と期限 ms) */
    private val sessions = HashMap<String, Pair<String, Long>>()

    fun clearSessions() = synchronized(sessions) { sessions.clear() }

    /** 失敗の理由を日本語に */
    private fun loginError(error: String?, message: String?, status: Int) = when (error) {
        "INVALID_CREDENTIALS" -> "ユーザー ID かパスワードが違います"
        "PASSKEY_REQUIRED" -> "このアカウントはパスキーでしか入れません"
        "TOO_MANY_ATTEMPTS" -> "ログインの失敗が続いたので、しばらく待ってください"
        else -> message ?: "HTTP $status"
    }

    /**
     * パスワードを送ってよいサイトか。板は URL の形だけで判定するので、確かめないと、形を合わせただけの別サイトへパスワードが渡る。
     * API の場所(<meta name="bbs-api">)も相手のページが決めるので、こちらも確かめる。PC 版の isAccountSite と同じ
     */
    fun isAccountSite(url: String): Boolean {
        val u = url.toHttpUrlOrNull() ?: return false
        return u.isHttps && (u.host == "red-edge.net" || u.host.endsWith(".red-edge.net"))
    }

    /** ログインし直して送り直すか。アカウントを付けて送ったのに、セッションが向こうで切れていたとき(packages/conformance/hono-relogin.json) */
    internal fun shouldRelogin(status: Int, sentAuth: Boolean) = status == 401 && sentAuth

    /** そのサイト(web の origin)にログインしてセッションをもらう(POST /auth/login)。返すのは表示名。失敗は例外(理由は message) */
    suspend fun login(origin: String, account: Account): String {
        val api = apiBaseOf(origin)
        if (!isAccountSite(origin) || !isAccountSite(api)) throw IllegalStateException("このサイトにはパスワードを送りません($origin)")
        val body = JSONObject().put("id", account.user).put("password", account.password).toString()
        val res = Http.postJson("$api/auth/login", body)
        val j = runCatching { json(res) }.getOrNull()
        val data = j?.optJSONObject("data")
        if (res.status != 200 || data == null) throw IllegalStateException(loginError(j?.str("error"), j?.str("message"), res.status))
        val expires = runCatching { java.time.Instant.parse(data.getString("expiresAt")).toEpochMilli() }.getOrDefault(System.currentTimeMillis() + 3600_000L)
        synchronized(sessions) { sessions[origin] = data.getString("sessionId") to expires }
        return data.optString("displayName").ifEmpty { account.user }
    }

    /** 書き込みに付ける Authorization。アカウントがあれば(セッションがなければ・切れそうならここでログイン) */
    private suspend fun authHeaders(origin: String): Map<String, String> {
        val a = account ?: return emptyMap()
        if (!isAccountSite(origin)) return emptyMap()
        val s = synchronized(sessions) { sessions[origin] }
        if (s == null || s.second - System.currentTimeMillis() < 60_000L) {
            runCatching { login(origin, a) }.getOrElse { throw IllegalStateException("アカウントでログインできませんでした: ${it.message}") }
        }
        return mapOf("Authorization" to "Bearer ${synchronized(sessions) { sessions[origin]!!.first }}")
    }

    /** アカウントを付けて送る。セッションが向こうで切れていたら(401)、一度だけログインし直して送り直す */
    private suspend fun postWithAuth(origin: String, url: String, body: String): HttpResponse {
        val auth = authHeaders(origin)
        val res = Http.postJson(url, body, auth)
        if (!shouldRelogin(res.status, auth.isNotEmpty())) return res
        synchronized(sessions) { sessions.remove(origin) }
        return Http.postJson(url, body, authHeaders(origin))
    }

    /** 利用者の登録(1 段目): メールに確認コードを送る(POST /auth/register/request)。Turnstile が要れば Auth(認証ページとコード)を返す */
    suspend fun registerRequest(origin: String, email: String): PostResult {
        val api = apiBaseOf(origin)
        val res = Http.postJson("$api/auth/register/request", JSONObject().put("email", email).toString())
        if (res.status in 200..299) return PostResult.Ok("確認コードを送りました(10 分有効)", null)
        return readWrite(res, api)
    }

    /** 利用者の登録(2 段目): コードと ID・パスワードでユーザーを作り、そのままログインする(POST /auth/register/verify) */
    suspend fun registerVerify(origin: String, email: String, code: String, id: String, displayName: String, password: String): PostResult {
        val api = apiBaseOf(origin)
        val body = JSONObject().put("email", email).put("code", code).put("id", id).put("displayName", displayName.ifEmpty { id }).put("password", password).toString()
        val res = Http.postJson("$api/auth/register/verify", body)
        val j = runCatching { json(res) }.getOrNull()
        if (res.status in 200..299) {
            val data = j?.optJSONObject("data")
            if (data != null) {
                val expires = runCatching { java.time.Instant.parse(data.getString("expiresAt")).toEpochMilli() }.getOrDefault(System.currentTimeMillis() + 3600_000L)
                synchronized(sessions) { sessions[origin] = data.getString("sessionId") to expires }
            }
            return PostResult.Ok("登録しました(${data?.optString("displayName")?.ifEmpty { id } ?: id})", null)
        }
        val why = when (j?.str("error")) {
            "OTP_EXPIRED" -> "コードの期限が切れたか、5 回間違えました。送り直してください"
            "OTP_INVALID" -> "コードが違います"
            "USER_ID_TAKEN" -> "その ID はもう使われています"
            "EMAIL_TAKEN" -> "そのメールアドレスはもう使われています"
            "VALIDATION_ERROR" -> j.str("message") ?: "入力の形が違います(ID は英数字・_・- で 7 文字以上、パスワードは 8 文字以上)"
            else -> null
        }
        return if (why != null) PostResult.Error(why) else readWrite(res, api)
    }

    /** サイトの入口(https://<web>/boards)から origin */
    fun originOfSite(siteUrl: String): String? = SITE_URL.find(siteUrl.trim())?.groupValues?.get(1)

    /** 板の URL から origin(hono-bbs の板でなければ null) */
    fun originOfBoard(boardUrl: String): String? = BOARD_URL.find(boardUrl)?.groupValues?.get(1)

    /** この起動で読んだことのある hono-bbs のサイト(origin)。設定のアカウントで「ログインして確かめる」先に使う */
    fun knownOrigins(): List<String> = synchronized(apiBases) { apiBases.keys.toList() }

    // ── 書き込み ──

    private fun input(input: PostInput) = JSONObject().apply {
        put("content", input.body)
        if (input.name.isNotEmpty()) put("posterName", input.name)
        if (input.mail.isNotEmpty()) put("posterOptionInfo", input.mail)
    }

    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        val (origin, id) = parts(t.boardUrl)
        val api = apiBaseOf(origin)
        return readWrite(postWithAuth(origin, "$api/boards/${enc(id)}/threads/${enc(t.key)}/posts", input(input).toString()), api)
    }

    suspend fun createThread(board: Board, title: String, input: PostInput): PostResult {
        val (origin, id) = parts(board.url)
        val api = apiBaseOf(origin)
        return readWrite(postWithAuth(origin, "$api/boards/${enc(id)}/threads", input(input).put("title", title).toString()), api)
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
                // 認証ページはブラウザで開くので、http(s) 以外の URL は開かない
                val url = pair.str("url")
                if (url != null && url.toHttpUrlOrNull() == null) return PostResult.Error("認証ページの URL が読めませんでした")
                return PostResult.Auth(
                    "この掲示板は、書き込みの前に人の確認(Turnstile)が要ります。認証ページを開いて確認が済んだら、もう一度送ってください",
                    url, pair.str("code"),
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
