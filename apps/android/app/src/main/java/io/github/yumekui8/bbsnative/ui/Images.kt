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
fun Thumbnails(urls: List<String>, autoLoad: Boolean, onOpen: (String) -> Unit) {
    FlowRow(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (url in urls) Thumbnail(url, autoLoad, onOpen)
    }
}

@Composable
private fun Thumbnail(url: String, autoLoad: Boolean, onOpen: (String) -> Unit) {
    var load by rememberSaveable(url) { mutableStateOf(autoLoad) }
    val shape = RoundedCornerShape(8.dp)
    val box = Modifier.size(96.dp).clip(shape).border(1.dp, Palette.border, shape).background(Palette.surface2)
    if (!load) {
        Box(box.clickable { load = true }, contentAlignment = Alignment.Center) { Text("画像", color = Palette.textMuted, fontSize = 13.sp) }
        return
    }
    AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = box.clickable { onOpen(url) })
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
