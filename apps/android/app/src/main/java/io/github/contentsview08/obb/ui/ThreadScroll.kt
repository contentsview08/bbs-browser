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
/** 開いてから、なぞらなくても見えているレスを読んだことにするまでの時間(ms)。開いてすぐ閉じるだけでは既読を進めない */
const val READ_DWELL_MS = 1200L
private const val STAGGER_MS = 35f
private const val STAGGER_TOTAL_MS = 450f
private const val FLASH_MS = 1000L
private const val NEW_TOAST_MS = 2500L
/** 飛んだ先のレスの光り方(ミニマップ・履歴・URL の番号・新着の札、どこから飛んでも同じ): 置いてから少し待ち、1 色の面を薄めていく */
const val JUMP_FLASH_HOLD_MS = 120L
const val JUMP_FLASH_FADE_MS = 900
const val JUMP_FLASH_ALPHA = 0.28f

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
    /**
     * 開いている間に「下端まで見えた」レスの番号(読み切れたもの。頭だけ見えたレスは入れない)。
     * 既読は、今の既読から途切れずにこの中にある所までしか進めない(飛んで開いたときに、その手前の読んでいないレスを既読にしないため)。
     * 一番下に着いたときだけ全部読んだことにする
     */
    val seen = HashSet<Int>()
    /** 位置が決まった時刻(ms)。既読を数え始めるのは、なぞってから(untouched が外れてから)か、ここから READ_DWELL_MS 経ってから */
    var positionedAt = 0L
    /**
     * 見えているレスを読んだことにしてよいか(開いて閉じるだけで 1 画面ぶん既読が進むのを防ぐ)。
     * 一番下まで見えているとき(新着が 1〜2 件で全部見えた)は、開いてすぐ戻っても読んだことにする(未読の札が残らないように)
     */
    fun counting() = !untouched || atBottom || (positionedAt > 0 && System.currentTimeMillis() - positionedAt >= READ_DWELL_MS)
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

    /** 飛んだ先のレスを光らせる(どこから飛んでも同じ見た目・同じ長さ) */
    fun flashJump(no: Int) { jumpFlash = no to System.nanoTime() }

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
 * 途中では 1 番から途切れずに出し終えた所までを既読にする(top は手元の最後のレス)。
 * 一番下まで来ていれば(atBottom。-END- が見えた)、番号の順と同じく、ミニマップや End で飛ばして出していないレスがあっても top まで
 * (途中の既読が止まったまま一番下に着くと、タブ・スレ一覧の未読の数が消えなかった。1 画面に収まる短いスレは開いただけで全部既読)。
 * PC 版の treeRead の写し
 */
fun readHead(from: Int, top: Int, seen: Set<Int>, exists: Set<Int>, atBottom: Boolean = false): Int {
    if (atBottom) return maxOf(from, top)
    var n = maxOf(0, from)
    while (n < top && (n + 1 in seen || n + 1 !in exists)) n++
    return n
}

/**
 * ツリー表示の新着の印をどこから付けるか(更新したあとの値。1 以下なら印なし。PC 版の treeFreshFrom の写し)。
 * 印は「前に見たときになかったレス」に付ける: 更新で届いた分(lastBefore より後)で、まだ読んでいない(readNo より後)もの。
 * 手で更新したときは、届かなくても引き直す(読んだので消える)。自動更新で何も届かなければ、今の印を残す。
 * ツリーの既読(readHead)は 1 番から途切れずに出し終えた所までしか進まないので、「既読の次から全部」にすると、開いてから見たレスまで全部に印が付いてしまう
 */
fun treeFreshFrom(current: Int, readNo: Int, lastBefore: Int, arrived: Boolean, manual: Boolean): Int {
    if (!arrived && !manual) return current
    return maxOf(readNo, lastBefore) + 1
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

/**
 * 飛んだレスを見える範囲の縦の真ん中に置くための、上の端からの位置(px)。
 * レスが見える範囲より高いときは頭を上に(0)。スレの頭・末尾に近くて真ん中にできないときは、並べる側が端で止める
 */
fun centerOffset(viewportPx: Int, itemPx: Int): Int = maxOf(0, (viewportPx - itemPx) / 2)

/** 開いたときの行き先(PC 版の OpenTarget の写し) */
sealed class OpenTarget {
    /** pendingUnread: 前に閉じた位置へ戻したうえで、新着が届いたら未読の頭へ移る */
    data class Saved(val pos: ScrollPos, val pendingUnread: Boolean = false) : OpenTarget()
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
 * closed は前に閉じたときの位置(スレ一覧などから開き直したとき)。saved と違い設定より先には使わず、
 * 「最初の未読」で未読の頭がないとき(全部読んでいた)にだけ戻す(PC 版の closed と同じ)。closedFound はそのレスが手元にあるか。
 * 途中で閉じていたなら、新着が届いてもそこから動かさない(2026-11-25。前は未読の頭へ送っていて、読んでいた所から一番下へ飛んで見えた)
 */
fun openTarget(
    saved: ScrollPos?, savedFound: Boolean, openPosition: String, readNo: Int, unreadFrom: Int, hasUnreadPost: Boolean,
    closed: ScrollPos? = null, closedFound: Boolean = false,
): OpenTarget {
    fun usable(p: ScrollPos?) = p?.takeIf { !(it.readNo != null && readNo > it.readNo) }
    val s = usable(saved)
    if (s != null) {
        if (s.bottom) return OpenTarget.Bottom(pendingUnread = false)
        if (savedFound) return OpenTarget.Saved(s)
    }
    if (openPosition == "bottom") return OpenTarget.Bottom(pendingUnread = false)
    if (openPosition == "unread" && unreadFrom > 1) {
        if (hasUnreadPost) return OpenTarget.Unread(unreadFrom)
        val c = usable(closed)
        // 途中で閉じていたならそこへ戻すだけ(新着が届いても動かさない。読んでいた所から新着まで送ると読み飛ばす)。一番下で閉じていたなら一番下で新着を待つ
        return if (c != null && !c.bottom && closedFound) OpenTarget.Saved(c, pendingUnread = false) else OpenTarget.Bottom(pendingUnread = true)
    }
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

    /**
     * レスへ飛ぶ(ミニマップの印・履歴・URL の番号など、特定のレスへ飛ぶ操作はすべてここを通す)。
     * そのレスを見える範囲の縦の真ん中に置き、光らせる(flash)。そのレスの行がなければ、後ろでいちばん近い行へ。
     * 高さは並べてから分かるので、いちど上に置いて測り、真ん中になる分だけ上へ戻す(どちらも描く前に済むので、途中は見えない)
     */
    suspend fun jumpToNow(no: Int, flash: Boolean = true) {
        val rows = shown()
        val i = rowIndexOf(rows, no)
        if (i < 0) return
        state.scrollToItem(i)
        val h = state.layoutInfo.visibleItemsInfo.firstOrNull { it.index == i }?.size ?: 0
        val off = centerOffset(visibleHeight().toInt(), h)
        if (off > 0) state.scrollToItem(i, -off)
        if (flash) ctl.flashJump(rows[i].takeIf { it > 0 } ?: no)
    }

    fun jumpTo(no: Int, flash: Boolean = true) { scope.launch { jumpToNow(no, flash) } }

    /** 見えている範囲の真ん中にあるレスを光らせる(ミニマップのつまみを離したとき。流したあとの「飛んだ先」はそのレス。PC 版の pinCenter と同じ) */
    fun flashCenter() {
        val items = state.layoutInfo.visibleItemsInfo.filter { it.key is Int }
        val mid = visibleHeight() / 2
        val item = items.firstOrNull { it.offset + it.size > mid } ?: items.lastOrNull() ?: return
        ctl.flashJump(item.key as Int)
    }

    /** 開いたときの位置(どこへ置くかは openTarget が決める)。jumpTo: 開いてすぐ飛ぶレス(手元にあるもの)。最初の描画からそのレスを真ん中に */
    suspend fun open(saved: ScrollPos?, openPosition: String, jumpTo: Int? = null, closed: ScrollPos? = null) {
        val page = ctl.page
        val posts = page.index.posts
        ctl.sent = maxOf(ctl.sent, page.readNo)
        fun idx(p: ScrollPos?) = p?.let { s -> shown().indexOf(s.no).takeIf { s.no > 0 } } ?: -1
        val savedIdx = idx(saved)
        val closedIdx = idx(closed)
        val unreadFrom = page.unreadFrom
        if (tree()) {
            // ツリー表示: 未読は枝に散るので「未読の頭」を追わない。閉じたときの位置に戻すだけ(一番下で閉じたなら一番下、なければ先頭)。
            // 設定が先頭・一番下なら、そのとおり(PC 版と同じ)
            val pos = saved ?: closed
            val posIdx = if (saved != null) savedIdx else closedIdx
            when {
                jumpTo != null -> jumpToNow(jumpTo)
                openPosition == "top" -> state.scrollToItem(0)
                openPosition == "bottom" || pos?.bottom == true -> toBottomNow()
                pos != null && posIdx >= 0 -> state.scrollToItem(posIdx, -pos.offset)
                else -> state.scrollToItem(0)
            }
            ctl.pendingUnread = false
            ctl.firstGrowth = false
        } else when (val t = openTarget(saved, savedIdx >= 0, openPosition, ctl.sent, unreadFrom, posts.any { it.no == unreadFrom }, closed, closedIdx >= 0)) {
            is OpenTarget.Bottom -> { toBottomNow(); ctl.pendingUnread = t.pendingUnread }
            // 覚えたずれは「上の帯の下からの位置」(上へはみ出していれば負)。scrollToItem は送る量なので符号を返す
            is OpenTarget.Saved -> {
                state.scrollToItem(if (t.pos === saved) savedIdx else closedIdx, -t.pos.offset)
                ctl.pendingUnread = t.pendingUnread
                // 覚えた位置へ戻したときは「開いて最初の取得の新着へ送る」をしない(読んでいた所から一番下へ飛んでしまう)
                ctl.firstGrowth = false
            }
            is OpenTarget.Unread -> toUnreadNow(t.no)
            OpenTarget.Top -> if (jumpTo != null) jumpToNow(jumpTo) else state.scrollToItem(0)
        }
        // この時点で手元にあるレスは「新着」として扱わない
        ctl.prevCount = posts.size
        ctl.lastMax = posts.lastOrNull()?.no ?: 0
        ctl.positioned = true
        ctl.positionedAt = System.currentTimeMillis()
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
            // 一番下で未読を待っていた・開いた直後でそれまでを読み終えていたなら、既読の末尾(新しい一番下)まで送る。未読の頭はまだないので、待ち続ける。
            // 読み終えていないのに送らない(先頭に置いた読んでいないスレで、既読より前の番号のレスが増えたときに一番下へ落ちていた)
            if (!ctl.keepJump && !tree() && (ctl.pendingUnread || (ctl.untouched && ctl.firstGrowth && read >= prevLastNo))) toUnread(head)
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
     * 下端まで見えた(読み切れた)レスを、見た印(ctl.seen)に足す。スクロールのたびに呼ぶ
     * (止まってからだけだと、速く流した途中のレスを見たことにできず、既読が止まる)。
     * 開いた直後(なぞる前・少し経つ前)は数えない
     */
    fun noteSeen() {
        if (!ctl.counting()) return
        val info = state.layoutInfo
        val end = info.viewportEndOffset - info.afterContentPadding
        for (it in info.visibleItemsInfo) if (it.key is Int && it.offset + it.size <= end) ctl.seen += it.key as Int
    }

    /**
     * どこまで読んだかを測り、読んでいた位置を返す。
     * 既読は「今の既読から、途切れずに下端まで見えた所まで」(readHead)。頭だけ見えたレスや、飛んで開いたときに手前に残った
     * 読んでいないレスは既読にしない。一番下まで来ていれば(飛ばしたレスがあっても)全部読んだことに。
     * 開いてすぐ(なぞる前・READ_DWELL_MS 経つ前)は既読を進めない(開いて閉じるだけで 1 画面ぶん進んでいた)。
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
        val page = ctl.page
        val posts = page.index.posts
        // 最後のレスが下端まで見えていれば、その下の行(-END-・次スレの案内)が長くても一番下に着いたことにする
        val lastNo = posts.lastOrNull()?.no ?: 0
        // ツリー表示は番号の順に並ばない(最後の番号のレスが途中に出る)ので、この判定は番号の順のときだけ
        val lastPostShown = !tree() && lastNo > 0 && items.any { it.key == lastNo && it.offset + it.size <= end }
        ctl.atBottom = !state.canScrollForward || rest < bottomPx || lastPostShown
        noteSeen()
        // 絞り込みで中身が縮むと一番下に見えるが、読んだわけではない(全部既読になって戻せなくなる)
        val filtering = page.filter != null || (page.searching && page.query.isNotBlank())
        // 途切れの判定に使う「あるレス」: 並んでいる行(透明あぼーん・まとめたあぼーんで行のないレスは飛ばしてよい)。
        // 絞り込み中は全部(絞って消えたレスを飛ばして既読にしない)
        val exists = if (filtering) posts.mapTo(HashSet()) { it.no } else shown().filterTo(HashSet()) { it > 0 }
        // 実況モードでまだ出していないレスは読んでいない
        val top = minOf(lastNo, if (tree()) Int.MAX_VALUE else ctl.liveLimit)
        val from = maxOf(ctl.sent, page.readNo)
        // ツリー表示: 新着は枝に散って下に足されるわけではないので、「下まで見たら既読」は成り立たない。
        // 開いたとき手元にあるレスは全部読んだことにする(開いた直後でも。絞り込み中は別)
        val last = if (tree() && !filtering) maxOf(from, lastNo) else if (ctl.counting()) readHead(from, top, ctl.seen, exists, atBottom = ctl.atBottom && !filtering) else from
        val first = items.firstOrNull { it.offset + it.size > 0 }
        return last to first?.let { ScrollPos(it.key as Int, it.offset, ctl.atBottom) }
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
