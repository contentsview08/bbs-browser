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
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
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
class PopupEntry(val id: Int, val posts: List<Post>, val tree: List<TreeRow>? = null, val triggerY: Float, val focusNo: Int? = null, val triggerX: Float = -1f) {
    /** 中のスクロール(ジェスチャーの「先頭へ」「一番下へ」で、一番上のポップアップを送る) */
    val state = androidx.compose.foundation.lazy.LazyListState()
}

/**
 * レスのポップアップ(今のスマホ版の PostPopup と同じ)。スレ表示の領域いっぱいの幅で、押した所の真上に収まるなら真上に、
 * 収まらなければ上の帯のすぐ下から出す。高さは領域の 8 割まで(外を押して閉じられるように)。
 * ポップアップの中のアンカーを押すと上に積み重なる。外を押すと一番上を閉じる。下のポップアップは押せない(押すと一番上が閉じる)
 */
@Composable
fun PopupLayer(
    popups: List<PopupEntry>,
    /** ポップアップの地(LINE 風なら、スレ表示と同じ地) */
    bg: Color = Palette.surface,
    topInset: Float,
    endInset: androidx.compose.ui.unit.Dp = 0.dp,
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
            PopupWindow(e, topInset, areaH, endInset, bg, post)
        }
    }
}

@Composable
private fun PopupWindow(e: PopupEntry, topInset: Float, areaH: Float, endInset: androidx.compose.ui.unit.Dp, bg: Color, post: @Composable (Post) -> Unit) {
    val density = LocalDensity.current
    val gap = with(density) { 4.dp.toPx() }
    val minTop = topInset + gap
    val limit = (areaH - minTop) * 0.8f
    val shape = RoundedCornerShape(6.dp)
    // 出てくるとき: 少し小さく・少し下から浮き上がる(今のスマホ版の rise-in。200ms)
    val rise = remember(e.id) { androidx.compose.animation.core.Animatable(0f) }
    // 広がり始める点(押した字の位置)。置く位置が決まってから、ポップアップの中の割合にする
    val origin = remember(e.id) { floatArrayOf(0.5f, 1f) }
    androidx.compose.runtime.LaunchedEffect(e.id) { if (Motion.reduced) rise.snapTo(1f) else rise.animateTo(1f, androidx.compose.animation.core.tween(200, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
    Layout(
        content = {
            Box(
                // ミニマップに重ならないよう、その幅だけ右を空ける
                Modifier.padding(start = 6.dp, end = 6.dp + endInset)
                    .graphicsLayer {
                        // 押した字の位置から広がる(どのアンカーから出たか分かるように)
                        val p = rise.value; alpha = p; val s = 0.6f + 0.4f * p; scaleX = s; scaleY = s
                        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(origin[0], origin[1])
                    }.shadow(12.dp, shape).clip(shape).background(bg).border(2.dp, Palette.accent, shape)
                    // 中を押しても幕に届かない(閉じない)ように
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
            ) { PopupContent(e, post) }
        },
    ) { measurables, constraints ->
        val spaceAbove = e.triggerY - minTop - gap
        val p = measurables.first().measure(Constraints(maxWidth = constraints.maxWidth, maxHeight = limit.toInt().coerceAtLeast(0)))
        // 押した所の真上に収まるなら真上、収まらなければ上の帯のすぐ下
        val y = if (p.height <= spaceAbove) e.triggerY - p.height - gap else minTop
        if (p.height > 0) origin[1] = ((e.triggerY - y) / p.height).coerceIn(0f, 1f)
        if (e.triggerX >= 0 && p.width > 0) origin[0] = (e.triggerX / p.width).coerceIn(0f, 1f)
        layout(constraints.maxWidth, constraints.maxHeight) { p.place(0, y.toInt()) }
    }
}

@Composable
private fun PopupContent(e: PopupEntry, post: @Composable (Post) -> Unit) {
    val state = e.state
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
                TreeStep(r, depthChanged = i > 0 && tree[i - 1].depth != r.depth, focus = r.no == e.focusNo, hasChild = (tree.getOrNull(i + 1)?.depth ?: -1) > r.depth) {
                    androidx.compose.runtime.CompositionLocalProvider(LocalInTree provides true) { post(p) }
                }
            }
        }
    }
}

/** ツリーの中か(ツリーの中のレスは、返信先の 1 行を出さない。線をたどれば返信先が分かるので) */
val LocalInTree = androidx.compose.runtime.compositionLocalOf { false }

/** スマホのツリーの 1 行(今のスマホ版の StepTree): 段の分だけ左を薄い灰色で塗り、縦線を引く。段が変わる所に線 */
@Composable
private fun TreeStep(r: TreeRow, depthChanged: Boolean, focus: Boolean, hasChild: Boolean = false, content: @Composable () -> Unit) {
    // 深い段は 5 段にそろえる(右へずれ続けて、本文の幅がなくなるのを防ぐ)
    val depth = minOf(r.depth, 5)
    // Discord 風・LINE 風: 罫線(├ └ │)でつなぐ(PC 版の AnchorTree と同じ形)。親の頭の高さから縦線を下ろし、
    // 子の頭の高さで角を丸めて横へ曲げる。まだ兄弟が残っている段は縦線を下まで続ける
    if (isChatStyle(LocalPrefs.current.postStyle)) {
        // 線はアイコンに合わせて引く: 縦線はアイコンの左寄り(左端から 8dp)を通り、子のアイコンの真ん中の高さで曲がって、子のアイコンの左端へ届く。
        // 子への線は、自分のアイコンの下から下ろす。アイコンの上端は見た目ごとに違う(LINE 風は名前の行の下、ほかは頭と同じ高さ)
        val prefs = LocalPrefs.current
        val step = 20.dp
        val line = Palette.textMuted.copy(alpha = 0.8f)
        val avatarTop = if (prefs.postStyle == "line") 6.dp + (12 * prefs.postHeadScale * 1.4f).dp + 4.dp else prefs.postPad.dp + 2.dp
        val padStart = if (prefs.postStyle == "line") 10.dp else 12.dp
        Row(
            Modifier.height(IntrinsicSize.Min).then(if (focus) Modifier.background(Palette.accentWash) else Modifier)
                .drawBehind {
                    val w = 2.dp.toPx()
                    val s = step.toPx()
                    val radius = 6.dp.toPx()
                    val elbow = (avatarTop + AVATAR / 2).toPx()
                    fun x(k: Int) = padStart.toPx() + 8.dp.toPx() + s * k
                    // 上の段から続く縦線。5 段より深いところは 5 段目にそろえて描くので、つなぎの列(depth - 1)より右の線は描かない
                    r.rails.forEachIndexed { k, on -> if (on && k < depth - 1) drawLine(line, Offset(x(k), 0f), Offset(x(k), size.height), w) }
                    // 5 段より深い段の兄弟の続きは、まとめてつなぎの列に
                    if (r.depth > 5 && r.rails.drop(depth - 1).any { it }) drawLine(line, Offset(x(depth - 1), 0f), Offset(x(depth - 1), size.height), w)
                    if (depth > 0) {
                        val px = x(depth - 1)
                        val toX = padStart.toPx() + s * depth - 2.dp.toPx()
                        // まだ兄弟がいれば下まで(├)、最後の子なら角まで(└)
                        drawLine(line, Offset(px, 0f), Offset(px, if (r.last) elbow - radius else size.height), w)
                        // 角を丸めて、子のアイコンの左端へ
                        val path = androidx.compose.ui.graphics.Path().apply {
                            moveTo(px, elbow - radius)
                            quadraticTo(px, elbow, px + radius, elbow)
                            lineTo(toX, elbow)
                        }
                        drawPath(path, line, style = androidx.compose.ui.graphics.drawscope.Stroke(w))
                    }
                    // 子があれば、自分のアイコンの下から縦線を下ろす。5 段目(これより右へずらさない段)では、子も同じ段に並ぶので、自分のつなぎの列に下ろす
                    if (hasChild) {
                        val deep = r.depth >= 5
                        val cx = if (deep) x(depth - 1) else x(depth)
                        val top = if (deep) elbow else (avatarTop + AVATAR + 2.dp).toPx()
                        drawLine(line, Offset(cx, top), Offset(cx, size.height), w)
                    }
                },
        ) {
            Spacer(Modifier.width(step * depth))
            Column(Modifier.weight(1f)) {
                content()
                if (r.alsoTo.isNotEmpty()) Text(r.alsoTo.joinToString(" ") { ">>$it" } + " にも", Modifier.padding(start = 56.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 10.sp)
            }
        }
        return
    }
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
