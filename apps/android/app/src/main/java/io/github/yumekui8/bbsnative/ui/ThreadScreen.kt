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
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Bolt
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
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.draw.clipToBounds
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
    // 重なったポップアップ(下から順に)。押した所の高さ・押したレスは、指を置いたときに控えておく
    val popups = remember { mutableStateListOf<PopupEntry>() }
    var popupSeq by remember { mutableIntStateOf(0) }
    var downY by remember { mutableFloatStateOf(0f) }
    var downNo by remember { mutableIntStateOf(0) }
    fun openPopup(posts: List<Post>, tree: List<io.github.yumekui8.bbsnative.bbs.TreeRow>? = null, focus: Int? = null) {
        if (posts.isNotEmpty()) popups += PopupEntry(++popupSeq, posts, tree, downY, focus)
    }
    BackHandler(enabled = popups.isNotEmpty()) { popups.clear() }
    var menu by remember { mutableStateOf(false) }
    var postMenu by remember { mutableStateOf<Post?>(null) }
    var ngWordFor by remember { mutableStateOf<Post?>(null) }
    var gallery by remember { mutableStateOf(false) }
    var nextSheet by remember { mutableStateOf(false) }
    /** 中身を見せている NG のレス */
    var revealed by remember { mutableStateOf(emptySet<Int>()) }
    var viewer by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var fontDialog by remember { mutableStateOf(false) }
    // スレを保存(テキスト・HTML)。保存先は端末のファイルの画面で選ぶ
    val safeName = remember(page.title) { page.title.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(60) }
    val saveText = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/plain")) { uri -> if (uri != null) vm.saveThread(page, uri, html = false) }
    val saveHtml = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/html")) { uri -> if (uri != null) vm.saveThread(page, uri, html = true) }
    /** 長押しで「AAとして表示」「文字列として表示」を選んだレス */
    var aaOverride by remember { mutableStateOf(mapOf<Int, Boolean>()) }
    val swipe = rememberSwipeState()
    val own = page.ownNos
    // 自分への返信(自分のレスにアンカーを付けたレス)
    val toOwn = remember(index, own) { own.flatMap { index.replies[it] ?: emptyList() }.toSet() - own }
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

    // いちばん下を見ているときに新着が届いたら、新着まで送る(今のスマホ版の既定と同じ)。
    // 下にいたかは、新着を組み立てた直後(並べ直す前)に見る
    var prevCount by remember { mutableIntStateOf(-1) }
    var stickTo by remember { mutableStateOf<Int?>(null) }
    SideEffect {
        val n = index.posts.size
        if (vm.prefs.autoScrollOnNew && prevCount in 1 until n && !listState.canScrollForward && filter == null && query.isBlank()) stickTo = prevCount
        prevCount = n
    }
    LaunchedEffect(stickTo) { stickTo?.let { listState.animateScrollToItem(it); stickTo = null } }

    // 番号・ID・アンカー・URL を押したとき(組み立て済みの文字列から呼ばれる)
    SideEffect {
        page.links.onTag = { tag ->
            val v = tag.drop(2)
            when (tag[0]) {
                'a' -> {
                    val (from, to) = v.split('-').map { it.toInt() }
                    val list = index.posts.filter { it.no in from..to }
                    openPopup(list)
                }
                'r' -> {
                    val no = v.toInt()
                    val list = (index.replies[no] ?: emptyList()).mapNotNull { n -> index.posts.getOrNull(n - 1)?.takeIf { it.no == n } }
                    openPopup(list)
                }
                'i' -> openPopup(index.posts.filter { it.id == v }, focus = downNo)
                // 名前: 同じ名前のレス(タグはレス番号。名前に何が入っていてもよいように)
                'n' -> index.posts.getOrNull(v.toInt() - 1)?.let { src -> openPopup(index.posts.filter { it.name == src.name }, focus = src.no) }
                // 画像の URL はビューアーで、2ch 互換のスレ・板の URL はアプリの中で、それ以外はブラウザで
                'u' -> when {
                    v in index.allImages -> viewer = v
                    !vm.openUrl(v) -> openExternal(context, v, vm.prefs.openLinksInApp)
                }
            }
        }
    }

    val ended = page.archived || index.posts.size >= 1000

    // レス 1 件(本文とポップアップで共通)。本文を押すとアンカーツリー、長押しでメニュー
    val postRow = @Composable { p: Post ->
        Box(
            Modifier
                .pointerInput(p.no) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial); downNo = p.no } }
                .combinedClickable(
                    interactionSource = null, indication = null,
                    onClick = { index.treeRows(p.no).takeIf { it.size > 1 }?.let { rows -> openPopup(rows.mapNotNull { r -> index.posts.getOrNull(r.no - 1) }, rows, p.no) } },
                    onLongClick = { postMenu = p },
                ),
        ) {
            if (p.no in page.ngNos && p.no !in revealed) {
                Text(
                    "${p.no}  あぼーん", Modifier.fillMaxWidth().clickable { revealed = revealed + p.no }.padding(horizontal = 14.dp, vertical = 10.dp),
                    color = Palette.textMuted, fontSize = 13.sp,
                )
            } else page.rendered[p.no]?.let {
                PostItem(it, aa = aaOverride[p.no] ?: it.aa, own = p.no in own, toOwn = p.no in toOwn, info = index.info[p.no], autoLoad = autoLoad, onImage = { url -> viewer = url }, onUrl = { url -> page.links.onTag("u:$url") }, gross = p.no in index.gross)
            }
        }
    }
    val atBottom by remember { derivedStateOf { !listState.canScrollForward } }

    Column(modifier.fillMaxSize().background(Palette.base)) {
        // なぞる操作(今のスマホ版の既定と同じ割り当て)。左の端から右へはメニュー
        val prefs = vm.prefs
        val gestures = if (!prefs.gesturesEnabled) emptyMap() else buildGestures(
            prefs.gestures("thread"), "thread",
            mapOf(
                "back" to { vm.back(); Unit },
                "reply" to { vm.openReply(page) },
                "bottom" to { scope.launch { listState.scrollToItem(maxOf(0, shown.size)) }; Unit },
                "top" to { scope.launch { listState.scrollToItem(0); bars.show() }; Unit },
                "refresh" to { vm.refreshThread(page); Unit },
                "deleteLog" to { confirmDelete = true },
                "drawer" to { vm.drawerOpen = true },
                "search" to { searching = true; bars.show() },
                "favorite" to { vm.toggleFavoriteThread(page) },
                "next" to { vm.findNext(page); nextSheet = true },
            ),
        )
        bars.enabled = prefs.hideBarsOnScroll
        // 開いているスレの自動更新(設定。0 ならしない)
        if (prefs.autoRefreshSec > 0) LaunchedEffect(prefs.autoRefreshSec, page) {
            while (true) {
                delay(prefs.autoRefreshSec * 1000L)
                if (!page.loading) vm.refreshThread(page, quiet = true)
            }
        }
        Box(
            Modifier.weight(1f).fillMaxWidth().clipToBounds().nestedScroll(bars.connection)
                .swipeGestures(swipe, gestures, onEdgeRight = if (prefs.gesturesEnabled) ({ vm.drawerOpen = true }) else null, sensitivity = prefs.gestureSensitivity)
                // 押した所の高さを控える(ポップアップを、押した所の真上に出すため)
                .pointerInput(Unit) { awaitEachGesture { downY = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial).position.y } },
        ) {
            PullToRefreshBox(isRefreshing = page.loading, onRefresh = { vm.refreshThread(page) }, modifier = Modifier.fillMaxSize()) {
                when {
                    !page.loaded -> Hint("読み込み中…")
                    page.error != null && index.posts.isEmpty() -> Hint("読み込めませんでした: ${page.error}")
                    else -> LazyColumn(
                        Modifier.fillMaxSize(), state = listState,
                        // ミニマップの幅だけ右を空けて、レスが下に潜らないようにする
                        contentPadding = PaddingValues(top = with(density) { bars.topHeight.toDp() }, end = if (vm.prefs.showMinimap && shown.size > 1) 24.dp else 0.dp),
                    ) {
                        items(shown, key = { it.no }, contentType = { if (it.no in page.ngNos) 1 else 0 }) { p ->
                            if (filter == null && query.isBlank() && p.no == page.unreadFrom) UnreadDivider()
                            postRow(p)
                            HorizontalDivider(color = Palette.border)
                        }
                        item(key = "end") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 22.dp), contentAlignment = Alignment.Center) {
                                Text(if (page.archived) "-END-(dat 落ち)" else "-END-", color = Palette.textMuted, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                            }
                        }
                        // スレが終わったら(dat 落ち・1000 到達)、一番下に次スレの候補を出す(今のスマホ版と同じ)
                        if (ended && filter == null && query.isBlank()) item(key = "next") {
                            LaunchedEffect(Unit) { if (page.nextCandidates == null) vm.findNext(page) }
                            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 24.dp).border(1.dp, Palette.border, RoundedCornerShape(12.dp)).background(Palette.surface, RoundedCornerShape(12.dp))) {
                                NextCandidates(page) { vm.openThread(it) }
                            }
                        }
                    }
                }
            }

            // ミニマップ(右端。上の帯の下から、書き込み欄の上まで)
            if (vm.prefs.showMinimap && shown.size > 1) {
                Minimap(
                    shown, index, own, toOwn, if (filter == null && query.isBlank()) page.unreadFrom else null, listState,
                    Modifier.align(Alignment.TopEnd).padding(top = with(density) { (bars.topHeight * (1f - bars.hidden)).toDp() } + 4.dp, bottom = 4.dp, end = 2.dp),
                )
            }

            SwipeLabel(swipe)

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
                    Modifier.align(Alignment.BottomEnd).padding(end = if (vm.prefs.showMinimap) 34.dp else 16.dp, bottom = 14.dp).size(48.dp)
                        .background(Palette.surface2, RoundedCornerShape(12.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(12.dp))
                        .clickable { scope.launch { listState.animateScrollToItem(maxOf(0, shown.size)) } },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.KeyboardDoubleArrowDown, "一番下へ", tint = Palette.textBody) }
            }

            PopupLayer(popups, topInset = bars.topHeight * (1f - bars.hidden), onCloseTop = { popups.removeAt(popups.lastIndex) }) { postRow(it) }
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
                    MenuItem("文字の大きさ・余白", Icons.Filled.FormatSize) { fontDialog = true },
                ),
                listOf(
                    MenuItem("URL をコピー", Icons.Filled.Link, Palette.markLink) { copyText(context, TwoCh.webUrl(page.summary)); vm.toast = "URL をコピーしました" },
                    MenuItem("スレを保存(テキスト)", Icons.Filled.Save) { saveText.launch("$safeName.txt") },
                    MenuItem("スレを保存(HTML)", Icons.Filled.Save) { saveHtml.launch("$safeName.html") },
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, Palette.markLink) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(TwoCh.webUrl(page.summary)))) } },
                ),
                listOf(MenuItem("ログを削除して閉じる", Icons.Filled.Delete, danger = true) { vm.deleteLog(page) }),
            ),
        ) { menu = false }
    }

    postMenu?.let { p ->
        MenuSheet(
            listOf(
                // 今のスマホ版の長押しと同じ並び: 返信・定型文・アンカーツリー / コピー・AA / NG
                listOf(MenuItem("返信(>>${p.no})", Icons.AutoMirrored.Filled.Reply, Palette.accent) { vm.openReply(page, ">>${p.no}\n") }) +
                    vm.prefs.quickPhrases.lines().map { it.trim() }.filter { it.isNotEmpty() }.map { ph ->
                        MenuItem("「$ph」とすぐ書き込む", Icons.Filled.Bolt, Palette.markHot) { vm.quickPost(page, p.no, ph) }
                    } +
                    listOfNotNull(
                        if (index.tree(p.no).size > 1) MenuItem("アンカーツリーを表示", Icons.Filled.AccountTree, Palette.markPurple) {
                            val rows = index.treeRows(p.no)
                            openPopup(rows.mapNotNull { r -> index.posts.getOrNull(r.no - 1) }, rows, p.no)
                        } else null,
                    ),
                listOf(
                    MenuItem("ヘッダ含めてコピー", Icons.Filled.ContentCopy, Palette.markLink) {
                        copyText(context, "${p.no} ${p.name} ${p.date}${p.id?.let { " ID:$it" } ?: ""}\n${p.body}"); vm.toast = "コピーしました"
                    },
                    MenuItem("本文のみコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, p.body); vm.toast = "コピーしました" },
                    (aaOverride[p.no] ?: page.rendered[p.no]?.aa ?: false).let { isAA ->
                        MenuItem(if (isAA) "文字列として表示" else "AAとして表示", if (isAA) Icons.AutoMirrored.Filled.Notes else Icons.Filled.GridOn) { aaOverride = aaOverride + (p.no to !isAA) }
                    },
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
            Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
                NextCandidates(page) { nextSheet = false; vm.openThread(it) }
            }
        }
    }

    // 文字の大きさ・余白(︙ から。設定の「文字と余白」と同じ値)
    if (fontDialog) {
        val pr = vm.prefs
        AlertDialog(
            onDismissRequest = { fontDialog = false },
            title = { Text("文字の大きさ・余白") },
            text = {
                Column {
                    Text("レスの本文 ${(pr.bodyScale * 100).toInt()}%", color = Palette.textBody, fontSize = 14.sp)
                    androidx.compose.material3.Slider(pr.bodyScale, { pr.bodyScale = (it * 20).toInt() / 20f }, valueRange = 0.8f..1.4f, steps = 11)
                    Text("行間 ${"%.2f".format(pr.lineHeight)}", color = Palette.textBody, fontSize = 14.sp)
                    androidx.compose.material3.Slider(pr.lineHeight, { pr.lineHeight = (it * 20).toInt() / 20f }, valueRange = 1.2f..1.9f, steps = 13)
                    Text("画面全体 ${(pr.fontScale * 100).toInt()}%", color = Palette.textBody, fontSize = 14.sp)
                    androidx.compose.material3.Slider(pr.fontScale, { pr.fontScale = (it * 20).toInt() / 20f }, valueRange = 0.85f..1.3f, steps = 8)
                }
            },
            confirmButton = { TextButton(onClick = { fontDialog = false }) { Text("閉じる") } },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("ログを削除しますか") },
            text = { Text("このスレの手元のログを消して、一覧に戻ります。") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteLog(page) }) { Text("削除する", color = Palette.markDanger) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("やめる") } },
        )
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

/** 次スレの候補の一覧(︙ の「次スレを探す」と、終わったスレの一番下で共通) */
@Composable
private fun NextCandidates(page: Page.Thread, onOpen: (io.github.yumekui8.bbsnative.bbs.ThreadSummary) -> Unit) {
    Text("次スレの候補", Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = Palette.textStrong, fontWeight = FontWeight.Bold)
    val list = page.nextCandidates
    when {
        list == null -> Text("探しています…", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        list.isEmpty() -> Text("似たスレタイのスレは、まだ立っていないようです", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        else -> for ((i, c) in list.withIndex()) {
            if (i > 0) HorizontalDivider(color = Palette.border)
            Column(Modifier.fillMaxWidth().clickable { onOpen(c.thread) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(c.thread.title, color = Palette.textStrong, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text((if (c.isNextNumber) "番号が次 ・ " else "") + "${c.thread.postCount}レス ・ ${relativeTime(c.thread.createdAt)}", color = Palette.textMuted, fontSize = 12.sp)
            }
        }
    }
}
