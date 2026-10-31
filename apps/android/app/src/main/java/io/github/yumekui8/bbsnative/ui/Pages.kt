package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.bbs.Board
import io.github.yumekui8.bbsnative.data.HistoryEntry
import io.github.yumekui8.bbsnative.data.ThumbMode

/** 板一覧(5ch の bbsmenu)。☆ でお気に入り板に足す。押すとその板を開く */
@Composable
fun BoardsScreen(vm: AppViewModel) {
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val favUrls = remember(vm.favorites) { vm.favorites.map { it.url }.toSet() }
    val shown = remember(vm.boards, query) {
        val q = query.trim()
        if (q.isEmpty()) vm.boards else vm.boards.filter { it.name.contains(q, true) || (it.category ?: "").contains(q, true) }
    }
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        if (searching) SearchBar(query, { query = it }, "板の名前・カテゴリ") { searching = false; query = "" }
        else HeaderBar("板を追加", onNav = { vm.drawerOpen = true }) {
            BarIcon(Icons.Filled.Search, "探す") { searching = true }
            BarIcon(Icons.Filled.Refresh, "取り直す") { vm.loadBoards(refresh = true) }
        }
        HorizontalDivider(color = Palette.border)
        // サイトが 2 つ以上あれば、どのサイトの板を見るか選ぶ
        if (vm.sites.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val current = vm.siteUrl ?: vm.sites.first().first
                for ((url, name) in vm.sites) {
                    val on = url == current
                    Text(
                        name, Modifier.background(if (on) Palette.accentWash else Palette.surface2, RoundedCornerShape(8.dp)).clickable { vm.selectSite(url) }.padding(horizontal = 14.dp, vertical = 7.dp),
                        color = if (on) Palette.accent else Palette.textBody, fontSize = 14.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                    )
                }
            }
        }
        when {
            vm.boardsLoading && vm.boards.isEmpty() -> Hint("読み込み中…")
            vm.boardsError != null && vm.boards.isEmpty() -> Hint("読み込めませんでした: ${vm.boardsError}")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                var lastCat: String? = null
                for (b in shown) {
                    if (query.isBlank() && b.category != lastCat) {
                        lastCat = b.category
                        item(key = "cat:${b.category}") {
                            Text(b.category ?: "", Modifier.fillMaxWidth().padding(start = 20.dp, top = 16.dp, bottom = 4.dp), color = Palette.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    item(key = b.url) { BoardRow(b, b.url in favUrls, onStar = { vm.toggleFavorite(b) }, onClick = { vm.openBoard(b) }) }
                }
                item { Spacer(Modifier.navigationBarsPadding()) }
            }
        }
    }
}

@Composable
private fun BoardRow(b: Board, favorite: Boolean, onStar: () -> Unit, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(start = 20.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(b.name, Modifier.weight(1f), color = Palette.textStrong, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        IconButton(onClick = onStar) {
            Icon(if (favorite) Icons.Filled.Star else Icons.Outlined.Star, "お気に入り", tint = if (favorite) Palette.markFav else Palette.textMuted)
        }
    }
    HorizontalDivider(color = Palette.border)
}

/**
 * 過去のスレの画面の上: 題「過去のスレ」と、未読(全板)・閲覧履歴・お気に入り・書き込みの切り替え。
 * どれも「前に見たスレ」の一覧なので、1 つの画面のタブとしてまとめる
 */
@Composable
private fun PastHeader(vm: AppViewModel, current: String, onRefresh: (() -> Unit)?) {
    HeaderBar("過去のスレ", onNav = { vm.drawerOpen = true }) {
        if (onRefresh != null) BarIcon(Icons.Filled.Refresh, "新着を確かめる") { onRefresh() }
    }
    Row(Modifier.fillMaxWidth().background(Palette.bar).padding(horizontal = 10.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((k, label) in listOf("unread" to "未読", "history" to "閲覧", "fav" to "お気に入り", "posts" to "書き込み")) {
            val on = k == current
            val count = when (k) { "unread" -> vm.allUnread.size; "fav" -> vm.favThreads.size; else -> 0 }
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(50)).background(if (on) Palette.accentWash else Palette.surface2)
                    .border(1.dp, if (on) Palette.accent else Color.Transparent, RoundedCornerShape(50))
                    .clickable(enabled = !on) { vm.openPast(k) }.padding(vertical = 7.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                if (count > 0) Text(" $count", color = if (k == "unread") Palette.unread else Palette.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
    HorizontalDivider(color = Palette.border)
}

/** 過去のスレの 1 行(どのタブでも同じ形): スレタイ、下に板と時間、右に レス数と未読。書き込みのタブは、書いた本文を下に */
@Composable
private fun PastRow(
    vm: AppViewModel, t: io.github.yumekui8.bbsnative.bbs.ThreadSummary, meta: String, total: Int?, unread: Int,
    archived: Boolean = false, own: String? = null, ownNo: Int? = null, onLongClick: (() -> Unit)? = null,
) {
    @OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).combinedClickable(onLongClick = onLongClick) { vm.openThread(t) }.graphicsLayer { alpha = if (archived) 0.6f else 1f },
    ) {
        // 左の帯: 未読があれば未読の色(未読が多いほど濃く)
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (unread > 0) Palette.unread.copy(alpha = 0.35f + 0.65f * minOf(1f, kotlin.math.log10(unread + 1f) / 2.5f)) else Color.Transparent))
        Column(Modifier.weight(1f).padding(start = 13.dp, end = 12.dp, top = 10.dp, bottom = 10.dp)) {
            Text(
                t.title.ifEmpty { t.key }, color = if (unread > 0) Palette.textStrong else Palette.threadReadTitle, fontSize = 15.sp, lineHeight = 20.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = if (unread > 0) FontWeight.SemiBold else FontWeight.Normal,
            )
            if (own != null) Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.Top) {
                if (ownNo != null) Text(">>$ownNo", Modifier.background(Palette.ownWash, RoundedCornerShape(4.dp)).padding(horizontal = 5.dp), color = Palette.own, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(6.dp))
                Text(own, color = Palette.textBody, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(meta, Modifier.weight(1f), color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (total != null) Text("${total}レス", color = Palette.textMuted, fontSize = 11.sp)
                if (unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    Text(if (unread > 999) "+999+" else "+$unread", Modifier.background(Palette.unread, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.unreadText, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
    HorizontalDivider(color = Palette.border)
}

private fun boardName(vm: AppViewModel, url: String) = vm.favorites.firstOrNull { it.url == url }?.name ?: url.removePrefix("https://").trimEnd('/')

/** 過去のスレの「未読」「閲覧」「お気に入り」のタブ。読んだ位置と、手元で分かっている未読の数 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ThreadEntryList(vm: AppViewModel, title: String, entries: List<HistoryEntry>, empty: String, onRefresh: (() -> Unit)? = null) {
    val refresh = onRefresh ?: { vm.checkNew(entries) }
    val tab = when (title) { "全板の未読" -> "unread"; "お気に入りのスレ" -> "fav"; else -> "history" }
    var menuFor by remember { mutableStateOf<io.github.yumekui8.bbsnative.bbs.ThreadSummary?>(null) }
    val hv = androidx.compose.ui.platform.LocalView.current
    menuFor?.let { t -> ThreadMenu(vm, t, hasLog = true) { menuFor = null } }
    // お気に入りのスレは、開いたときに新着を確かめる(今のスマホ版と同じ)
    androidx.compose.runtime.LaunchedEffect(title) { if (title == "お気に入りのスレ") vm.checkNew(entries) }
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        PastHeader(vm, tab, refresh)
        if (entries.isEmpty() && !(tab == "unread" && vm.checking)) Hint(empty)
        else androidx.compose.material3.pulltorefresh.PullToRefreshBox(isRefreshing = vm.checking, onRefresh = { refresh() }, modifier = Modifier.fillMaxSize()) { LazyColumn(Modifier.fillMaxSize()) {
            items(entries, key = { it.thread.id }) { h ->
                // 掲示板で分かったレス数があれば、そちらで未読を数える(-1 は dat 落ち)
                val remote = vm.remoteCounts[h.thread.id]
                val total = maxOf(h.thread.postCount, remote ?: 0)
                val unread = maxOf(0, total - h.readNo)
                val meta = listOfNotNull(
                    boardName(vm, h.thread.boardUrl),
                    if (h.readAt > 0) "${relativeTime(h.readAt)}に見た" else null,
                    if (remote == -1) "dat 落ち" else null,
                ).joinToString(" ・ ")
                PastRow(vm, h.thread, meta, total, unread, archived = remote == -1, onLongClick = { Haptics.longPress(hv); menuFor = h.thread })
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }}
    }
}

/** 過去のスレの「書き込み」のタブ(新しい順)。行の形はほかのタブと同じで、書いた本文を足す */
@Composable
fun PostHistoryScreen(vm: AppViewModel) {
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        PastHeader(vm, "posts", null)
        if (vm.postHistory.isEmpty()) Hint("書き込み履歴はありません")
        else LazyColumn(Modifier.fillMaxSize()) {
            items(vm.postHistory) { e ->
                PastRow(vm, e.thread, "${boardName(vm, e.thread.boardUrl)} ・ ${relativeTime(e.postedAt)}に書いた", null, 0, own = e.body.lines().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim() ?: e.body.trim(), ownNo = e.no)
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }
    }
}
