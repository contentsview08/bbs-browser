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
import io.github.yumekui8.bbsnative.ui.PostLinks
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
    }

    /** 左のメニューに出すもの(お気に入り板・閲覧履歴・お気に入りのスレ)を読み直す */
    fun reloadSide() {
        viewModelScope.launch {
            favorites = db.favorites()
            history = db.history()
            favThreads = db.favoriteThreads()
        }
    }

    /** スレ一覧に戻る前に見ていたスレ(「進む」で開き直す) */
    private var forwardPage: Page.Thread? = null
    val canForward get() = forwardPage != null

    fun back(): Boolean {
        if (stack.size <= 1) return false
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
        stack.add(p)
    }

    /** 左のメニューから開く(積み重ねを入れ替える) */
    fun openRoot(page: Page) {
        drawerOpen = false
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

    fun loadBoards(refresh: Boolean = false) {
        if (boardsLoading) return
        viewModelScope.launch {
            boardsLoading = true
            boardsError = null
            try {
                val (menuUrl, _) = db.siteMenuUrls().firstOrNull() ?: return@launch
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
                page.openAt = when {
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
    fun refreshThread(page: Page.Thread, firstOpen: Boolean = false): Job? {
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
                    if (firstOpen && log == null) page.openAt = 1
                } else if (!firstOpen) toast = "新着はありません"
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
        val noname = TwoCh.cachedNoname(page.summary.boardUrl)
        val result = withContext(Dispatchers.Default) {
            val i = PostIndex.build(posts)
            Triple(i, renderPosts(i, page.links, noname), ngOf(posts, rules))
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
                val url = io.github.yumekui8.bbsnative.data.Uploader.upload(getApplication(), uri)
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

    private fun handlePost(page: Page.Thread, body: String, name: String, mail: String, send: suspend () -> PostResult) {
        val r = page.reply
        viewModelScope.launch {
            r.sending = true
            r.notice = null
            try {
                when (val res = send()) {
                    is PostResult.Ok -> {
                        r.body = ""
                        r.open = false
                        db.saveDraft(page.summary, "")
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
                    is PostResult.Error -> r.notice = res.message
                }
            } catch (e: Exception) {
                r.notice = "書き込めませんでした: ${e.message ?: e}"
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
