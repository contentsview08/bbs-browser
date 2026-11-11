package io.github.contentsview08.obb.ui

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
import androidx.compose.material.icons.filled.ImageSearch
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
import androidx.compose.runtime.collectAsState
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
import io.github.contentsview08.obb.bbs.Post
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import androidx.compose.material.icons.filled.BrokenImage

// 動き方は PC 版の MobileImageViewer と同じ
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

/** 画像のビューアー(操作は PC 版の MobileImageViewer と同じ)。posts は urls と同じ並びの、その画像が載っていたレス */
@Composable
fun ImageViewer(urls: List<String>, start: String, onClose: () -> Unit, posts: List<Post?> = emptyList()) {
    val context = LocalContext.current
    val prefs = LocalPrefs.current
    val density = LocalDensity.current
    val view = androidx.compose.ui.platform.LocalView.current
    val scope = rememberCoroutineScope()
    // 両端の外に空のページを置き、そこまでなぞったら閉じる
    val pager = rememberPagerState(initialPage = urls.indexOf(start).coerceAtLeast(0) + 1) { urls.size + 2 }
    val current = (pager.currentPage - 1).coerceIn(0, urls.lastIndex.coerceAtLeast(0))
    var chrome by remember { mutableStateOf(true) }
    var sheet by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    /** 保存中は次の保存を受け付けない(続けて長押ししても二重に保存しない) */
    var saving by remember { mutableStateOf(false) }
    fun save(url: String) {
        if (saving) return
        saving = true
        notice = "保存しています…"
        scope.launch {
            notice = runCatching { io.github.contentsview08.obb.data.ImageSaver.save(context, url) }.getOrElse { "保存できませんでした: ${it.message}" }
            saving = false
        }
    }
    /** 拡大中は左右のページ送りを止める */
    var zoomed by remember { mutableStateOf(false) }
    val dismiss = remember { Animatable(0f) }
    val open = remember { Animatable(0f) }
    LaunchedEffect(Unit) { open.animateTo(1f, tween(MOVE_MS, easing = OPEN_EASE)) }
    LaunchedEffect(pager, urls.size) {
        androidx.compose.runtime.snapshotFlow { pager.settledPage }.collect { if (it == 0 || it == urls.size + 1) onClose() }
    }
    fun close() {
        scope.launch { open.animateTo(0f, tween(180, easing = EASE)); onClose() }
    }

    FullWindow(onDismiss = { close() }) {
        BackHandler(enabled = sheet) { sheet = false }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val h = constraints.maxHeight.toFloat()
            // 端の外へなぞるほど、後ろの画面を見せる
            val position = pager.currentPage + pager.currentPageOffsetFraction
            val edge = maxOf(0f, 1f - position, position - urls.size).coerceAtMost(1f)
            val bgAlpha = (1f - min(1f, abs(dismiss.value) / (h * 0.6f))) * open.value * (1f - edge)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = bgAlpha)))
            Box(
                Modifier.fillMaxSize().graphicsLayer {
                    val p = open.value
                    alpha = p
                    val s = 0.85f + 0.15f * p
                    scaleX = s; scaleY = s
                    translationY = with(density) { 28.dp.toPx() } * (1f - p) + dismiss.value
                },
            ) {
                HorizontalPager(pager, Modifier.fillMaxSize(), key = { it }, beyondViewportPageCount = 1, userScrollEnabled = !zoomed) { page ->
                    val url = urls.getOrNull(page - 1) ?: return@HorizontalPager
                    ZoomPage(
                        url, active = page == pager.currentPage,
                        onZoomed = { if (page == pager.currentPage) zoomed = it },
                        onTap = { chrome = !chrome },
                        onLongPress = { Haptics.longPress(view); save(url) },
                        onDismissDrag = { dy -> scope.launch { dismiss.snapTo(dy) } },
                        onDismissEnd = { dy, v ->
                            scope.launch {
                                if (abs(dy) > h * 0.15f || abs(v) > with(density) { 500.dp.toPx() }) {
                                    dismiss.animateTo(if (dy > 0) h else -h, tween(MOVE_MS, easing = EASE))
                                    onClose()
                                } else dismiss.animateTo(0f, tween(MOVE_MS, easing = EASE))
                            }
                        },
                    )
                }
            }

            AnimatedVisibility(chrome && open.value > 0.5f, enter = fadeIn(tween(200)), exit = fadeOut(tween(200)), modifier = Modifier.align(Alignment.TopCenter)) {
                Row(
                    Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent))).statusBarsPadding().heightIn(min = 56.dp).padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { close() }) { Icon(Icons.Filled.Close, "閉じる", tint = Color.White, modifier = Modifier.size(26.dp)) }
                    Text(if (urls.size > 1) "${current + 1} / ${urls.size}" else "", Modifier.weight(1f), color = Color.White.copy(alpha = 0.9f), fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    IconButton(onClick = { sheet = true }) { Icon(Icons.Filled.MoreVert, "操作", tint = Color.White, modifier = Modifier.size(26.dp)) }
                }
            }

            val post = posts.getOrNull(current)
            if (post != null) {
                AnimatedVisibility(chrome && open.value > 0.5f, enter = fadeIn(tween(200)), exit = fadeOut(tween(200)), modifier = Modifier.align(Alignment.BottomCenter)) {
                    Column(
                        Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f), Color.Black.copy(alpha = 0.8f))))
                            .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 16.dp).navigationBarsPadding(),
                    ) {
                        // 名前が長くても ID が縦に潰れないよう、名前の方を省く
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${post.no}", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false)
                            Text(post.name, Modifier.weight(1f, fill = false), color = Color(0xFFA9BBFF), fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            post.id?.let { Text("ID:$it", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1, softWrap = false) }
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

            if (sheet) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)).clickable(remember { MutableInteractionSource() }, null) { sheet = false })
            AnimatedVisibility(
                sheet, enter = slideInVertically(tween(200)) { it }, exit = slideOutVertically(tween(200)) { it },
                modifier = Modifier.align(Alignment.BottomCenter),
            ) {
                val url = urls.getOrNull(current) ?: ""
                Column(Modifier.fillMaxWidth().background(Palette.surface, RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp)).navigationBarsPadding().padding(vertical = 8.dp)) {
                    SheetRow(Icons.Filled.Download, "保存") {
                        sheet = false
                        save(url)
                    }
                    SheetRow(Icons.Filled.Link, "URL をコピー") { sheet = false; copyText(context, url); notice = "URL をコピーしました" }
                    SheetRow(Icons.AutoMirrored.Filled.OpenInNew, "ブラウザで開く") { sheet = false; openExternal(context, url, prefs.openLinksInApp) }
                    // 画像の URL を渡すだけで、画像そのものは送らない
                    SheetRow(Icons.Filled.ImageSearch, "画像で検索(Google レンズ)") {
                        sheet = false
                        openExternal(context, "https://lens.google.com/uploadbyurl?url=" + java.net.URLEncoder.encode(url, "UTF-8"), false)
                    }
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

/** 拡大していないときの左右のなぞりは受けずに、ページ送り(HorizontalPager)に任せる */
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
    LaunchedEffect(active) { if (!active) { scale = 1f; ox = 0f; oy = 0f } }

    /** 拡大した絵を動かせる幅(真ん中から片側) */
    fun bounds(s: Float): Pair<Float, Float> {
        val n = natural ?: return 0f to 0f
        val w = size.width.toFloat(); val h = size.height.toFloat()
        if (w == 0f || h == 0f || n.width == 0f || n.height == 0f) return 0f to 0f
        val fit = min(w / n.width, h / n.height)
        return max(0f, (n.width * fit * s - w) / 2f) to max(0f, (n.height * fit * s - h) / 2f)
    }
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
                    while (true) {
                        val ev = awaitPointerEvent(PointerEventPass.Main)
                        val pressed = ev.changes.filter { it.pressed }
                        if (pressed.isEmpty()) break
                        if (pressed.size >= 2) {
                            // 指の真ん中が、絵の同じ所を指し続けるように
                            moved = true
                            val a = pressed[0].position; val b = pressed[1].position
                            val mid = Offset((a.x + b.x) / 2, (a.y + b.y) / 2)
                            val d = hypot(b.x - a.x, b.y - a.y).coerceAtLeast(1f)
                            val p = pinch ?: Triple(scale, mid, d).also { pinch = it; mode = "pinch" }
                            val newScale = rubber(p.first * (d / p.third), 1f, MAX_SCALE)
                            val cx = size.width / 2f; val cy = size.height / 2f
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
                                // 2 本から 1 本になった
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
                    val v = tracker.calculateVelocity()
                    when (mode) {
                        "pinch" -> settle()
                        "pan" -> {
                            val (mx, my) = bounds(scale)
                            animateTo(scale, (ox + v.x * 0.25f).coerceIn(-mx, mx), (oy + v.y * 0.25f).coerceIn(-my, my))
                        }
                        "dismiss" -> onDismissEnd(dy, v.y)
                        "" -> if (!longPressed) {
                            val second = withTimeoutOrNull(DOUBLE_TAP_MS) { awaitFirstDown(requireUnconsumed = false) }
                            if (second != null) {
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
        // サムネイルと同じファイルを使う。ビューアーの枠で取るので、サムネイルの順番待ちに並ばない
        val store = io.github.contentsview08.obb.data.ImageStore
        val ds = store.stateOf(url)
        LaunchedEffect(url, active) { if (active || ds !is io.github.contentsview08.obb.data.ImageStore.State.Done) store.request(url, viewer = active) }
        val file = (ds as? io.github.contentsview08.obb.data.ImageStore.State.Done)?.file
        if (file != null) {
            val painter = coil3.compose.rememberAsyncImagePainter(file)
            val st by painter.state.collectAsState()
            LaunchedEffect(st) {
                when (val s = st) {
                    is coil3.compose.AsyncImagePainter.State.Success -> { loading = false; natural = s.painter.intrinsicSize }
                    is coil3.compose.AsyncImagePainter.State.Error -> loading = false
                    else -> {}
                }
            }
            androidx.compose.foundation.Image(
                painter, null, Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = ox; translationY = oy },
                contentScale = ContentScale.Fit,
            )
            if (st is coil3.compose.AsyncImagePainter.State.Error) Text("画像を取得できませんでした", color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp)
        }
        when (ds) {
            is io.github.contentsview08.obb.data.ImageStore.State.Failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(androidx.compose.material.icons.Icons.Filled.BrokenImage, null, Modifier.size(48.dp), tint = Color.White.copy(alpha = 0.8f))
                Text("画像を取得できませんでした", Modifier.padding(top = 8.dp), color = Color.White.copy(alpha = 0.85f), fontSize = 14.sp)
                Text(ds.message, Modifier.padding(top = 4.dp), color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
                Text(
                    "もう一度", Modifier.padding(top = 12.dp).background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(6.dp)).clickable { store.request(url, viewer = true) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    color = Color.White, fontSize = 14.sp,
                )
                val context = LocalContext.current
                Text(
                    "ブラウザで開く", Modifier.padding(top = 8.dp).background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(6.dp)).clickable { openExternal(context, url, false) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    color = Color.White, fontSize = 14.sp,
                )
            }
            is io.github.contentsview08.obb.data.ImageStore.State.Loading -> Text(
                store.progressText(ds), Modifier.padding(top = 70.dp), color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp,
            )
            is io.github.contentsview08.obb.data.ImageStore.State.Queued, null -> Text("待っています…", Modifier.padding(top = 70.dp), color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
            else -> {}
        }
        if (loading && ds !is io.github.contentsview08.obb.data.ImageStore.State.Failed) CircularProgressIndicator(Modifier.size(36.dp), color = Color.White.copy(alpha = 0.7f), strokeWidth = 3.dp)
    }
}
