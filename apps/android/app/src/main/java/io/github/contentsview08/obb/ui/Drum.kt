package io.github.contentsview08.obb.ui

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max

/** ドラムの枠の中の並び。行は drumItem() を付ける */
class DrumState(val list: LazyListState) {
    var edgePx = 0f
}

/**
 * 決まった高さの枠の中で縦にスクロールする並び。枠の上下の端に近い行ほど、円柱の表面に沿って奥へ回り込むように見せる
 * (スクロールできることを、見ただけで分からせるため)。枠の高さは modifier で抑える(行が少なければ行の分だけになる)。
 * 行が多くても(引き出しの履歴は 100 件)見えている行だけを組み立てるよう LazyColumn にする。
 * 動きはスクロールの位置を graphicsLayer の中で読むだけなので、スクロールしても組み直し・測り直しは起きない
 */
@Composable
fun DrumColumn(modifier: Modifier = Modifier, edge: Dp = 56.dp, content: LazyListScope.(DrumState) -> Unit) {
    val list = rememberLazyListState()
    val state = remember(list) { DrumState(list) }
    state.edgePx = with(LocalDensity.current) { edge.toPx() }
    LazyColumn(modifier, state = list) { content(state) }
}

/**
 * ドラムの行(index は並びの中の番号)。t = 端への近さ(0 は真ん中のふつうの見た目、1 は端の線の上)に、その端の向こうにまだ行が隠れている度合いを掛ける
 * (一番上・一番下で止まっているときは、その端の行をつぶさない)。
 * t に合わせて、手前から奥へ最大 50° 倒し・幅を 8% 縮め・濃さを 30% まで落とす。動きを減らすときは倒さず、薄くするだけ
 */
fun Modifier.drumItem(d: DrumState, index: Int): Modifier = graphicsLayer {
    val info = d.list.layoutInfo
    val vp = info.viewportSize.height.toFloat()
    if (vp <= 0f) return@graphicsLayer
    val items = info.visibleItemsInfo
    val item = items.firstOrNull { it.index == index } ?: return@graphicsLayer
    val e = minOf(d.edgePx, vp / 2f)
    val c = item.offset - info.viewportStartOffset + item.size / 2f // 枠の上端から行の真ん中まで
    // 枠の外に隠れている量(上・下)。端の帯の幅より多ければ、それ以上は数えない
    val first = items.first()
    val last = items.last()
    val above = if (first.index > 0) e else (info.viewportStartOffset - first.offset).toFloat()
    val below = if (last.index < info.totalItemsCount - 1) e else (last.offset + last.size - info.viewportEndOffset).toFloat()
    val tTop = (1f - c / e).coerceIn(0f, 1f) * (above / e).coerceIn(0f, 1f)
    val tBottom = (1f - (vp - c) / e).coerceIn(0f, 1f) * (below / e).coerceIn(0f, 1f)
    val t = max(tTop, tBottom)
    if (Motion.reduced) {
        alpha = 1f - 0.8f * t
    } else {
        alpha = 1f - 0.7f * t
        // 上の端では行の上側が、下の端では行の下側が奥へ行く向き
        rotationX = (if (tTop >= tBottom) 50f else -50f) * t
        scaleX = 1f - 0.08f * t
        cameraDistance = 6f * density
    }
}

private const val FLEX = "flex"

/** FitColumn の中で、残りの高さに抑える子に付ける */
fun Modifier.fitFlex(): Modifier = layoutId(FLEX)

/**
 * 縦の並び。fitFlex() を付けた子だけ、ほかの子を並べた残りの高さ(avail から引いた分。少なくとも minFlex)までに抑える。
 * ほかの子が多くて avail を超えるときは、modifier に付けた外のスクロールに任せる
 */
@Composable
fun FitColumn(avail: Dp, minFlex: Dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0, maxHeight = Constraints.Infinity)
        val fixed = measurables.map { if (it.layoutId == FLEX) null else it.measure(loose) }
        val room = max(avail.roundToPx() - fixed.sumOf { it?.height ?: 0 }, minFlex.roundToPx())
        val placeables = measurables.mapIndexed { i, m -> fixed[i] ?: m.measure(loose.copy(maxHeight = room)) }
        layout(constraints.maxWidth, placeables.sumOf { it.height }) {
            var y = 0
            for (p in placeables) { p.placeRelative(0, y); y += p.height }
        }
    }
}
