package io.github.yumekui8.bbsnative

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.yumekui8.bbsnative.bbs.Board
import io.github.yumekui8.bbsnative.bbs.FetchStatus
import io.github.yumekui8.bbsnative.bbs.NextThreadCandidate
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.PostIndex
import io.github.yumekui8.bbsnative.bbs.PostInput
import io.github.yumekui8.bbsnative.bbs.PostResult
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import io.github.yumekui8.bbsnative.bbs.TwoCh
import io.github.yumekui8.bbsnative.bbs.findNextThreads
import io.github.yumekui8.bbsnative.data.HistoryEntry
import io.github.yumekui8.bbsnative.data.Http
import io.github.yumekui8.bbsnative.data.LogDb
import io.github.yumekui8.bbsnative.data.NgRule
import io.github.yumekui8.bbsnative.data.PostHistoryEntry
import io.github.yumekui8.bbsnative.data.Prefs
import io.github.yumekui8.bbsnative.data.ThreadState
import io.github.yumekui8.bbsnative.ui.Palette
import io.github.yumekui8.bbsnative.ui.PostLinks
import io.github.yumekui8.bbsnative.ui.RenderOptions
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.drop
import io.github.yumekui8.bbsnative.ui.RenderedPost
import io.github.yumekui8.bbsnative.ui.renderPosts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 書き込み欄の状態(スレごと、スレ立てでも使う) */
class ReplyState {
    var open by mutableStateOf(false)
    var name by mutableStateOf("")
    var sage by mutableStateOf(true)
    var title by mutableStateOf("")
    var body by mutableStateOf("")
    var sending by mutableStateOf(false)
    /** 画像を上げているところ */
    var uploading by mutableStateOf(false)
    /** 結果の知らせ(書き込めた・エラー) */
    var notice by mutableStateOf<String?>(null)
    /** エッヂの認証待ち(ブラウザで開く URL と認証コード) */
    var auth by mutableStateOf<PostResult.Auth?>(null)
    /** 5ch の書き込み確認(承諾したら送り直す) */
    var confirm by mutableStateOf<PostResult.Confirm?>(null)
    var draftLoaded = false
}

/** 画面の積み重ね(戻るで 1 つ前へ)。左のメニューから開くものは、積み重ねを入れ替える */
sealed interface Page {
    class Threads(val board: Board) : Page {
        var threads by mutableStateOf<List<ThreadSummary>>(emptyList())
        var states by mutableStateOf<Map<String, ThreadState>>(emptyMap())
        var loading by mutableStateOf(false)
        var error by mutableStateOf<String?>(null)
        /** スレを立てる欄 */
        val newThread = ReplyState()
    }

    class Thread(val summary: ThreadSummary) : Page {
        var title by mutableStateOf(summary.title)
        var index by mutableStateOf(PostIndex.build(emptyList()))
        /** 組み立て済みのレス(レス番号 → 頭の行と本文)。index と一緒に作る */
        var rendered by mutableStateOf<Map<Int, RenderedPost>>(emptyMap())
        /** NG に当たるレスの番号(あぼーんと出す) */
        var ngNos by mutableStateOf<Set<Int>>(emptySet())
        /** レスの中の押せるところの呼び先(画面が関数を入れる) */
        val links = PostLinks()
        /** 開いた時点の「最初の未読」(「ここから未読」の線を引く位置)。0 なら線を引かない */
        var unreadFrom by mutableStateOf(0)
        /** 開いたときに移る位置(レス番号)。一度移ったら null */
        var openAt by mutableStateOf<Int?>(null)
        var loaded by mutableStateOf(false)
        var loading by mutableStateOf(false)
        var archived by mutableStateOf(false)
        var error by mutableStateOf<String?>(null)
        var readNo = 0
        /** 自分の書き込みのレス番号 */
        var ownNos by mutableStateOf<Set<Int>>(emptySet())
        var favorite by mutableStateOf(false)
        /** 次スレの候補(探したら入る。null はまだ探していない) */
        var nextCandidates by mutableStateOf<List<NextThreadCandidate>?>(null)
        val reply = ReplyState()
    }

    /** 板一覧(板を足す) */
    class Boards : Page
    class History : Page
    class FavThreads : Page
    class PostHistory : Page
    class Settings : Page
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val db = LogDb(app)
    val prefs = Prefs(app)

    val stack = mutableStateListOf<Page>()
    var drawerOpen by mutableStateOf(false)
    /** 画面の下に一瞬出す知らせ */
    var toast by mutableStateOf<String?>(null)

    var favorites by mutableStateOf<List<Board>>(emptyList())
        private set
    var boards by mutableStateOf<List<Board>>(emptyList())
        private set
    var boardsLoading by mutableStateOf(false)
        private set
    var boardsError by mutableStateOf<String?>(null)
        private set
    var history by mutableStateOf<List<HistoryEntry>>(emptyList())
        private set
    var favThreads by mutableStateOf<List<HistoryEntry>>(emptyList())
        private set
    var postHistory by mutableStateOf<List<PostHistoryEntry>>(emptyList())
        private set

    init {
        Http.init(app)
        // 起動したら、前回の板のスレ一覧(初めてならエッヂ)
        val url = prefs.lastBoardUrl ?: "https://bbs.eddibb.cc/liveedge/"
        openBoard(Board(url, prefs.lastBoardName ?: "エッヂ"), root = true)
        reloadSide()
        viewModelScope.launch { snapshotFlow { renderKey() }.drop(1).collectLatest { rerenderAll() } }
        // 起動したら、しばらく開いていないスレのログを消す(設定)
        if (prefs.logRetentionDays > 0) viewModelScope.launch { runCatching { db.pruneLogs(System.currentTimeMillis() - prefs.logRetentionDays * 86_400_000L) } }
    }

    /** 左のメニューに出すもの(お気に入り板・閲覧履歴・お気に入りのスレ)を読み直す */
    fun reloadSide() {
        viewModelScope.launch {
            favorites = db.favorites()
            history = db.history()
            favThreads = db.favoriteThreads()
        }
    }

    /** スレを保存(︙ の「スレを保存」)。html なら HTML、そうでなければテキスト */
    fun saveThread(page: Page.Thread, uri: android.net.Uri, html: Boolean) {
        viewModelScope.launch {
            try {
                val url = TwoCh.webUrl(page.summary)
                val text = withContext(Dispatchers.Default) {
                    fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    if (!html) buildString {
                        append(page.title).append('\n').append(url).append("\n\n")
                        for (p in page.index.posts) {
                            append("${p.no} ${p.name}${if (p.mail.isNotEmpty()) " [${p.mail}]" else ""} ${p.date}${p.id?.let { " ID:$it" } ?: ""}\n")
                            append(p.body).append("\n\n")
                        }
                    } else buildString {
                        append("<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>").append(esc(page.title)).append("</title>")
                        append("<style>body{font-family:sans-serif;max-width:48rem;margin:auto;padding:1rem;line-height:1.6}dt{color:#666;font-size:.85em;margin-top:1em}dd{margin:0;white-space:pre-wrap}</style></head><body>")
                        append("<h1>").append(esc(page.title)).append("</h1><p><a href=\"").append(esc(url)).append("\">").append(esc(url)).append("</a></p><dl>")
                        for (p in page.index.posts) {
                            append("<dt>${p.no} <b>${esc(p.name)}</b>${if (p.mail.isNotEmpty()) " [${esc(p.mail)}]" else ""} ${esc(p.date)}${p.id?.let { " ID:${esc(it)}" } ?: ""}</dt>")
                            append("<dd>").append(esc(p.body)).append("</dd>")
                        }
                        append("</dl></body></html>")
                    }
                }
                withContext(Dispatchers.IO) { getApplication<Application>().contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray()) } }
                toast = "スレを保存しました"
            } catch (e: Exception) {
                toast = "保存できませんでした: ${e.message ?: e}"
            }
        }
    }

    /** 設定の「今すぐ消す」 */
    fun pruneLogsNow() {
        viewModelScope.launch {
            val days = prefs.logRetentionDays.takeIf { it > 0 } ?: 30
            val n = db.pruneLogs(System.currentTimeMillis() - days * 86_400_000L)
            reloadSide()
            toast = "$n 件のスレのログを消しました"
        }
    }

    /** 掲示板のスレ一覧で分かった、いまのレス数(スレの id → 数)。閲覧履歴・お気に入りのスレの新着に使う。-1 は dat 落ち */
    var remoteCounts by mutableStateOf<Map<String, Int>>(emptyMap())
        private set
    var checking by mutableStateOf(false)
        private set

    /** 閲覧履歴・お気に入りのスレの新着を確かめる(板ごとにスレ一覧を 1 回だけ読む) */
    fun checkNew(entries: List<HistoryEntry>) {
        if (checking || entries.isEmpty()) return
        viewModelScope.launch {
            checking = true
            val next = remoteCounts.toMutableMap()
            try {
                for ((boardUrl, list) in entries.groupBy { it.thread.boardUrl }) {
                    val threads = runCatching { TwoCh.listThreads(Board(boardUrl, "")) }.getOrNull() ?: continue
                    val counts = threads.associate { it.key to it.postCount }
                    for (e in list) next[e.thread.id] = counts[e.thread.key] ?: -1
                }
                remoteCounts = next
            } finally {
                checking = false
            }
        }
    }

    /** スレ一覧に戻る前に見ていたスレ(「進む」で開き直す) */
    private var forwardPage: Page.Thread? = null
    val canForward get() = forwardPage != null

    /** 画面の移り方(1: 右から出てくる / -1: 右へ戻る / 0: 入れ替え)。積み重ねを変える直前に決める */
    var navDir = 0
        private set

    fun back(): Boolean {
        if (stack.size <= 1) return false
        navDir = -1
        forwardPage = stack.removeAt(stack.lastIndex) as? Page.Thread
        // 戻ったスレ一覧の未読の数を新しくする
        when (val top = stack.last()) {
            is Page.Threads -> viewModelScope.launch { top.states = db.threadStates(top.board.url) }
            is Page.History, is Page.FavThreads -> reloadSide()
            else -> {}
        }
        return true
    }

    /** 戻る前に見ていたスレを開き直す */
    fun forward() {
        val p = forwardPage ?: run { toast = "進む先がありません"; return }
        forwardPage = null
        navDir = 1
        stack.add(p)
    }

    /** 左のメニューから開く(積み重ねを入れ替える) */
    fun openRoot(page: Page) {
        drawerOpen = false
        navDir = 0
        stack.clear()
        stack.add(page)
        when (page) {
            is Page.History, is Page.FavThreads -> reloadSide()
            is Page.PostHistory -> viewModelScope.launch { postHistory = db.postHistory() }
            is Page.Boards -> if (boards.isEmpty()) loadBoards()
            else -> {}
        }
    }

    // ── 板 ──

    /** 板一覧の取得元(bbsmenu の URL と名前) */
    var sites by mutableStateOf<List<Pair<String, String>>>(emptyList())
        private set
    /** 「板を探す」で見ているサイト(null なら最初のサイト) */
    var siteUrl by mutableStateOf<String?>(null)

    fun reloadSites() { viewModelScope.launch { sites = db.siteMenuUrls() } }

    fun selectSite(url: String) {
        siteUrl = url
        boards = emptyList()
        loadBoards()
    }

    /** bbsmenu の URL を足す(読めるか確かめてから) */
    fun addSite(menuUrl: String, name: String) {
        val url = menuUrl.trim()
        viewModelScope.launch {
            try {
                val list = TwoCh.listBoards(url)
                if (list.isEmpty()) throw IllegalStateException("板が 1 つもありません")
                db.addSite(url, name.trim().ifEmpty { url.removePrefix("https://").substringBefore('/') })
                db.replaceBoards(url, list)
                sites = db.siteMenuUrls()
                toast = "サイトを足しました(${list.size} 板)"
            } catch (e: Exception) {
                toast = "足せませんでした: ${e.message ?: e}"
            }
        }
    }

    fun removeSite(menuUrl: String) {
        viewModelScope.launch {
            db.removeSite(menuUrl)
            sites = db.siteMenuUrls()
            if (siteUrl == menuUrl) { siteUrl = null; boards = emptyList() }
        }
    }

    /** お気に入り板を 1 つ上・下へ */
    fun moveFavorite(board: Board, delta: Int) {
        val list = favorites.toMutableList()
        val i = list.indexOfFirst { it.url == board.url }
        val j = i + delta
        if (i < 0 || j !in list.indices) return
        list.add(j, list.removeAt(i))
        favorites = list
        viewModelScope.launch { db.reorderFavorites(list.map { it.url }) }
    }

    /** バックアップを書き出す: 設定・お気に入り板・お気に入りのスレ・サイト・NG(設定に入っている) */
    fun exportBackup(uri: android.net.Uri) {
        viewModelScope.launch {
            try {
                val o = org.json.JSONObject()
                o.put("app", "bbs-native").put("version", 1)
                o.put("settings", prefs.export())
                o.put("favoriteBoards", org.json.JSONArray().apply { for (b in db.favorites()) put(org.json.JSONObject().put("url", b.url).put("name", b.name)) })
                o.put("favoriteThreads", org.json.JSONArray().apply {
                    for (h in db.favoriteThreads()) put(org.json.JSONObject().put("boardUrl", h.thread.boardUrl).put("key", h.thread.key).put("title", h.thread.title))
                })
                o.put("sites", org.json.JSONArray().apply { for ((u, n) in db.siteMenuUrls()) put(org.json.JSONObject().put("url", u).put("name", n)) })
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openOutputStream(uri, "wt")?.use { it.write(o.toString(2).toByteArray()) }
                }
                toast = "バックアップを保存しました"
            } catch (e: Exception) {
                toast = "保存できませんでした: ${e.message ?: e}"
            }
        }
    }

    /** バックアップから戻す(今あるものに足す。設定は上書き) */
    fun importBackup(uri: android.net.Uri) {
        viewModelScope.launch {
            try {
                val text = withContext(Dispatchers.IO) { getApplication<Application>().contentResolver.openInputStream(uri)?.use { String(it.readBytes()) } } ?: throw IllegalStateException("読めませんでした")
                val o = org.json.JSONObject(text)
                o.optJSONObject("settings")?.let { prefs.import(it) }
                o.optJSONArray("favoriteBoards")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { db.setFavorite(Board(it.getString("url"), it.getString("name")), true) } }
                o.optJSONArray("favoriteThreads")?.let { a ->
                    for (i in 0 until a.length()) a.getJSONObject(i).let {
                        val t = ThreadSummary(it.getString("boardUrl"), it.getString("key"), it.getString("title"), 0, 0, null)
                        db.setFavoriteThread(t, t.title, true)
                    }
                }
                o.optJSONArray("sites")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { db.addSite(it.getString("url"), it.getString("name")) } }
                favorites = db.favorites()
                sites = db.siteMenuUrls()
                reloadSide()
                toast = "バックアップから戻しました(設定は、アプリを開き直すと全部に効きます)"
            } catch (e: Exception) {
                toast = "戻せませんでした: ${e.message ?: e}"
            }
        }
    }

    fun loadBoards(refresh: Boolean = false) {
        if (boardsLoading) return
        viewModelScope.launch {
            boardsLoading = true
            boardsError = null
            try {
                if (sites.isEmpty()) sites = db.siteMenuUrls()
                val menuUrl = siteUrl ?: sites.firstOrNull()?.first ?: return@launch
                val cached = if (refresh) emptyList() else db.cachedBoards(menuUrl)
                boards = cached.ifEmpty { TwoCh.listBoards(menuUrl).also { db.replaceBoards(menuUrl, it) } }
            } catch (e: Exception) {
                boardsError = e.message ?: e.toString()
            } finally {
                boardsLoading = false
            }
        }
    }

    fun isFavorite(board: Board) = favorites.any { it.url == board.url }

    fun toggleFavorite(board: Board) {
        viewModelScope.launch {
            val on = !isFavorite(board)
            db.setFavorite(board, on)
            favorites = db.favorites()
            toast = if (on) "お気に入り板に足しました" else "お気に入り板から外しました"
        }
    }

    // ── スレ一覧 ──

    /** 板のスレ一覧を開く。root なら積み重ねを入れ替える(左のメニューから) */
    fun openBoard(board: Board, root: Boolean = true) {
        drawerOpen = false
        val page = Page.Threads(board)
        navDir = if (root) 0 else 1
        if (root) stack.clear()
        stack.add(page)
        prefs.lastBoardUrl = board.url
        prefs.lastBoardName = board.name
        refreshBoard(page)
        // 板の既定の名前を先に読んでおく(スレを開いたとき、待たずに名無しを省けるように)
        viewModelScope.launch { TwoCh.nonameName(board.url) }
    }

    fun refreshBoard(page: Page.Threads) {
        if (page.loading) return
        viewModelScope.launch {
            page.loading = true
            page.error = null
            try {
                page.states = db.threadStates(page.board.url)
                page.threads = TwoCh.listThreads(page.board)
            } catch (e: Exception) {
                page.error = e.message ?: e.toString()
            } finally {
                page.loading = false
            }
        }
    }

    // ── スレ ──

    fun openThread(t: ThreadSummary) {
        drawerOpen = false
        val page = Page.Thread(t)
        forwardPage = null
        navDir = 1
        stack.add(page)
        page.reply.name = prefs.postName
        viewModelScope.launch {
            // 手元のログを先に出し、そのあと新着を取りに行く
            val log = db.loadThread(t)
            page.ownNos = db.ownPosts(t)
            page.favorite = db.isFavoriteThread(t)
            if (log != null) {
                page.title = log.title
                page.readNo = log.readNo
                page.archived = log.archived
                setPosts(page, log.posts)
                val hasUnread = log.readNo in 1 until log.posts.size
                page.unreadFrom = if (hasUnread) log.readNo + 1 else 0
                // 開く位置(設定): 最初の未読・先頭・いちばん下
                page.openAt = when {
                    prefs.openPosition == "top" -> 1
                    prefs.openPosition == "bottom" -> log.posts.lastOrNull()?.no
                    log.readNo <= 0 -> 1
                    hasUnread -> log.readNo
                    else -> log.posts.lastOrNull()?.no
                }
                db.touch(t)
            }
            page.loaded = log != null
            refreshThread(page, firstOpen = true)
        }
    }

    /** 新着を取る。取り直しの最中なら何もしない(null)。終わりを待つときは返した Job を join する */
    /** quiet: 自動更新(「新着はありません」を出さない) */
    fun refreshThread(page: Page.Thread, firstOpen: Boolean = false, quiet: Boolean = false): Job? {
        if (page.loading) return null
        return viewModelScope.launch {
            page.loading = true
            page.error = null
            try {
                val t = page.summary
                val log = db.loadThread(t)
                val r = TwoCh.fetchPosts(t, log?.cursor)
                val title = r.title ?: log?.title ?: t.title
                db.saveFetch(t, r, title)
                if (log == null) db.touch(t)
                page.title = title
                if (r.status == FetchStatus.ARCHIVED || r.archived) page.archived = true
                if (r.posts.isNotEmpty() || r.status == FetchStatus.RESET) {
                    val old = if (r.status == FetchStatus.RESET) emptyList() else page.index.posts
                    val all: List<Post> = old + r.posts
                    // 手で更新したときは、届いた新着の頭に「ここから未読」を引き直す
                    if (!firstOpen && old.isNotEmpty() && r.posts.isNotEmpty()) page.unreadFrom = r.posts.first().no
                    setPosts(page, all)
                    if (firstOpen && log == null) page.openAt = if (prefs.openPosition == "bottom") all.lastOrNull()?.no else 1
                } else if (!firstOpen && !quiet) toast = "新着はありません"
            } catch (e: Exception) {
                page.error = e.message ?: e.toString()
            } finally {
                page.loaded = true
                page.loading = false
            }
        }
    }

    /** レスの下ごしらえと組み立て(と NG の判定)を、画面とは別のスレッドで済ませてから入れる */
    private suspend fun setPosts(page: Page.Thread, posts: List<Post>) {
        val rules = prefs.ngRules
        // 板の既定の名前(名無し)は省いて出す。読み終えていなければ(待つと表示が遅れるので)そのまま
        val noname = if (prefs.omitNoname) TwoCh.cachedNoname(page.summary.boardUrl) else null
        val o = renderOptions(noname)
        val collapse = prefs.collapseBlankLines
        val gross = if (prefs.blurGross) prefs.grossWords.lines().map { it.trim() }.filter { it.isNotEmpty() } else emptyList()
        val result = withContext(Dispatchers.Default) {
            val i = PostIndex.build(posts, collapse, gross)
            Triple(i, renderPosts(i, page.links, o), ngOf(posts, rules))
        }
        page.rendered = result.second
        page.ngNos = result.third
        page.index = result.first
    }

    private fun ngOf(posts: List<Post>, rules: List<NgRule>): Set<Int> {
        if (rules.isEmpty()) return emptySet()
        return posts.filter { p ->
            rules.any { r ->
                when (r.target) {
                    "id" -> p.id != null && p.id == r.pattern
                    "name" -> p.name.contains(r.pattern)
                    "body" -> p.body.contains(r.pattern, ignoreCase = true)
                    // スレタイの NG はスレ一覧で使う
                    else -> false
                }
            }
        }.map { it.no }.toSet()
    }

    /** NG を足して、開いているスレに当て直す */
    fun addNg(rule: NgRule) {
        prefs.addNg(rule)
        reapplyNg()
        toast = "NG に足しました"
    }

    fun removeNg(rule: NgRule) {
        prefs.removeNg(rule)
        reapplyNg()
    }

    private fun renderOptions(noname: String?) = RenderOptions(
        noname = noname, highlightOp = prefs.highlightOp, idHeat = prefs.idHeat, urlShorten = prefs.urlShorten,
        imageUrlOmit = prefs.imageUrlOmit, imageUrlCollapse = prefs.imageUrlCollapse, aaAutoDetect = prefs.aaAutoDetect, style = prefs.postStyle,
    )

    /**
     * レスの見せ方に関わる設定と配色。変わったら、開いているスレを組み立て直す(設定画面から戻ったときに、もう新しい見た目になっている)
     */
    private fun renderKey() = listOf(
        prefs.omitNoname, prefs.collapseBlankLines, prefs.highlightOp, prefs.idHeat, prefs.urlShorten, prefs.imageUrlOmit,
        prefs.imageUrlCollapse, prefs.aaAutoDetect, prefs.blurGross, prefs.grossWords, Palette.scheme.key, prefs.postStyle,
    )

    private fun rerenderAll() {
        for (p in stack.toList()) if (p is Page.Thread && p.loaded) viewModelScope.launch { setPosts(p, p.index.posts) }
    }

    private fun reapplyNg() {
        val rules = prefs.ngRules
        for (p in stack) if (p is Page.Thread) viewModelScope.launch { p.ngNos = withContext(Dispatchers.Default) { ngOf(p.index.posts, rules) } }
    }

    fun markRead(page: Page.Thread, no: Int) {
        if (no <= page.readNo) return
        page.readNo = no
        viewModelScope.launch { db.markRead(page.summary, no) }
    }

    /** スレ一覧の長押しから: お気に入りのスレに足す・外す */
    fun toggleFavoriteThread(t: ThreadSummary) {
        viewModelScope.launch {
            val on = !db.isFavoriteThread(t)
            db.setFavoriteThread(t, t.title, on)
            favThreads = db.favoriteThreads()
            toast = if (on) "お気に入りのスレに足しました" else "お気に入りのスレから外しました"
        }
    }

    /** スレ一覧の長押しから: ログを削除(開いていないスレ) */
    fun deleteLogOf(t: ThreadSummary) {
        viewModelScope.launch {
            db.deleteThread(t)
            (stack.lastOrNull() as? Page.Threads)?.let { it.states = db.threadStates(it.board.url) }
            reloadSide()
            toast = "ログを削除しました"
        }
    }

    suspend fun isFavoriteThread(t: ThreadSummary) = db.isFavoriteThread(t)

    fun toggleFavoriteThread(page: Page.Thread) {
        viewModelScope.launch {
            val on = !page.favorite
            db.setFavoriteThread(page.summary, page.title, on)
            page.favorite = on
            favThreads = db.favoriteThreads()
            toast = if (on) "お気に入りのスレに足しました" else "お気に入りのスレから外しました"
        }
    }

    /** 次スレを探す(板のスレ一覧を取り直して、似たスレタイを並べる) */
    fun findNext(page: Page.Thread) {
        page.nextCandidates = null
        viewModelScope.launch {
            try {
                val list = TwoCh.listThreads(Board(page.summary.boardUrl, ""))
                page.nextCandidates = findNextThreads(page.summary, page.title, list)
            } catch (e: Exception) {
                toast = "探せませんでした: ${e.message ?: e}"
                page.nextCandidates = emptyList()
            }
        }
    }

    /** このスレの板のスレ一覧を開く */
    fun openBoardOf(page: Page.Thread) {
        val url = page.summary.boardUrl
        openBoard(favorites.firstOrNull { it.url == url } ?: boards.firstOrNull { it.url == url } ?: Board(url, url.removePrefix("https://").trimEnd('/')), root = true)
    }

    /** 2ch 互換のスレ・板の URL なら、アプリの中で開いて true */
    fun openUrl(url: String): Boolean {
        val u = url.trim()
        // 本文の URL は http:// のことが多い。Android は暗号化しない通信を断るので https:// で開く
        val thread = Regex("^https?://([^/?#]+)/test/read\\.cgi/([^/?#]+)/(\\d+)").find(u)
        if (thread != null) {
            val key = thread.groupValues[3]
            val created = if (key.length == 10) key.toLong() * 1000 else null
            openThread(ThreadSummary("https://${thread.groupValues[1]}/${thread.groupValues[2]}/", key, "", 0, 0, created))
            return true
        }
        val board = Regex("^https?://([^/?#]+)/([^/?#]+)/?$").find(u)
        if (board != null && !board.groupValues[2].contains('.')) {
            val bu = "https://${board.groupValues[1]}/${board.groupValues[2]}/"
            openBoard(favorites.firstOrNull { it.url == bu } ?: Board(bu, board.groupValues[2]), root = true)
            return true
        }
        return false
    }

    fun deleteLog(page: Page.Thread) {
        viewModelScope.launch {
            db.deleteThread(page.summary)
            back()
            toast = "ログを削除しました"
        }
    }

    // ── 書き込み ──

    /** 書き込み欄を開く。insert(「>>12」など)があれば本文の最後に足す */
    fun openReply(page: Page.Thread, insert: String? = null) {
        val r = page.reply
        viewModelScope.launch {
            if (!r.draftLoaded) {
                r.draftLoaded = true
                if (r.body.isEmpty()) r.body = db.draft(page.summary)
            }
            if (insert != null) r.body = if (r.body.isEmpty() || r.body.endsWith("\n")) r.body + insert else r.body + "\n" + insert
            r.notice = null
            r.open = true
        }
    }

    /** 選んだ画像を catbox に上げて、本文の最後に URL を足す(書き込みとスレ立てで共通) */
    fun attach(r: ReplyState, uri: android.net.Uri) {
        if (r.uploading) return
        r.uploading = true
        r.notice = null
        viewModelScope.launch {
            try {
                val url = io.github.yumekui8.bbsnative.data.Uploader.upload(getApplication(), uri, prefs.uploadMaxDimension)
                r.body = if (r.body.isEmpty() || r.body.endsWith("\n")) r.body + url else r.body + "\n" + url
            } catch (e: Exception) {
                r.notice = e.message ?: "アップロードできませんでした"
            } finally {
                r.uploading = false
            }
        }
    }

    fun saveDraft(page: Page.Thread) {
        viewModelScope.launch { db.saveDraft(page.summary, page.reply.body) }
    }

    /** 長押しの「「草」とすぐ書き込む」: >>番号 と定型文を、書き込み欄を開かずに送る(今のスマホ版と同じ) */
    fun quickPost(page: Page.Thread, no: Int, phrase: String) {
        val r = page.reply
        if (r.sending) return
        val body = ">>$no\n$phrase"
        val mail = if (r.sage) "sage" else ""
        handlePost(page, body, r.name, mail, quick = true) { TwoCh.createPost(page.summary, PostInput(r.name, mail, body)) }
    }

    fun send(page: Page.Thread) {
        val r = page.reply
        if (r.sending || r.body.isBlank()) return
        val body = r.body
        val mail = if (r.sage) "sage" else ""
        prefs.postName = r.name
        handlePost(page, body, r.name, mail) { TwoCh.createPost(page.summary, PostInput(r.name, mail, body)) }
    }

    /** 5ch の書き込み確認で承諾した */
    fun acceptConfirm(page: Page.Thread) {
        val c = page.reply.confirm ?: return
        page.reply.confirm = null
        handlePost(page, page.reply.body, page.reply.name, if (page.reply.sage) "sage" else "") { TwoCh.submitConfirm(c) }
    }

    /** quick: 長押しの「すぐ書き込む」(書き込み欄の下書きは消さず、うまくいかなければ知らせで出す) */
    private fun handlePost(page: Page.Thread, body: String, name: String, mail: String, quick: Boolean = false, send: suspend () -> PostResult) {
        val r = page.reply
        viewModelScope.launch {
            r.sending = true
            r.notice = null
            try {
                when (val res = send()) {
                    is PostResult.Ok -> {
                        if (!quick) {
                            r.body = ""
                            r.open = false
                            db.saveDraft(page.summary, "")
                        }
                        toast = "書き込みました"
                        refreshThread(page)?.join()
                        // 自分の書き込みを覚える。番号が返らない掲示板では、新着から同じ本文の一番新しいレスを探す
                        val no = res.resNumber ?: page.index.posts.lastOrNull { it.body.trim() == body.trim() }?.no
                        if (no != null) {
                            db.addOwnPost(page.summary, no)
                            page.ownNos = page.ownNos + no
                        }
                        db.addPostHistory(page.summary, page.title, no, name, mail, body)
                    }
                    is PostResult.Auth -> r.auth = res
                    is PostResult.Confirm -> r.confirm = res
                    is PostResult.Error -> if (quick) toast = res.message else r.notice = res.message
                }
            } catch (e: Exception) {
                if (quick) toast = "書き込めませんでした: ${e.message ?: e}" else r.notice = "書き込めませんでした: ${e.message ?: e}"
            } finally {
                r.sending = false
            }
        }
    }

    /** スレを立てる。立てたら一覧を取り直し、同じスレタイのスレを開く */
    fun createThread(page: Page.Threads) {
        val r = page.newThread
        if (r.sending || r.title.isBlank() || r.body.isBlank()) return
        val mail = if (r.sage) "sage" else ""
        prefs.postName = r.name
        viewModelScope.launch {
            r.sending = true
            r.notice = null
            try {
                when (val res = TwoCh.createThread(page.board, r.title, PostInput(r.name, mail, r.body))) {
                    is PostResult.Ok -> {
                        val title = r.title.trim()
                        r.title = ""
                        r.body = ""
                        r.open = false
                        toast = "スレを立てました"
                        page.threads = TwoCh.listThreads(page.board)
                        page.threads.firstOrNull { it.title.trim() == title }?.let { openThread(it) }
                    }
                    is PostResult.Auth -> r.auth = res
                    is PostResult.Confirm -> r.confirm = res
                    is PostResult.Error -> r.notice = res.message
                }
            } catch (e: Exception) {
                r.notice = "立てられませんでした: ${e.message ?: e}"
            } finally {
                r.sending = false
            }
        }
    }
}
