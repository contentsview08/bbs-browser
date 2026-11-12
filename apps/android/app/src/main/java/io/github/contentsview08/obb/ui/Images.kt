package io.github.contentsview08.obb.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import io.github.contentsview08.obb.data.Ogp
import io.github.contentsview08.obb.data.OgpFetcher
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Refresh

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
    youtube: List<Pair<String, String>> = emptyList(), onUrl: (String) -> Unit = {}, size: Int = 96,
    /** 動画のファイル(mp4 など)。最初のコマに再生の印を重ね、押すと onUrl(再生) */
    videos: List<String> = emptyList(),
) {
    // グロ注意のレスは、押すまでぼかす
    var blurred by rememberSaveable(urls) { mutableStateOf(blur) }
    FlowRow(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (url in urls) Thumbnail(url, autoLoad, if (blurred) { _ -> blurred = false } else onOpen, blurred, size = size)
        for (url in videos) VideoThumbnail(url, autoLoad, { if (blurred) blurred = false else onUrl(url) }, blurred, size = size)
        // YouTube は動画の絵(i.ytimg.com)に再生の印を重ねる。押すと YouTube で開く(ぼかしの間は、画像と同じくぼかしを解くだけ)
        for ((id, url) in youtube) Thumbnail("https://i.ytimg.com/vi/$id/hqdefault.jpg", autoLoad, { if (blurred) blurred = false else onUrl(url) }, blurred, play = true, size = size)
    }
}

/**
 * 画像を 1 枚出す(サムネイル・画像一覧・クイックアクセスで共通)。ImageStore に頼み、取れたファイルを出す。
 * 取っている間は明滅する面と輪と「320 KB / 1.2 MB」、失敗したら壊れた画像の印と「取得できません」、取り消したら「取り消しました」(どちらも押すと取り直す)
 */
@Composable
fun StoredImage(url: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop, blurred: Boolean = false, showProgress: Boolean = true) {
    val st = io.github.contentsview08.obb.data.ImageStore.stateOf(url)
    androidx.compose.runtime.LaunchedEffect(url) { io.github.contentsview08.obb.data.ImageStore.request(url) }
    Box(modifier, contentAlignment = Alignment.Center) {
        when (st) {
            is io.github.contentsview08.obb.data.ImageStore.State.Done -> AsyncImage(
                model = st.file, contentDescription = null, contentScale = contentScale,
                modifier = Modifier.matchParentSize().then(if (blurred) Modifier.blur(18.dp) else Modifier),
            )
            is io.github.contentsview08.obb.data.ImageStore.State.Failed -> Column(
                Modifier.matchParentSize().clickable { io.github.contentsview08.obb.data.ImageStore.request(url, retry = true) },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Filled.BrokenImage, null, Modifier.size(20.dp), tint = Palette.textMuted)
                Text("取得できません", color = Palette.textMuted, fontSize = 10.sp, lineHeight = 12.sp)
                Text("押して再試行", color = Palette.textMuted, fontSize = 10.sp, lineHeight = 12.sp)
            }
            is io.github.contentsview08.obb.data.ImageStore.State.Canceled -> Column(
                Modifier.matchParentSize().clickable { io.github.contentsview08.obb.data.ImageStore.request(url, retry = true) },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Filled.Refresh, null, Modifier.size(20.dp), tint = Palette.textMuted)
                Text("取り消しました", color = Palette.textMuted, fontSize = 10.sp, lineHeight = 12.sp)
                Text("押して読み込む", color = Palette.textMuted, fontSize = 10.sp, lineHeight = 12.sp)
            }
            else -> {
                val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "thumb")
                val a by t.animateFloat(0.35f, 0.8f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(700), androidx.compose.animation.core.RepeatMode.Reverse), label = "a")
                Box(Modifier.matchParentSize().graphicsLayer { alpha = a }.background(Palette.textMuted.copy(alpha = 0.18f)))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    val l = st as? io.github.contentsview08.obb.data.ImageStore.State.Loading
                    if (l != null && l.total > 0) androidx.compose.material3.CircularProgressIndicator(
                        progress = { (l.read.toFloat() / l.total).coerceIn(0f, 1f) }, modifier = Modifier.size(18.dp), color = Palette.textMuted, strokeWidth = 2.dp,
                    ) else androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), color = Palette.textMuted, strokeWidth = 2.dp)
                    if (showProgress && l != null) Text(io.github.contentsview08.obb.data.ImageStore.progressText(l), Modifier.padding(top = 3.dp), color = Palette.textMuted, fontSize = 9.sp, maxLines = 1)
                    else if (showProgress && (st == null || st is io.github.contentsview08.obb.data.ImageStore.State.Queued)) Text("待ち", Modifier.padding(top = 3.dp), color = Palette.textMuted, fontSize = 9.sp)
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun Thumbnail(url: String, autoLoad: Boolean, onOpen: (String) -> Unit, blurred: Boolean = false, play: Boolean = false, size: Int = 96) {
    // 家の中のアドレスは、押すまで読まない。手元にある画像(どの画面で取ったものでも)は、自動で読まない設定でもそのまま出す
    var load by rememberSaveable(url) {
        mutableStateOf(io.github.contentsview08.obb.data.ImageStore.cached(url) != null || (autoLoad && io.github.contentsview08.obb.data.isAutoLoadable(url)))
    }
    val shape = RoundedCornerShape(5.dp)
    // YouTube は赤い枠で見分ける(PC 版と同じ色)
    val box = Modifier.size(size.dp).clip(shape).then(if (play) Modifier.border(2.dp, Color(0xFFFF0000), shape) else Modifier.border(1.dp, Palette.border, shape)).background(Palette.surface2)
    if (!load) {
        Box(box.clickable { load = true }, contentAlignment = Alignment.Center) { Text("画像", color = Palette.textMuted, fontSize = 13.sp) }
        return
    }
    // 進み具合が変わるたびにサムネイルごと組み直さないよう、読み込み中かどうかだけを見る
    val loading by remember(url) {
        androidx.compose.runtime.derivedStateOf {
            val st = io.github.contentsview08.obb.data.ImageStore.stateOf(url)
            st is io.github.contentsview08.obb.data.ImageStore.State.Queued || st is io.github.contentsview08.obb.data.ImageStore.State.Loading
        }
    }
    val view = androidx.compose.ui.platform.LocalView.current
    Box(
        box.combinedClickable(
            onLongClick = if (loading) ({ Haptics.longPress(view); io.github.contentsview08.obb.data.ImageStore.cancel(url) }) else null,
            onClick = { onOpen(url) },
        ),
        contentAlignment = Alignment.Center,
    ) {
        StoredImage(url, Modifier.matchParentSize(), blurred = blurred)
        if (play && !blurred) Icon(Icons.Filled.PlayCircle, "動画", tint = Color.White, modifier = Modifier.size(36.dp).background(Color.Black.copy(alpha = 0.35f), CircleShape))
        if (blurred) Text("グロ注意", Modifier.background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp), color = Color.White, fontSize = 11.sp)
    }
}

/**
 * 動画のファイルのサムネイル(PC 版の LazyVideoThumb と同じ)。画面に出たときに最初のコマだけを取り(VideoThumbs)、再生の印を重ねる。
 * 自動で読まない設定なら「動画」の札を出し、押したものだけ取る。コマを取れなければ黒地に印だけ(押せば再生できる)
 */
@Composable
internal fun VideoThumbnail(url: String, autoLoad: Boolean, onOpen: () -> Unit, blurred: Boolean = false, size: Int = 96) {
    var load by rememberSaveable(url) {
        mutableStateOf(io.github.contentsview08.obb.data.VideoThumbs.cached(url) != null || (autoLoad && io.github.contentsview08.obb.data.isAutoLoadable(url)))
    }
    val shape = RoundedCornerShape(5.dp)
    val box = Modifier.size(size.dp).clip(shape).border(1.dp, Palette.border, shape)
    if (!load) {
        Box(box.background(Palette.surface2).clickable { load = true }, contentAlignment = Alignment.Center) { Text("動画", color = Palette.textMuted, fontSize = 13.sp) }
        return
    }
    LaunchedEffect(url) { io.github.contentsview08.obb.data.VideoThumbs.request(url) }
    val st = io.github.contentsview08.obb.data.VideoThumbs.stateOf(url)
    Box(box.background(Color.Black).clickable(onClick = onOpen), contentAlignment = Alignment.Center) {
        when (st) {
            is io.github.contentsview08.obb.data.VideoThumbs.State.Done -> AsyncImage(
                model = st.file, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().then(if (blurred) Modifier.blur(18.dp) else Modifier),
            )
            io.github.contentsview08.obb.data.VideoThumbs.State.Failed -> Text("動画", Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp), color = Color.White.copy(alpha = 0.8f), fontSize = 10.sp)
            else -> androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp).align(Alignment.TopEnd).padding(4.dp), color = Color.White.copy(alpha = 0.6f), strokeWidth = 2.dp)
        }
        if (blurred) Text("グロ注意", Modifier.background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp), color = Color.White, fontSize = 11.sp)
        else Icon(Icons.Filled.PlayCircle, "動画", tint = Color.White, modifier = Modifier.size(36.dp).background(Color.Black.copy(alpha = 0.35f), CircleShape))
    }
}

/**
 * リンクのカード(PC 版の LinkPreview と同じ)。画面に出たときに初めてページを取りに行き、題・説明・サイト名・絵を出す。3 つまで。
 * 枠の高さは読み込みの前から決めておき、取れても取れなくても変えない(上のレスの高さが後から変わると、飛んだ先の位置がずれる)。
 * 何も取れなければアドレスだけの札にする。家の中のアドレスには出さない(リンクの文字は本文にある)。
 * autoLoad でなければ(モバイル通信など)ページも取りに行かず、カードを出さない
 */
@Composable
fun LinkCards(urls: List<String>, autoLoad: Boolean, onOpen: (String) -> Unit) {
    if (!autoLoad) return
    Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp)) {
        for (url in urls.take(3)) if (io.github.contentsview08.obb.data.isAutoLoadable(url)) LinkCard(url, onOpen)
    }
}

/** カードの高さ(dp)。本文の下の枠の分で、読み込みの前後で変えない */
const val LINK_CARD_HEIGHT_DP = 80

@Composable
private fun LinkCard(url: String, onOpen: (String) -> Unit) {
    var state by remember(url) { mutableStateOf<Ogp?>(null) }
    var done by remember(url) { mutableStateOf(false) }
    LaunchedEffect(url) { if (!done) { state = OgpFetcher.fetch(url); done = true } }
    val ogp = state
    val host = remember(url) { runCatching { java.net.URI(url).host }.getOrNull() ?: url }
    val shape = RoundedCornerShape(5.dp)
    Row(
        Modifier.padding(top = 6.dp).fillMaxWidth().height(LINK_CARD_HEIGHT_DP.dp).clip(shape).background(Palette.surface2).border(1.dp, Palette.border, shape).clickable { onOpen(url) },
    ) {
        Column(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.Center) {
            when {
                ogp != null -> {
                    Text(ogp.title ?: url, color = Palette.textStrong, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 17.sp)
                    ogp.description?.let { Text(it, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    Text(ogp.siteName ?: host, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                // 取れなかった: アドレスだけの札(枠は残す)
                done -> {
                    Text(url, color = Palette.textStrong, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 17.sp)
                    Text(host, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                else -> Text("読み込み中…", color = Palette.textMuted, fontSize = 11.sp)
            }
        }
        // 絵は枠の高さに切り取る(幅も決めてあるので、絵の大きさで枠は変わらない)
        if (ogp?.image != null) {
            AsyncImage(ogp.image, null, Modifier.width(112.dp).fillMaxHeight().background(Palette.surface3), contentScale = ContentScale.Crop)
        }
    }
}
