package io.github.contentsview08.obb.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.ScrollPos
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// スレ表示のスクロールまわり。apps/desktop の hooks/useThreadScroll.ts と utils/threadScroll.ts の写し

/** 未読の頭を置く位置(見えている範囲の上からの割合) */
private const val UNREAD_AT = 0.3f
private const val STAGGER_MS = 35f
private const val STAGGER_TOTAL_MS = 450f
private const val FLASH_MS = 1000L
private const val NEW_TOAST_MS = 2500L

/** スレ表示 1 つぶんの、スクロールの覚え(開き直すと作り直す) */
@Stable
class ThreadScrollCtl(val page: Page.Thread) {
    var positioned by mutableStateOf(false)
    /** レスへ飛んで開いた。開いたときの取得が済むまで、新着で位置を動かさない */
    var keepJump = false
    /** 開いてから、まだ利用者がスクロールしていない */
    var untouched = true
    /** 開いてから、まだ新着を受け取っていない(次に届くのは開いたときの取得の分) */
    var firstGrowth = true
    /** 知らせた既読の番号 */
    var sent = page.readNo
    /** ツリー表示で画面に出たレスの番号(スレを開いている間だけ。既読は 1 番から途切れずに出し終えた所まで進める) */
    val treeSeen = HashSet<Int>()
    var atBottom = false
    /** 開いたときに未読の頭がまだ手元になかった。新着が届いたらそこへ移る */
    var pendingUnread = false
    var prevCount = 0
    var lastMax = 0
    /** 新着として光らせるレス(番号 → 出るまでの遅れ ms) */
    var flash by mutableStateOf<Map<Int, Int>>(emptyMap())
    /** 新着の札(件数と、新着の頭の番号) */
    var newToast by mutableStateOf<Pair<Int, Int>?>(null)
    /** 新着が届いた時刻。出る動きは、この時に画面に出ていたレスだけ(あとからスクロールして出てきたレスは、待たせずにすぐ描く) */
    var flashAt = 0L
    /** 押して飛んだレス(番号と、押した時刻)。一瞬光らせる */
    var jumpFlash by mutableStateOf<Pair<Int, Long>?>(null)

    // ── 実況モード(ui/LiveMode.kt) ──
    /** 実況モードに入っている(スレを閉じたらやめる) */
    var liveOn by mutableStateOf(false)
    var livePhase by mutableStateOf(LivePhase.CATCH_UP)
    /** 出しているレスの最後の番号。これより後のレスは、出す時刻まで並べない */
    var liveLimit by mutableStateOf(Int.MAX_VALUE)
    /** 出す順のレス(番号と、出す時刻 ms) */
    private val liveQueue = ArrayDeque<Pair<Int, Long>>()
    /** 前の更新で最後に出す(出した)レスの書き込みの時刻。次の更新の分は、ここからの差だけ遅らせる */
    private var liveBase: Long? = null
    /** ライブの段で出たレス → 出た時刻(ms)。ポンと出る動きに使う */
    var livePop by mutableStateOf<Map<Int, Long>>(emptyMap())
    /** 実況モードで、指で外していない(新着の送る動き・札はこちらが受け持つ) */
    val liveRunning get() = liveOn && livePhase != LivePhase.PAUSED
    /** 次に自動で取りに行く時刻(ms)。0 は取りに行っている間(更新ボタンに残りを出す) */
    var liveNextAt by mutableStateOf(0L)
    /** 入ってすぐの更新が済んだ。済むまではライブの段に入らない(その更新で届いたレスは、追いつくまでの段として流して見せる) */
    var livePrimed by mutableStateOf(false)
    /** 出す順に足すたびに進める。実況モードの動きが、出すもののない間の眠りから起きる合図 */
    var liveQueued by mutableIntStateOf(0)
        private set

    fun startLive() { liveOn = true; livePhase = LivePhase.CATCH_UP; liveNextAt = 0L; livePrimed = false; showAllLive() }
    fun stopLive() { liveOn = false; livePhase = LivePhase.CATCH_UP; liveNextAt = 0L; livePrimed = false; showAllLive() }

    /** 一番下に着いた: 今あるレスは全部出ているので、ここから後を 1 つずつ積む */
    fun enterLive() {
        livePhase = LivePhase.LIVE
        liveQueue.clear()
        val last = page.index.posts.lastOrNull()
        liveLimit = last?.no ?: 0
        liveBase = last?.let { postTimeMs(it.date) }
    }

    /** 指で上へ動かした: 隠していたレスを全部出し、自分で一番下へ戻るまで待つ */
    fun leaveLive() { livePhase = LivePhase.PAUSED; showAllLive() }

    private fun showAllLive() { liveQueue.clear(); liveLimit = Int.MAX_VALUE; liveBase = null }

    /**
     * ライブの段で更新が届いた: まだ出す順に入れていないレスを、出す時刻を決めて並べる。
     * 前の分が残っていれば、その後ろに続ける。溜まりすぎたら全部出す
     */
    fun queueLive(nowMs: Long, intervalMs: Long) {
        val after = maxOf(liveLimit, liveQueue.lastOrNull()?.first ?: 0)
        val fresh = page.index.posts.filter { it.no > after }
        if (fresh.isEmpty()) return
        val times = fresh.map { postTimeMs(it.date) }
        val (at, flush) = liveQueueTimes(nowMs, liveRevealSchedule(times, liveBase, intervalMs), liveQueue.lastOrNull()?.second, intervalMs)
        fresh.forEachIndexed { i, p -> liveQueue.addLast(p.no to at[i]) }
        liveBase = times.last()
        if (flush) {
            liveLimit = liveQueue.last().first
            liveQueue.clear()
        }
        liveQueued++
    }

    /** 次に出す時刻(ms)。出す予定がなければ null */
    fun nextRevealAt(): Long? = liveQueue.firstOrNull()?.second

    /** 出す時刻の来たレスを出す */
    fun revealDue(nowMs: Long) {
        var shown: Int? = null
        while (liveQueue.isNotEmpty() && liveQueue.first().second <= nowMs) shown = liveQueue.removeFirst().first
        val no = shown ?: return
        // 先に動きを決めてから並べる(並んだ最初の描画から動くように)
        if (!Motion.reduced) livePop = livePop.filterValues { nowMs - it < LIVE_POP_MS * 2 } + ((liveLimit + 1)..no).associateWith { nowMs }
        liveLimit = no
    }
}

/** 実況モードの段: 追いつくまで・追いついた後(ライブ)・指で外した */
enum class LivePhase { CATCH_UP, LIVE, PAUSED }

/** PC 版の staggerDelays の写し */
fun staggerDelays(nos: List<Int>): Map<Int, Int> {
    val d = minOf(STAGGER_MS, STAGGER_TOTAL_MS / maxOf(1, nos.size - 1))
    return nos.mapIndexed { i, n -> n to Math.round(i * d) }.toMap()
}

/**
 * ツリー表示の既読: from(今の既読)の次から、画面に出たレス(seen)か手元にない番号(exists にない。飛んだ番号)が続く限り進めた番号。
 * 1 番から途切れずに出し終えた所までを既読にする(top は手元の最後のレス)
 */
fun readHead(from: Int, top: Int, seen: Set<Int>, exists: Set<Int>): Int {
    var n = maxOf(0, from)
    while (n < top && (n + 1 in seen || n + 1 !in exists)) n++
    return n
}

/** 並んでいる行(レス番号。0 は数えない行)のうち、そのレスの行。なければ、それより後ろでいちばん小さい番号の行(番号の順なら最初の no 以上の行) */
fun rowIndexOf(nos: List<Int>, no: Int): Int {
    var best = -1
    var bestNo = Int.MAX_VALUE
    for (i in nos.indices) {
        val n = nos[i]
        if (n == no) return i
        if (n > no && n < bestNo) { best = i; bestNo = n }
    }
    return best
}

/** 開いたときの行き先(PC 版の OpenTarget の写し) */
sealed class OpenTarget {
    data class Saved(val pos: ScrollPos) : OpenTarget()
    /** pendingUnread: 未読の頭がまだ手元にないので、新着が届いたらそこへ移る */
    data class Bottom(val pendingUnread: Boolean) : OpenTarget()
    data class Unread(val no: Int) : OpenTarget()
    data object Top : OpenTarget()
}

/** 自動の取得でレスの数の上限とみなす数(PC 版のコネクタの maxPosts。hono-bbs は上限がない) */
const val AUTO_REFRESH_MAX_POSTS = 1000

/** 開いているスレを自動で取りに行くか。PC 版 utils/autoRefresh.ts の shouldAutoRefresh と同じ。見えていないとき・もう増えないスレ(dat 落ち・上限到達)では行かない */
fun shouldAutoRefresh(visible: Boolean, archived: Boolean, postCount: Int, maxPosts: Int?): Boolean =
    visible && !archived && (maxPosts == null || postCount < maxPosts)

/**
 * 開いたとき(最初にレスが出たとき)にどこへ置くか(PC 版の openTarget と同じ決まり)。
 * - 覚えた位置があっても、覚えたときの既読より今の既読が先(別の端末で読み進めた分が同期で届いた)なら使わず、既読の次へ
 * - 覚えた位置のレスが手元にあればそこへ(一番下で閉じたなら一番下)。ログを取り直して見つからなければ、覚えた位置は使わない
 * - 覚えた位置が使えなければ設定どおり。「最初の未読」がまだ手元にない(前回最後まで読んでいた)ときは、一番下に置いて新着を待つ
 * - 既読が 0 で覚えた位置もなければ先頭
 * 覚えた位置の no は画面の上に見えていたレスなので、既読そのものとは比べない(既読は 1 画面ぶん先にある)。
 * 既読を添えていない古い覚えは、そのまま使う
 */
fun openTarget(saved: ScrollPos?, savedFound: Boolean, openPosition: String, readNo: Int, unreadFrom: Int, hasUnreadPost: Boolean): OpenTarget {
    val advanced = saved?.readNo != null && readNo > saved.readNo
    if (saved != null && !advanced) {
        if (saved.bottom) return OpenTarget.Bottom(pendingUnread = false)
        if (savedFound) return OpenTarget.Saved(saved)
    }
    if (openPosition == "bottom") return OpenTarget.Bottom(pendingUnread = false)
    if (openPosition == "unread" && unreadFrom > 1) return if (hasUnreadPost) OpenTarget.Unread(unreadFrom) else OpenTarget.Bottom(pendingUnread = true)
    return OpenTarget.Top
}

/**
 * shown は今並んでいる行のレス番号(絞り込み後。ツリー表示の 2 回目以降の出現は 0)、footer は重なっている下の帯の高さ(px)。
 * tree: ツリー表示で並べているか(並びが番号の順ではない)
 */
class ThreadScroller(
    private val ctl: ThreadScrollCtl,
    private val state: LazyListState,
    private val scope: CoroutineScope,
    private val shown: () -> List<Int>,
    private val footer: () -> Float,
    private val bottomPx: Float,
    private val tree: () -> Boolean = { false },
) {
    private fun indexOf(no: Int) = rowIndexOf(shown(), no)

    /** 見えている範囲の高さ(上の帯の下から、下の帯の上まで) */
    private fun visibleHeight(): Float {
        val info = state.layoutInfo
        // 項目の位置は上の帯の下が 0。下の帯の分は afterContentPadding に入っている
        return (info.viewportEndOffset - info.afterContentPadding).toFloat().coerceAtLeast(1f)
    }

    /** 未読の頭を、見えている範囲の上から 3 割の所に置く(上に既読が少し見え、その下の線から未読と分かるように) */
    suspend fun toUnreadNow(no: Int, animate: Boolean = false) {
        val i = indexOf(no)
        if (i < 0) return toBottomNow(animate)
        val off = -(visibleHeight() * UNREAD_AT).toInt()
        if (animate) state.animateScrollToItem(i, off) else state.scrollToItem(i, off)
    }

    suspend fun toBottomNow(animate: Boolean = false) {
        val last = maxOf(0, state.layoutInfo.totalItemsCount - 1)
        if (animate) state.animateScrollToItem(last) else state.scrollToItem(last)
    }

    fun toUnread(no: Int, animate: Boolean = false) { scope.launch { toUnreadNow(no, animate) } }
    fun toBottom(animate: Boolean = false) { scope.launch { toBottomNow(animate) } }

    /** 開いたときの位置(どこへ置くかは openTarget が決める) */
    suspend fun open(saved: ScrollPos?, openPosition: String) {
        val page = ctl.page
        val posts = page.index.posts
        ctl.sent = maxOf(ctl.sent, page.readNo)
        val savedIdx = saved?.let { s -> shown().indexOf(s.no).takeIf { s.no > 0 } } ?: -1
        val unreadFrom = page.unreadFrom
        when (val t = openTarget(saved, savedIdx >= 0, openPosition, ctl.sent, unreadFrom, posts.any { it.no == unreadFrom })) {
            // ツリー表示では、一番下が最後のレスとは限らないので、既読のレスの位置へ
            is OpenTarget.Bottom -> if (tree() && t.pendingUnread) toUnreadNow(ctl.sent) else { toBottomNow(); ctl.pendingUnread = t.pendingUnread }
            // 覚えたずれは「上の帯の下からの位置」(上へはみ出していれば負)。scrollToItem は送る量なので符号を返す
            is OpenTarget.Saved -> state.scrollToItem(savedIdx, -t.pos.offset)
            // ツリー表示では、未読の頭は離れた枝にあることがあるので、既読の番号のレスの位置へ
            is OpenTarget.Unread -> toUnreadNow(if (tree()) maxOf(1, t.no - 1) else t.no)
            OpenTarget.Top -> state.scrollToItem(0)
        }
        // この時点で手元にあるレスは「新着」として扱わない
        ctl.prevCount = posts.size
        ctl.lastMax = posts.lastOrNull()?.no ?: 0
        ctl.positioned = true
    }

    /**
     * 新着が届いたとき(PC 版の newPostsTarget): 光らせ、
     * - 開いたときに未読の頭がなかったなら、届いた未読の頭へすぐ移る
     * - 開いて最初の取得の分で、利用者がまだ触っていなければ、それまでを読み終えていたときだけ新着の頭へすぐ移る
     * - 読んでいる途中は、設定がオンで一番下を見ているときだけ、新着の頭へ動かして見せる(実況モードの間は除く)
     * 実況モードのライブの段では、届いたレスは隠して 1 つずつ出す(光らせず、札も出さない)
     */
    fun grew(autoScrollOnNew: Boolean, liveIntervalMs: Long) {
        val page = ctl.page
        val posts = page.index.posts
        val grew = posts.size > ctl.prevCount
        ctl.prevCount = posts.size
        val prevLastNo = ctl.lastMax
        ctl.lastMax = posts.lastOrNull()?.no ?: 0
        if (!grew || !ctl.positioned) return
        if (ctl.liveOn && ctl.livePhase == LivePhase.LIVE) {
            ctl.firstGrowth = false
            ctl.pendingUnread = false
            ctl.queueLive(System.currentTimeMillis(), liveIntervalMs)
            return
        }
        // 既読より後のレスだけが新着。別の端末で読んだ分が同期で既読になっていれば、あとから届いても光らせず、札も出さない
        val read = maxOf(ctl.sent, page.readNo)
        val fresh = posts.filter { it.no > prevLastNo && it.no > read }.map { it.no }
        val head = maxOf(prevLastNo, read) + 1
        if (fresh.isEmpty()) {
            // 一番下で未読を待っていた・開いた直後なら、既読の末尾(新しい一番下)まで送る。未読の頭はまだないので、待ち続ける
            if (!ctl.keepJump && !tree() && (ctl.pendingUnread || (ctl.untouched && ctl.firstGrowth))) toUnread(head)
            return
        }
        ctl.flashAt = System.currentTimeMillis()
        // 動きを減らすときは、浮き上がりも光りもしない
        if (!Motion.reduced) ctl.flash = staggerDelays(fresh)
        scope.launch { delay(FLASH_MS + STAGGER_TOTAL_MS.toLong()); ctl.flash = emptyMap() }
        val opening = ctl.untouched && ctl.firstGrowth
        ctl.firstGrowth = false
        val unreadFrom = page.unreadFrom
        when {
            ctl.keepJump -> {}
            // ツリー表示では新着があちこちの枝に入るので、送らずに読んでいる位置を保つ(新着の印と札で知らせる)
            tree() -> {}
            ctl.pendingUnread && posts.any { it.no == unreadFrom } -> toUnread(unreadFrom)
            opening -> if (read >= prevLastNo) toUnread(head)
            // 実況モードの間は、流す方が新着まで運ぶ(送る動きどうしがぶつからないように)
            autoScrollOnNew && ctl.atBottom && !ctl.liveRunning -> toUnread(head, animate = true)
        }
        ctl.pendingUnread = false
        // 新着の頭が画面の外なら、下から「新着 +N」を少しのあいだ出す(送り終わるのを待ってから確かめる)
        val first = fresh.first()
        scope.launch {
            delay(450)
            // 実況モードの間は、新着は流れてくるので知らせない
            if (!isVisible(first) && !ctl.liveRunning) {
                ctl.newToast = fresh.size to first
                delay(NEW_TOAST_MS)
                if (ctl.newToast?.second == first) ctl.newToast = null
            }
        }
    }

    /** 上の端が画面の下端より上にあれば見えているとする */
    fun isVisible(no: Int): Boolean {
        val info = state.layoutInfo
        val item = info.visibleItemsInfo.firstOrNull { it.key == no } ?: return false
        return item.offset < info.viewportEndOffset - info.afterContentPadding + footer() - 8
    }

    /**
     * どこまで読んだかを測り、読んでいた位置を返す(PC 版の readProgress):
     * 画面の下端より上に頭が出ているレスのうち、いちばん後ろを既読に。一番下まで来ていれば全部読んだことに。
     * 上の帯の下に少しでも見えている最初のレスを、読んでいた位置として覚える
     */
    fun progress(): Pair<Int, ScrollPos?> {
        val info = state.layoutInfo
        val items = info.visibleItemsInfo.filter { it.key is Int }
        if (items.isEmpty()) return 0 to null
        val end = info.viewportEndOffset - info.afterContentPadding
        // 一番下かどうかは -END- の行で測る(その下の「次の未読スレへ」が画面の外でも、END まで見えていれば一番下)
        val lastItem = info.visibleItemsInfo.firstOrNull { it.key == "end" }
            ?: info.visibleItemsInfo.lastOrNull()?.takeIf { it.index == info.totalItemsCount - 1 }
        val rest = if (lastItem != null) (lastItem.offset + lastItem.size - end).toFloat() else Float.MAX_VALUE
        ctl.atBottom = !state.canScrollForward || rest < bottomPx
        var last = items.last().key as Int
        val page = ctl.page
        if (tree()) {
            // ツリー表示では並びが番号の順ではないので、出たレスを覚え、1 番から途切れずに出し終えた番号まで(一番下に着いても飛ばさない)
            for (it in items) ctl.treeSeen += it.key as Int
            val posts = page.index.posts
            val top = posts.lastOrNull()?.no ?: 0
            val exists = posts.mapTo(HashSet()) { it.no }
            last = readHead(maxOf(ctl.sent, page.readNo), top, ctl.treeSeen, exists)
            val first = items.firstOrNull { it.offset + it.size > 0 }
            return last to first?.let { ScrollPos(it.key as Int, it.offset, ctl.atBottom) }
        }
        // 絞り込みで中身が縮むと一番下に見えるが、読んだわけではない(全部既読になって戻せなくなる)
        val filtering = ctl.page.filter != null || (ctl.page.searching && ctl.page.query.isNotBlank())
        // 実況モードでまだ出していないレスは読んでいない
        if (ctl.atBottom && !filtering) last = maxOf(last, minOf(ctl.page.index.posts.lastOrNull()?.no ?: 0, ctl.liveLimit))
        val top = items.firstOrNull { it.offset + it.size > 0 }
        return last to top?.let { ScrollPos(it.key as Int, it.offset, ctl.atBottom) }
    }
}

// ── 引っぱって更新(PC 版の useTouchPull・useWheelPullRefresh・PullSpinner の写し) ──

/** 隠れている位置・確定して回る位置・引っぱれる見た目の上限(dp)。指でこれだけ引いて離したら更新する */
private const val PULL_HIDDEN_Y = -70f
private const val PULL_REVEAL_Y = 20f
private const val PULL_MAX_Y = 110f
private const val TOUCH_COMMIT_DP = 56f
private const val MIN_SPIN_MS = 800L

/** 引いた量 → 印の位置(しきい値でちょうど確定の位置、それ以上はゴムひもで上限に近づく) */
private fun dampedPullY(dy: Float, threshold: Float): Float {
    val t = dy / (dy + threshold)
    return PULL_HIDDEN_Y + (PULL_MAX_Y - PULL_HIDDEN_Y) * t
}

@Stable
class PullState(private val onCommit: () -> Unit = {}) {
    /** dp */
    var dist by mutableFloatStateOf(0f)
    val y = Animatable(PULL_HIDDEN_Y)
    val alpha = Animatable(0f)
    var spinning by mutableStateOf(false)
    var committing = false
    val progress get() = minOf(1f, dist / TOUCH_COMMIT_DP)

    suspend fun pull(d: Float) {
        if (committing) return
        dist = d
        y.snapTo(dampedPullY(d, TOUCH_COMMIT_DP))
        alpha.snapTo(minOf(1f, progress + 0.15f))
    }

    /** 指を離した: 十分に引いていれば更新し(回しながら確定の位置へ・最低 0.8 秒)、足りなければ戻す */
    suspend fun release(refresh: suspend () -> Unit) {
        val d = dist
        dist = 0f
        if (committing) return
        if (d >= TOUCH_COMMIT_DP) {
            committing = true
            spinning = true
            onCommit()
            y.animateTo(PULL_REVEAL_Y, tween(150, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
            val start = System.currentTimeMillis()
            refresh()
            val left = MIN_SPIN_MS - (System.currentTimeMillis() - start)
            if (left > 0) delay(left)
            settle()
            spinning = false
            committing = false
        } else settle()
    }

    private suspend fun settle() {
        kotlinx.coroutines.coroutineScope {
            launch { y.animateTo(PULL_HIDDEN_Y, tween(250, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
            launch { alpha.animateTo(0f, tween(200)) }
        }
    }
}

/** 本文の端で引っぱると更新する。端に着いたかは指を動かすたびに見る(同じ指のまま端まで送って引いても効くように) */
class PullConnection(
    private val top: PullState,
    private val bottom: PullState,
    private val density: Float,
    private val scope: CoroutineScope,
    private val refresh: suspend () -> Unit,
) : NestedScrollConnection {
    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source != NestedScrollSource.UserInput) return Offset.Zero
        // 引いている途中で指を戻したら、まず引いた分を戻す
        if (top.dist > 0f && available.y < 0f) {
            val d = minOf(top.dist * density, -available.y)
            scope.launch { top.pull(top.dist - d / density) }
            return Offset(0f, -d)
        }
        if (bottom.dist > 0f && available.y > 0f) {
            val d = minOf(bottom.dist * density, available.y)
            scope.launch { bottom.pull(bottom.dist - d / density) }
            return Offset(0f, d)
        }
        return Offset.Zero
    }

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        if (source != NestedScrollSource.UserInput) return Offset.Zero
        if (available.y > 0f) { scope.launch { top.pull(top.dist + available.y / density) }; return Offset(0f, available.y) }
        if (available.y < 0f) { scope.launch { bottom.pull(bottom.dist - available.y / density) }; return Offset(0f, available.y) }
        return Offset.Zero
    }

    override suspend fun onPreFling(available: Velocity): Velocity {
        if (top.dist > 0f) scope.launch { top.release(refresh) }
        if (bottom.dist > 0f) scope.launch { bottom.release(refresh) }
        return Velocity.Zero
    }
}

/** 引っぱって更新の印(丸の中の更新の矢印。引いた分だけ回り、確定したらくるくる回る)。sign は上の端なら 1、下の端なら -1 */
@Composable
fun PullSpinner(state: PullState, sign: Int, modifier: Modifier = Modifier) {
    Box(
        modifier.graphicsLayer { translationY = sign * state.y.value * density; alpha = state.alpha.value }
            .size(42.dp).background(Palette.surface, CircleShape).border(1.dp, Palette.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (state.spinning) SpinningRefreshIcon(null, Palette.accent, 24.dp)
        else Icon(Icons.Filled.Refresh, null, tint = Palette.accent, modifier = Modifier.size(24.dp).rotate(state.progress * 360f))
    }
}

/** 回っている更新の矢印。無限のアニメーションは置いてある間ずっと毎フレーム動くので、回す間だけ置く */
@Composable
fun SpinningRefreshIcon(contentDescription: String?, tint: androidx.compose.ui.graphics.Color, size: androidx.compose.ui.unit.Dp) {
    val spin = rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "r")
    Icon(Icons.Filled.Refresh, contentDescription, tint = tint, modifier = Modifier.size(size).graphicsLayer { rotationZ = spin.value })
}
