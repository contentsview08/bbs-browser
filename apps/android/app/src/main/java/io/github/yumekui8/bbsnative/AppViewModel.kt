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
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.PostIndex
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import io.github.yumekui8.bbsnative.bbs.TwoCh
import io.github.yumekui8.bbsnative.data.HistoryEntry
import io.github.yumekui8.bbsnative.data.LogDb
import io.github.yumekui8.bbsnative.data.ThreadState
import io.github.yumekui8.bbsnative.ui.PostLinks
import io.github.yumekui8.bbsnative.ui.RenderedPost
import io.github.yumekui8.bbsnative.ui.renderPosts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 画面の積み重ね(戻るで 1 つ前へ) */
sealed interface Page {
    data object Home : Page
    class Threads(val board: Board) : Page {
        var threads by mutableStateOf<List<ThreadSummary>>(emptyList())
        var states by mutableStateOf<Map<String, ThreadState>>(emptyMap())
        var loading by mutableStateOf(false)
        var error by mutableStateOf<String?>(null)
    }
    class Thread(val summary: ThreadSummary) : Page {
        var title by mutableStateOf(summary.title)
        var index by mutableStateOf(PostIndex.build(emptyList()))
        /** 組み立て済みのレス(レス番号 → 頭の行と本文)。index と一緒に作る */
        var rendered by mutableStateOf<Map<Int, RenderedPost>>(emptyMap())
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
    }
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val db = LogDb(app)

    val stack = mutableStateListOf<Page>(Page.Home)

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

    init {
        viewModelScope.launch { favorites = db.favorites() }
        viewModelScope.launch { history = db.history() }
    }

    fun back(): Boolean {
        if (stack.size <= 1) return false
        stack.removeAt(stack.lastIndex)
        // 戻ったスレ一覧・ホームの未読の数を新しくする
        when (val top = stack.last()) {
            is Page.Threads -> viewModelScope.launch { top.states = db.threadStates(top.board.url) }
            is Page.Home -> viewModelScope.launch { history = db.history() }
            else -> {}
        }
        return true
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

    fun toggleFavorite(board: Board) {
        viewModelScope.launch {
            db.setFavorite(board, favorites.none { it.url == board.url })
            favorites = db.favorites()
        }
    }

    // ── スレ一覧 ──

    fun openBoard(board: Board) {
        val page = Page.Threads(board)
        stack.add(page)
        refreshBoard(page)
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
        val page = Page.Thread(t)
        stack.add(page)
        viewModelScope.launch {
            // 手元のログを先に出し、そのあと新着を取りに行く
            val log = db.loadThread(t)
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

    fun refreshThread(page: Page.Thread, firstOpen: Boolean = false) {
        if (page.loading) return
        viewModelScope.launch {
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
                }
            } catch (e: Exception) {
                page.error = e.message ?: e.toString()
            } finally {
                page.loaded = true
                page.loading = false
            }
        }
    }

    /** レスの下ごしらえと組み立てを、画面とは別のスレッドで済ませてから入れる */
    private suspend fun setPosts(page: Page.Thread, posts: List<Post>) {
        val (index, rendered) = withContext(Dispatchers.Default) {
            val i = PostIndex.build(posts)
            i to renderPosts(i, page.links)
        }
        page.rendered = rendered
        page.index = index
    }

    fun markRead(page: Page.Thread, no: Int) {
        if (no <= page.readNo) return
        page.readNo = no
        viewModelScope.launch { db.markRead(page.summary, no) }
    }

    fun deleteLog(page: Page.Thread) {
        viewModelScope.launch {
            db.deleteThread(page.summary)
            back()
        }
    }
}
