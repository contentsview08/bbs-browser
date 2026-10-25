package io.github.yumekui8.bbsnative.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardDoubleArrowDown
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.VerticalAlignBottom
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.bbs.Filter
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.TwoCh
import io.github.yumekui8.bbsnative.data.NgRule
import io.github.yumekui8.bbsnative.data.ThumbMode
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** ポップアップに出すもの(アンカー先・返信・同じ ID) */
private class Popup(val title: String, val posts: List<Post>)

/** 絞り込みのタブ(今のスマホ版と同じ 4 つ + すべて。アイコンに意味の色) */
private val TABS: List<Triple<Filter, ImageVector, Color>> = listOf(
    Triple(Filter.POPULAR, Icons.Filled.LocalFireDepartment, Palette.markHot),
    Triple(Filter.IMAGE, Icons.Filled.Image, Palette.markImage),
    Triple(Filter.VIDEO, Icons.Filled.PlayCircle, Palette.markVideo),
    Triple(Filter.LINK, Icons.Filled.Link, Palette.markLink),
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ThreadScreen(vm: AppViewModel, page: Page.Thread, modifier: Modifier = Modifier) {
    val index = page.index
    val context = LocalContext.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val bars = rememberHideOnScroll()
    var filter by rememberSaveable { mutableStateOf<Filter?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var popup by remember { mutableStateOf<Popup?>(null) }
    var menu by remember { mutableStateOf(false) }
    var postMenu by remember { mutableStateOf<Post?>(null) }
    var ngWordFor by remember { mutableStateOf<Post?>(null) }
    var gallery by remember { mutableStateOf(false) }
    var nextSheet by remember { mutableStateOf(false) }
    /** 中身を見せている NG のレス */
    var revealed by remember { mutableStateOf(emptySet<Int>()) }
    var viewer by remember { mutableStateOf<String?>(null) }
    val own = page.ownNos
    val autoLoad = remember(vm.prefs.thumbMode) {
        when (vm.prefs.thumbMode) {
            ThumbMode.ALWAYS -> true
            ThumbMode.WIFI -> isWifi(context)
            ThumbMode.NEVER -> false
        }
    }
    val counts = remember(index, own) { Filter.entries.associateWith { index.count(it, own) } }
    val shown = remember(index, filter, own, query) {
        var list = index.posts
        val f = filter
        if (f != null) list = list.filter { index.matches(it, f, own) }
        val q = query.trim()
        if (q.isNotEmpty()) list = list.filter { it.body.contains(q, true) || it.name.contains(q, true) || it.id == q }
        list
    }
    val listState = rememberLazyListState()

    // 開いたときの位置へ(手元のログ・新着が届いて openAt が決まったら一度だけ)
    LaunchedEffect(page.openAt, index) {
        val at = page.openAt ?: return@LaunchedEffect
        val i = index.posts.indexOfFirst { it.no >= at }
        if (i >= 0) {
            listState.scrollToItem(i)
            page.openAt = null
        }
    }
    ReadTracker(listState) { vm.markRead(page, it) }

    // 番号・ID・アンカー・URL を押したとき(組み立て済みの文字列から呼ばれる)
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
                // 2ch 互換のスレ・板の URL はアプリの中で、それ以外はブラウザで
                'u' -> if (!vm.openUrl(v)) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(v))) }
            }
        }
    }

    val atBottom by remember { derivedStateOf { !listState.canScrollForward } }

    Column(modifier.fillMaxSize().background(Palette.base)) {
        Box(Modifier.weight(1f).fillMaxWidth().nestedScroll(bars.connection)) {
            PullToRefreshBox(isRefreshing = page.loading, onRefresh = { vm.refreshThread(page) }, modifier = Modifier.fillMaxSize()) {
                when {
                    !page.loaded -> Hint("読み込み中…")
                    page.error != null && index.posts.isEmpty() -> Hint("読み込めませんでした: ${page.error}")
                    else -> LazyColumn(
                        Modifier.fillMaxSize(), state = listState,
                        contentPadding = PaddingValues(top = with(density) { bars.topHeight.toDp() }),
                    ) {
                        items(shown, key = { it.no }, contentType = { if (it.no in page.ngNos) 1 else 0 }) { p ->
                            if (filter == null && query.isBlank() && p.no == page.unreadFrom) UnreadDivider()
                            Box(Modifier.combinedClickable(interactionSource = null, indication = null, onClick = {}, onLongClick = { postMenu = p })) {
                                if (p.no in page.ngNos && p.no !in revealed) {
                                    Text(
                                        "${p.no}  あぼーん", Modifier.fillMaxWidth().clickable { revealed = revealed + p.no }.padding(horizontal = 14.dp, vertical = 10.dp),
                                        color = Palette.textMuted, fontSize = 13.sp,
                                    )
                                } else page.rendered[p.no]?.let {
                                    PostItem(it, own = p.no in own, images = index.info[p.no]?.images ?: emptyList(), autoLoad = autoLoad, onImage = { url -> viewer = url })
                                }
                            }
                            HorizontalDivider(color = Palette.border)
                        }
                        item(key = "end") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 22.dp), contentAlignment = Alignment.Center) {
                                Text(if (page.archived) "-END-(dat 落ち)" else "-END-", color = Palette.textMuted, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                            }
                        }
                    }
                }
            }

            // 上の帯と絞り込みのタブ(スクロールで隠れる)
            Column(Modifier.fillMaxWidth().onSizeChanged { bars.topHeight = it.height.toFloat() }.graphicsLayer { translationY = -bars.hidden * bars.topHeight }) {
                if (searching) {
                    SearchBar(query, { query = it }, "レスを探す(本文・名前・ID)") { searching = false; query = "" }
                } else {
                    HeaderBar(page.title, onNav = { vm.drawerOpen = true }) {
                        BarIcon(Icons.Filled.Search, "探す") { searching = true }
                        MoreButton { menu = true }
                    }
                }
                FilterTabs(filter, counts) { filter = it }
                HorizontalDivider(color = Palette.border)
            }

            // 一番下へ(右下)
            if (!atBottom && index.posts.isNotEmpty()) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 14.dp).size(48.dp)
                        .background(Palette.surface2, RoundedCornerShape(12.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(12.dp))
                        .clickable { scope.launch { listState.animateScrollToItem(maxOf(0, shown.size)) } },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.KeyboardDoubleArrowDown, "一番下へ", tint = Palette.textBody) }
            }
        }
        ThreadFooter(vm, page) { vm.refreshThread(page) }
    }

    if (menu) {
        MenuSheet(
            listOf(
                listOf(
                    MenuItem(if (page.favorite) "お気に入りのスレから外す" else "お気に入りのスレに足す", if (page.favorite) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, Palette.markFav) { vm.toggleFavoriteThread(page) },
                    MenuItem("このスレの画像一覧", Icons.Filled.PhotoLibrary, Palette.markImage) { gallery = true },
                    MenuItem("次スレを探す", Icons.Filled.SkipNext, Palette.accent) { vm.findNext(page); nextSheet = true },
                    MenuItem(if (filter == Filter.OWN) "自分の書き込みの絞り込みを外す" else "自分の書き込みだけ(${counts[Filter.OWN] ?: 0})", Icons.Filled.Person, Palette.own) { filter = if (filter == Filter.OWN) null else Filter.OWN },
                ),
                listOf(
                    MenuItem("板を開く", Icons.AutoMirrored.Filled.List) { vm.openBoardOf(page) },
                    MenuItem("いちばん上へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                    MenuItem("いちばん下へ", Icons.Filled.VerticalAlignBottom) { scope.launch { listState.scrollToItem(maxOf(0, shown.size)) } },
                ),
                listOf(
                    MenuItem("URL をコピー", Icons.Filled.Link, Palette.markLink) { copyText(context, TwoCh.webUrl(page.summary)); vm.toast = "URL をコピーしました" },
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, Palette.markLink) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(TwoCh.webUrl(page.summary)))) } },
                ),
                listOf(MenuItem("ログを削除して閉じる", Icons.Filled.Delete, danger = true) { vm.deleteLog(page) }),
            ),
        ) { menu = false }
    }

    postMenu?.let { p ->
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("返信する(>>${p.no})", Icons.AutoMirrored.Filled.Reply, Palette.accent) { vm.openReply(page, ">>${p.no}\n") },
                    MenuItem("本文をコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, p.body); vm.toast = "コピーしました" },
                ),
                listOfNotNull(
                    p.id?.let { id -> MenuItem("ID を NG(ID:$id)", Icons.Filled.Block, Palette.markDanger) { vm.addNg(NgRule("id", id)) } },
                    MenuItem("名前を NG(${p.name.take(20)})", Icons.Filled.Block, Palette.markDanger) { vm.addNg(NgRule("name", p.name)) },
                    MenuItem("言葉を NG…", Icons.Filled.Block, Palette.markDanger) { ngWordFor = p },
                ),
            ),
        ) { postMenu = null }
    }

    ngWordFor?.let { p ->
        var word by remember(p.no) { mutableStateOf(p.body.lineSequence().firstOrNull()?.take(30) ?: "") }
        AlertDialog(
            onDismissRequest = { ngWordFor = null },
            title = { Text("言葉を NG") },
            text = { OutlinedTextField(word, { word = it }, singleLine = true, label = { Text("この言葉を含むレスをあぼーんにする") }) },
            confirmButton = { TextButton(onClick = { vm.addNg(NgRule("body", word.trim())); ngWordFor = null }) { Text("NG に足す") } },
            dismissButton = { TextButton(onClick = { ngWordFor = null }) { Text("やめる") } },
        )
    }

    popup?.let { pop ->
        ModalBottomSheet(onDismissRequest = { popup = null }, containerColor = Palette.surface) {
            Text(pop.title, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = Palette.accent, fontWeight = FontWeight.Bold)
            LazyColumn(Modifier.fillMaxWidth()) {
                items(pop.posts, key = { it.no }) { p ->
                    page.rendered[p.no]?.let { PostItem(it, own = p.no in own, images = index.info[p.no]?.images ?: emptyList(), autoLoad = autoLoad, onImage = { url -> viewer = url }) }
                    HorizontalDivider(color = Palette.border)
                }
                item { Spacer(Modifier.height(24.dp).navigationBarsPadding()) }
            }
        }
    }

    if (gallery) {
        ModalBottomSheet(onDismissRequest = { gallery = false }, containerColor = Palette.surface) {
            Text("このスレの画像(${index.allImages.size})", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = Palette.textStrong, fontWeight = FontWeight.Bold)
            if (index.allImages.isEmpty()) Hint("画像はありません")
            else LazyVerticalGrid(GridCells.Fixed(3), Modifier.fillMaxWidth().heightIn(max = 600.dp), contentPadding = PaddingValues(8.dp)) {
                items(index.allImages) { url ->
                    AsyncImage(url, null, Modifier.padding(3.dp).aspectRatio(1f).background(Palette.surface2).clickable { viewer = url }, contentScale = ContentScale.Crop)
                }
            }
            Spacer(Modifier.height(16.dp).navigationBarsPadding())
        }
    }

    if (nextSheet) {
        ModalBottomSheet(onDismissRequest = { nextSheet = false }, containerColor = Palette.surface) {
            Text("次スレの候補", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = Palette.textStrong, fontWeight = FontWeight.Bold)
            val list = page.nextCandidates
            when {
                list == null -> Hint("探しています…")
                list.isEmpty() -> Hint("似たスレタイのスレは、まだ立っていないようです")
                else -> Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
                    for (c in list) {
                        Column(Modifier.fillMaxWidth().clickable { nextSheet = false; vm.openThread(c.thread) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Text(c.thread.title, color = Palette.textStrong, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text((if (c.isNextNumber) "番号が次 ・ " else "") + "${c.thread.postCount}レス ・ ${relativeTime(c.thread.createdAt)}", color = Palette.textMuted, fontSize = 12.sp)
                        }
                        HorizontalDivider(color = Palette.border)
                    }
                }
            }
        }
    }

    viewer?.let { url -> ImageViewer(index.allImages.ifEmpty { listOf(url) }, url, onClose = { viewer = null }) }
}

/** 見えている一番下のレスを、スクロールが止まって少ししてから既読として知らせる */
@Composable
private fun ReadTracker(state: LazyListState, onRead: (Int) -> Unit) {
    LaunchedEffect(state) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull { it.key is Int }?.key as Int? }
            .collectLatest { no ->
                if (no == null) return@collectLatest
                delay(500)
                onRead(no)
            }
    }
}

/** 絞り込みのタブ(人気・画像・動画・リンク・すべてを等分に。選んでいるタブは薄く色を敷いて下に線) */
@Composable
private fun FilterTabs(filter: Filter?, counts: Map<Filter, Int>, onSelect: (Filter?) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Palette.bar)) {
        for ((f, icon, color) in TABS) Tab(Modifier.weight(1f), filter == f, { onSelect(if (filter == f) null else f) }) {
            Icon(icon, null, tint = color, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(3.dp))
            Text(f.label, fontSize = 14.sp, color = if (filter == f) Palette.accent else Palette.textMuted, maxLines = 1)
            val n = counts[f] ?: 0
            if (n > 0) Text("$n", Modifier.padding(start = 2.dp), fontSize = 10.sp, color = Palette.textMuted)
        }
        Tab(Modifier.weight(1f), filter == null || filter == Filter.OWN, { onSelect(null) }) {
            if (filter == Filter.OWN) {
                Icon(Icons.Filled.Person, null, tint = Palette.own, modifier = Modifier.size(17.dp))
                Text("自分", fontSize = 14.sp, color = Palette.accent)
            } else Text("すべて", fontSize = 14.sp, color = Palette.accent)
        }
    }
}

@Composable
private fun Tab(modifier: Modifier, active: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(modifier.background(if (active) Palette.accentWash else Color.Transparent).clickable(onClick = onClick).heightIn(min = 46.dp), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically) { content() }
        if (active) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(2.dp).background(Palette.accent))
    }
}

@Composable
private fun UnreadDivider() {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(3.dp).background(Palette.unread.copy(alpha = 0.35f)))
        Text("ここから未読", Modifier.padding(horizontal = 10.dp), color = Palette.unread.copy(alpha = 0.8f), fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp)
        Box(Modifier.weight(1f).height(3.dp).background(Palette.unread.copy(alpha = 0.35f)))
    }
}
