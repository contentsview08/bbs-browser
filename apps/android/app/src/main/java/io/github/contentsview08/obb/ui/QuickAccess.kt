package io.github.contentsview08.obb.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.ThreadSummary
import kotlinx.coroutines.launch

/**
 * クイックアクセス: 最近見たスレ・書き込んだスレ・最近見た板・上げた画像へ、どの画面からでもさっと移る画面。
 * 既定では、左右に往復するようになぞると出る(←→ か →←)。下からせり上がる板(ボトムシート)で、
 * いちばん上に「続きを読む」(未読のある最近のスレの札)、絞り込みの欄、見たスレ・書いたスレ・板・画像の切り替え。
 * 押すとそのスレを開く(スレを見ているときは、今のスレの上に開く)。hono-bbs の web のスマホ(QuickAccess.tsx)も同じ形
 */
@Composable
fun QuickAccess(vm: AppViewModel) {
    if (!vm.quickOpen) return
    val current = (vm.stack.lastOrNull() as? Page.Thread)?.summary?.id
    var tab by rememberSaveable { mutableStateOf("recent") }
    var query by rememberSaveable { mutableStateOf("") }
    var viewerUrl by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    viewerUrl?.let { u -> ImageViewer(vm.prefs.uploads().map { it.first }, u, onClose = { viewerUrl = null }) }

    // 板の URL → 名前(お気に入り・最近見た板から。なければ URL の板の部分)
    val recentBoards = remember(vm.quickOpen) { vm.prefs.recentBoards() }
    val boardNames = remember(vm.favorites, recentBoards) { recentBoards.associate { it.first to it.second } + vm.favorites.associate { it.url to it.name } }
    fun boardName(url: String) = boardNames[url] ?: url.trimEnd('/').substringAfterLast('/')
    fun unreadOf(t: ThreadSummary, readNo: Int) = maxOf(0, maxOf(t.postCount, vm.remoteCounts[t.id] ?: 0) - readNo)
    val q = query.trim()
    fun hit(vararg s: String) = q.isEmpty() || s.any { it.contains(q, ignoreCase = true) }

    // 下からせり上がる(動きを減らす設定なら、すぐ出す)
    val show = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { if (Motion.reduced) show.snapTo(1f) else show.animateTo(1f, tween(220, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
    fun close(then: () -> Unit = {}) {
        scope.launch {
            if (!Motion.reduced) show.animateTo(0f, tween(140))
            vm.quickOpen = false
            then()
        }
    }

    androidx.compose.ui.window.Popup(onDismissRequest = { close() }, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
        BoxWithConstraints(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f * show.value))
                .clickable(remember { MutableInteractionSource() }, null) { close() },
            contentAlignment = Alignment.BottomCenter,
        ) {
            val sheetShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
            Column(
                // 高さはいつも同じ
                Modifier.fillMaxWidth().height(maxHeight * 0.78f)
                    .graphicsLayer { translationY = (1f - show.value) * size.height }
                    .shadow(16.dp, sheetShape).clip(sheetShape).background(Palette.surface)
                    .clickable(remember { MutableInteractionSource() }, null) {}
                    .navigationBarsPadding(),
            ) {
                // つまみと題
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(Palette.borderStrong))
                }
                Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("クイックアクセス", Modifier.weight(1f), color = Palette.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).clickable { close() }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, "閉じる", tint = Palette.textMuted, modifier = Modifier.size(20.dp))
                    }
                }
                // 絞り込み(スレタイ・板の名前)
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Palette.surface2)
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Search, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) Text("スレタイ・板の名前で絞り込む", color = Palette.textMuted, fontSize = 14.sp)
                        BasicTextField(
                            query, { query = it }, Modifier.fillMaxWidth(), singleLine = true,
                            textStyle = TextStyle(color = Palette.textStrong, fontSize = 14.sp), cursorBrush = SolidColor(Palette.accent),
                        )
                    }
                    if (query.isNotEmpty()) Icon(Icons.Filled.Close, "消す", tint = Palette.textMuted, modifier = Modifier.size(18.dp).clickable { query = "" })
                }
                // 続きを読む: 未読のある最近のスレ(6 つまで)を横に並べた札
                val resume = vm.history.filter { it.thread.id != current && unreadOf(it.thread, it.readNo) > 0 }.take(6)
                if (q.isEmpty() && resume.isNotEmpty()) {
                    Text("続きを読む", Modifier.padding(start = 18.dp, top = 6.dp, bottom = 6.dp), color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(resume, key = { it.thread.id }) { h ->
                            val unread = unreadOf(h.thread, h.readNo)
                            Column(
                                Modifier.width(156.dp).clip(RoundedCornerShape(12.dp)).background(Palette.surface2)
                                    .clickable { close { vm.openThread(h.thread) } }.padding(10.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    BoardIcon(h.thread.boardUrl, 14.dp) { Icon(Icons.Filled.Forum, null, tint = Palette.textMuted, modifier = Modifier.size(14.dp)) }
                                    Spacer(Modifier.width(5.dp))
                                    Text(boardName(h.thread.boardUrl), Modifier.weight(1f), color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    UnreadBadge(unread)
                                }
                                Text(
                                    h.thread.title.ifEmpty { h.thread.key }, Modifier.padding(top = 6.dp).height(38.dp),
                                    color = Palette.textStrong, fontSize = 13.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }
                // 切り替え(区切りボタン。選んでいるものは面を浮かせる)
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 10.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Palette.surface2).padding(3.dp),
                ) {
                    for ((k, label, icon) in listOf<Triple<String, String, ImageVector>>(
                        Triple("recent", "見たスレ", Icons.Filled.History), Triple("posted", "書いたスレ", Icons.Filled.EditNote),
                        Triple("boards", "板", Icons.Filled.Forum), Triple("uploads", "画像", Icons.Filled.Image),
                    )) {
                        val on = k == tab
                        Row(
                            Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).then(if (on) Modifier.shadow(1.dp, RoundedCornerShape(8.dp)).background(Palette.surface) else Modifier)
                                .clickable { tab = k }.padding(vertical = 7.dp),
                            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(icon, null, tint = if (on) Palette.accent else Palette.textMuted, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(label, color = if (on) Palette.textStrong else Palette.textMuted, fontSize = 12.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                        }
                    }
                }
                val listMod = Modifier.fillMaxWidth().heightIn(min = 200.dp)
                @Composable fun empty(text: String) = Text(text, Modifier.fillMaxWidth().padding(28.dp), color = Palette.textMuted, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                @Composable fun row(icon: @Composable () -> Unit, title: String, sub: String, unread: Int, here: Boolean, onClick: () -> Unit) =
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !here, onClick = onClick)
                            .background(if (here) Palette.accentWash else Color.Transparent).padding(horizontal = 18.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(Palette.surface2), contentAlignment = Alignment.Center) { icon() }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(title, color = Palette.textStrong, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread > 0) FontWeight.SemiBold else FontWeight.Normal)
                            Text(if (here) "いま見ているスレ" else sub, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (unread > 0 && !here) {
                            Spacer(Modifier.width(8.dp))
                            UnreadBadge(unread)
                        }
                    }
                val boardIcon = @Composable { url: String -> BoardIcon(url, 18.dp) { Icon(Icons.Filled.Forum, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp)) } }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    "boards" -> {
                        val boards = recentBoards.filter { hit(it.second) }
                        if (boards.isEmpty()) empty(if (q.isEmpty()) "まだありません" else "当てはまる板はありません")
                        else LazyColumn(listMod) {
                            items(boards, key = { it.first }) { (url, name, t) ->
                                row({ boardIcon(url) }, name, "${relativeTime(t)}に見た", 0, false) {
                                    close { vm.openBoard(vm.favorites.firstOrNull { it.url == url } ?: Board(url, name), root = false) }
                                }
                            }
                        }
                    }
                    "uploads" -> {
                        // 上げた画像: 押すと見る、長押しで URL をコピー(もう一度貼れるように)
                        val ups = vm.prefs.uploads()
                        if (ups.isEmpty()) empty("まだありません(書き込み欄の ＋ の「画像」から上げた画像が並びます)")
                        else {
                            androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                                androidx.compose.foundation.lazy.grid.GridCells.Fixed(3), listMod,
                                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 2.dp),
                            ) {
                                items(ups.size) { i ->
                                    val url = ups[i].first
                                    @OptIn(ExperimentalFoundationApi::class)
                                    StoredImage(
                                        url,
                                        Modifier.padding(3.dp).aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(Palette.surface2)
                                            .combinedClickable(onLongClick = { copyText(context, url); vm.toast = "URL をコピーしました" }) { viewerUrl = url },
                                    )
                                }
                            }
                            Text("長押しで URL をコピー", Modifier.padding(horizontal = 18.dp, vertical = 6.dp), color = Palette.textMuted, fontSize = 11.sp)
                        }
                    }
                    else -> {
                        // (スレ, 下の行, 未読)
                        val rows: List<Triple<ThreadSummary, String, Int>> = when (tab) {
                            "posted" -> vm.postHistory.distinctBy { it.thread.id }.take(30).map { e ->
                                Triple(e.thread, "${boardName(e.thread.boardUrl)} ・ ${relativeTime(e.postedAt)}に書いた ・ ${postedHeadLine(e.body) ?: ""}", 0)
                            }
                            else -> vm.history.take(30).map { h -> Triple(h.thread, "${boardName(h.thread.boardUrl)} ・ ${relativeTime(h.readAt)}に見た", unreadOf(h.thread, h.readNo)) }
                        }.filter { (t, _, _) -> hit(t.title, boardName(t.boardUrl)) }
                        if (rows.isEmpty()) empty(if (q.isEmpty()) "まだありません" else "当てはまるスレはありません")
                        else LazyColumn(listMod) {
                            items(rows, key = { it.first.id }) { (t, sub, unread) ->
                                row({ boardIcon(t.boardUrl) }, t.title.ifEmpty { t.key }, sub, unread, t.id == current) { close { vm.openThread(t) } }
                            }
                        }
                    }
                }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
