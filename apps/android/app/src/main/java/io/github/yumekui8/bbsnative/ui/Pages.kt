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

/** スレの一覧(閲覧履歴・お気に入りのスレで共通)。読んだ位置と、手元で分かっている未読の数 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ThreadEntryList(vm: AppViewModel, title: String, entries: List<HistoryEntry>, empty: String) {
    var menuFor by remember { mutableStateOf<io.github.yumekui8.bbsnative.bbs.ThreadSummary?>(null) }
    val hv = androidx.compose.ui.platform.LocalView.current
    menuFor?.let { t -> ThreadMenu(vm, t, hasLog = true) { menuFor = null } }
    // お気に入りのスレは、開いたときに新着を確かめる(今のスマホ版と同じ)
    androidx.compose.runtime.LaunchedEffect(title) { if (title == "お気に入りのスレ") vm.checkNew(entries) }
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        HeaderBar(title, onNav = { vm.drawerOpen = true }) {
            BarIcon(Icons.Filled.Refresh, "新着を確かめる") { vm.checkNew(entries) }
        }
        HorizontalDivider(color = Palette.border)
        if (entries.isEmpty()) Hint(empty)
        else androidx.compose.material3.pulltorefresh.PullToRefreshBox(isRefreshing = vm.checking, onRefresh = { vm.checkNew(entries) }, modifier = Modifier.fillMaxSize()) { LazyColumn(Modifier.fillMaxSize()) {
            items(entries, key = { it.thread.id }) { h ->
                // 掲示板で分かったレス数があれば、そちらで未読を数える(-1 は dat 落ち)
                val remote = vm.remoteCounts[h.thread.id]
                val unread = maxOf(0, maxOf(h.thread.postCount, remote ?: 0) - h.readNo)
                Column(Modifier.fillMaxWidth().combinedClickable(onLongClick = { Haptics.longPress(hv); menuFor = h.thread }) { vm.openThread(h.thread) }.padding(start = 28.dp, end = 16.dp, top = 10.dp, bottom = 10.dp)) {
                    Text(h.thread.title.ifEmpty { h.thread.key }, color = Palette.textStrong, fontSize = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal)
                    Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            (if (remote == -1) "dat 落ち ・ " else "") + "${relativeTime(h.readAt)}に見た ・ ${h.thread.boardUrl.removePrefix("https://").trimEnd('/')}",
                            Modifier.weight(1f), color = Palette.textMuted, fontSize = 12.sp, maxLines = 1,
                        )
                        Text("${maxOf(h.thread.postCount, remote ?: 0)}レス", color = Palette.textMuted, fontSize = 12.sp)
                        if (unread > 0) {
                            Spacer(Modifier.width(8.dp))
                            Text("+$unread", Modifier.background(Palette.unread, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp), color = Palette.unreadText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                HorizontalDivider(color = Palette.border)
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }}
    }
}

/** 書き込み履歴(新しい順)。押すとそのスレを開く */
@Composable
fun PostHistoryScreen(vm: AppViewModel) {
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        HeaderBar("書き込み履歴", onNav = { vm.drawerOpen = true })
        HorizontalDivider(color = Palette.border)
        if (vm.postHistory.isEmpty()) Hint("書き込み履歴はありません")
        else LazyColumn(Modifier.fillMaxSize()) {
            items(vm.postHistory) { e ->
                Column(Modifier.fillMaxWidth().clickable { vm.openThread(e.thread) }.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (e.no != null) Text(">>${e.no}", Modifier.background(Palette.ownWash, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.own, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.width(8.dp))
                        Text(relativeTime(e.postedAt), color = Palette.textMuted, fontSize = 12.sp)
                    }
                    Text(e.thread.title, color = Palette.textStrong, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(e.body, Modifier.padding(start = 10.dp), color = Palette.textBody, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
                HorizontalDivider(color = Palette.border)
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }
    }
}
