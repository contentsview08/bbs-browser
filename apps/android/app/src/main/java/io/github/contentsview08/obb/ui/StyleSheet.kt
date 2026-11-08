package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.data.LIST_PAD_PX
import io.github.contentsview08.obb.data.POST_BODY_BASE_PX
import io.github.contentsview08.obb.data.POST_HEAD_BASE_PX
import io.github.contentsview08.obb.data.POST_LINE_HEIGHT
import io.github.contentsview08.obb.data.POST_PAD_PX
import io.github.contentsview08.obb.data.Prefs
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 表示スタイルのシート(︙ の「表示スタイル」)。下から半分ほどの高さで出し、上に見えている画面で変えた結果を見ながら合わせられるよう、背景は暗くしない。
 * 上から テーマ・差し色・レスの見た目(スレ表示だけ)・文字と余白。下へなぞるか、外を押すか、戻るで閉じる。
 * thread: スレ表示から開いたか(スレ一覧はレスの見た目に関係しないので、その行を出さない)
 */
@Composable
fun StyleSheet(p: Prefs, thread: Boolean, onDismiss: () -> Unit) {
    // 出入りの動き(0 = 隠れている、1 = 出ている)と、指で下へずらした量(px)
    val show = remember { androidx.compose.animation.core.Animatable(0f) }
    var drag by remember { mutableFloatStateOf(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        if (Motion.reduced) show.snapTo(1f)
        else show.animateTo(1f, androidx.compose.animation.core.tween(220, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
    }
    // 閉じる動きの途中で、もう一度閉じない(外を押す・なぞる・戻るが重なることがある)
    val closing = remember { booleanArrayOf(false) }
    fun close() {
        if (closing[0]) return
        closing[0] = true
        scope.launch { if (!Motion.reduced) show.animateTo(0f, androidx.compose.animation.core.tween(160)); onDismiss() }
    }
    // Dialog は密度が変わると窓を作り直すので、外側から基本の文字を外す(基本の文字のスライダーを動かしても閉じないように)
    WithoutBaseFont { FullWindow(onDismiss = { close() }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val density = LocalDensity.current
            // よく使う上の 3 つ(テーマ・差し色・レスの見た目)が最初に収まる高さで、上には画面が半分ほど見えるように
            val sheetHeight = (maxHeight * 0.5f).coerceIn(minOf(380.dp, maxHeight - 80.dp), maxHeight - 80.dp)
            val sheetPx = with(density) { sheetHeight.toPx() }
            // 指を離したとき: 3 割より下へずらしていたら閉じる。足りなければ戻す
            suspend fun settle(velocity: Float) {
                if (drag > sheetPx * 0.3f || velocity > 1500f) close()
                else androidx.compose.animation.core.animate(drag, 0f, animationSpec = androidx.compose.animation.core.tween(150)) { v, _ -> drag = v }
            }
            // 中身を一番上までスクロールしてから、さらに下へなぞったらシートごと下げる
            val nested = remember(sheetPx) {
                object : NestedScrollConnection {
                    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                        if (available.y < 0 && drag > 0f) {
                            val used = maxOf(available.y, -drag)
                            drag += used
                            return Offset(0f, used)
                        }
                        return Offset.Zero
                    }
                    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                        if (available.y > 0 && source == NestedScrollSource.UserInput) {
                            drag += available.y
                            return Offset(0f, available.y)
                        }
                        return Offset.Zero
                    }
                    override suspend fun onPreFling(available: Velocity): Velocity {
                        if (drag > 0f) { settle(available.y); return available }
                        return Velocity.Zero
                    }
                }
            }
            // 外(上に見えている画面)を押したら閉じる。暗くはしない
            Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null) { close() })
            val shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(sheetHeight)
                    .graphicsLayer { translationY = (1f - show.value) * sheetPx + drag }
                    .shadow(18.dp, shape).clip(shape).background(Palette.surface).border(1.dp, Palette.border, shape)
                    .clickable(remember { MutableInteractionSource() }, null) {}
                    .navigationBarsPadding(),
            ) {
                // つまみ。ここを下へなぞっても閉じる
                Box(
                    Modifier.fillMaxWidth().height(22.dp).draggable(
                        rememberDraggableState { d -> drag = (drag + d).coerceAtLeast(0f) },
                        Orientation.Vertical, onDragStopped = { v -> settle(v) },
                    ),
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size(width = 36.dp, height = 4.dp).background(Palette.textMuted.copy(alpha = 0.45f), CircleShape)) }
                Column(Modifier.fillMaxWidth().weight(1f).nestedScroll(nested).verticalScroll(rememberScrollState()).padding(bottom = 12.dp)) {
                    SheetLabel("テーマ")
                    SchemeRow(p)
                    SheetLabel("差し色")
                    AccentRow(p)
                    if (thread) {
                        SheetLabel("レスの見た目")
                        PostStyleRow(p)
                    }
                    SheetLabel("文字と余白")
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        if (thread) {
                            FontSizeSlider("本文の文字", p.bodyScale, POST_BODY_BASE_PX) { p.bodyScale = it }
                            FontSizeSlider("レスの頭の文字", p.postHeadScale, POST_HEAD_BASE_PX) { p.postHeadScale = it }
                            SizeSlider("行間", p.lineHeight, 1.0f..3.0f, 39, "%.2f".format(p.lineHeight), POST_LINE_HEIGHT) { p.lineHeight = if (it == POST_LINE_HEIGHT) it else snapTo(it, 20) }
                            SizeSlider("レスの上下の余白", p.postPad.toFloat(), 0f..40f, 39, "${p.postPad}", POST_PAD_PX.toFloat()) { p.postPad = snapInt(it) }
                        } else {
                            FontSizeSlider("スレ一覧の文字", p.listFontScale, 15) { p.listFontScale = it }
                            SizeSlider("スレの上下の余白", p.listPad.toFloat(), 0f..40f, 39, "${p.listPad}", LIST_PAD_PX.toFloat()) { p.listPad = snapInt(it) }
                        }
                        BarSliders(p)
                    }
                }
            }
        }
    } }
}

@Composable
private fun SheetLabel(t: String) =
    Text(t, Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)

/** 配色の丸を横一列に。丸の中に、その配色の帯・地・差し色を描く(名前だけより、押す前に色が分かる) */
@Composable
private fun SchemeRow(p: Prefs) {
    val current = Palette.scheme.key
    val schemes = allSchemes()
    // 開いたときに、いま使っている配色が見える所から並べる
    val state = androidx.compose.foundation.lazy.rememberLazyListState(initialFirstVisibleItemIndex = (schemes.indexOfFirst { it.key == current } - 2).coerceAtLeast(0))
    androidx.compose.foundation.lazy.LazyRow(Modifier.fillMaxWidth(), state = state, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        items(schemes.size, key = { schemes[it].key }) { i ->
            val s = schemes[i]
            val on = s.key == current
            Column(
                Modifier.width(68.dp).clip(RoundedCornerShape(8.dp)).clickable {
                    // スマホのダーク・ライトに合わせているときは、いまの明るさの方の配色を変える(PC 版の pickSchemeNow)
                    if (p.followOsTheme) { if (s.dark == Palette.dark) { if (s.dark) p.darkScheme = s.key else p.lightScheme = s.key } else { p.followOsTheme = false; p.scheme = s.key } }
                    else p.scheme = s.key
                }.padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier.size(44.dp).border(if (on) 2.5.dp else 0.dp, if (on) Palette.accent else Color.Transparent, CircleShape).padding(4.dp)
                        .clip(CircleShape).background(s.base).border(1.dp, s.border, CircleShape),
                ) {
                    Box(Modifier.fillMaxWidth().height(12.dp).background(s.bar))
                    Box(Modifier.align(Alignment.Center).padding(top = 6.dp).size(width = 18.dp, height = 4.dp).background(s.textMuted.copy(alpha = 0.7f), RoundedCornerShape(2.dp)))
                    Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp).size(9.dp).background(s.accent, CircleShape))
                }
                Text(
                    s.name, Modifier.padding(top = 2.dp), color = if (on) Palette.textStrong else Palette.textMuted, fontSize = 10.sp, lineHeight = 12.sp,
                    fontWeight = if (on) FontWeight.Bold else null, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** 差し色の丸を横一列に。左端の「テーマ」はテーマの色に戻す */
@Composable
private fun AccentRow(p: Prefs) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        @Composable fun dot(c: Color, label: String, on: Boolean, onClick: () -> Unit) {
            Column(Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(horizontal = 4.dp, vertical = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(28.dp).background(c, CircleShape).border(if (on) 3.dp else 1.dp, if (on) Palette.textStrong else Palette.border, CircleShape))
                Text(label, Modifier.padding(top = 2.dp), color = if (on) Palette.textStrong else Palette.textMuted, fontSize = 10.sp, lineHeight = 12.sp)
            }
        }
        dot(Palette.scheme.accent, "テーマ", p.accent.isEmpty()) { p.accent = "" }
        for (a in ACCENTS) dot(if (Palette.dark) a.dark else a.light, a.name, p.accent == a.key) { p.accent = a.key }
    }
}

/** レスの見た目の切り替え(POST_STYLES の順に横並び)。名前の括弧の中の説明は、狭いので省く */
@Composable
private fun PostStyleRow(p: Prefs) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((k, name) in POST_STYLES) {
            val on = p.postStyle == k
            val shape = RoundedCornerShape(16.dp)
            Text(
                name.substringBefore('('),
                Modifier.clip(shape).background(if (on) Palette.accent else Palette.surface2, shape)
                    .border(1.dp, if (on) Palette.accent else Palette.border, shape)
                    .clickable { p.postStyle = k }.padding(horizontal = 11.dp, vertical = 7.dp),
                color = if (on) Palette.accentText else Palette.textBody, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else null, maxLines = 1,
            )
        }
    }
}

/**
 * 「文字と余白」の 1 行。名前・スライダー・いまの値を 1 行に詰める。既定と違うときだけ、値の右に元に戻すボタンを出す
 * (幅を取っておき、出し入れでスライダーの幅が変わらないようにする)
 */
@Composable
fun SizeSlider(label: String, value: Float, range: ClosedFloatingPointRange<Float>, steps: Int, text: String, default: Float, onChange: (Float) -> Unit) {
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.width(112.dp), color = Palette.textBody, fontSize = 13.sp, lineHeight = 15.sp, maxLines = 2)
        Slider(
            value, onChange, Modifier.weight(1f), valueRange = range, steps = steps,
            // 目盛りの点は細かすぎて読めず、うるさいだけなので描かない
            colors = SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent, activeTickColor = Color.Transparent, inactiveTickColor = Color.Transparent),
        )
        Text(text, Modifier.widthIn(min = 38.dp), color = Palette.accent, fontSize = 13.sp, textAlign = TextAlign.End, maxLines = 1)
        val canReset = value != default
        Box(
            Modifier.size(30.dp).clip(CircleShape).then(if (canReset) Modifier.clickable { onChange(default) } else Modifier),
            contentAlignment = Alignment.Center,
        ) { if (canReset) Icon(Icons.Filled.Refresh, "元に戻す", tint = Palette.textMuted, modifier = Modifier.size(18.dp)) }
    }
}

/** 文字の大きさのスライダー。base は倍率 1 のときの大きさ */
@Composable
fun FontSizeSlider(label: String, scale: Float, base: Int, onChange: (Float) -> Unit) {
    SizeSlider(label, scale * base, FONT_MIN.toFloat()..FONT_MAX.toFloat(), FONT_MAX - FONT_MIN - 1, "${fontSizeOf(scale, base)}", base.toFloat()) { onChange(scaleOf(it.roundToInt(), base)) }
}

/** 基本の文字と、ヘッダー・フッターの高さと文字 */
@Composable
fun BarSliders(p: Prefs) {
    SizeSlider("ヘッダーの高さ", p.headerHeight.toFloat(), 32f..120f, 0, "${p.headerHeight}", io.github.contentsview08.obb.data.HEADER_PX.toFloat()) { p.headerHeight = it.toInt() }
    SizeSlider("フッターの高さ", p.footerHeight.toFloat(), 32f..110f, 0, "${p.footerHeight}", io.github.contentsview08.obb.data.FOOTER_PX.toFloat()) { p.footerHeight = it.toInt() }
    SizeSlider("ヘッダー・フッターの文字", p.barFontScale, 0.6f..1.6f, 19, "${percent(p.barFontScale)}%", 1f) { p.barFontScale = snapTo(it, 20) }
    SizeSlider("基本の文字", p.fontScale, 0.6f..1.6f, 19, "${percent(p.fontScale)}%", 1f) { p.fontScale = snapTo(it, 20) }
}
