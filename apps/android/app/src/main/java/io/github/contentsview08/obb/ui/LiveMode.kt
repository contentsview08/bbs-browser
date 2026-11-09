package io.github.contentsview08.obb.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

// 実況モード(bbs-suite の docs/autoscroll.md)。追いつくまでは一定の速さで流し、追いついた後は届いたレスを 1 つずつ下に積む

/** 更新の間隔の選択肢(秒) */
val LIVE_REFRESH_CHOICES = listOf(3, 5, 10, 20, 30)
const val LIVE_REFRESH_DEFAULT_SEC = 5
/** 流す速さ(1 秒に流す本文の行)の範囲と既定 */
const val LIVE_SPEED_MIN = 0.5f
const val LIVE_SPEED_MAX = 40f
const val LIVE_SPEED_DEFAULT = 2f
/** 1 件ずつ出す間の最小の間(ms)。これより詰めると 1 件ずつに見えない */
const val LIVE_MIN_GAP_MS = 100L

// ── 流す速さのスライダー(対数の目盛り。遅い側を細かく選べるように) ──

/** スライダーの位置(0〜1) → 速さ。10 行より遅ければ 0.1 行、速ければ 1 行の刻みに丸める */
fun liveSpeedOfPos(pos: Float): Float {
    val v = LIVE_SPEED_MIN * (LIVE_SPEED_MAX / LIVE_SPEED_MIN).pow(pos.coerceIn(0f, 1f))
    val r = if (v < 10f) (v * 10f).roundToInt() / 10f else v.roundToInt().toFloat()
    return r.coerceIn(LIVE_SPEED_MIN, LIVE_SPEED_MAX)
}

fun posOfLiveSpeed(speed: Float): Float =
    (ln(speed.coerceIn(LIVE_SPEED_MIN, LIVE_SPEED_MAX) / LIVE_SPEED_MIN) / ln(LIVE_SPEED_MAX / LIVE_SPEED_MIN)).coerceIn(0f, 1f)

/** 「1 秒に 2 行」の数のところ(2.0 は 2、0.5 は 0.5) */
fun liveSpeedText(speed: Float): String = if (speed % 1f == 0f) speed.toInt().toString() else "%.1f".format(speed)

// ── 書き込みの時刻 ──

private val JST = java.time.ZoneId.of("Asia/Tokyo")
/** 年/月/日(曜日など)時:分:秒(.小数)(時差)。年は 2 桁もある。日付と時刻の間は「(月) 」「T」「 」など */
private val DATE_TIME = Regex("""(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})[^0-9]{0,10}?(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d+))?\s*(Z|[+-]\d{2}:?\d{2})?""")
private val DATE_TIME_JA = Regex("""(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]{0,10}?(\d{1,2})時(\d{1,2})分(\d{1,2})秒""")

/**
 * レスの日時の文字から、書き込みの時刻(ms)を読む。秒まで書いていなければ null(秒がないと 1 件ずつの間が分からないため)。
 * 5ch の「2026/11/09(月) 00:01:43.12」、hono-bbs の ISO(と、それを 5ch の形に直したもの)、したらば・まちBBS の「2026/11/09(月) 00:01:43」を読む。
 * 時差の書いていないものは日本の時刻とみなす
 */
fun postTimeMs(date: String): Long? {
    val m = DATE_TIME.find(date) ?: DATE_TIME_JA.find(date) ?: return null
    val g = m.groupValues
    return runCatching {
        val year = g[1].toInt().let { if (it < 100) it + 2000 else it }
        val frac = g.getOrNull(7).orEmpty()
        val nanos = if (frac.isEmpty()) 0 else frac.take(3).padEnd(3, '0').toInt() * 1_000_000
        val local = java.time.LocalDateTime.of(year, g[2].toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt(), nanos)
        val zone = g.getOrNull(8).orEmpty()
        val offset = if (zone.isEmpty()) JST.rules.getOffset(local) else java.time.ZoneOffset.of(if (zone == "Z") "Z" else if (zone.length == 5) zone.substring(0, 3) + ":" + zone.substring(3) else zone)
        local.toInstant(offset).toEpochMilli()
    }.getOrNull()
}

// ── 出す時刻 ──

/** 出す予定が、更新の間隔のこの倍より先まで溜まったら、待たずに全部出す */
const val LIVE_FLUSH_INTERVALS = 3

/**
 * ライブの段で、更新で届いた N 件を更新から何 ms 後に出すか(届いた順に 1 件ずつ)。
 * - postTimesMs: 届いたレスの書き込みの時刻(postTimeMs。読めなければ null)
 * - baseTimeMs: 前の更新で最後に出したレスの書き込みの時刻(読めなければ null)
 * 時刻が全部読めて、基準から順に並んでいれば、基準からの差だけ遅らせる(差が T を超えるなら、比を保ったまま T の中に縮める)。
 * そうでなければ(秒が分からない・基準がない・順番が前後する)T ÷ N ごとの等間隔で、最後の 1 件を出すころに次の更新が来る。
 * どちらも 1 件あたり LIVE_MIN_GAP_MS より詰めず、詰めきれない分は T を超えて続ける
 */
fun liveRevealSchedule(postTimesMs: List<Long?>, baseTimeMs: Long?, intervalMs: Long): List<Long> {
    val n = postTimesMs.size
    if (n == 0) return emptyList()
    val t = intervalMs.coerceAtLeast(0L).toDouble()
    val ordered = baseTimeMs != null && postTimesMs.all { it != null } &&
        (listOf(baseTimeMs) + postTimesMs).zipWithNext().all { (a, b) -> a!! <= b!! }
    val delays: List<Double> = if (ordered) {
        val first = postTimesMs.first()!!
        val last = postTimesMs.last()!!
        // 基準から T より長く静かだったときは、その空白を数えない(届いた分が T の終わりにまとまって出ないように)
        val base = if (first - baseTimeMs > t) minOf(first.toDouble(), last - t) else baseTimeMs.toDouble()
        val diffs = postTimesMs.map { it!! - base }
        val span = diffs.last()
        if (span > t) diffs.map { it * t / span } else diffs
    } else {
        val gap = maxOf(t / n, LIVE_MIN_GAP_MS.toDouble())
        List(n) { gap * (it + 1) }
    }
    val out = delays.toMutableList()
    for (i in 1 until n) out[i] = maxOf(out[i], out[i - 1] + LIVE_MIN_GAP_MS)
    return out.map { Math.round(it) }
}

/**
 * 出す予定(liveRevealSchedule の遅れ)を時刻(ms)の列にする。まだ出していない前の分があれば(lastQueuedAtMs)、
 * その後ろに LIVE_MIN_GAP_MS ずつ空けて続ける。最後が間隔の LIVE_FLUSH_INTERVALS 倍より先になるほど溜まったら flush(全部出して一番下へ)
 */
fun liveQueueTimes(nowMs: Long, delaysMs: List<Long>, lastQueuedAtMs: Long?, intervalMs: Long): Pair<List<Long>, Boolean> {
    var prev = lastQueuedAtMs ?: (Long.MIN_VALUE / 2)
    val at = delaysMs.map { d -> maxOf(nowMs + d, prev + LIVE_MIN_GAP_MS).also { prev = it } }
    val flush = at.isNotEmpty() && at.last() - nowMs > intervalMs.coerceAtLeast(0L) * LIVE_FLUSH_INTERVALS
    return at to flush
}

// ── スクロール ──

/** 見えている行(並びの位置・上端・高さ) */
data class AutoRow(val index: Int, val offset: Int, val size: Int)

/**
 * 画面の下端(viewEnd)から行(lastIndex)の下端までの長さ。その行が画面の外なら、
 * 見えている行の平均の高さで、まだ測っていない行の分を見積もる。下に着いている・通り越しているなら 0 以下
 */
fun remainingToLastPx(rows: List<AutoRow>, lastIndex: Int, viewEnd: Int): Float {
    if (lastIndex < 0) return 0f
    val posts = rows.filter { it.index <= lastIndex }
    val lv = posts.maxByOrNull { it.index } ?: return 0f
    val shown = posts.filter { it.size > 0 }
    val avg = if (shown.isEmpty()) 0f else shown.sumOf { it.size }.toFloat() / shown.size
    return (lv.offset + lv.size - viewEnd) + (lastIndex - lv.index) * avg
}

/** 一番下にくっつく動きの時定数(秒)。届いたレスの分だけ、すっと上がる */
private const val STICK_TAU = 0.07f

/**
 * 実況モードの間、毎フレーム動かす。
 * - 追いつくまで: 流す速さで一定に送る。指で動かしている間は送らず、離したらそこから続ける。一番下に着いたらライブへ
 * - ライブ: 出す時刻の来たレスを出し、一番下にくっつく。指で上へ動かしたら外れる(隠していたレスは全部出す)
 * - 外れている間: 送らない。自分で一番下まで戻ったらライブへ
 */
suspend fun runLiveMode(
    ctl: ThreadScrollCtl,
    state: LazyListState,
    lineHeightPx: () -> Float,
    speed: () -> Float,
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
        if (!ctl.positioned || ctl.keepJump) { carry = 0f; continue }
        val info = state.layoutInfo
        val end = info.viewportEndOffset - info.afterContentPadding
        val rows = info.visibleItemsInfo.map { AutoRow(it.index, it.offset, it.size) }
        val lh = lineHeightPx().coerceAtLeast(1f)
        // 一番下は、レスの後ろの -END- などの行まで含めた下端
        val rem = if (state.canScrollForward) remainingToLastPx(rows, info.totalItemsCount - 1, end) else 0f
        if (state.isScrollInProgress) {
            // 指(か、ほかの送る動き)が動かしている。ライブの間に上へ離れたら外れる
            if (ctl.livePhase == LivePhase.LIVE && rem > lh * 1.5f) ctl.leaveLive()
            carry = 0f
            continue
        }
        when (ctl.livePhase) {
            LivePhase.PAUSED -> if (rem <= lh) ctl.enterLive()
            LivePhase.CATCH_UP -> {
                if (rem < 1f) ctl.enterLive()
                else {
                    carry += minOf(speed() * lh * dt, rem)
                    // 1 px に満たない分は溜めて送る(遅いときに止まって見えないように)
                    if (carry >= 1f) {
                        val step = kotlin.math.floor(carry)
                        carry -= step
                        scrollQuietly(state, step)
                    }
                }
            }
            LivePhase.LIVE -> {
                ctl.revealDue(System.currentTimeMillis())
                if (rem >= 0.5f) scrollQuietly(state, maxOf(1f, rem * (1f - exp(-dt / STICK_TAU))).coerceAtMost(rem.coerceAtLeast(1f)))
            }
        }
        // 動き続けている間は位置が止まらず、ふだんの既読の書き込み(止まってから 0.3 秒後)が来ないので、ここで知らせる
        val ms = now / 1_000_000
        if (ms - reportedAt >= 1000) { reportedAt = ms; report() }
    }
}

private suspend fun scrollQuietly(state: LazyListState, px: Float) {
    try { state.scrollBy(px) } catch (e: CancellationException) {
        // 指の操作が割り込んだ。自分が止められたのでなければ続ける
        currentCoroutineContext().ensureActive()
    }
}

/** ライブの段で出たレスの、ポンと出る動き(出た時刻から短いあいだだけ) */
const val LIVE_POP_MS = 260

// ── 右上の速さのスライダー ──

private const val SLIDER_IDLE_ALPHA = 0.35f
private const val SLIDER_IDLE_AFTER_MS = 1800L

/** 実況モードの間だけ出す、半透明の小さなスライダー。触っていない間は薄く、触ると濃くなる。onTouch は指を置いたとき(後ろのジェスチャーを止めるため) */
@Composable
fun LiveSpeedSlider(speed: Float, onChange: (Float) -> Unit, modifier: Modifier = Modifier, onTouch: () -> Unit = {}) {
    val density = LocalDensity.current
    var trackW by remember { mutableIntStateOf(1) }
    var touching by remember { mutableStateOf(false) }
    var lastTouch by remember { mutableStateOf(0L) }
    val alpha = remember { Animatable(SLIDER_IDLE_ALPHA) }
    LaunchedEffect(touching, lastTouch) {
        if (touching) alpha.animateTo(0.95f, tween(120))
        else { delay(SLIDER_IDLE_AFTER_MS); alpha.animateTo(SLIDER_IDLE_ALPHA, tween(500)) }
    }
    val pos = posOfLiveSpeed(speed)
    val thumb = 14.dp
    Row(
        modifier.graphicsLayer { this.alpha = alpha.value }
            .background(Palette.surface.copy(alpha = 0.85f), RoundedCornerShape(50))
            .padding(start = 10.dp, end = 8.dp).height(30.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${liveSpeedText(speed)} 行/秒", Modifier.width(56.dp), color = Palette.textStrong, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Box(
            Modifier.width(96.dp).fillMaxHeight().onSizeChanged { trackW = it.width.coerceAtLeast(1) }
                // 下のスレ表示を動かさないよう、指はここで受けきる
                .pointerInput(Unit) {
                    val pad = thumb.toPx() / 2
                    fun posAt(x: Float) = ((x - pad) / (size.width - 2 * pad).coerceAtLeast(1f)).coerceIn(0f, 1f)
                    awaitEachGesture {
                        val d = awaitFirstDown(requireUnconsumed = false)
                        d.consume()
                        onTouch()
                        touching = true
                        onChange(liveSpeedOfPos(posAt(d.position.x)))
                        do {
                            val e = awaitPointerEvent()
                            val c = e.changes.firstOrNull { it.id == d.id } ?: break
                            if (c.pressed) onChange(liveSpeedOfPos(posAt(c.position.x)))
                            e.changes.forEach { it.consume() }
                        } while (e.changes.any { it.pressed })
                        touching = false
                        lastTouch = System.nanoTime()
                    }
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            val usable = with(density) { (trackW.toFloat() - thumb.toPx()).coerceAtLeast(0f).toDp() }
            Box(Modifier.padding(horizontal = thumb / 2).fillMaxWidth().height(3.dp).background(Palette.border, RoundedCornerShape(50)))
            Box(Modifier.padding(start = thumb / 2).width(usable * pos).height(3.dp).background(Palette.accent, RoundedCornerShape(50)))
            Box(Modifier.offset(x = usable * pos).size(thumb).background(Palette.accent, CircleShape))
        }
    }
}
