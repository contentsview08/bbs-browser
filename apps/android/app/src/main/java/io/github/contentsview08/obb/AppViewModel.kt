package io.github.contentsview08.obb

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.FetchStatus
import io.github.contentsview08.obb.bbs.NextThreadCandidate
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.PostIndex
import io.github.contentsview08.obb.bbs.PostInput
import io.github.contentsview08.obb.bbs.PostResult
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.HonoBbs
import io.github.contentsview08.obb.bbs.Shitaraba
import io.github.contentsview08.obb.bbs.Machi
import io.github.contentsview08.obb.bbs.TwoCh
import io.github.contentsview08.obb.bbs.UrlRoute
import io.github.contentsview08.obb.ui.mostCommonName
import io.github.contentsview08.obb.bbs.findNextThreads
import io.github.contentsview08.obb.data.HistoryEntry
import io.github.contentsview08.obb.data.Http
import io.github.contentsview08.obb.data.LogDb
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.PostHistoryEntry
import io.github.contentsview08.obb.data.Prefs
import io.github.contentsview08.obb.data.ThreadState
import io.github.contentsview08.obb.data.unreadEntries
import io.github.contentsview08.obb.ui.Palette
import io.github.contentsview08.obb.ui.PostLinks
import io.github.contentsview08.obb.ui.RenderOptions
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import io.github.contentsview08.obb.ui.RenderedPost
import io.github.contentsview08.obb.ui.RenderMemo
import io.github.contentsview08.obb.ui.renderPostsReusing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 読んでいた位置(offset はレスの中のずれ、bottom は一番下にいたか) */
data class ScrollPos(val no: Int, val offset: Int, val bottom: Boolean)

/** 読み込めなかった理由を、人に分かる言葉にする(通信の失敗は英語の決まり文句なので言い換える) */
fun loadErrorText(e: Throwable): String = when (e) {
    is java.net.UnknownHostException -> "ネットにつながっていないか、掲示板のサーバーが見つかりません(${e.message?.substringAfter('"')?.substringBefore('"') ?: ""})"
    is java.net.ConnectException -> "掲示板のサーバーにつながりませんでした"
    is java.net.SocketTimeoutException -> "掲示板のサーバーから時間内に返事がありませんでした"
    is javax.net.ssl.SSLException -> "安全な通信を始められませんでした(${e.message ?: "SSL"})"
    else -> e.message ?: e.toString()
}

/** 書き込み欄の状態(スレごと、スレ立てでも使う)。boardUrl: 書き込む板(画像の上げ先を板で選ぶ。hono-bbs の板は、その掲示板の画像の置き場) */
class ReplyState(val boardUrl: String = "") {
    /** 本文の欄に入っている(書いている)。書いている間はフッターを隠さない */
    var open by mutableStateOf(false)
    var name by mutableStateOf("")
    /** メール(sage など)。オプションの欄で書く */
    var mail by mutableStateOf("")
    var sage: Boolean
        get() = mail.trim().equals("sage", true)
        set(v) { mail = if (v) "sage" else "" }
    /** 本文の欄に入る(返信・書き込むのジェスチャー)・出る(書き込めたとき)を頼む。数が変わったら画面が応える */
    var focusSeq by mutableStateOf(0)
    var blurSeq by mutableStateOf(0)
    /** 本文を AA 用の字で出すか(＋ のメニューで選んだもの。null なら本文から見分ける) */
    var aaOverride by mutableStateOf<Boolean?>(null)
    /** 書き込めたときの知らせ(少しで消す) */
    var done by mutableStateOf<String?>(null)
    var title by mutableStateOf("")
    var body by mutableStateOf("")
    var sending by mutableStateOf(false)
    /** 選んだ画像の上げ具合(選んだ順。上げ終わったものも、本文のサムネイルを端末の画像で出すために残す) */
    val uploads = androidx.compose.runtime.mutableStateListOf<UploadItem>()
    /** 開いているサイトの画面(ui/WebUpload.kt) */
    var webUpload by mutableStateOf<io.github.contentsview08.obb.ui.WebUploadJob?>(null)
    /** 選んだばかりで、上げる前の確かめ(どれを上げるか・スレタイと URL を描き込むか)を待っている画像 */
    var pendingPick by mutableStateOf<List<android.net.Uri>?>(null)
    /** 画像を上げているところ(待っている画像も含む) */
    val uploading: Boolean get() = uploads.any { it.state is UploadItem.State.Waiting || it.state is UploadItem.State.Uploading }
    /** 上げ終わった URL → 端末の画像(サムネイルをすぐ出すため) */
    fun localOf(url: String): android.net.Uri? = uploads.firstOrNull { (it.state as? UploadItem.State.Done)?.url == url }?.uri
    /** 結果の知らせ(書き込めた・エラー) */
    var notice by mutableStateOf<String?>(null)
    /** エッヂの認証待ち(ブラウザで開く URL と認証コード) */
    var auth by mutableStateOf<PostResult.Auth?>(null)
    /** 5ch の書き込み確認(承諾したら送り直す) */
    var confirm by mutableStateOf<PostResult.Confirm?>(null)
    /** 確認の出た書き込みの中身。承諾で送るのは confirm の fields なので、書き込み欄の本文とは限らない(すぐ書き込むの定型文など) */
    var confirmPost: ConfirmPost? = null
    var draftLoaded = false
}

class ConfirmPost(val body: String, val name: String, val mail: String, val quick: Boolean)

/** 書き込み欄で選んだ画像 1 枚(stamp は上げる前の確かめで選んだ描き込み) */
class UploadItem(val uri: android.net.Uri, val stamp: io.github.contentsview08.obb.data.Uploader.Stamp? = null) {
    sealed interface State {
        data object Waiting : State
        data object Uploading : State
        data class Done(val url: String) : State
        data class Failed(val message: String) : State
    }
    var state by mutableStateOf<State>(State.Waiting)
    /** 今回まとめて上げている 1 枚か(何枚目かを数える) */
    var inBatch = true
}

/** 画面の積み重ね(戻るで 1 つ前へ)。左のメニューから開くものは、積み重ねを入れ替える */
sealed interface Page {
    class Threads(val board: Board) : Page {
        // 画面の状態(タブ・検索・スクロールの位置)は画面ではなくここに持つ。スレを開いて戻っても、そのまま残るように
        val listState = androidx.compose.foundation.lazy.LazyListState()
        var tab by mutableStateOf<String?>(null)
        var searching by mutableStateOf(false)
        var query by mutableStateOf("")
        var threads by mutableStateOf<List<ThreadSummary>>(emptyList())
        var states by mutableStateOf<Map<String, ThreadState>>(emptyMap())
        var loading by mutableStateOf(false)
        var error by mutableStateOf<String?>(null)
        /** スレ一覧を取り直した回数(取り直したら一覧の一番上へ戻す)と、もう一番上へ戻した回 */
        var refreshed by mutableStateOf(0)
        var scrolledFor = 1
        /** 並べ替え(勢い順など)の向き。true なら逆順 */
        var reversed by mutableStateOf(false)
        /** 「新」の印を付ける境目の時刻(前回この板の一覧を取った時刻)。初めての板なら null */
        var newSince by mutableStateOf<Long?>(null)
        /** 差分の行から絞り込んだ: "new"(新しく立ったスレ)/ null */
        var only by mutableStateOf<String?>(null)
        val newThread = ReplyState(board.url)
    }

    class Thread(val summary: ThreadSummary) : Page {
        // 画面の状態(スクロールの位置・絞り込み・検索・読んだところの覚え)はここに持つ。一覧へ戻って「進む」で開き直しても、そのまま残るように
        val listState = androidx.compose.foundation.lazy.LazyListState()
        val scroll = io.github.contentsview08.obb.ui.ThreadScrollCtl(this)
        var filter by mutableStateOf<io.github.contentsview08.obb.bbs.Filter?>(null)
        var searching by mutableStateOf(false)
        var query by mutableStateOf("")
        var title by mutableStateOf(summary.title)
        var index by mutableStateOf(PostIndex.build(emptyList()))
        /** 組み立て済みのレス(レス番号 → 頭の行と本文)。index と一緒に作る */
        var rendered by mutableStateOf<Map<Int, RenderedPost>>(emptyMap())
        /** 前回の組み立て(次の組み立てで使い回す) */
        var renderMemo: RenderMemo? = null
        /** NG に当たるレスの番号(あぼーんと出す) */
        var ngNos by mutableStateOf<Set<Int>>(emptySet())
        /** AI NG に当たったレス(data/AiNg.kt)。ふつうの NG とは別に持つ */
        var aiNg by mutableStateOf<Map<Int, io.github.contentsview08.obb.data.AiHit>>(emptyMap())
        /** レスの中の押せるところの呼び先(画面が関数を入れる) */
        val links = PostLinks()
        /** 開いた時点の「最初の未読」(「ここから未読」の線を引く位置)。0 なら線を引かない */
        var unreadFrom by mutableStateOf(0)
        /** 画像の札を押して、URL を本文に広げたレス */
        val expandedImages = androidx.compose.runtime.mutableStateListOf<Int>()
        var loaded by mutableStateOf(false)
        var loading by mutableStateOf(false)
        var archived by mutableStateOf(false)
        var error by mutableStateOf<String?>(null)
        var readNo = 0
        /** 自分の書き込みのレス番号 */
        var ownNos by mutableStateOf<Set<Int>>(emptySet())
        /** いま書き込んだ本文(その取り直しで、自分宛ての知らせを出さないため) */
        var justPosted: String? = null
        var favorite by mutableStateOf(false)
        /** 開いたらこのレスへ飛ぶ(書き込み履歴・画像の「貼ったレス」・URL のレス番号から)。飛んだら null */
        var jumpNo by mutableStateOf<Int?>(null)
        /** 次スレの候補(探したら入る。null はまだ探していない) */
        var nextCandidates by mutableStateOf<List<NextThreadCandidate>?>(null)
        val reply = ReplyState(summary.boardUrl)
    }

    /** 板一覧(板を足す)。サイト → カテゴリ → 板 の順に入っていく。site・category は今いる段 */
    class Boards : Page {
        var site by mutableStateOf<String?>(null)
        var category by mutableStateOf<String?>(null)
    }
    class History : Page
    class FavThreads : Page
    /** 閲覧履歴のうち、新着のあるスレ */
    class AllUnread : Page
    class PostHistory : Page
    /** 上げた画像(履歴の「画像」) */
    class Uploads : Page
    /** start: 開いたときに出すページ("sites" など) */
    class Settings(val start: String? = null) : Page
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

    /** 閲覧履歴の全部(検索用。ふだんの一覧は新しい方から 300 件だけ) */
    suspend fun allHistory(): List<HistoryEntry> = db.history(Int.MAX_VALUE)

    /** クイックアクセス(最近見たスレ・書き込んだスレへさっと移る小さな画面)を出しているか */
    var quickOpen by mutableStateOf(false)

    fun openQuick() {
        quickOpen = true
        viewModelScope.launch { history = db.history(); postHistory = db.postHistory(); favThreads = db.favoriteThreads() }
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

    /**
     * スレごとの読んでいた位置(画面のいちばん上に見えていたレスとずれ、一番下にいたか)。戻って開き直したときに戻す。
     * 端末にも残し、アプリを開き直しても同じ所から読めるようにする
     */
    private val positionStore = app.getSharedPreferences("positions", android.content.Context.MODE_PRIVATE)
    private val positionCache = HashMap<String, ScrollPos?>()

    fun position(id: String): ScrollPos? = positionCache.getOrPut(id) {
        positionStore.getString(id, null)?.split(',')?.takeIf { it.size == 3 }?.let { ScrollPos(it[0].toInt(), it[1].toInt(), it[2] == "1") }
    }

    fun savePosition(id: String, pos: ScrollPos) {
        if (positionCache[id] == pos) return
        positionCache[id] = pos
        positionStore.edit().putString(id, "${pos.no},${pos.offset},${if (pos.bottom) 1 else 0}").apply()
    }

    /** 掲示板のスレ一覧で分かった、いまのレス数(スレの id → 数)。閲覧履歴・お気に入りのスレの新着に使う。-1 は dat 落ち */
    var remoteCounts by mutableStateOf<Map<String, Int>>(emptyMap())
        private set
    var checking by mutableStateOf(false)
        private set

    /** 未読のスレ(閲覧履歴のうち、新着のあるもの) */
    var allUnread by mutableStateOf<List<HistoryEntry>>(emptyList())
    /**
     * 未読: 閲覧履歴のうち、新着のあるスレ(PC 版・Web と同じ意味)。
     * 板ごとにスレ一覧を 1 回だけ取り、載っていればそのレス数を新しい数にする(dat を 1 つずつ取りに行かない)
     */
    fun loadAllUnread() {
        if (checking) return
        viewModelScope.launch {
            checking = true
            try {
                val hist = db.history()
                history = hist
                val counts = remoteCounts.toMutableMap()
                // hono-bbs のスレは、板ごとに一覧を取り直さず、まとめて 1 回で確かめる(POST /threads/status)
                val (hono, others) = hist.partition { HonoBbs.isBoardUrl(it.thread.boardUrl) }
                if (hono.isNotEmpty()) runCatching { HonoBbs.threadStatus(hono.map { it.thread }) }.onSuccess { st ->
                    for (h in hono) st[h.thread.key]?.let { counts[h.thread.id] = it.first }
                }
                val byBoard = others.groupBy { it.thread.boardUrl }
                for ((boardUrl, entries) in byBoard) {
                    val board = favorites.firstOrNull { it.url == boardUrl } ?: Board(boardUrl, boardUrl)
                    val threads = runCatching { TwoCh.listThreads(board) }.getOrNull() ?: continue
                    val live = threads.associateBy { it.key }
                    for (h in entries) {
                        val t = live[h.thread.key]
                        if (t != null) counts[h.thread.id] = t.postCount
                    }
                }
                remoteCounts = counts
                allUnread = unreadEntries(hist, counts)
            } finally {
                checking = false
            }
        }
    }

    /** 過去のスレの画面を、そのタブで開く(左のメニュー・下のタブ・画面の上のタブから) */
    fun openPast(tab: String) {
        prefs.pastTab = tab
        when (tab) {
            "unread" -> { openRoot(Page.AllUnread()); loadAllUnread() }
            "fav" -> openRoot(Page.FavThreads())
            "posts" -> openRoot(Page.PostHistory())
            "uploads" -> openRoot(Page.Uploads())
            else -> openRoot(Page.History())
        }
    }

    /** 書き込み履歴から 1 件消す(掲示板の書き込みは消えない) */
    fun deletePostHistory(e: PostHistoryEntry) {
        postHistory = postHistory.filter { it !== e }
        viewModelScope.launch { db.deletePostHistory(e); postHistory = db.postHistory() }
    }

    /** その画像を貼ったレス(書き込み履歴の本文に URL があるもの) */
    fun postedIn(url: String): PostHistoryEntry? = postHistory.firstOrNull { it.body.contains(url) }

    /** 未読のスレを、手元の既読で数え直す(読んだスレは外す。通信はしない) */
    private fun recountAllUnread() {
        viewModelScope.launch {
            val byBoard = allUnread.groupBy { it.thread.boardUrl }
            val out = ArrayList<HistoryEntry>()
            for ((url, list) in byBoard) {
                val states = db.threadStates(url)
                for (e in list) {
                    val r = states[e.thread.key]?.readNo ?: e.readNo
                    out += HistoryEntry(e.thread, r, e.readAt)
                }
            }
            allUnread = unreadEntries(out, remoteCounts)
        }
    }

    /** 閲覧履歴・お気に入りのスレの新着を確かめる(板ごとにスレ一覧を 1 回だけ読む) */
    fun checkNew(entries: List<HistoryEntry>) {
        if (checking || entries.isEmpty()) return
        viewModelScope.launch {
            checking = true
            val next = remoteCounts.toMutableMap()
            try {
                // hono-bbs のスレはまとめて 1 回で(POST /threads/status)。返らなかったものは -1(消えた)
                val (hono, others) = entries.partition { HonoBbs.isBoardUrl(it.thread.boardUrl) }
                if (hono.isNotEmpty()) runCatching { HonoBbs.threadStatus(hono.map { it.thread }) }.onSuccess { st ->
                    for (e in hono) next[e.thread.id] = st[e.thread.key]?.first ?: -1
                }
                for ((boardUrl, list) in others.groupBy { it.thread.boardUrl }) {
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
    /** アプリが見えているか(MainActivity の onStart・onStop)。見えていない間は、開いている間の定期確認を止める */
    var appVisible by mutableStateOf(true)
    val canForward get() = forwardPage != null

    /** なぞって戻っている途中の量(0〜1)。画面が指についてきて、後ろに前の画面が見える */
    var backDrag by mutableStateOf(0f)
    /** 画面の移り方の向き(1 開く・-1 戻る・0 入れ替え・2 なぞって戻り終えた: 動きなし)。積み重ねを変える直前に決める */
    var navDir = 0

    fun back(): Boolean {
        if (stack.size <= 1) return false
        navDir = -1
        forwardPage = stack.removeAt(stack.lastIndex) as? Page.Thread
        refreshTopAfterBack()
        return true
    }

    /** 戻った先の一覧の未読の数を新しくする */
    private fun refreshTopAfterBack() {
        when (val top = stack.last()) {
            is Page.Threads -> viewModelScope.launch { top.states = db.threadStates(top.board.url) }
            is Page.History, is Page.FavThreads -> reloadSide()
            is Page.AllUnread -> recountAllUnread()
            else -> {}
        }
    }

    /** たどってきた画面の名前(戻る先の一覧に出す) */
    fun pageName(p: Page): String = when (p) {
        is Page.Threads -> p.board.name
        is Page.Thread -> p.title.ifEmpty { p.summary.title }
        is Page.Boards -> "板を探す"
        is Page.History -> "閲覧履歴"
        is Page.FavThreads -> "お気に入りのスレ"
        is Page.AllUnread -> "未読のスレ"
        is Page.PostHistory -> "書き込み履歴"
        is Page.Uploads -> "上げた画像"
        is Page.Settings -> "設定"
    }

    /** 戻る先の一覧から選んだ画面まで、まとめて戻る */
    fun popTo(index: Int) {
        if (index !in 0 until stack.lastIndex) return
        navDir = -1
        forwardPage = stack.last() as? Page.Thread
        while (stack.lastIndex > index) stack.removeAt(stack.lastIndex)
        refreshTopAfterBack()
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
            is Page.AllUnread -> recountAllUnread()
            is Page.PostHistory, is Page.Uploads -> viewModelScope.launch { postHistory = db.postHistory() }
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

    /** hono-bbs のアカウントを保存する(空なら消す)。セッションは取り直す */
    fun setHonoAccount(user: String, password: String) {
        prefs.honoUser = user.trim()
        prefs.honoPassword = password
        HonoBbs.account = if (user.isNotBlank()) HonoBbs.Account(user.trim(), password) else null
        HonoBbs.clearSessions()
    }

    /** 知っている hono-bbs のサイト(web の origin)。この起動で読んだもの・開いている板・お気に入り板・サイト(BBS メニュー)に登録したものから */
    fun honoOrigins(): List<String> =
        (HonoBbs.knownOrigins() + listOfNotNull(prefs.lastBoardUrl?.let { HonoBbs.originOfBoard(it) }) +
            favorites.mapNotNull { HonoBbs.originOfBoard(it.url) } + sites.map { it.first }.mapNotNull { HonoBbs.originOfSite(it) }).distinct()

    fun selectSite(url: String) {
        siteUrl = url
        boards = emptyList()
        loadBoards()
    }

    /**
     * 最初から入れておく掲示板・板(assets の sites.json。PC 版と同じ packages/presets/sites.json)を足す。起動のたびに 1 回。
     * まだ足していない id のものだけを足し、足した id を覚える。板一覧は開いたときに取る
     */
    private suspend fun applyPresets() {
        val json = runCatching { getApplication<android.app.Application>().assets.open("sites.json").bufferedReader().use { it.readText() } }.getOrNull() ?: return
        val o = runCatching { org.json.JSONObject(json) }.getOrNull() ?: return
        val done = prefs.presetsApplied.split(',').filter { it.isNotEmpty() }.toMutableSet()
        val before = done.size
        val have = db.siteMenuUrls().map { it.first }.toSet()
        o.optJSONArray("sites")?.let { a ->
            for (i in 0 until a.length()) {
                val s = a.getJSONObject(i)
                val id = s.getString("id")
                if (id in done) continue
                if (s.getString("menu") !in have) db.addSite(s.getString("menu"), s.getString("name"))
                done += id
            }
        }
        o.optJSONArray("boards")?.let { a ->
            val favs = db.favorites().map { it.url }.toSet()
            for (i in 0 until a.length()) {
                val b = a.getJSONObject(i)
                val id = b.getString("id")
                if (id in done) continue
                if (b.getString("url") !in favs) db.setFavorite(Board(b.getString("url"), b.getString("name")), true)
                done += id
            }
        }
        if (done.size != before) {
            prefs.presetsApplied = done.joinToString(",")
            sites = db.siteMenuUrls()
            favorites = db.favorites()
        }
    }

    /** bbsmenu の URL を足す(読めるか確かめてから) */
    fun addSite(menuUrl: String, name: String) {
        viewModelScope.launch {
            try {
                // hono-bbs(web のトップ・板・API の URL のどれでも)なら、板の一覧の URL(https://…/boards)にそろえる
                // まちBBS(https://machi.to/)は、トップページから板の一覧を読む
                val url = if (menuUrl.contains("bbsmenu")) menuUrl.trim() else if (Machi.isSiteUrl(menuUrl)) "https://machi.to/" else HonoBbs.detectSite(menuUrl) ?: menuUrl.trim()
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

    /** お気に入り板を i 番目から j 番目へ(掴んで並べ替え) */
    fun moveFavorite(i: Int, j: Int) {
        val list = favorites.toMutableList()
        if (i !in list.indices || j !in list.indices) return
        list.add(j, list.removeAt(i))
        favorites = list
        viewModelScope.launch { db.reorderFavorites(list.map { it.url }) }
    }

    /** 画像をまとめて保存する(画像一覧を閉じても続ける) */
    fun saveImages(urls: List<String>) {
        toast = "${urls.size} 枚を保存しています…"
        viewModelScope.launch {
            val ok = io.github.contentsview08.obb.data.saveEach(urls) { io.github.contentsview08.obb.data.ImageSaver.save(getApplication<Application>(), it) }
            toast = "$ok 枚を保存しました" + if (ok < urls.size) "(${urls.size - ok} 枚は保存できませんでした)" else ""
        }
    }

    /** バックアップを書き出す: 設定・お気に入り板・お気に入りのスレ・サイト・NG(設定に入っている) */
    fun exportBackup(uri: android.net.Uri) {
        viewModelScope.launch {
            try {
                val o = io.github.contentsview08.obb.data.backupJson(prefs.export(), db.favorites(), db.favoriteThreads().map { it.thread }, db.siteMenuUrls())
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
                // 先に全部読む(途中の行が壊れていても、半分だけ戻さない)
                val b = io.github.contentsview08.obb.data.parseBackup(text)
                b.settings?.let { prefs.import(it) }
                for (x in b.boards) db.setFavorite(x, true)
                for (t in b.threads) db.setFavoriteThread(t, t.title, true)
                for ((u, n) in b.sites) db.addSite(u, n)
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
        prefs.addRecentBoard(board.url, board.name)
        refreshBoard(page)
        // 板の既定の名前を先に読んでおく(スレを開いたとき、待たずに名無しを省けるように)
        viewModelScope.launch { TwoCh.nonameName(board.url) }
    }

    /** スレ一覧を取り直す。取り直しの印が一瞬で消えて、取れたか分からなくならないよう、印は 0.8 秒は出しておく */
    fun refreshBoard(page: Page.Threads): Job? {
        if (page.loading) return null
        return viewModelScope.launch {
            page.loading = true
            page.error = null
            val start = System.currentTimeMillis()
            try {
                val list = TwoCh.listThreads(page.board)
                page.states = db.threadStates(page.board.url)
                // 前回この板の一覧を取った時刻より後に立ったスレに「新」の印を付ける。今回の時刻を次のために覚える
                page.newSince = prefs.boardVisit(page.board.url)
                prefs.setBoardVisit(page.board.url, System.currentTimeMillis())
                page.threads = list
                page.refreshed++
            } catch (e: Exception) {
                page.error = loadErrorText(e)
            } finally {
                val left = 800 - (System.currentTimeMillis() - start)
                if (left > 0) kotlinx.coroutines.delay(left)
                page.loading = false
            }
        }
    }

    // ── スレ ──

    /** no: 開いたらそのレスへ飛ぶ(書き込み履歴・画像の「貼ったレス」・URL のレス番号から) */
    fun openThread(t: ThreadSummary, no: Int? = null) {
        drawerOpen = false
        val page = Page.Thread(t)
        page.jumpNo = no
        forwardPage = null
        navDir = 1
        stack.add(page)
        // 板ごとの設定に名前欄・メール欄の既定値があれば、そちらを入れる
        val meta = prefs.boardMeta[t.boardUrl]
        page.reply.name = meta?.defaultName ?: prefs.postName
        page.reply.mail = meta?.defaultMail ?: prefs.postMail
        viewModelScope.launch {
            // 手元のログを先に出し、そのあと新着を取りに行く
            val log = db.loadThread(t)
            page.ownNos = db.ownPosts(t)
            page.favorite = db.isFavoriteThread(t)
            if (log != null) {
                page.title = log.title
                page.readNo = log.readNo
                page.archived = log.archived
                // 「ここから未読」は、開いた時点の既読の次(まだ手元にないときは、届いた新着の頭に線が出る)。
                // 開く位置は画面が決める(レスが出たときに、覚えた位置・設定・未読から)ので、レスより先に入れておく
                page.unreadFrom = log.readNo + 1
                setPosts(page, log.posts)
                db.touch(t)
            }
            page.loaded = log != null
            refreshThread(page, firstOpen = true)
        }
    }

    /** 新着を取る。取り直しの最中なら何もしない(null)。終わりを待つときは返した Job を join する。quiet: 自動更新から呼ぶとき(今は動きを変えない) */
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
                // 手元にログのあるスレに届いた新着なら、あなた宛てを知らせる(全部取り直したときと、初めて開くスレは知らせない)
                if (log != null && r.status != FetchStatus.RESET && r.posts.isNotEmpty()) {
                    runCatching { io.github.contentsview08.obb.data.Crawler.notifyReplies(getApplication(), prefs, t, title, r.posts, page.ownNos, page.justPosted) }
                }
                page.title = title
                if (r.status == FetchStatus.ARCHIVED || r.archived) page.archived = true
                // 「ここから未読」は、更新したときにその時点の既読の次へ引き直す(開いたときの取得では動かさない)
                if (!firstOpen) page.unreadFrom = page.readNo + 1
                if (r.posts.isNotEmpty() || r.status == FetchStatus.RESET) {
                    val old = if (r.status == FetchStatus.RESET) emptyList() else renderSeq[page]?.second ?: page.index.posts
                    // 同じ番号が 2 回入らないように(差分の取得で重なって返る掲示板があると、スレ表示の LazyColumn のキーが重なって落ちる)
                    val all: List<Post> = (old + r.posts).distinctBy { it.no }
                    setPosts(page, all)
                }
            } catch (e: Exception) {
                page.error = loadErrorText(e)
            } finally {
                page.loaded = true
                page.loading = false
            }
        }
    }

    /**
     * スレごとの組み立ての通し番号。設定を変えたときの組み立て直しと新着の取り込みが重なると、遅れて終わった古い並びが
     * 新着を上書きして、届いたレスが抜け落ちる。最後に頼んだ組み立てだけを入れ、組み立て直しは最後に頼んだ並びで行う
     */
    private val renderSeq = java.util.WeakHashMap<Page.Thread, Pair<Int, List<Post>>>()

    /** レスの下ごしらえと組み立て(と NG の判定)を、画面とは別のスレッドで済ませてから入れる */
    private suspend fun setPosts(page: Page.Thread, posts: List<Post>) {
        val seq = (renderSeq[page]?.first ?: 0) + 1
        renderSeq[page] = seq to posts
        val rules = prefs.ngRules
        // 板の既定の名前(名無し)は省いて出す。読み終えていなければ(待つと表示が遅れるので)そのまま。
        // 板ごとの設定で、省くかどうかと、ほかに名無しとみなす名前を変えられる
        val meta = prefs.boardMeta[page.summary.boardUrl]
        val omit = meta?.omitNoname ?: prefs.omitNoname
        val noname = if (omit) TwoCh.cachedNoname(page.summary.boardUrl) else null
        // そのスレで一番多い名前も名無しとみなす(板の既定の名前は、使っていない掲示板が多い。PC・Web と同じ)
        val common = if (omit) mostCommonName(posts) else null
        val o = renderOptions(noname).copy(extraNonames = if (omit) meta?.nonames.orEmpty() + listOfNotNull(common) else emptyList())
        val collapse = prefs.tidyBlankLines
        val gross = if (prefs.blurGross) prefs.grossWords.lines().map { it.trim() }.filter { it.isNotEmpty() } else emptyList()
        val oldIndex = page.index
        val oldMemo = page.renderMemo
        val result = withContext(Dispatchers.Default) {
            val i = PostIndex.build(posts, collapse, gross, oldIndex)
            Triple(i, renderPostsReusing(i, page.links, o, oldMemo), ngOf(posts, rules, page.summary.boardUrl))
        }
        if (renderSeq[page]?.first != seq) return
        page.renderMemo = result.second
        page.rendered = result.second.rendered
        page.ngNos = result.third
        page.index = result.first
    }

    /** NG に当たるレスの番号(data/Ng.kt の NgMatcher。boardUrl はこのスレの板。「この板だけ」の NG を当てる) */
    private fun ngOf(posts: List<Post>, rules: List<NgRule>, boardUrl: String): Set<Int> {
        val m = io.github.contentsview08.obb.data.NgMatcher(rules)
        if (m.isEmpty) return emptySet()
        return posts.filter { m.post(it, boardUrl) }.map { it.no }.toSet()
    }

    // ── AI NG ──

    /** このスレの板に効く AI NG の条件(使っていなければ空) */
    fun aiRulesFor(page: Page.Thread) =
        if (prefs.aiNgEnabled) io.github.contentsview08.obb.data.activeRules(prefs.aiNgRules, page.summary.boardUrl) else emptyList()

    /** 印から学んだ判定(印が変わったときだけ学び直す) */
    private var learned: Pair<Map<String, io.github.contentsview08.obb.data.AiNgOverride>, Map<String, io.github.contentsview08.obb.data.RuleModel>>? = null

    /** スレのレスを判定し直す(当たり具合のないものはモデルに頼む)。当たり具合が届くたびに呼ぶ */
    fun applyAiNg(page: Page.Thread) {
        val rules = aiRulesFor(page)
        if (rules.isEmpty()) { page.aiNg = emptyMap(); return }
        val posts = page.index.posts
        val overrides = prefs.aiNgOverrides
        // 学ぶのは全部の条件について(有効な条件だけだと、あとで有効にした条件の判定が印を付け直すまで学ばれない)
        val allRules = prefs.aiNgRules
        viewModelScope.launch {
            val result = withContext(Dispatchers.Default) {
                val models = learned?.takeIf { it.first === overrides }?.second
                    ?: io.github.contentsview08.obb.data.trainRules(allRules, overrides).also { learned = overrides to it }
                // スレの話題(スレタイと 1 レス目の頭)。文脈つきの条件に添える
                val context = io.github.contentsview08.obb.data.threadContextOf(page.title, posts.firstOrNull()?.body)
                io.github.contentsview08.obb.data.AiModel.request(posts.asReversed(), rules.map { it.prompt }, rules.map { if (it.withContext) context else null })
                io.github.contentsview08.obb.data.judgeAiNg(posts, rules, io.github.contentsview08.obb.data.AiModel::scoreOf, overrides, models, context)
            }
            page.aiNg = result
        }
    }

    /** AI NG の手の印(true: 当たる・false: 当たらない・null: 外す) */
    fun markAi(p: Post, ruleId: String, mark: Boolean?) {
        prefs.setAiOverrides(io.github.contentsview08.obb.data.setOverride(prefs.aiNgOverrides, ruleId, p.body, mark))
        toast = when (mark) { true -> "AI NG に当たる、と印を付けました"; false -> "AI NG に当たらない、と印を付けました"; null -> "印を外しました" }
    }

    /** 自分のレスの印を手で付ける・外す。sameId なら、このスレの同じ ID のレスすべて */
    fun markOwn(page: Page.Thread, p: Post, own: Boolean, sameId: Boolean) {
        val nos = if (sameId && p.id != null) page.index.posts.filter { it.id == p.id }.map { it.no } else listOf(p.no)
        viewModelScope.launch {
            db.setOwnPosts(page.summary, nos, own)
            page.ownNos = if (own) page.ownNos + nos else page.ownNos - nos.toSet()
            toast = if (own) "自分のレスの印を付けました" else "自分のレスの印を外しました"
        }
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

    /** NG を直す(同じ id を差し替える)・まとめて置き換える */
    fun saveNg(rule: NgRule) {
        prefs.addNg(rule)
        reapplyNg()
    }

    fun setNg(list: List<NgRule>) {
        prefs.setNg(list)
        reapplyNg()
    }

    /** 設定画面の見本のレス(ui/SettingParts.kt)を、スレ表示と同じ設定で組み立てる */
    fun sampleRenderOptions(noname: String?) = renderOptions(noname)

    private fun renderOptions(noname: String?) = RenderOptions(
        noname = noname, highlightOp = prefs.highlightOp, idColor = prefs.idStyle == "color", urlShorten = prefs.urlShorten,
        style = prefs.postStyle, heatText = prefs.heatStyle == "text", onSky = Palette.onSky(prefs.postStyle),
        dateStyle = prefs.dateStyle, idShort = prefs.idShort, idPosition = prefs.idPosition, watchoiShort = prefs.watchoiShort, nameSubtle = prefs.nameSubtle,
    )

    /**
     * レスの見せ方に関わる設定と配色。変わったら、開いているスレを組み立て直す(設定画面から戻ったときに、もう新しい見た目になっている)
     */
    private fun renderKey() = listOf(
        prefs.omitNoname, prefs.tidyBlankLines, prefs.highlightOp, prefs.idStyle, prefs.dateStyle, prefs.idShort, prefs.idPosition, prefs.watchoiShort, prefs.nameSubtle, prefs.urlShorten,
        prefs.blurGross, prefs.grossWords, Palette.scheme.key, prefs.postStyle, prefs.heatStyle, prefs.boardMeta,
    )

    /** 組み立て直すスレ(開いているものと、「進む」で開き直すもの) */
    private fun threadPages() = stack.filterIsInstance<Page.Thread>() + listOfNotNull(forwardPage)

    private fun rerenderAll() {
        for (p in threadPages()) if (p.loaded) viewModelScope.launch { setPosts(p, renderSeq[p]?.second ?: p.index.posts) }
    }

    private fun reapplyNg() {
        val rules = prefs.ngRules
        for (p in threadPages()) viewModelScope.launch { p.ngNos = withContext(Dispatchers.Default) { ngOf(p.index.posts, rules, p.summary.boardUrl) } }
    }

    fun markRead(page: Page.Thread, no: Int) {
        if (no <= page.readNo) return
        page.readNo = no
        // 開いている一覧(板のスレ一覧・未読のスレ)の既読も合わせる。古いままだと「次の未読スレへ」が読み終えたスレへ戻ってループする
        val t = page.summary
        for (p in stack) if (p is Page.Threads && p.board.url == t.boardUrl) {
            val st = p.states[t.key]
            p.states = p.states + (t.key to (st?.copy(readNo = maxOf(st.readNo, no)) ?: ThreadState(no, page.index.posts.size)))
        }
        if (allUnread.any { it.thread.id == t.id }) allUnread = allUnread.map { if (it.thread.id == t.id) HistoryEntry(it.thread, maxOf(it.readNo, no), it.readAt) else it }
        // 変わるものがないときは書き換えない(読み手全員を作り直さない)
        if (history.any { it.thread.id == t.id && it.readNo < no }) history = history.map { if (it.thread.id == t.id && it.readNo < no) HistoryEntry(it.thread, no, it.readAt) else it }
        if (favThreads.any { it.thread.id == t.id && it.readNo < no }) favThreads = favThreads.map { if (it.thread.id == t.id && it.readNo < no) HistoryEntry(it.thread, no, it.readAt) else it }
        viewModelScope.launch { db.markRead(page.summary, no) }
    }

    /**
     * 次の未読スレ(PC 版の「次の未読スレへ」): このスレを開いた一覧(板のスレ一覧・閲覧履歴・お気に入りのスレ)で、
     * このスレより後ろにある、新着のある読んだスレ。なければ一覧の頭から探す。一覧の名前と、スレと未読の数を返す
     */
    fun nextUnread(page: Page.Thread): Triple<String, ThreadSummary, Int>? {
        val i = stack.indexOf(page)
        val under = stack.getOrNull(i - 1) ?: return null
        fun unreadOf(h: HistoryEntry) = h.thread to maxOf(0, maxOf(h.thread.postCount, remoteCounts[h.thread.id] ?: 0) - h.readNo)
        val (name, list) = when (under) {
            is Page.Threads -> under.board.name to under.threads.map { t -> t to (under.states[t.key]?.let { maxOf(0, t.postCount - it.readNo) } ?: 0) }
            is Page.History -> "閲覧履歴" to history.map(::unreadOf)
            is Page.FavThreads -> "お気に入りのスレ" to favThreads.map(::unreadOf)
            is Page.AllUnread -> "未読のスレ" to allUnread.map(::unreadOf)
            else -> return null
        }
        val at = list.indexOfFirst { it.first.id == page.summary.id }
        val order = if (at >= 0) list.drop(at + 1) + list.take(at) else list
        val hit = order.firstOrNull { it.second > 0 && it.first.id != page.summary.id } ?: return null
        return Triple(name, hit.first, hit.second)
    }

    /** 次の未読スレを、今のスレと入れ替えて開く(戻ると一覧へ) */
    fun openNextUnread(page: Page.Thread, t: ThreadSummary) {
        val i = stack.indexOf(page)
        if (i >= 0) stack.removeAt(i)
        openThread(t)
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
            if (forwardPage?.summary?.id == t.id) forwardPage = null
            (stack.lastOrNull() as? Page.Threads)?.let { it.states = db.threadStates(it.board.url) }
            reloadSide()
            toast = "ログを削除しました"
        }
    }

    /** 履歴で選んだスレのログをまとめて削除 */
    fun deleteLogsOf(list: List<ThreadSummary>) {
        viewModelScope.launch {
            db.deleteThreads(list)
            if (list.any { it.id == forwardPage?.summary?.id }) forwardPage = null
            // スタックの下のスレ一覧も、既読の印を読み直す
            for (p in stack) if (p is Page.Threads) p.states = db.threadStates(p.board.url)
            reloadSide()
            toast = "${list.size} 件のログを削除しました"
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
                val title = page.title
                page.nextCandidates = withContext(Dispatchers.Default) { findNextThreads(page.summary, title, list) }
            } catch (e: Exception) {
                toast = "探せませんでした: ${e.message ?: e}"
                page.nextCandidates = emptyList()
            }
        }
    }

    fun openBoardOf(page: Page.Thread) {
        val url = page.summary.boardUrl
        openBoard(favorites.firstOrNull { it.url == url } ?: boards.firstOrNull { it.url == url } ?: Board(url, url.removePrefix("https://").trimEnd('/')), root = true)
    }

    /** 2ch 互換・hono-bbs・したらば・まちBBS のスレ・板の URL なら、アプリの中で開いて true。形の読み方は bbs/UrlRoute.kt */
    fun openUrl(url: String): Boolean {
        val u = url.trim()
        when (val r = UrlRoute.parse(u) ?: return false) {
            is UrlRoute.Itest -> viewModelScope.launch {
                // サーバー名が URL にないときは、itest の板のページから探す。分からなければブラウザで開く
                runCatching { TwoCh.itestServer(r.domain, r.board) }.onSuccess { openUrl(r.realUrl(it)) }.onFailure {
                    toast = "アプリでは開けないので、ブラウザで開きます"
                    openInOs(u)
                }
            }
            is UrlRoute.Thread -> if (r.site != UrlRoute.Site.TWOCH || knownBoard(r.thread.boardUrl) != null) openThread(r.thread, r.no) else viewModelScope.launch {
                // 形だけではスレか分からない。ログがあるか、板があると確かめられたら開く(PC 版の ensureBoard と同じ)。だめなら OS の既定のアプリへ
                val ok = db.loadThread(r.thread) != null || kotlinx.coroutines.withTimeoutOrNull(8000) { TwoCh.isBoard(r.thread.boardUrl) } == true
                if (ok) openThread(r.thread, r.no) else openInOs(u)
            }
            is UrlRoute.BoardPage -> openBoardPage(r, u)
        }
        return true
    }

    private fun knownBoard(boardUrl: String) = favorites.firstOrNull { it.url == boardUrl } ?: boards.firstOrNull { it.url == boardUrl }

    private fun openBoardPage(r: UrlRoute.BoardPage, u: String) {
        val bu = r.boardUrl
        knownBoard(bu)?.let { openBoard(it, root = false); return }
        val dir = bu.removeSuffix("/").substringAfterLast('/')
        viewModelScope.launch {
            val name = when (r.site) {
                UrlRoute.Site.HONO -> runCatching { HonoBbs.boardName(bu) }.getOrElse { toast = it.message ?: "hono-bbs の板を開けません"; return@launch } ?: dir
                UrlRoute.Site.SHITARABA -> runCatching { Shitaraba.boardName(bu) }.getOrElse { toast = it.message ?: "したらばの板を開けません"; return@launch }
                UrlRoute.Site.MACHI -> runCatching { Machi.boardName(bu) }.getOrElse { toast = it.message ?: "まちBBS の板を開けません"; return@launch }
                UrlRoute.Site.TWOCH -> {
                    // 形だけでは板か分からない(youtu.be/xxx も同じ形)。スレ一覧の形の応答なら板とする(スレが 0 件の板も開ける)。だめなら OS の既定のアプリへ
                    if (kotlinx.coroutines.withTimeoutOrNull(8000) { TwoCh.isBoard(bu) } != true) { openInOs(u); return@launch }
                    kotlinx.coroutines.withTimeoutOrNull(3000) { TwoCh.setting(bu)["BBS_TITLE"] }?.ifEmpty { null } ?: dir
                }
            }
            openBoard(Board(bu, name), root = false)
        }
    }

    /** OS の既定のアプリで開く(YouTube のリンクなら YouTube のアプリ) */
    private fun openInOs(url: String) {
        runCatching {
            getApplication<Application>().startActivity(
                android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.onFailure { toast = "開けるアプリがありません" }
    }

    fun deleteLog(page: Page.Thread) {
        viewModelScope.launch {
            db.deleteThread(page.summary)
            back()
            // 消したスレを「進む」で開き直さない
            forwardPage = null
            toast = "ログを削除しました"
        }
    }

    // ── 書き込み ──

    /** 本文の最後に、新しい行として足す */
    private fun withLine(body: String, line: String) = if (body.isEmpty() || body.endsWith("\n")) body + line else body + "\n" + line

    /** 書き込み欄を開く。insert(「>>12」など)があれば本文の最後に足す */
    fun openReply(page: Page.Thread, insert: String? = null) {
        val r = page.reply
        viewModelScope.launch {
            if (!r.draftLoaded) {
                r.draftLoaded = true
                if (r.body.isEmpty()) r.body = db.draft(page.summary)
            }
            if (insert != null) r.body = withLine(r.body, insert)
            r.notice = null
            r.focusSeq++
        }
    }

    /** サイトの画面で上げたリンクを履歴に残し、本文の終わりに 1 行で入れる(ui/WebUpload.kt)。hash は渡した画像と結びつくときだけ */
    fun insertLink(r: ReplyState, url: String, hash: String? = null) {
        prefs.addUpload(url, hash)
        if (r.body.contains(url)) return
        r.body = withLine(r.body, url + "\n")
        toast = "リンクを本文に入れました"
    }

    /**
     * 選んだ画像(一度に 10 枚まで)を 1 枚ずつ順番に上げ、上げ終わるたびに本文の最後に URL を足す(書き込みとスレ立てで共通)。
     * 上げている途中に選び足したら、列の後ろに並べる。上げ先は板で決める(hono-bbs の板はその掲示板の置き場、ほかは設定の上げ先。data/Uploader.kt)
     */
    fun attach(r: ReplyState, uris: List<android.net.Uri>, stamp: io.github.contentsview08.obb.data.Uploader.Stamp? = null) {
        if (uris.isEmpty()) return
        r.notice = null
        val site = siteFor(r)
        if (site != null) { attachViaSite(r, site, uris, stamp); return }
        val running = r.uploading
        if (!running) r.uploads.forEach { it.inBatch = false }
        r.uploads.removeAll { it.state is UploadItem.State.Failed }
        r.uploads += uris.take(10).map { UploadItem(it, stamp) }
        if (uris.size > 10) r.notice = "一度に上げられるのは 10 枚までです(先頭の 10 枚だけ上げます)"
        if (running) return
        viewModelScope.launch {
            while (true) {
                val item = r.uploads.firstOrNull { it.state is UploadItem.State.Waiting } ?: break
                item.state = UploadItem.State.Uploading
                try {
                    val api = HonoBbs.apiFor(r.boardUrl)
                    val up = io.github.contentsview08.obb.data.Uploader
                    val (name, type, bytes) = up.prepareFor(getApplication(), item.uri, prefs.uploadMaxDimension, item.stamp)
                    // 同じ中身の画像を前に上げていれば、上げずにその URL を使う(履歴のハッシュで引く)
                    val hash = up.sha256(bytes)
                    val sent = prefs.findUploadByHash(hash)?.let { it to null } ?: up.send(name, type, bytes, api, prefs.uploadHost, prefs.imgurClientId, prefs.imgbbApiKey).let { it.url to it.deleteUrl }
                    val (url, deleteUrl) = sent
                    // いつも最新の本文に足す(前の画像の URL を消さない)
                    r.body = withLine(r.body, url + "\n")
                    prefs.addUpload(url, hash, deleteUrl ?: prefs.uploadDeleteUrl(url))
                    item.state = UploadItem.State.Done(url)
                } catch (e: Exception) {
                    uploadFailed(r, item, e)
                } catch (e: OutOfMemoryError) {
                    uploadOutOfMemory(r, item)
                }
            }
        }
    }

    /** この板の上げ先がサイトの画面ならそのサイト(hono-bbs の板はその掲示板の置き場) */
    private fun siteFor(r: ReplyState) = if (HonoBbs.isBoardUrl(r.boardUrl)) null else io.github.contentsview08.obb.ui.webUploadSiteFor(prefs.uploadHost)

    /** 思いがけない失敗(メモリが足りないなど)も、理由を出して次の画像へ進む */
    private fun uploadFailed(r: ReplyState, item: UploadItem, e: Exception) {
        val msg = (e as? io.github.contentsview08.obb.data.Uploader.UploadException)?.message
            ?: "${e.javaClass.simpleName}${e.message?.let { ": $it" } ?: ""}"
        item.state = UploadItem.State.Failed(msg)
        r.notice = "画像を上げられませんでした: $msg。画像を押すと上げ直します"
    }

    private fun uploadOutOfMemory(r: ReplyState, item: UploadItem) {
        item.state = UploadItem.State.Failed("メモリが足りません")
        r.notice = "画像が大きすぎて読めませんでした(メモリが足りません)。設定の「大きい画像を縮める」を小さくしてください"
    }

    /**
     * 選んだ画像を整えて、サイトの画面へ渡す。前に上げた画像はその URL を本文に入れ、渡さない。
     * 合計が上限を超えたら理由を出し、画像を渡さずに開く(サイトの画面から手で選べる)
     */
    private fun attachViaSite(r: ReplyState, site: io.github.contentsview08.obb.ui.WebUploadSite, uris: List<android.net.Uri>, stamp: io.github.contentsview08.obb.data.Uploader.Stamp?) {
        r.uploads.forEach { it.inBatch = false }
        r.uploads.removeAll { it.state is UploadItem.State.Failed }
        val items = uris.take(10).map { UploadItem(it, stamp) }
        r.uploads += items
        if (uris.size > 10) r.notice = "一度に上げられるのは 10 枚までです(先頭の 10 枚だけ上げます)"
        viewModelScope.launch {
            val up = io.github.contentsview08.obb.data.Uploader
            val files = mutableListOf<io.github.contentsview08.obb.ui.WebUploadFile>()
            val passing = mutableListOf<UploadItem>()
            var total = 0L
            var attempted = 0
            for (item in items) {
                item.state = UploadItem.State.Uploading
                try {
                    val (name, type, bytes) = up.prepareFor(getApplication(), item.uri, prefs.uploadMaxDimension, item.stamp)
                    val hash = up.sha256(bytes)
                    val known = prefs.findUploadByHash(hash)
                    if (known != null) {
                        if (!r.body.contains(known)) r.body = withLine(r.body, known + "\n")
                        prefs.addUpload(known, hash)
                        item.state = UploadItem.State.Done(known)
                        continue
                    }
                    attempted++
                    passing += item
                    total += bytes.size
                    // 超えると分かったら、読んだ分を持ち続けない
                    if (total > io.github.contentsview08.obb.ui.WEB_PASS_MAX_BYTES) files.clear()
                    else files += io.github.contentsview08.obb.ui.WebUploadFile(name, type, bytes, hash)
                } catch (e: Exception) {
                    uploadFailed(r, item, e)
                } catch (e: OutOfMemoryError) {
                    uploadOutOfMemory(r, item)
                }
            }
            r.uploads.removeAll(passing)
            val problem = io.github.contentsview08.obb.ui.webPassProblem(total)
            if (problem != null) r.notice = problem
            if (attempted > 0) r.webUpload = io.github.contentsview08.obb.ui.WebUploadJob(site, files.toList(), problem)
        }
    }

    fun retryUpload(r: ReplyState, item: UploadItem) {
        // サイトの画面へ渡す分は列にできない
        if (siteFor(r) != null && r.uploading) return
        r.uploads.remove(item)
        attach(r, listOf(item.uri), item.stamp)
    }

    /** 本文から画像の URL を外す(サムネイルの ×) */
    fun removeImageUrl(r: ReplyState, url: String) {
        r.body = r.body.lines().filter { it.trim() != url }.joinToString("\n").let { if (it.contains(url)) it.replace(url, "") else it }
        r.uploads.removeAll { (it.state as? UploadItem.State.Done)?.url == url }
    }

    /** 書きかけを戻す(開いたとき 1 回。もう何か書いていたら、そちらを優先する) */
    fun loadDraft(page: Page.Thread) {
        val r = page.reply
        if (r.draftLoaded) return
        r.draftLoaded = true
        viewModelScope.launch { if (r.body.isEmpty()) r.body = db.draft(page.summary) }
    }

    private var draftJob: Job? = null
    /** 書くのが止まって少ししたら、書きかけを保存する(1 文字ごとに DB へ書かないように) */
    fun saveDraftLater(page: Page.Thread) {
        draftJob?.cancel()
        draftJob = viewModelScope.launch { kotlinx.coroutines.delay(400); db.saveDraft(page.summary, page.reply.body) }
    }

    fun saveDraft(page: Page.Thread) {
        viewModelScope.launch { db.saveDraft(page.summary, page.reply.body) }
    }

    /** 長押しの「「草」とすぐ書き込む」: >>番号 と定型文を、書き込み欄を開かずに送る */
    fun quickPost(page: Page.Thread, no: Int, phrase: String) {
        val r = page.reply
        if (r.sending) return
        val body = ">>$no\n$phrase"
        val mail = r.mail.trim()
        val over = TwoCh.overLimits(page.summary.boardUrl, body, r.name, mail)
        if (over.isNotEmpty()) { toast = over.joinToString(" / "); return }
        handlePost(page, body, r.name, mail, quick = true) { TwoCh.createPost(page.summary, PostInput(r.name, mail, body)) }
    }

    fun send(page: Page.Thread) {
        val r = page.reply
        if (r.sending || r.body.isBlank()) return
        val body = r.body
        val mail = r.mail.trim()
        val over = TwoCh.overLimits(page.summary.boardUrl, body, r.name, mail)
        if (over.isNotEmpty()) { r.notice = over.joinToString(" / "); return }
        handlePost(page, body, r.name, mail) { TwoCh.createPost(page.summary, PostInput(r.name, mail, body)) }
    }

    /** 5ch の書き込み確認で承諾した */
    fun acceptConfirm(page: Page.Thread) {
        val c = page.reply.confirm ?: return
        page.reply.confirm = null
        val p = page.reply.confirmPost ?: return
        handlePost(page, p.body, p.name, p.mail, p.quick) { TwoCh.submitConfirm(c) }
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
                            r.body = ""; r.uploads.clear()
                            // 書き込めたらキーボードをしまう(書いたレスと返事が見えるように)
                            r.blurSeq++
                            r.done = "書き込みました"
                            // 遅れて保存する書きかけが、空にしたあとで古い本文を書き戻さないように止める
                            draftJob?.cancel()
                            db.saveDraft(page.summary, "")
                            // 板ごとの既定値がある欄は、ふだんの値を書き換えない
                            val meta = prefs.boardMeta[page.summary.boardUrl]
                            if (meta?.defaultName == null) prefs.postName = name
                            if (meta?.defaultMail == null) prefs.postMail = mail
                        }
                        toast = "書き込みました"
                        // 自動更新の最中だと取り直しが飛ばされ、自分のレスが見つからない。終わるのを待ってから取り直す
                        while (page.loading) kotlinx.coroutines.delay(100)
                        // いま書いたレスが自分のレスへのアンカーでも、自分宛てとして知らせない
                        page.justPosted = body.trim()
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
                    is PostResult.Confirm -> {
                        r.confirmPost = ConfirmPost(body, name, mail, quick)
                        r.confirm = res
                    }
                    is PostResult.Error -> if (quick) toast = res.message else r.notice = res.message
                }
            } catch (e: Exception) {
                if (quick) toast = "書き込めませんでした: ${e.message ?: e}" else r.notice = "書き込めませんでした: ${e.message ?: e}"
            } finally {
                r.sending = false
            }
        }
    }

    /** スレを立てる欄を開く。書きかけがなければ、板ごとの既定値かふだんの名前・メールを入れる */
    fun openNewThread(page: Page.Threads) {
        val r = page.newThread
        if (r.title.isEmpty() && r.body.isEmpty()) {
            val meta = prefs.boardMeta[page.board.url]
            r.name = meta?.defaultName ?: prefs.postName
            r.mail = meta?.defaultMail ?: prefs.postMail
        }
        r.open = true
    }

    /** スレを立てる。立てたら一覧を取り直し、同じスレタイのスレを開く */
    fun createThread(page: Page.Threads) {
        val r = page.newThread
        if (r.sending || r.title.isBlank() || r.body.isBlank()) return
        val mail = r.mail.trim()
        val over = TwoCh.overLimits(page.board.url, r.body, r.name, mail, r.title)
        if (over.isNotEmpty()) { r.notice = over.joinToString(" / "); return }
        // 板ごとの既定値がある欄は、ふだんの値を書き換えない
        val meta = prefs.boardMeta[page.board.url]
        if (meta?.defaultName == null) prefs.postName = r.name
        viewModelScope.launch {
            r.sending = true
            r.notice = null
            try {
                when (val res = TwoCh.createThread(page.board, r.title, PostInput(r.name, mail, r.body))) {
                    is PostResult.Ok -> {
                        val title = r.title.trim()
                        if (meta?.defaultMail == null) prefs.postMail = r.mail
                        r.title = ""
                        r.body = ""; r.uploads.clear()
                        r.open = false
                        prefs.setNewThreadDraft(page.board.url, "", "", "", "")
                        toast = "スレを立てました"
                        // 立てたあとの一覧の取り直しに失敗しても、立てられなかったとは出さない
                        runCatching { TwoCh.listThreads(page.board) }.onSuccess { list ->
                            page.threads = list
                            list.firstOrNull { it.title.trim() == title }?.let { openThread(it) }
                        }
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

    // 中で画面のスレッドの処理を始めるので、すべてのプロパティを初期化したあとに置く
    init {
        Http.init(app)
        // hono-bbs のアカウント(保存してあれば、書き込みのときにログインして使う)
        if (prefs.honoUser.isNotEmpty()) HonoBbs.account = HonoBbs.Account(prefs.honoUser, prefs.honoPassword)
        io.github.contentsview08.obb.data.ImageStore.init(app)
        io.github.contentsview08.obb.data.Favicons.db = db
        // 起動したら、前回の板のスレ一覧(初めてならエッヂ)
        val url = prefs.lastBoardUrl ?: "https://bbs.eddibb.cc/liveedge/"
        openBoard(Board(url, prefs.lastBoardName ?: "エッヂ"), root = true)
        // 最初から入れておく掲示板・板を足してから、左のメニューを読む
        viewModelScope.launch { runCatching { applyPresets() }; reloadSide() }
        viewModelScope.launch { snapshotFlow { renderKey() }.drop(1).collectLatest { rerenderAll() } }
        // 起動したら、しばらく開いていないスレのログを消す(設定)
        if (prefs.logRetentionDays > 0) viewModelScope.launch { runCatching { db.pruneLogs(System.currentTimeMillis() - prefs.logRetentionDays * 86_400_000L) } }
        // 定期確認: アプリを開いている間は、閲覧履歴・お気に入りのスレ・キーワードをそれぞれの間隔で。閉じている間は WorkManager で
        viewModelScope.launch {
            val clock = io.github.contentsview08.obb.data.CrawlClock()
            kotlinx.coroutines.delay(30_000)
            while (true) {
                // 閉じている間は、ここで止まって起きない
                snapshotFlow { appVisible }.first { it }
                // キーワードは知らせるだけのものなので、知らせないときはスレ一覧を取りに行かない
                val keywordMin = if (prefs.osNotify && prefs.notifyKeyword && prefs.keywords.isNotBlank()) prefs.keywordWatchMin else 0
                clock.due(System.currentTimeMillis(), prefs.historyCheckMin, prefs.favCheckMin, keywordMin)?.let { scope ->
                    // スレ一覧の読み取りが重いので、画面のスレッドでは動かさない(ANR になる)
                    runCatching { withContext(Dispatchers.Default) { io.github.contentsview08.obb.data.Crawler.run(app, db, prefs, scope) } }.onSuccess { remoteCounts = remoteCounts + it }
                }
                kotlinx.coroutines.delay(60_000)
            }
        }
        viewModelScope.launch {
            snapshotFlow { prefs.osNotify to prefs.historyCheckMin }.collect { runCatching { io.github.contentsview08.obb.data.Crawler.schedule(app, prefs) } }
        }
    }
}
