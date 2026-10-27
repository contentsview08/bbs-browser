package io.github.yumekui8.bbsnative.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import io.github.yumekui8.bbsnative.bbs.Post
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

// 動き方。今のスマホ版の MobileImageViewer と同じ曲線・時間・しきい値
private val EASE = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
private val OPEN_EASE = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
private const val MOVE_MS = 260
private const val MAX_SCALE = 5f
private const val DOUBLE_TAP_SCALE = 2.5f
private const val DOUBLE_TAP_MS = 280L
private const val LONG_PRESS_MS = 450L
/** 端からはみ出した分は、この割合しか動かない(ゴムひも) */
private const val RUBBER = 0.35f

private fun rubber(v: Float, lo: Float, hi: Float) = if (v > hi) hi + (v - hi) * RUBBER else if (v < lo) lo - (lo - v) * RUBBER else v

/**
 * 画像のビューアー(今のスマホ版の MobileImageViewer と同じ操作。スマホの写真ビューアーと同じ):
 * - 左右になぞると前後の絵へ(隣の絵は前もって読んでおき、指に付いてすべってくる)
 * - 2 本指で拡大、拡大中は 1 本指で動かす(離すと勢いで流れ、端からはみ出したら戻る)。2 回たたくと、たたいた所を拡大・等倍
 * - 上か下へなぞると閉じる(なぞった分だけ背景が透ける)。左上の ×・戻るでも閉じる。背景をたたいても閉じない
 * - 1 回たたくと、上下の帯(閉じる・何枚目か・画像の載っていたレス)を出し入れする
 * - 長押しで、保存・URL のコピー・ブラウザで開く
 * - 開くときは、画面の奥から浮き上がってくる
 * posts は urls と同じ並びの、その画像が載っていたレス
 */
@Composable
fun ImageViewer(urls: List<String>, start: String, onClose: () -> Unit, posts: List<Post?> = emptyList()) {
    val context = LocalContext.current
    val prefs = LocalPrefs.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val pager = rememberPagerState(initialPage = urls.indexOf(start).coerceAtLeast(0)) { urls.size }
    var chrome by remember { mutableStateOf(true) }
    var sheet by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    /** 拡大しているページ(拡大中は左右のページ送りを止める) */
    var zoomed by remember { mutableStateOf(false) }
    /** 上下になぞって閉じるときのずれ */
    val dismiss = remember { Animatable(0f) }
    /** 開くとき・閉じるときの動き(0 → 1) */
    val open = remember { Animatable(0f) }
    LaunchedEffect(Unit) { open.animateTo(1f, tween(MOVE_MS, easing = OPEN_EASE)) }
    fun close() {
        scope.launch { open.animateTo(0f, tween(180, easing = EASE)); onClose() }
    }

    Dialog(onDismissRequest = { close() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(enabled = sheet) { sheet = false }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val h = constraints.maxHeight.toFloat()
            // 背景: なぞった分だけ透ける
            val bgAlpha = (1f - min(1f, abs(dismiss.value) / (h * 0.6f))) * open.value
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = bgAlpha)))
            Box(
                Modifier.fillMaxSize().graphicsLayer {
                    // 開くとき: 少し小さく・少し下から、浮き上がってくる(lightbox-open-rise)
                    val p = open.value
                    alpha = p
                    val s = 0.85f + 0.15f * p
                    scaleX = s; scaleY = s
                    translationY = with(density) { 28.dp.toPx() } * (1f - p) + dismiss.value
                },
            ) {
                HorizontalPager(pager, Modifier.fillMaxSize(), key = { it }, beyondViewportPageCount = 1, userScrollEnabled = !zoomed) { page ->
                    ZoomPage(
                        urls[page], active = page == pager.currentPage,
                        onZoomed = { if (page == pager.currentPage) zoomed = it },
                        onTap = { chrome = !chrome },
                        onLongPress = { sheet = true },
                        onDismissDrag = { dy -> scope.launch { dismiss.snapTo(dy) } },
                        onDismissEnd = { dy, v ->
                            scope.launch {
                                // 画面の 15% を超えたか、速くはじいたら閉じる(なぞった向きへ抜ける)
                                if (abs(dy) > h * 0.15f || abs(v) > with(density) { 500.dp.toPx() }) {
                                    dismiss.animateTo(if (dy > 0) h else -h, tween(MOVE_MS, easing = EASE))
                                    onClose()
                                } else dismiss.animateTo(0f, tween(MOVE_MS, easing = EASE))
                            }
                        },
                    )
                }
            }

            // 上の帯: 閉じる・何枚目か・操作
            AnimatedVisibility(chrome && open.value > 0.5f, enter = fadeIn(tween(200)), exit = fadeOut(tween(200)), modifier = Modifier.align(Alignment.TopCenter)) {
                Row(
                    Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent))).statusBarsPadding().heightIn(min = 56.dp).padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { close() }) { Icon(Icons.Filled.Close, "閉じる", tint = Color.White, modifier = Modifier.size(26.dp)) }
                    Text(if (urls.size > 1) "${pager.currentPage + 1} / ${urls.size}" else "", Modifier.weight(1f), color = Color.White.copy(alpha = 0.9f), fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    IconButton(onClick = { sheet = true }) { Icon(Icons.Filled.MoreVert, "操作", tint = Color.White, modifier = Modifier.size(26.dp)) }
                }
            }

            // 下の帯: 画像の載っていたレス
            val post = posts.getOrNull(pager.currentPage)
            if (post != null) {
                AnimatedVisibility(chrome && open.value > 0.5f, enter = fadeIn(tween(200)), exit = fadeOut(tween(200)), modifier = Modifier.align(Alignment.BottomCenter)) {
                    Column(
                        Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f), Color.Black.copy(alpha = 0.8f))))
                            .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 16.dp).navigationBarsPadding(),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${post.no}", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Text(post.name, color = Color(0xFFA9BBFF), fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                            post.id?.let { Text("ID:$it", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp, fontFamily = FontFamily.Monospace) }
                        }
                        Text(post.body, Modifier.padding(top = 4.dp), color = Color.White, fontSize = 14.sp, lineHeight = 21.sp, maxLines = 6, overflow = TextOverflow.Ellipsis)
                    }
                }
            }

            notice?.let { msg ->
                LaunchedEffect(msg) { delay(2500); notice = null }
                Text(
                    msg, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 24.dp).background(Color.Black.copy(alpha = 0.8f), RoundedCornerShape(10.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
                    color = Color.White, fontSize = 14.sp,
                )
            }

            // 長押し・︙ の操作(下からせり上がる)
            if (sheet) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)).clickable(remember { MutableInteractionSource() }, null) { sheet = false })
            AnimatedVisibility(
                sheet, enter = slideInVertically(tween(200)) { it }, exit = slideOutVertically(tween(200)) { it },
                modifier = Modifier.align(Alignment.BottomCenter),
            ) {
                val url = urls.getOrNull(pager.currentPage) ?: ""
                Column(Modifier.fillMaxWidth().background(Palette.surface, RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp)).navigationBarsPadding().padding(vertical = 8.dp)) {
                    SheetRow(Icons.Filled.Download, "保存") {
                        sheet = false
                        notice = "保存しています…"
                        scope.launch { notice = runCatching { io.github.yumekui8.bbsnative.data.ImageSaver.save(context, url) }.getOrElse { "保存できませんでした: ${it.message}" } }
                    }
                    SheetRow(Icons.Filled.Link, "URL をコピー") { sheet = false; copyText(context, url); notice = "URL をコピーしました" }
                    SheetRow(Icons.AutoMirrored.Filled.OpenInNew, "ブラウザで開く") { sheet = false; openExternal(context, url, prefs.openLinksInApp) }
                }
            }
        }
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Palette.textMuted, modifier = Modifier.size(24.dp))
        Text(label, Modifier.padding(start = 18.dp), color = Palette.textStrong, fontSize = 16.sp)
    }
}

/**
 * 1 枚の絵。拡大・動かす・2 回たたく・長押し・上下になぞって閉じるを受ける。
 * 拡大していないときの左右のなぞりは受けずに、ページ送り(HorizontalPager)に任せる
 */
@Composable
private fun ZoomPage(
    url: String, active: Boolean,
    onZoomed: (Boolean) -> Unit, onTap: () -> Unit, onLongPress: () -> Unit,
    onDismissDrag: (Float) -> Unit, onDismissEnd: (Float, Float) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var scale by remember { mutableFloatStateOf(1f) }
    var ox by remember { mutableFloatStateOf(0f) }
    var oy by remember { mutableFloatStateOf(0f) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var natural by remember { mutableStateOf<androidx.compose.ui.geometry.Size?>(null) }
    var loading by remember { mutableStateOf(true) }
    var anim by remember { mutableStateOf<Job?>(null) }
    // 別のページへ移ったら、拡大を戻す
    LaunchedEffect(active) { if (!active) { scale = 1f; ox = 0f; oy = 0f } }

    /** 拡大した絵を動かせる幅(真ん中から片側) */
    fun bounds(s: Float): Pair<Float, Float> {
        val n = natural ?: return 0f to 0f
        val w = size.width.toFloat(); val h = size.height.toFloat()
        if (w == 0f || h == 0f || n.width == 0f || n.height == 0f) return 0f to 0f
        val fit = min(w / n.width, h / n.height)
        return max(0f, (n.width * fit * s - w) / 2f) to max(0f, (n.height * fit * s - h) / 2f)
    }
    /** 拡大・位置を、なめらかに目標へ */
    fun animateTo(s: Float, x: Float, y: Float) {
        anim?.cancel()
        anim = scope.launch {
            val a = Animatable(0f)
            val s0 = scale; val x0 = ox; val y0 = oy
            a.animateTo(1f, tween(MOVE_MS, easing = EASE)) {
                scale = s0 + (s - s0) * value; ox = x0 + (x - x0) * value; oy = y0 + (y - y0) * value
            }
            onZoomed(s > 1.01f)
        }
    }
    /** はみ出していれば戻す */
    fun settle() {
        val s = scale.coerceIn(1f, MAX_SCALE)
        val (mx, my) = bounds(s)
        animateTo(s, ox.coerceIn(-mx, mx), oy.coerceIn(-my, my))
    }

    Box(
        Modifier.fillMaxSize()
            .pointerInput(url) {
                size = this.size
                val slop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    anim?.cancel()
                    val tracker = VelocityTracker()
                    tracker.addPosition(down.uptimeMillis, down.position)
                    var mode = "" // "" まだ / pinch / pan / dismiss / swipe(ページ送りに任せる)
                    var moved = false
                    var longPressed = false
                    var pinch: Triple<Float, Offset, Float>? = null // 始めた時の拡大・真ん中・指の間
                    var dy = 0f
                    val longJob = scope.launch { delay(LONG_PRESS_MS); if (!moved && mode == "") { longPressed = true; onLongPress() } }
                    var up = false
                    while (true) {
                        val ev = awaitPointerEvent(PointerEventPass.Main)
                        val pressed = ev.changes.filter { it.pressed }
                        if (pressed.isEmpty()) { up = true; break }
                        if (pressed.size >= 2) {
                            // 2 本指: 拡大。指の真ん中が、絵の同じ所を指し続けるように
                            moved = true
                            val a = pressed[0].position; val b = pressed[1].position
                            val mid = Offset((a.x + b.x) / 2, (a.y + b.y) / 2)
                            val d = hypot(b.x - a.x, b.y - a.y).coerceAtLeast(1f)
                            val p = pinch ?: Triple(scale, mid, d).also { pinch = it; mode = "pinch" }
                            val newScale = rubber(p.first * (d / p.third), 1f, MAX_SCALE)
                            val cx = size.width / 2f; val cy = size.height / 2f
                            // 絵の中の点(真ん中からの位置)を、拡大の比で動かす
                            val k = newScale / scale
                            ox = (mid.x - cx) - k * ((mid.x - cx) - ox)
                            oy = (mid.y - cy) - k * ((mid.y - cy) - oy)
                            scale = newScale
                            ev.changes.forEach { it.consume() }
                            continue
                        }
                        val c = pressed[0]
                        tracker.addPosition(c.uptimeMillis, c.position)
                        val total = c.position - down.position
                        if (mode == "" && (abs(total.x) > slop || abs(total.y) > slop)) {
                            moved = true
                            mode = when {
                                scale > 1.01f -> "pan"
                                abs(total.y) > abs(total.x) -> "dismiss"
                                else -> "swipe"
                            }
                        }
                        when (mode) {
                            "pan" -> {
                                val delta = c.position - c.previousPosition
                                val (mx, my) = bounds(scale)
                                ox = rubber(ox + delta.x, -mx, mx)
                                oy = rubber(oy + delta.y, -my, my)
                                c.consume()
                            }
                            "pinch" -> {
                                // 2 本から 1 本になったら、そのまま動かす
                                val delta = c.position - c.previousPosition
                                ox += delta.x; oy += delta.y
                                c.consume()
                            }
                            "dismiss" -> {
                                dy = total.y
                                onDismissDrag(dy)
                                c.consume()
                            }
                        }
                    }
                    longJob.cancel()
                    if (!up) return@awaitEachGesture
                    val v = tracker.calculateVelocity()
                    when (mode) {
                        "pinch" -> settle()
                        "pan" -> {
                            // 離したときの速さで少し流してから、はみ出しを戻す
                            val (mx, my) = bounds(scale)
                            animateTo(scale, (ox + v.x * 0.25f).coerceIn(-mx, mx), (oy + v.y * 0.25f).coerceIn(-my, my))
                        }
                        "dismiss" -> onDismissEnd(dy, v.y)
                        "" -> if (!longPressed) {
                            // たたいた: 2 回なら拡大・等倍、1 回なら(2 回目を少し待ってから)帯の出し入れ
                            val second = withTimeoutOrNull(DOUBLE_TAP_MS) { awaitFirstDown(requireUnconsumed = false) }
                            if (second != null) {
                                // 2 回目の指が離れるまで待つ
                                do { val e = awaitPointerEvent() } while (e.changes.any { it.pressed })
                                if (scale > 1.01f) animateTo(1f, 0f, 0f)
                                else {
                                    val sc = DOUBLE_TAP_SCALE
                                    val px = second.position.x - size.width / 2f
                                    val py = second.position.y - size.height / 2f
                                    val (mx, my) = bounds(sc)
                                    animateTo(sc, (-px * (sc - 1)).coerceIn(-mx, mx), (-py * (sc - 1)).coerceIn(-my, my))
                                }
                            } else onTap()
                        }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        AsyncImage(
            url, null, Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = ox; translationY = oy },
            contentScale = ContentScale.Fit,
            onSuccess = { st -> loading = false; natural = st.painter.intrinsicSize },
            onError = { loading = false },
        )
        if (loading) CircularProgressIndicator(Modifier.size(36.dp), color = Color.White.copy(alpha = 0.7f), strokeWidth = 3.dp)
    }
}
