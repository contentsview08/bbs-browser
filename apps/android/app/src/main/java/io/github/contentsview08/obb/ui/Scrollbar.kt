package io.github.contentsview08.obb.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest

/** 止まっているときの濃さ。どの辺にいるかが分かるだけにとどめる */
private const val IDLE_ALPHA = 0.16f
/** 動かしているときの濃さ */
private const val ACTIVE_ALPHA = 0.5f

/**
 * 一覧の右端に出す細いスクロールバー。位置を見せるだけで、つまめない(指の操作を受けない)。
 * 位置は見えている項目の平均の高さから見積もる(高さの違う項目でもおおよそ合えばよいので、測り直さない)。
 * 位置と濃さは描くときにだけ読み、スクロールで画面を組み直さない。
 * top・bottom: 上下の帯に隠れる分(px)。帯が出入りするので描くときに読む
 */
@Composable
fun ThinScrollbar(state: LazyListState, modifier: Modifier = Modifier, top: () -> Float = { 0f }, bottom: () -> Float = { 0f }) {
    val alpha = remember { Animatable(IDLE_ALPHA) }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.collectLatest { moving ->
            if (moving) alpha.animateTo(ACTIVE_ALPHA, tween(120))
            else { delay(500); alpha.animateTo(IDLE_ALPHA, tween(400)) }
        }
    }
    Box(
        modifier.fillMaxSize().drawBehind {
            val info = state.layoutInfo
            val items = info.visibleItemsInfo
            if (items.isEmpty()) return@drawBehind
            val span = scrollbarSpan(
                firstIndex = items[0].index, firstOffset = items[0].offset, avgSize = items.sumOf { it.size }.toFloat() / items.size,
                count = info.totalItemsCount, viewport = info.viewportEndOffset - info.viewportStartOffset,
                pads = info.beforeContentPadding + info.afterContentPadding,
                atTop = !state.canScrollBackward, atEnd = !state.canScrollForward,
            ) ?: return@drawBehind
            val margin = 3.dp.toPx()
            val trackTop = top() + margin
            val track = size.height - bottom() - margin - trackTop
            if (track <= 0f) return@drawBehind
            val len = maxOf(span.second * track, minOf(28.dp.toPx(), track))
            val w = 3.dp.toPx()
            drawRoundRect(
                Palette.textMuted.copy(alpha = alpha.value),
                topLeft = Offset(size.width - w - 2.dp.toPx(), trackTop + span.first * (track - len)),
                size = Size(w, len), cornerRadius = CornerRadius(w / 2),
            )
        },
    )
}

/**
 * つまみの位置(0〜1。上の端からの割合)と長さ(見えている割合)。全部見えているときは null。
 * firstOffset は最初に見えている項目の上端の位置(上へはみ出していれば負)。pads は上下の余白の合計
 */
internal fun scrollbarSpan(
    firstIndex: Int, firstOffset: Int, avgSize: Float, count: Int, viewport: Int, pads: Int,
    atTop: Boolean, atEnd: Boolean,
): Pair<Float, Float>? {
    if (count <= 0 || avgSize <= 0f || viewport <= 0 || (atTop && atEnd)) return null
    val content = avgSize * count + pads
    val maxScroll = content - viewport
    if (maxScroll <= 0f) return null
    val scrolled = firstIndex * avgSize - firstOffset
    val pos = when {
        atTop -> 0f
        atEnd -> 1f
        else -> (scrolled / maxScroll).coerceIn(0f, 1f)
    }
    return pos to (viewport / content).coerceIn(0f, 1f)
}
