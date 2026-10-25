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
@Composable
fun ThreadEntryList(vm: AppViewModel, title: String, entries: List<HistoryEntry>, empty: String) {
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        HeaderBar(title, onNav = { vm.drawerOpen = true })
        HorizontalDivider(color = Palette.border)
        if (entries.isEmpty()) Hint(empty)
        else LazyColumn(Modifier.fillMaxSize()) {
            items(entries, key = { it.thread.id }) { h ->
                val unread = maxOf(0, h.thread.postCount - h.readNo)
                Column(Modifier.fillMaxWidth().clickable { vm.openThread(h.thread) }.padding(start = 28.dp, end = 16.dp, top = 10.dp, bottom = 10.dp)) {
                    Text(h.thread.title.ifEmpty { h.thread.key }, color = Palette.textStrong, fontSize = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal)
                    Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${relativeTime(h.readAt)}に見た ・ ${h.thread.boardUrl.removePrefix("https://").trimEnd('/')}", Modifier.weight(1f), color = Palette.textMuted, fontSize = 12.sp, maxLines = 1)
                        Text("${h.thread.postCount}レス", color = Palette.textMuted, fontSize = 12.sp)
                        if (unread > 0) {
                            Spacer(Modifier.width(8.dp))
                            Text("+$unread", Modifier.background(Palette.unread, RoundedCornerShape(10.dp)).padding(horizontal = 7.dp, vertical = 1.dp), color = Palette.unreadText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                HorizontalDivider(color = Palette.border)
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }
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
                        if (e.no != null) Text(">>${e.no}", Modifier.background(Palette.ownWash, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.own, fontSize = 12.sp, fontWeight = FontWeight.Bold)
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

/** 設定: 文字の大きさ・画像の自動読み込み・NG の一覧 */
@Composable
fun SettingsScreen(vm: AppViewModel) {
    val p = vm.prefs
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        HeaderBar("設定", onNav = { vm.drawerOpen = true })
        HorizontalDivider(color = Palette.border)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp).navigationBarsPadding()) {
            Section("文字の大きさ")
            Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("A", color = Palette.textMuted, fontSize = 13.sp)
                Slider(
                    p.fontScale, { p.changeFontScale((it * 20).toInt() / 20f) }, Modifier.weight(1f).padding(horizontal = 12.dp), valueRange = 0.85f..1.3f,
                    colors = SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent),
                )
                Text("A", color = Palette.textMuted, fontSize = 20.sp)
            }
            Text("${(p.fontScale * 100).toInt()}%", Modifier.padding(horizontal = 20.dp), color = Palette.textMuted, fontSize = 12.sp)

            Section("画像のサムネイルを自動で読む")
            for (m in ThumbMode.entries) Choice(m.label, p.thumbMode == m) { p.changeThumbMode(m) }

            Section("NG(${p.ngRules.size} 件)")
            if (p.ngRules.isEmpty()) Text("レスを長押しして、ID・名前・言葉を NG に足せます", Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = Palette.textMuted, fontSize = 13.sp)
            for (r in p.ngRules) {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        when (r.target) { "id" -> "ID"; "name" -> "名前"; else -> "言葉" },
                        Modifier.background(Palette.surface2, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.textMuted, fontSize = 12.sp,
                    )
                    Text(r.pattern, Modifier.weight(1f).padding(start = 10.dp), color = Palette.textBody, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = { vm.removeNg(r) }) { Icon(Icons.Filled.Close, "外す", tint = Palette.textMuted) }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, Modifier.padding(start = 20.dp, top = 22.dp, bottom = 8.dp), color = Palette.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp).background(if (selected) Palette.accentWash else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick).heightIn(min = 48.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { Text(label, color = if (selected) Palette.accent else Palette.textBody, fontSize = 15.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal) }
}
