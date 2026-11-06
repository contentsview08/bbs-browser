package io.github.contentsview08.obb.ui

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Reply
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import kotlinx.coroutines.launch
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.data.HistoryEntry

/** サイトの見せる名前(5ch の bbsmenu は「5ちゃんねる」と出す) */
fun siteLabel(url: String, name: String): String = if (url.contains("menu.5ch.")) "5ちゃんねる" else name

/**
 * 板を探す: サイト(5ちゃんねる・red-edge など) → カテゴリ → 板 の順に入っていく(スマホのファイルの選び方と同じ)。
 * 戻る(左上・端末の戻る)で 1 段上へ。☆ でお気に入り板に足す。押すとその板を開く。
 * 探す(虫めがね)は、いま見ているサイトの板の名前・カテゴリから
 */
@Composable
fun BoardsScreen(vm: AppViewModel, page: io.github.contentsview08.obb.Page.Boards) {
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var urlDialog by rememberSaveable { mutableStateOf(false) }
    val favUrls = remember(vm.favorites) { vm.favorites.map { it.url }.toSet() }
    androidx.compose.runtime.LaunchedEffect(Unit) { vm.reloadSites() }
    // サイトを選んだら、その板の一覧を読む
    androidx.compose.runtime.LaunchedEffect(page.site) { page.site?.let { if (vm.siteUrl != it || vm.boards.isEmpty()) vm.selectSite(it) } }
    val up = { if (page.category != null) page.category = null else page.site = null }
    androidx.activity.compose.BackHandler(enabled = page.site != null && !searching) { up() }
    androidx.activity.compose.BackHandler(enabled = searching) { searching = false; query = "" }
    val siteName = page.site?.let { u -> vm.sites.firstOrNull { it.first == u }?.let { siteLabel(it.first, it.second) } }
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        if (searching) SearchBar(query, { query = it }, "板の名前・カテゴリ") { searching = false; query = "" }
        else if (page.site == null) HeaderBar("板を探す", onNav = { vm.drawerOpen = true })
        else HeaderBar(page.category ?: siteName ?: "", onNav = up, navIsBack = true) {
            BarIcon(Icons.Filled.Search, "探す") { searching = true }
            BarIcon(Icons.Filled.Refresh, "取り直す") { vm.loadBoards(refresh = true) }
        }
        HorizontalDivider(color = Palette.border)
        val loaded = page.site != null && vm.siteUrl == page.site
        when {
            // 探す: いま見ているサイトの板から
            searching && query.isNotBlank() -> {
                val q = query.trim()
                val hits = vm.boards.filter { it.name.contains(q, true) || (it.category ?: "").contains(q, true) }
                LazyColumn(Modifier.fillMaxSize()) {
                    items(hits, key = { it.url }) { b -> BoardRow(b, b.url in favUrls, onStar = { vm.toggleFavorite(b) }, onClick = { vm.openBoard(b) }) }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
            // 1 段目: サイト
            page.site == null -> LazyColumn(Modifier.fillMaxSize()) {
                item { SectionLabel("サイト") }
                items(vm.sites, key = { it.first }) { (url, name) ->
                    FolderRow(siteLabel(url, name), url.removePrefix("https://").substringBefore('/'), Icons.Filled.Public) { page.site = url; page.category = null }
                }
                item { SectionLabel("ほかの掲示板") }
                item { FolderRow("サイトを足す", "bbsmenu・hono-bbs のサイトの URL から", Icons.Filled.Add, chevron = false) { vm.openRoot(io.github.contentsview08.obb.Page.Settings("sites")) } }
                item { FolderRow("URL で板・スレを開く", "板の一覧がない掲示板は、板・スレの URL から", Icons.Filled.Link, chevron = false) { urlDialog = true } }
                item { Spacer(Modifier.navigationBarsPadding()) }
            }
            vm.boardsLoading && (!loaded || vm.boards.isEmpty()) -> Hint("読み込み中…")
            vm.boardsError != null && vm.boards.isEmpty() -> Hint("読み込めませんでした: ${vm.boardsError}")
            // 2 段目: カテゴリ
            page.category == null -> {
                val cats = remember(vm.boards) { vm.boards.groupBy { it.category ?: "その他" }.map { it.key to it.value.size } }
                LazyColumn(Modifier.fillMaxSize()) {
                    items(cats, key = { it.first }) { (cat, n) -> FolderRow(cat, "$n 板", Icons.Filled.Folder) { page.category = cat } }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
            // 3 段目: 板
            else -> {
                val list = remember(vm.boards, page.category) { vm.boards.filter { (it.category ?: "その他") == page.category } }
                LazyColumn(Modifier.fillMaxSize()) {
                    items(list, key = { it.url }) { b -> BoardRow(b, b.url in favUrls, onStar = { vm.toggleFavorite(b) }, onClick = { vm.openBoard(b) }) }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }
    if (urlDialog) OpenUrlDialog(vm) { urlDialog = false }
}

/** 段の見出し(小さく) */
@Composable
private fun SectionLabel(text: String) =
    Text(text, Modifier.fillMaxWidth().padding(start = 20.dp, top = 18.dp, bottom = 6.dp), color = Palette.textMuted, fontSize = 13.sp, fontWeight = FontWeight.Bold)

/** 入っていく行(サイト・カテゴリ): アイコン、名前と小さな説明、右に › */
@Composable
private fun FolderRow(title: String, sub: String?, icon: androidx.compose.ui.graphics.vector.ImageVector, chevron: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 60.dp).padding(start = 20.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Palette.textMuted, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
            Text(title, color = Palette.textStrong, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, color = Palette.textMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (chevron) Icon(Icons.Filled.ChevronRight, null, tint = Palette.textMuted)
    }
    HorizontalDivider(color = Palette.border)
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
 * 履歴の画面の上: 題「履歴」と、未読(全板)・閲覧履歴・お気に入り・書き込み・画像の切り替え。
 * どれも「前に見た・書いた・上げたもの」の一覧なので、1 つの画面のタブとしてまとめる(PC 版・Web と同じ並び)
 */
@Composable
private fun PastHeader(vm: AppViewModel, current: String, onRefresh: (() -> Unit)?, actions: @Composable () -> Unit = {}) {
    HeaderBar("履歴", onNav = { vm.drawerOpen = true }) {
        actions()
        if (onRefresh != null) BarIcon(Icons.Filled.Refresh, "新着を確かめる") { onRefresh() }
    }
    Row(Modifier.fillMaxWidth().background(Palette.bar).padding(horizontal = 10.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((k, label) in listOf("unread" to "未読", "history" to "閲覧", "fav" to "お気に入り", "posts" to "書き込み", "uploads" to "画像")) {
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
    vm: AppViewModel, t: io.github.contentsview08.obb.bbs.ThreadSummary, meta: String, total: Int?, unread: Int,
    archived: Boolean = false, own: String? = null, ownNo: Int? = null, checked: Boolean? = null, onLongClick: (() -> Unit)? = null, onClick: (() -> Unit)? = null,
) = WithoutBaseFont {
    // スレ一覧と同じく、字の大きさはスレ一覧の文字で決める
    val k = vm.prefs.listFontScale
    @OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).combinedClickable(onLongClick = onLongClick) { if (onClick != null) onClick() else vm.openThread(t) }.graphicsLayer { alpha = if (archived) 0.6f else 1f },
    ) {
        // 左の帯: 未読があれば未読の色(未読が多いほど濃く)
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (unread > 0) Palette.unread.copy(alpha = 0.35f + 0.65f * minOf(1f, kotlin.math.log10(unread + 1f) / 2.5f)) else Color.Transparent))
        // 選んでいる間は、行を押すと選ぶ(チェックは飾りで、押した指は行が受ける)
        if (checked != null) androidx.compose.material3.Checkbox(checked, null, Modifier.align(Alignment.CenterVertically).padding(start = 10.dp), colors = androidx.compose.material3.CheckboxDefaults.colors(checkedColor = Palette.accent))
        Column(Modifier.weight(1f).padding(start = 13.dp, end = 12.dp, top = 10.dp, bottom = 10.dp)) {
            Text(
                t.title.ifEmpty { t.key }, color = if (unread > 0) Palette.textStrong else Palette.threadReadTitle, fontSize = (15 * k).sp, lineHeight = (20 * k).sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = if (unread > 0) FontWeight.SemiBold else FontWeight.Normal,
            )
            if (own != null) Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.Top) {
                if (ownNo != null) Badge(">>$ownNo", Palette.ownWash, Palette.own)
                Spacer(Modifier.width(6.dp))
                Text(own, color = Palette.textBody, fontSize = (13 * k).sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(meta, Modifier.weight(1f), color = Palette.textMuted, fontSize = (11 * k).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (total != null) Text("${total}レス", color = Palette.textMuted, fontSize = (11 * k).sp)
                if (unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    UnreadBadge(unread)
                }
            }
        }
    }
    HorizontalDivider(color = Palette.border)
}

private fun boardName(vm: AppViewModel, url: String) = vm.favorites.firstOrNull { it.url == url }?.name ?: url.removePrefix("https://").trimEnd('/')

/** 未読の数の札 */
@Composable
internal fun UnreadBadge(unread: Int) {
    Badge(badgeCount(unread), Palette.unread, Palette.unreadText)
}

/** 書いた本文の頭の行(アンカーだけの行は飛ばす) */
internal fun postedHeadLine(body: String): String? = body.lines().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim()

/** 過去のスレの「未読」「閲覧」「お気に入り」のタブ。読んだ位置と、手元で分かっている未読の数 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ThreadEntryList(vm: AppViewModel, tab: String, entries: List<HistoryEntry>, empty: String, onRefresh: (() -> Unit)? = null) {
    val refresh = onRefresh ?: { vm.checkNew(entries) }
    var menuFor by remember { mutableStateOf<io.github.contentsview08.obb.bbs.ThreadSummary?>(null) }
    val hv = androidx.compose.ui.platform.LocalView.current
    menuFor?.let { t -> ThreadMenu(vm, t, hasLog = true) { menuFor = null } }
    // お気に入りのスレは、開いたときに新着を確かめる
    androidx.compose.runtime.LaunchedEffect(tab) { if (tab == "fav") vm.checkNew(entries) }
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val swipe = rememberSwipeState()
    // 閲覧のタブのスレタイ検索。ふだんの一覧は 300 件までなので、探すあいだは全部から探す
    var searching by remember(tab) { mutableStateOf(false) }
    var query by remember(tab) { mutableStateOf("") }
    var pool by remember(tab) { mutableStateOf<List<HistoryEntry>?>(null) }
    androidx.compose.runtime.LaunchedEffect(searching, entries) { if (searching) pool = vm.allHistory() }
    val shown = remember(entries, pool, searching, query) {
        val terms = io.github.contentsview08.obb.data.searchTerms(query)
        if (!searching) entries else (pool ?: entries).filter { io.github.contentsview08.obb.data.matchesTerms(it.thread.title, terms) }
    }
    androidx.activity.compose.BackHandler(enabled = searching) { searching = false; query = "" }
    // 閲覧のタブで選んでログを消す。選ぶのは見えている行(検索で絞っていれば絞った中)から
    var selecting by remember(tab) { mutableStateOf(false) }
    var selected by remember(tab) { mutableStateOf(emptySet<String>()) }
    var confirmDel by remember(tab) { mutableStateOf(false) }
    val picked = remember(shown, selected) { shown.filter { it.thread.id in selected }.map { it.thread } }
    fun stopSelecting() { selecting = false; selected = emptySet() }
    androidx.activity.compose.BackHandler(enabled = selecting) { stopSelecting() }
    if (confirmDel) ConfirmDeleteDialog(vm.prefs, count = picked.size, onDelete = { vm.deleteLogsOf(picked); stopSelecting() }) { confirmDel = false }
    Box(Modifier.fillMaxSize().then(pastGestures(vm, listState, refresh, swipe))) {
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        // 選んでいる間の帯はヘッダーに重ねる(差し込むと、一覧が下にずれて押す所が動く)
        Box {
            PastHeader(vm, tab, refresh) {
                if (tab == "history") {
                    BarIcon(Icons.Filled.Search, "スレタイを探す") { searching = true }
                    if (entries.isNotEmpty()) BarIcon(Icons.Filled.Checklist, "選んでログを削除") { selecting = true }
                }
            }
            if (selecting) Row(Modifier.matchParentSize().background(Palette.bar).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                BarIcon(Icons.Filled.Close, "選ぶのをやめる") { stopSelecting() }
                Text("${picked.size} 件", Modifier.weight(1f), color = Palette.textStrong, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                val allOn = shown.isNotEmpty() && picked.size == shown.size
                TextButton(onClick = { selected = if (allOn) emptySet() else shown.map { it.thread.id }.toSet() }) { Text(if (allOn) "すべて外す" else "すべて選ぶ", color = Palette.textBody) }
                TextButton(onClick = { confirmDel = true }, enabled = picked.isNotEmpty()) {
                    Icon(Icons.Filled.Delete, null, tint = if (picked.isNotEmpty()) Palette.markDanger else Palette.textMuted, modifier = Modifier.size(18.dp))
                    Text("ログを削除", color = if (picked.isNotEmpty()) Palette.markDanger else Palette.textMuted, fontWeight = FontWeight.Bold)
                }
            }
        }
        if (searching) SearchBar(query, { query = it }, "スレタイを探す") { searching = false; query = "" }
        if (searching && shown.isEmpty() && pool != null) Hint("見つかりませんでした")
        else if (entries.isEmpty() && !(tab == "unread" && vm.checking)) Hint(empty)
        else androidx.compose.material3.pulltorefresh.PullToRefreshBox(isRefreshing = vm.checking, onRefresh = { refresh() }, modifier = Modifier.fillMaxSize()) { LazyColumn(Modifier.fillMaxSize(), state = listState) {
            items(shown, key = { it.thread.id }) { h ->
                // 掲示板で分かったレス数があれば、そちらで未読を数える(-1 は dat 落ち)
                val remote = vm.remoteCounts[h.thread.id]
                val total = maxOf(h.thread.postCount, remote ?: 0)
                val unread = maxOf(0, total - h.readNo)
                val meta = listOfNotNull(
                    boardName(vm, h.thread.boardUrl),
                    if (h.readAt > 0) "${relativeTime(h.readAt)}に見た" else null,
                    if (remote == -1) "dat 落ち" else null,
                ).joinToString(" ・ ")
                val id = h.thread.id
                fun toggle() { selected = if (id in selected) selected - id else selected + id }
                if (selecting) PastRow(vm, h.thread, meta, total, unread, archived = remote == -1, checked = id in selected, onLongClick = { toggle() }, onClick = { toggle() })
                else PastRow(vm, h.thread, meta, total, unread, archived = remote == -1, onLongClick = { Haptics.longPress(hv); menuFor = h.thread })
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }}
    }
    SwipeLabel(swipe)
    }
}

/** 履歴の「書き込み」のタブ(新しい順)。行の形はほかのタブと同じで、書いた本文を足す。押すとスレを開いてそのレスへ、長押しでメニュー */
@Composable
fun PostHistoryScreen(vm: AppViewModel) {
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val swipe = rememberSwipeState()
    val context = androidx.compose.ui.platform.LocalContext.current
    val hv = androidx.compose.ui.platform.LocalView.current
    var menuFor by remember { mutableStateOf<io.github.contentsview08.obb.data.PostHistoryEntry?>(null) }
    menuFor?.let { e ->
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("スレを開いて、このレスへ", Icons.AutoMirrored.Filled.OpenInNew) { vm.openThread(e.thread, e.no) },
                    MenuItem("本文をコピー", Icons.Filled.ContentCopy) { copyText(context, e.body); vm.toast = "コピーしました" },
                ),
                listOf(MenuItem("履歴から消す(掲示板の書き込みは消えません)", Icons.Filled.Delete, danger = true) { vm.deletePostHistory(e) }),
            ),
            MenuAt.Center,
        ) { menuFor = null }
    }
    Box(Modifier.fillMaxSize().then(pastGestures(vm, listState, null, swipe))) {
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        PastHeader(vm, "posts", null)
        if (vm.postHistory.isEmpty()) Hint("まだ書き込んでいません")
        else LazyColumn(Modifier.fillMaxSize(), state = listState) {
            items(vm.postHistory) { e ->
                PastRow(
                    vm, e.thread, "${boardName(vm, e.thread.boardUrl)} ・ ${relativeTime(e.postedAt)}に書いた", null, 0,
                    own = postedHeadLine(e.body) ?: e.body.trim(), ownNo = e.no,
                    onLongClick = { Haptics.longPress(hv); menuFor = e },
                    onClick = { vm.openThread(e.thread, e.no) },
                )
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }
    }
    SwipeLabel(swipe)
    }
}

/** 履歴の「画像」のタブ: 上げた画像を 3 列で(新しい順)。押すと見る、長押しで URL のコピー・貼ったレスへ・置き場の削除ページ(imgbb)。履歴から消す操作はない */
@Composable
fun UploadsScreen(vm: AppViewModel) {
    val gridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val swipe = rememberSwipeState()
    val context = androidx.compose.ui.platform.LocalContext.current
    val hv = androidx.compose.ui.platform.LocalView.current
    val ups = vm.uploads
    // セルごとに書き込み履歴をなめないよう、先にまとめて引いておく
    val postedOf = remember(ups, vm.postHistory) { ups.associate { it.url to vm.postedIn(it.url) } }
    var viewerUrl by remember { mutableStateOf<String?>(null) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    viewerUrl?.let { u -> ImageViewer(ups.map { it.url }, u, onClose = { viewerUrl = null }) }
    menuFor?.let { url ->
        val posted = vm.postedIn(url)
        MenuSheet(
            listOf(
                listOfNotNull(
                    MenuItem("見る", Icons.AutoMirrored.Filled.OpenInNew) { viewerUrl = url },
                    MenuItem("URL をコピー", Icons.Filled.ContentCopy) { copyText(context, url); vm.toast = "URL をコピーしました" },
                    posted?.let { e -> MenuItem("貼ったレスへ(${e.thread.title.ifEmpty { "スレタイ不明" }}${e.no?.let { " >>$it" } ?: ""})", Icons.Filled.Reply) { vm.openThread(e.thread, e.no) } },
                    // imgbb(API キー)は上げたときに消すためのページが返る。API では消せないので、ブラウザで開いて消す
                    vm.uploads.firstOrNull { it.url == url }?.deleteUrl?.let { d -> MenuItem("置き場の削除ページを開く", Icons.Filled.Delete) { openExternal(context, d, false) } },
                ),
            ),
            MenuAt.Center,
        ) { menuFor = null }
    }
    val toBottom: suspend () -> Unit = { gridState.scrollToItem(maxOf(0, gridState.layoutInfo.totalItemsCount - 1)) }
    Box(Modifier.fillMaxSize().then(pastGestures(vm, toBottom, { gridState.scrollToItem(0) }, null, swipe))) {
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        PastHeader(vm, "uploads", null)
        if (ups.isEmpty()) Hint("まだありません(書き込み欄の ＋ の「画像」から上げた画像が並びます)")
        else {
            androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                androidx.compose.foundation.lazy.grid.GridCells.Fixed(3), Modifier.fillMaxSize(), state = gridState,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp),
            ) {
                items(ups.size) { i ->
                    val url = ups[i].url
                    val posted = postedOf[url]
                    Column(Modifier.padding(3.dp)) {
                        @OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
                        StoredImage(
                            url,
                            Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(Palette.surface2)
                                .combinedClickable(onLongClick = { Haptics.longPress(hv); menuFor = url }) { viewerUrl = url },
                        )
                        // 貼ったレスがあれば、その印(押すとそのレスへ)
                        Text(
                            if (posted != null) "→ ${posted.thread.title.ifEmpty { "スレ" }}" else relativeTime(ups[i].uploadedAt),
                            Modifier.fillMaxWidth().padding(top = 2.dp).then(if (posted != null) Modifier.clickable { vm.openThread(posted.thread, posted.no) } else Modifier),
                            color = if (posted != null) Palette.accent else Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(3) }) { Spacer(Modifier.navigationBarsPadding()) }
            }
        }
    }
    SwipeLabel(swipe)
    }
}

/** 過去のスレの一覧でも、スレ一覧と同じなぞる操作(一番上へ・一番下へ・更新・メニューなど)を使う */
@Composable
private fun pastGestures(vm: AppViewModel, listState: androidx.compose.foundation.lazy.LazyListState, refresh: (() -> Unit)?, swipe: SwipeState): Modifier =
    pastGestures(vm, { listState.scrollToItem(maxOf(0, listState.layoutInfo.totalItemsCount - 1)) }, { listState.scrollToItem(0) }, refresh, swipe)

@Composable
private fun pastGestures(vm: AppViewModel, toBottom: suspend () -> Unit, toTop: suspend () -> Unit, refresh: (() -> Unit)?, swipe: SwipeState): Modifier {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val prefs = vm.prefs
    val g = if (!prefs.gesturesEnabled) emptyMap() else buildGestures(
        prefs.gestures("list"), "list",
        buildMap {
            put("drawer") { vm.drawerOpen = true }
            put("forward") { vm.forward() }
            put("bottom") { scope.launch { toBottom() }; Unit }
            put("top") { scope.launch { toTop() }; Unit }
            if (refresh != null) put("refresh", refresh)
            put("quick") { vm.openQuick() }
        },
    )
    return Modifier.swipeGestures(swipe, g, sensitivity = prefs.gestureSensitivity)
}
