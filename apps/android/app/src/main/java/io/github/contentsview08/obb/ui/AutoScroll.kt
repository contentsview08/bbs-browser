package io.github.contentsview08.obb.ui

import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

// 自動で流す(bbs-suite の docs/autoscroll.md)。速さの式は PC 版・Web と同じ

/** 速さの選択肢 → 既定の速さ(1 秒に流す行)。既定の速さは、追いつくまでの速さと追いついた後の最低の速さを兼ねる */
val AUTO_SCROLL_SPEEDS = linkedMapOf("slow" to 1f, "normal" to 2f, "fast" to 4f)
const val AUTO_SCROLL_DEFAULT_SPEED = "normal"
/** 最大の速さは既定の速さのこの倍 */
const val AUTO_SCROLL_MAX_FACTOR = 6f
/** 更新が遅れたとき、1 秒に残りの距離のこの割合だけ寄せる(下に近づくほどゆっくりになる) */
const val AUTO_SCROLL_LATE_RATE = 0.5f
/** 溜まった分がこの画面の枚数を超えたら、一番下へ飛ぶ札を出す */
const val AUTO_SCROLL_BACKLOG_SCREENS = 10f

/**
 * 自動で流す速さ(px/秒)。
 * - remainingPx: 画面の下端から最後のレスの下端までの長さ。0 以下なら下に着いているので 0
 * - msToNext: 次の自動更新までの時間。null は自動更新がオフ(追いついた後も既定の速さで下まで流し、下で止まる)
 * - lineHeightPx: 本文の 1 行の高さ(字を大きくしても体感の速さが変わらないように)
 * - caughtUp: 一度一番下に着いた。着くまでは既定の速さで一定に流す
 * 追いついた後は「残り ÷ 次の更新までの時間」で、次の更新の時刻にちょうど下に着く速さ。
 * 既定の速さより遅くしない(新着が少ないときに這うように動かないように。早く着いたら下で待つ)、最大の速さを超えない。
 * 更新が遅れて時間が 0 以下なら、残りの距離 × 0.5 / 秒で寄せる
 */
fun autoScrollSpeed(remainingPx: Float, msToNext: Long?, lineHeightPx: Float, speedKey: String, caughtUp: Boolean): Float {
    if (remainingPx <= 0f) return 0f
    val base = (AUTO_SCROLL_SPEEDS[speedKey] ?: AUTO_SCROLL_SPEEDS.getValue(AUTO_SCROLL_DEFAULT_SPEED)) * lineHeightPx
    val max = base * AUTO_SCROLL_MAX_FACTOR
    if (!caughtUp || msToNext == null) return base
    if (msToNext <= 0L) return minOf(remainingPx * AUTO_SCROLL_LATE_RATE, max)
    return (remainingPx / (msToNext / 1000f)).coerceIn(base, max)
}

/** 見えている行(並びの位置・上端・高さ) */
data class AutoRow(val index: Int, val offset: Int, val size: Int)

/**
 * 画面の下端(viewEnd)から最後のレス(lastIndex)の下端までの長さ。最後のレスが画面の外なら、
 * 見えているレスの平均の高さで、まだ測っていないレスの分を見積もる。下に着いている・通り越しているなら 0 以下
 */
fun remainingToLastPx(rows: List<AutoRow>, lastIndex: Int, viewEnd: Int): Float {
    if (lastIndex < 0) return 0f
    val posts = rows.filter { it.index <= lastIndex }
    // 見えているのが -END- などレスより後の行だけなら、もう通り越している
    val lv = posts.maxByOrNull { it.index } ?: return 0f
    val shown = posts.filter { it.size > 0 }
    val avg = if (shown.isEmpty()) 0f else shown.sumOf { it.size }.toFloat() / shown.size
    return (lv.offset + lv.size - viewEnd) + (lastIndex - lv.index) * avg
}

/** 画面の下端より下にあるレスの数(上端が下端より上のレスまでは見えているとする) */
fun postsBelow(rows: List<AutoRow>, lastIndex: Int, viewEnd: Int): Int {
    val seen = rows.filter { it.index <= lastIndex && it.offset < viewEnd }.maxOfOrNull { it.index } ?: return 0
    return (lastIndex - seen).coerceAtLeast(0)
}

/**
 * 自動で流す(オンの間だけ動かす)。毎フレーム残りの距離を測り直して、その分だけ送る。
 * 送るのは利用者の操作より弱いので、ほかのスクロール(指・一番下へ・新着へ送る動き)が動いている間は、そのフレームは送らない。
 * 指で触ったら止め(ThreadScreen が autoPaused を立てる)、自分で一番下まで戻ったら、追いついた後として続ける
 */
suspend fun runAutoScroll(
    ctl: ThreadScrollCtl,
    state: LazyListState,
    lastIndex: () -> Int,
    lineHeightPx: () -> Float,
    speedKey: () -> String,
    msToNext: () -> Long?,
    report: () -> Unit,
) {
    var prev = 0L
    var carry = 0f
    var reportedAt = 0L
    while (true) {
        val now = withFrameNanos { it }
        // 裏から戻ったときなどに、止まっていた間の分を一度に送らない
        val dt = if (prev == 0L) 0f else ((now - prev) / 1e9f).coerceAtMost(0.1f)
        prev = now
        // 開いた直後の位置決め・レスへ飛ぶ動きが終わるまでは送らない
        if (!ctl.positioned || ctl.keepJump || state.isScrollInProgress) { carry = 0f; continue }
        val info = state.layoutInfo
        val end = info.viewportEndOffset - info.afterContentPadding
        val rows = info.visibleItemsInfo.map { AutoRow(it.index, it.offset, it.size) }
        val last = lastIndex()
        val lh = lineHeightPx().coerceAtLeast(1f)
        val rem = remainingToLastPx(rows, last, end)
        if (ctl.autoPaused) {
            if (!state.canScrollForward || rem <= lh) { ctl.autoPaused = false; ctl.autoCaughtUp = true }
            carry = 0f
            continue
        }
        if (rem < 1f) {
            ctl.autoCaughtUp = true
            ctl.autoBacklog = 0
            carry = 0f
            continue
        }
        val height = (end - info.viewportStartOffset - info.beforeContentPadding).coerceAtLeast(1)
        ctl.autoBacklog = if (rem > height * AUTO_SCROLL_BACKLOG_SCREENS) postsBelow(rows, last, end) else 0
        val v = autoScrollSpeed(rem, msToNext(), lh, speedKey(), ctl.autoCaughtUp)
        carry += minOf(v * dt, rem)
        // 1 px に満たない分は溜めて送る(ゆっくりのときに止まって見えないように)
        if (carry >= 1f) {
            val step = kotlin.math.floor(carry)
            carry -= step
            try { state.scrollBy(step) } catch (e: CancellationException) {
                // 指の操作が割り込んだ。自分が止められたのでなければ続ける
                currentCoroutineContext().ensureActive()
            }
        }
        // 流し続けている間は位置が止まらず、ふだんの既読の書き込み(止まってから 0.3 秒後)が来ないので、ここで知らせる
        val ms = now / 1_000_000
        if (ms - reportedAt >= 1000) { reportedAt = ms; report() }
    }
}
