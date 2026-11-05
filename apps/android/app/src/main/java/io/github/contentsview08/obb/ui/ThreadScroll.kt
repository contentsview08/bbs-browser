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

/*
 * スレ表示のスクロールまわり。今のスマホ版の hooks/useThreadScroll.ts と utils/threadScroll.ts をそのまま写したもの:
 * - 開いたら、覚えた位置(戻って開き直したとき)→ 設定の位置(最初の未読・先頭・一番下)へ置く。未読の頭は、見えている範囲の上から 3 割の所に
 * - スクロールが止まって 300ms たったら、どこまで読んだかを知らせ、読んでいた位置を覚える
 * - 新着が届いたら光らせ(35ms ずつずらして出す・合わせて 450ms まで・1 秒光る)、必要なら新着の頭まで送る
 * - 新着の頭が画面の外なら、下から「新着 +N」の札を 2.5 秒出す
 */

/** 未読の頭を置く位置(見えている範囲の上からの割合) */
private const val UNREAD_AT = 0.3f
private const val STAGGER_MS = 35f
private const val STAGGER_TOTAL_MS = 450f
private const val FLASH_MS = 1000L
private const val NEW_TOAST_MS = 2500L

/** スレ表示 1 つぶんの、スクロールの覚え(開き直すと作り直す) */
@Stable
class ThreadScrollCtl(val page: Page.Thread) {
    var positioned = false
    /** 開いてから、まだ利用者がスクロールしていない */
    var untouched = true
    /** 開いてから、まだ新着を受け取っていない(次に届くのは開いたときの取得の分) */
    var firstGrowth = true
    /** 知らせた既読の番号 */
    var sent = page.readNo
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
}

/** 新着を若い番号から順に出すときの、1 件ごとの遅れ(PC 版の staggerDelays) */
fun staggerDelays(nos: List<Int>): Map<Int, Int> {
    val d = minOf(STAGGER_MS, STAGGER_TOTAL_MS / maxOf(1, nos.size - 1))
    return nos.mapIndexed { i, n -> n to Math.round(i * d) }.toMap()
}

/**
 * スクロールの操作をまとめたもの。shown は今並んでいるレス(絞り込み後)、header・footer は重なっている帯の高さ(px)
 */
class ThreadScroller(
    private val ctl: ThreadScrollCtl,
    private val state: LazyListState,
    private val scope: CoroutineScope,
    private val shown: () -> List<io.github.contentsview08.obb.bbs.Post>,
    private val footer: () -> Float,
    private val bottomPx: Float,
) {
    private fun indexOf(no: Int) = shown().indexOfFirst { it.no >= no }

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
    fun toTop() { scope.launch { state.scrollToItem(0) } }

    /**
     * 開いたとき(最初にレスが出たとき)。覚えた位置 → 設定(一番下・最初の未読)→ 先頭(PC 版の openTarget)。
     * 最初の未読がまだ手元にない(前回最後まで読んでいた)ときは、一番下に置いて新着を待つ
     */
    suspend fun open(saved: ScrollPos?, openPosition: String) {
        val page = ctl.page
        val posts = page.index.posts
        ctl.sent = maxOf(ctl.sent, page.readNo)
        val savedIdx = saved?.let { s -> shown().indexOfFirst { it.no == s.no } } ?: -1
        val unreadFrom = page.unreadFrom
        val hasUnread = posts.any { it.no == unreadFrom }
        when {
            saved?.bottom == true -> toBottomNow()
            // 覚えたずれは「上の帯の下からの位置」(上へはみ出していれば負)。scrollToItem は送る量なので符号を返す
            saved != null && savedIdx >= 0 -> state.scrollToItem(savedIdx, -saved.offset)
            openPosition == "bottom" -> toBottomNow()
            openPosition == "unread" && unreadFrom > 1 -> if (hasUnread) toUnreadNow(unreadFrom) else { toBottomNow(); ctl.pendingUnread = true }
            else -> state.scrollToItem(0)
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
     * - 読んでいる途中は、設定がオンで一番下を見ているときだけ、新着の頭へ動かして見せる
     */
    fun grew(autoScrollOnNew: Boolean) {
        val page = ctl.page
        val posts = page.index.posts
        val grew = posts.size > ctl.prevCount
        ctl.prevCount = posts.size
        val prevLastNo = ctl.lastMax
        ctl.lastMax = posts.lastOrNull()?.no ?: 0
        if (!grew || !ctl.positioned) return
        val fresh = posts.filter { it.no > prevLastNo }.map { it.no }
        if (fresh.isEmpty()) return
        ctl.flashAt = System.currentTimeMillis()
        // 動きを減らすときは、浮き上がりも光りもしない
        if (!Motion.reduced) ctl.flash = staggerDelays(fresh)
        scope.launch { delay(FLASH_MS + STAGGER_TOTAL_MS.toLong()); ctl.flash = emptyMap() }
        val opening = ctl.untouched && ctl.firstGrowth
        ctl.firstGrowth = false
        val unreadFrom = page.unreadFrom
        val head = prevLastNo + 1
        when {
            ctl.pendingUnread && posts.any { it.no == unreadFrom } -> toUnread(unreadFrom)
            opening -> if (ctl.sent >= prevLastNo) toUnread(head)
            autoScrollOnNew && ctl.atBottom -> toUnread(head, animate = true)
        }
        ctl.pendingUnread = false
        // 新着の頭が画面の外なら、下から「新着 +N」を少しのあいだ出す(送り終わるのを待ってから確かめる)
        val first = fresh.first()
        scope.launch {
            delay(450)
            if (!isVisible(first)) {
                ctl.newToast = fresh.size to first
                delay(NEW_TOAST_MS)
                if (ctl.newToast?.second == first) ctl.newToast = null
            }
        }
    }

    /** そのレスが見えているか(上の端が、画面の下端より上にある) */
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
        if (ctl.atBottom) last = maxOf(last, ctl.page.index.posts.lastOrNull()?.no ?: 0)
        val top = items.firstOrNull { it.offset + it.size > 0 }
        return last to top?.let { ScrollPos(it.key as Int, it.offset, ctl.atBottom) }
    }
}

// ── 引っぱって更新(今のスマホ版の useTouchPull・useWheelPullRefresh・PullSpinner) ──

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

/** 上か下の端の、引っぱって更新の印の状態 */
@Stable
class PullState(private val onCommit: () -> Unit = {}) {
    /** 引いた量(dp) */
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

/**
 * 本文の上の端で下へ、下の端で上へ引っぱると更新する(今どきのチャットと同じ)。端に着いたかは指を動かすたびに見る
 * (同じ指のまま、スクロールして端に着き、そのまま引っぱっても効くように)
 */
class PullConnection(
    private val top: PullState?,
    private val bottom: PullState?,
    private val density: Float,
    private val scope: CoroutineScope,
    private val refresh: suspend () -> Unit,
) : NestedScrollConnection {
    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source != NestedScrollSource.UserInput) return Offset.Zero
        // 引いている途中で指を戻したら、まず引いた分を戻す
        if (top != null && top.dist > 0f && available.y < 0f) {
            val d = minOf(top.dist * density, -available.y)
            scope.launch { top.pull(top.dist - d / density) }
            return Offset(0f, -d)
        }
        if (bottom != null && bottom.dist > 0f && available.y > 0f) {
            val d = minOf(bottom.dist * density, available.y)
            scope.launch { bottom.pull(bottom.dist - d / density) }
            return Offset(0f, d)
        }
        return Offset.Zero
    }

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        if (source != NestedScrollSource.UserInput) return Offset.Zero
        if (top != null && available.y > 0f) { scope.launch { top.pull(top.dist + available.y / density) }; return Offset(0f, available.y) }
        if (bottom != null && available.y < 0f) { scope.launch { bottom.pull(bottom.dist - available.y / density) }; return Offset(0f, available.y) }
        return Offset.Zero
    }

    override suspend fun onPreFling(available: Velocity): Velocity {
        top?.let { t -> if (t.dist > 0f) scope.launch { t.release(refresh) } }
        bottom?.let { b -> if (b.dist > 0f) scope.launch { b.release(refresh) } }
        return Velocity.Zero
    }
}

/** 引っぱって更新の印(丸の中の更新の矢印。引いた分だけ回り、確定したらくるくる回る)。sign は上の端なら 1、下の端なら -1 */
@Composable
fun PullSpinner(state: PullState, sign: Int, modifier: Modifier = Modifier) {
    val spin = rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "r")
    Box(
        modifier.graphicsLayer { translationY = sign * state.y.value * density; alpha = state.alpha.value }
            .size(42.dp).background(Palette.surface, CircleShape).border(1.dp, Palette.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.Refresh, null, tint = Palette.accent, modifier = Modifier.size(24.dp).rotate(if (state.spinning) spin.value else state.progress * 360f))
    }
}
