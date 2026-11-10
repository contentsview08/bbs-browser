package io.github.contentsview08.obb.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 切り替えボタンの寸法。PC・Web(スマホ表示)もこの数でそろえる(bbs-suite/docs/style-tree.md) */
object SegmentSize {
    val height = 36.dp
    val radius = 10.dp
    /** 枠とつまみの間 */
    val inset = 3.dp
    val thumbRadius = 7.dp
    /** 1 つの選択肢の左右の余白 */
    val padX = 10.dp
    const val FONT_SP = 13
    /** 収まらないときに下げる下限。これでも収まらなければ横に流す */
    const val FONT_MIN_SP = 11
    const val MOVE_MS = 180
}

/**
 * 選択肢ごとの幅を決める。need は文字と余白の要る幅、avail は使える幅。
 * 等分で収まれば等分(つまみの幅がそろって落ち着く)、無理なら要る幅に余りを均等に足す。それでも収まらなければ null
 */
fun fitSegments(need: List<Float>, avail: Float): List<Float>? {
    if (need.isEmpty()) return emptyList()
    val max = need.max()
    if (max * need.size <= avail) return List(need.size) { avail / need.size }
    val sum = need.sum()
    if (sum > avail) return null
    val extra = (avail - sum) / need.size
    return need.map { it + extra }
}

/**
 * どれか 1 つを選ぶ、つながった切り替えボタン。1 本の枠の中に選択肢を並べ、選んでいる所に差し色のつまみが乗り、選び直すと滑って動く。
 * 名前の括弧の中の説明は、狭いので省く。
 */
@Composable
fun Segmented(options: List<Pair<String, String>>, value: String, modifier: Modifier = Modifier, onPick: (String) -> Unit) {
    val labels = options.map { it.second.substringBefore('(') }
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val inner = maxWidth - SegmentSize.inset * 2
        // 太字で測る(選んだ所だけ太くしても幅が変わらないように)。大きい字から順に、収まる大きさを探す
        val fit = remember(labels, inner, density) {
            val innerPx = with(density) { inner.toPx() }
            val pad = with(density) { (SegmentSize.padX * 2).toPx() }
            var last: Pair<Int, List<Float>> = SegmentSize.FONT_MIN_SP to emptyList()
            for (sp in SegmentSize.FONT_SP downTo SegmentSize.FONT_MIN_SP) {
                val need = labels.map { measurer.measure(it, TextStyle(fontSize = sp.sp, fontWeight = FontWeight.Bold), maxLines = 1).size.width + pad }
                val w = fitSegments(need, innerPx)
                if (w != null) return@remember Triple(sp, w, false)
                last = sp to need
            }
            Triple(last.first, last.second, true)
        }
        val (fontSp, widthsPx, scroll) = fit
        val widths = with(density) { widthsPx.map { it.toDp() } }
        val i = options.indexOfFirst { it.first == value }.coerceAtLeast(0)
        val spec: AnimationSpec<Dp> = if (Motion.reduced) snap() else tween(SegmentSize.MOVE_MS, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))
        val x by animateDpAsState(widths.take(i).fold(0.dp) { a, b -> a + b }, spec, label = "segX")
        val w by animateDpAsState(widths.getOrElse(i) { 0.dp }, spec, label = "segW")
        val outer = RoundedCornerShape(SegmentSize.radius)
        val scrollState = rememberScrollState()
        // 横に流すときは、選んだ所が見えるように寄せる
        if (scroll) LaunchedEffect(i) { scrollState.animateScrollTo(with(density) { (x - 24.dp).toPx() }.toInt().coerceAtLeast(0)) }
        Box(
            Modifier.fillMaxWidth().height(SegmentSize.height).clip(outer).background(Palette.surface2, outer).border(1.dp, Palette.border, outer)
                .then(if (scroll) Modifier.horizontalScroll(scrollState) else Modifier),
        ) {
            Box(Modifier.padding(SegmentSize.inset).fillMaxHeight()) {
                Box(Modifier.offset(x = x).width(w).fillMaxHeight().background(Palette.accent, RoundedCornerShape(SegmentSize.thumbRadius)))
                Row(Modifier.fillMaxHeight().selectableGroup()) {
                    options.forEachIndexed { j, (k, _) ->
                        val on = j == i
                        val c by animateColorAsState(
                            if (on) Palette.accentText else Palette.textBody,
                            if (Motion.reduced) snap() else tween(SegmentSize.MOVE_MS), label = "segText",
                        )
                        Box(
                            Modifier.width(widths.getOrElse(j) { 0.dp }).fillMaxHeight().clip(RoundedCornerShape(SegmentSize.thumbRadius))
                                .selectable(on, role = Role.RadioButton) { if (!on) onPick(k) },
                            contentAlignment = Alignment.Center,
                        ) { Text(labels[j], color = c, fontSize = fontSp.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, maxLines = 1, softWrap = false) }
                    }
                }
            }
        }
    }
}
