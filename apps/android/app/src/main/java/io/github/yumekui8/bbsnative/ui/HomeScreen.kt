package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.bbs.Board
import io.github.yumekui8.bbsnative.data.HistoryEntry

/** ホーム: お気に入り板・板一覧・閲覧履歴のタブ */
@Composable
fun HomeScreen(vm: AppViewModel, modifier: Modifier = Modifier) {
    var tab by rememberSaveable { mutableStateOf(0) }
    Column(modifier.fillMaxSize()) {
        Text(
            "bbs N",
            Modifier.padding(start = 20.dp, top = 16.dp, bottom = 8.dp),
            fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Palette.textStrong,
        )
        PrimaryTabRow(selectedTabIndex = tab, containerColor = Palette.base) {
            listOf("お気に入り", "板一覧", "履歴").forEachIndexed { i, name ->
                Tab(selected = tab == i, onClick = { tab = i }, text = { Text(name, fontSize = 15.sp) })
            }
        }
        when (tab) {
            0 -> FavoritesTab(vm)
            1 -> BoardsTab(vm)
            else -> HistoryTab(vm)
        }
    }
}

@Composable
private fun FavoritesTab(vm: AppViewModel) {
    if (vm.favorites.isEmpty()) {
        Hint("お気に入りの板はありません。板一覧の ☆ で足せます")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(vm.favorites, key = { it.url }) { b -> BoardRow(b, true, onStar = { vm.toggleFavorite(b) }, onClick = { vm.openBoard(b) }) }
    }
}

@Composable
private fun BoardsTab(vm: AppViewModel) {
    LaunchedEffect(Unit) { if (vm.boards.isEmpty()) vm.loadBoards() }
    var query by rememberSaveable { mutableStateOf("") }
    val favUrls = remember(vm.favorites) { vm.favorites.map { it.url }.toSet() }
    val shown = remember(vm.boards, query) {
        val q = query.trim()
        if (q.isEmpty()) vm.boards else vm.boards.filter { it.name.contains(q, true) || (it.category ?: "").contains(q, true) }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                placeholder = { Text("板の名前・カテゴリで絞り込む") }, modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { vm.loadBoards(refresh = true) }) { Icon(Icons.Outlined.Refresh, "板一覧を取り直す") }
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
                            Text(
                                b.category ?: "", Modifier.fillMaxWidth().padding(start = 16.dp, top = 14.dp, bottom = 4.dp),
                                color = Palette.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    item(key = b.url) { BoardRow(b, b.url in favUrls, onStar = { vm.toggleFavorite(b) }, onClick = { vm.openBoard(b) }) }
                }
            }
        }
    }
}

@Composable
private fun HistoryTab(vm: AppViewModel) {
    if (vm.history.isEmpty()) {
        Hint("閲覧履歴はありません")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(vm.history, key = { it.thread.id }) { h -> HistoryRow(h) { vm.openThread(h.thread) } }
    }
}

@Composable
private fun BoardRow(b: Board, favorite: Boolean, onStar: () -> Unit, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(b.name, Modifier.weight(1f).padding(vertical = 10.dp), color = Palette.textStrong, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        IconButton(onClick = onStar) {
            Icon(if (favorite) Icons.Filled.Star else Icons.Outlined.Star, "お気に入り", tint = if (favorite) Palette.heatWarm else Palette.textMuted)
        }
    }
    HorizontalDivider(color = Palette.border)
}

@Composable
private fun HistoryRow(h: HistoryEntry, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(h.thread.title, color = Palette.textStrong, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("${h.readNo} / ${h.thread.postCount} 読了 ・ ${hostBoard(h.thread.boardUrl)}", color = Palette.textMuted, fontSize = 12.sp)
    }
    HorizontalDivider(color = Palette.border)
}

private fun hostBoard(url: String) = url.removePrefix("https://").removePrefix("http://").trimEnd('/')

@Composable
fun Hint(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(text, color = Palette.textMuted, fontSize = 14.sp) }
}
