package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.TreeRow

/**
 * ポップアップ 1 枚。posts(アンカー先・返信・同じ ID / 名前)か、tree(アンカーツリー)のどちらかを出す。
 * triggerY: 押した所の高さ(スレ表示の領域の中の座標)。focusNo: 開いたときに見せる(色を付ける)レス
 */
class PopupEntry(val id: Int, val posts: List<Post>, val tree: List<TreeRow>? = null, val triggerY: Float, val focusNo: Int? = null)

/**
 * レスのポップアップ(今のスマホ版の PostPopup と同じ)。スレ表示の領域いっぱいの幅で、押した所の真上に収まるなら真上に、
 * 収まらなければ上の帯のすぐ下から出す。高さは領域の 8 割まで(外を押して閉じられるように)。
 * ポップアップの中のアンカーを押すと上に積み重なる。外を押すと一番上を閉じる。下のポップアップは押せない(押すと一番上が閉じる)
 */
@Composable
fun PopupLayer(
    popups: List<PopupEntry>,
    topInset: Float,
    onCloseTop: () -> Unit,
    post: @Composable (Post) -> Unit,
) {
    if (popups.isEmpty()) return
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val areaH = constraints.maxHeight.toFloat()
        val noRipple = remember { MutableInteractionSource() }
        popups.forEachIndexed { i, e ->
            // 一番上の下に、外を押したら閉じる幕を敷く(下のポップアップも幕の下になるので押せない)
            if (i == popups.lastIndex) {
                Box(Modifier.fillMaxSize().clickable(interactionSource = noRipple, indication = null, onClick = onCloseTop))
            }
            PopupWindow(e, topInset, areaH, post)
        }
    }
}

@Composable
private fun PopupWindow(e: PopupEntry, topInset: Float, areaH: Float, post: @Composable (Post) -> Unit) {
    val density = LocalDensity.current
    val gap = with(density) { 4.dp.toPx() }
    val minTop = topInset + gap
    val limit = (areaH - minTop) * 0.8f
    val shape = RoundedCornerShape(12.dp)
    Layout(
        content = {
            Box(
                Modifier.padding(horizontal = 6.dp).shadow(12.dp, shape).clip(shape).background(Palette.surface).border(2.dp, Palette.accent, shape)
                    // 中を押しても幕に届かない(閉じない)ように
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
            ) { PopupContent(e, post) }
        },
    ) { measurables, constraints ->
        val spaceAbove = e.triggerY - minTop - gap
        val p = measurables.first().measure(Constraints(maxWidth = constraints.maxWidth, maxHeight = limit.toInt().coerceAtLeast(0)))
        // 押した所の真上に収まるなら真上、収まらなければ上の帯のすぐ下
        val y = if (p.height <= spaceAbove) e.triggerY - p.height - gap else minTop
        layout(constraints.maxWidth, constraints.maxHeight) { p.place(0, y.toInt()) }
    }
}

@Composable
private fun PopupContent(e: PopupEntry, post: @Composable (Post) -> Unit) {
    val state = rememberLazyListState()
    val tree = e.tree
    // 見せたいレスまで中を送る(長いツリーで、起点のレスが下に隠れないように)
    LaunchedEffect(e.id) {
        val at = if (tree != null) tree.indexOfFirst { it.no == e.focusNo } else e.posts.indexOfFirst { it.no == e.focusNo }
        if (at > 0) state.scrollToItem(at, -200)
    }
    if (tree == null) {
        LazyColumn(state = state) {
            itemsIndexed(e.posts, key = { _, p -> p.no }) { i, p ->
                if (i > 0) HorizontalDivider(color = Palette.border)
                Box(if (p.no == e.focusNo) Modifier.background(Palette.accentWash) else Modifier) { post(p) }
            }
        }
    } else {
        val byNo = remember(e.posts) { e.posts.associateBy { it.no } }
        LazyColumn(state = state) {
            itemsIndexed(tree, key = { _, r -> r.no }) { i, r ->
                val p = byNo[r.no] ?: return@itemsIndexed
                TreeStep(r, depthChanged = i > 0 && tree[i - 1].depth != r.depth, focus = r.no == e.focusNo) { post(p) }
            }
        }
    }
}

/** スマホのツリーの 1 行(今のスマホ版の StepTree): 段の分だけ左を薄い灰色で塗り、縦線を引く。段が変わる所に線 */
@Composable
private fun TreeStep(r: TreeRow, depthChanged: Boolean, focus: Boolean, content: @Composable () -> Unit) {
    // 深い段は 5 段にそろえる(右へずれ続けて、本文の幅がなくなるのを防ぐ)
    val depth = minOf(r.depth, 5)
    Column {
        if (depthChanged) HorizontalDivider(thickness = 1.5.dp, color = Palette.borderStrong)
        Row(Modifier.height(IntrinsicSize.Min).then(if (focus) Modifier.background(Palette.accentWash) else Modifier)) {
            Box(Modifier.width((4 + depth * 10).dp).fillMaxHeight().background(Palette.textMuted.copy(alpha = 0.14f)))
            Box(Modifier.width(2.dp).fillMaxHeight().background(Palette.textMuted.copy(alpha = 0.8f)))
            Column(Modifier.weight(1f)) {
                content()
                if (r.alsoTo.isNotEmpty()) {
                    Text(r.alsoTo.joinToString(" ") { ">>$it" } + " にも", Modifier.padding(start = 14.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 10.sp)
                }
            }
        }
    }
}
