package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.bbs.Filter
import io.github.yumekui8.bbsnative.bbs.Post
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest

/** ポップアップに出すもの(アンカー先・返信・同じ ID) */
private class Popup(val title: String, val posts: List<Post>)

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ThreadScreen(vm: AppViewModel, page: Page.Thread, modifier: Modifier = Modifier) {
    val index = page.index
    var filters by remember { mutableStateOf(emptySet<Filter>()) }
    var popup by remember { mutableStateOf<Popup?>(null) }
    val own = page.ownNos
    val counts = remember(index, own) { Filter.entries.associateWith { index.count(it, own) } }
    val shown = remember(index, filters, own) {
        if (filters.isEmpty()) index.posts else index.posts.filter { p -> filters.any { index.matches(p, it, own) } }
    }
    val listState = rememberLazyListState()
    val context = LocalContext.current

    // 開いたときの位置へ(手元のログ・新着が届いて openAt が決まったら一度だけ)
    LaunchedEffect(page.openAt, index) {
        val at = page.openAt ?: return@LaunchedEffect
        val i = index.posts.indexOfFirst { it.no >= at }
        if (i >= 0) {
            listState.scrollToItem(i)
            page.openAt = null
        }
    }
    ReadTracker(listState, shown) { vm.markRead(page, it) }

    // 番号・ID・アンカーを押したとき(組み立て済みの文字列から呼ばれる)。tag は「a:から-まで」「r:番号」「i:ID」
    SideEffect {
        page.links.onTag = { tag ->
            val v = tag.drop(2)
            when (tag[0]) {
                'a' -> {
                    val (from, to) = v.split('-').map { it.toInt() }
                    val list = index.posts.filter { it.no in from..to }
                    if (list.isNotEmpty()) popup = Popup(if (from == to) ">>$from" else ">>$from-$to", list)
                }
                'r' -> {
                    val no = v.toInt()
                    val list = (index.replies[no] ?: emptyList()).mapNotNull { n -> index.posts.getOrNull(n - 1)?.takeIf { it.no == n } }
                    if (list.isNotEmpty()) popup = Popup(">>$no への返信(${list.size})", list)
                }
                'i' -> popup = Popup("ID:$v(${index.idCount[v] ?: 0})", index.posts.filter { it.id == v })
                // 2ch 互換のスレの URL はアプリの中で、それ以外はブラウザで
                'u' -> if (!vm.openUrl(v)) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(v))) }
            }
        }
    }

    Column(modifier.fillMaxSize()) {
        TopBar(page.title, onBack = { vm.back() }, onRefresh = { vm.refreshThread(page) }, refreshing = page.loading, subtitle = "${index.posts.size}")
        FilterBar(filters, counts) { f -> filters = if (f == null) emptySet() else if (f in filters) filters - f else filters + f }
        PullToRefreshBox(isRefreshing = page.loading, onRefresh = { vm.refreshThread(page) }, modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                !page.loaded -> Hint("読み込み中…")
                page.error != null && index.posts.isEmpty() -> Hint("読み込めませんでした: ${page.error}")
                else -> LazyColumn(Modifier.fillMaxSize(), state = listState) {
                    items(shown, key = { it.no }, contentType = { 0 }) { p ->
                        if (filters.isEmpty() && p.no == page.unreadFrom) UnreadDivider()
                        // 長押しで、そのレスへの返信を書き込み欄に入れて開く
                        Box(Modifier.combinedClickable(interactionSource = null, indication = null, onClick = {}, onLongClick = { vm.openReply(page, ">>${p.no}\n") })) {
                            page.rendered[p.no]?.let { PostItem(it, own = p.no in own) }
                        }
                        HorizontalDivider(color = Palette.border)
                    }
                    item(key = "end") {
                        Box(Modifier.fillMaxWidth().padding(vertical = 20.dp).navigationBarsPadding(), contentAlignment = Alignment.Center) {
                            Text(if (page.archived) "-END-(dat 落ち)" else "-END-", color = Palette.textMuted, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
        BottomBar(page.reply.notice, onWrite = { vm.openReply(page) })
    }

    ReplySheet(vm, page)

    popup?.let { pop ->
        ModalBottomSheet(onDismissRequest = { popup = null }, containerColor = Palette.surface) {
            Text(pop.title, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = Palette.accent, fontWeight = FontWeight.Bold)
            LazyColumn(Modifier.fillMaxWidth()) {
                items(pop.posts, key = { it.no }) { p ->
                    page.rendered[p.no]?.let { PostItem(it, own = p.no in own) }
                    HorizontalDivider(color = Palette.border)
                }
                item { Spacer(Modifier.height(24.dp).navigationBarsPadding()) }
            }
        }
    }
}

/** 見えている一番下のレスを、スクロールが止まって少ししてから既読として知らせる */
@Composable
private fun ReadTracker(state: LazyListState, shown: List<Post>, onRead: (Int) -> Unit) {
    LaunchedEffect(state, shown) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull { it.key is Int }?.key as Int? }
            .collectLatest { no ->
                if (no == null) return@collectLatest
                delay(500)
                onRead(no)
            }
    }
}

@Composable
private fun FilterBar(filters: Set<Filter>, counts: Map<Filter, Int>, onToggle: (Filter?) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Palette.base).horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (f in Filter.entries) FilterTab("${f.label} ${counts[f] ?: 0}", f in filters) { onToggle(f) }
        FilterTab("すべて", filters.isEmpty()) { onToggle(null) }
    }
    HorizontalDivider(color = Palette.border)
}

@Composable
private fun FilterTab(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 10.dp),
        color = if (active) Palette.accent else Palette.textMuted,
        fontSize = 14.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
    )
}

@Composable
private fun UnreadDivider() {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(2.dp).background(Palette.unread.copy(alpha = 0.5f)))
        Text("ここから未読", Modifier.padding(horizontal = 10.dp), color = Palette.unread, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Box(Modifier.weight(1f).height(2.dp).background(Palette.unread.copy(alpha = 0.5f)))
    }
}

@Composable
fun TopBar(title: String, onBack: () -> Unit, onRefresh: () -> Unit, refreshing: Boolean, subtitle: String? = null) {
    Row(Modifier.fillMaxWidth().background(Palette.base).padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る", tint = Palette.textStrong) }
        Column(Modifier.weight(1f)) {
            Text(title, color = Palette.textStrong, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 20.sp)
            if (subtitle != null) Text(subtitle, color = Palette.textMuted, fontSize = 12.sp)
        }
        IconButton(onClick = onRefresh, enabled = !refreshing) { Icon(Icons.Outlined.Refresh, "更新", tint = if (refreshing) Palette.textMuted else Palette.textStrong) }
    }
}
