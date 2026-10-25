package io.github.yumekui8.bbsnative.ui

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import io.github.yumekui8.bbsnative.data.Ogp
import io.github.yumekui8.bbsnative.data.OgpFetcher
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import coil3.compose.SubcomposeAsyncImage

/** Wi-Fi(か有線)につながっているか。画像を「Wi-Fi のときだけ」自動で読むのに使う。分からないときは false(読まない側) */
fun isWifi(context: Context): Boolean = runCatching {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
}.getOrDefault(false)

/**
 * レスの画像のサムネイルを並べる。autoLoad でなければ「画像」の札を出し、押したものだけ読む(モバイル通信で通信量を使わないように)。
 * 読み込んだサムネイルを押すと onOpen(ビューアー)
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Thumbnails(
    urls: List<String>, autoLoad: Boolean, onOpen: (String) -> Unit, blur: Boolean = false,
    youtube: List<Pair<String, String>> = emptyList(), onUrl: (String) -> Unit = {},
) {
    // グロ注意のレスは、押すまでぼかす
    var blurred by rememberSaveable(urls) { mutableStateOf(blur) }
    FlowRow(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (url in urls) Thumbnail(url, autoLoad, if (blurred) { _ -> blurred = false } else onOpen, blurred)
        // YouTube は動画の絵(i.ytimg.com)に再生の印を重ねる。押すと YouTube で開く
        for ((id, url) in youtube) Thumbnail("https://i.ytimg.com/vi/$id/hqdefault.jpg", autoLoad, { onUrl(url) }, blurred, play = true)
    }
}

@Composable
private fun Thumbnail(url: String, autoLoad: Boolean, onOpen: (String) -> Unit, blurred: Boolean = false, play: Boolean = false) {
    // 家の中のアドレスは、押すまで読まない
    var load by rememberSaveable(url) { mutableStateOf(autoLoad && io.github.yumekui8.bbsnative.data.isAutoLoadable(url)) }
    val shape = RoundedCornerShape(8.dp)
    val box = Modifier.size(96.dp).clip(shape).border(1.dp, Palette.border, shape).background(Palette.surface2)
    if (!load) {
        Box(box.clickable { load = true }, contentAlignment = Alignment.Center) { Text("画像", color = Palette.textMuted, fontSize = 13.sp) }
        return
    }
    Box(box.clickable { onOpen(url) }, contentAlignment = Alignment.Center) {
        AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().then(if (blurred) Modifier.blur(18.dp) else Modifier))
        if (play && !blurred) Icon(Icons.Filled.PlayCircle, "動画", tint = Color.White, modifier = Modifier.size(36.dp).background(Color.Black.copy(alpha = 0.35f), CircleShape))
        if (blurred) Text("グロ注意", Modifier.background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp), color = Color.White, fontSize = 11.sp)
    }
}

/**
 * 画像のビューアー(全画面)。左右になぞるとスレの中の前後の画像へ。ピンチ・2 回たたくで拡大、拡大中はなぞって動かす。
 * 背景をたたく・戻る・×で閉じる
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ImageViewer(urls: List<String>, start: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val pager = rememberPagerState(initialPage = urls.indexOf(start).coerceAtLeast(0)) { urls.size }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), key = { urls[it] }) { page -> ZoomableImage(urls[page], onTap = onClose) }
            Row(Modifier.fillMaxWidth().safeDrawingPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "閉じる", tint = Color.White) }
                Text("${pager.currentPage + 1} / ${urls.size}", Modifier.weight(1f), color = Color.White, fontSize = 14.sp)
                TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(urls[pager.currentPage]))) } }) {
                    Text("ブラウザで開く", color = Color.White)
                }
            }
        }
    }
}

@Composable
private fun ZoomableImage(url: String, onTap: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    SubcomposeAsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Fit,
        loading = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("読み込み中…", color = Color.Gray) } },
        error = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("読み込めませんでした", color = Color.Gray) } },
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(url) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f
                    },
                    onTap = { if (scale == 1f) onTap() },
                )
            }
            .pointerInput(url) {
                // 拡大していないときの 1 本指のなぞりは、ページ送り(HorizontalPager)に任せる。2 本指か、拡大中だけ受ける
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        if (event.changes.size >= 2 || scale > 1f) {
                            scale = (scale * event.calculateZoom()).coerceIn(1f, 6f)
                            offset = if (scale == 1f) Offset.Zero else offset + event.calculatePan()
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
    )
}

/**
 * リンクのカード(PC 版の LinkPreview と同じ)。画面に出たときに初めてページを取りに行き、題・説明・サイト名・絵を出す。
 * 何も取れなければ出さない(リンクの文字は本文にある)。3 つまで
 */
@Composable
fun LinkCards(urls: List<String>, autoLoad: Boolean, onOpen: (String) -> Unit) {
    Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp)) {
        for (url in urls.take(3)) LinkCard(url, autoLoad, onOpen)
    }
}

@Composable
private fun LinkCard(url: String, autoLoad: Boolean, onOpen: (String) -> Unit) {
    var state by remember(url) { mutableStateOf<Ogp?>(null) }
    var done by remember(url) { mutableStateOf(false) }
    LaunchedEffect(url) { state = OgpFetcher.fetch(url); done = true }
    val ogp = state
    if (done && ogp == null) return
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.padding(top = 6.dp).fillMaxWidth().height(80.dp).clip(shape).background(Palette.surface2).border(1.dp, Palette.border, shape).clickable { onOpen(url) },
    ) {
        Column(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.Center) {
            if (ogp == null) Text("読み込み中…", color = Palette.textMuted, fontSize = 11.sp)
            else {
                Text(ogp.title ?: url, color = Palette.textStrong, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 17.sp)
                ogp.description?.let { Text(it, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                Text(ogp.siteName ?: runCatching { java.net.URI(url).host }.getOrNull() ?: url, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        // 絵はサムネイルと同じく、自動で読む設定のときだけ
        if (ogp?.image != null && autoLoad) {
            AsyncImage(ogp.image, null, Modifier.width(112.dp).fillMaxHeight().background(Palette.surface3), contentScale = ContentScale.Crop)
        }
    }
}
