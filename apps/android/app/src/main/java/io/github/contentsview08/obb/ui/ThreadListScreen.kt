package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import io.github.contentsview08.obb.data.ThumbMode
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.togetherWith
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.border
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.data.ThreadState
import kotlinx.coroutines.launch

/** 一覧のタブ(今のスマホ版の LIST_TABS と同じ)。どれも選ばなければ設定の並び。色は配色に合わせて読むたびに取る */
private enum class ListTab(val key: String, val label: String, val icon: ImageVector, private val tint: () -> Color) {
    UNREAD("unread", "未読", Icons.Filled.MarkEmailUnread, { Palette.unread }),
    VISITED("visited", "閲覧済み", Icons.Filled.History, { Palette.markPurple }),
    MOMENTUM("momentum", "勢い順", Icons.Filled.LocalFireDepartment, { Palette.markHot }),
    NEWEST("newest", "新しい順", Icons.Filled.Schedule, { Palette.markLink }),
    COUNT("count", "レス数順", Icons.Filled.FormatListNumbered, { Palette.markNew });
    val color get() = tint()
}

/** 勢い(1 日あたりのレス数) */
fun momentum(t: ThreadSummary, now: Long): Double {
    val c = t.createdAt ?: return 0.0
    val days = maxOf(now - c, 60_000L) / 86_400_000.0
    return t.postCount / days
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadListScreen(vm: AppViewModel, page: Page.Threads, modifier: Modifier = Modifier) {
    // タブ・検索・スクロールの位置はページに持つ(スレを開いて戻っても残す)
    val tab = ListTab.entries.firstOrNull { it.key == page.tab }
    var searching by page::searching
    var query by page::query
    var menu by remember { mutableStateOf(false) }
    val now = remember(page.threads) { System.currentTimeMillis() }
    val listState = page.listState
    val scope = rememberCoroutineScope()
    val bars = rememberHideOnScroll()
    val density = LocalDensity.current
    val hapticView = androidx.compose.ui.platform.LocalView.current

    // 勢いの色は、板の中での順位で決める(過疎板でも一番勢いのあるスレは赤くなるように。今の専ブラと同じ)
    val rank = remember(page.threads) {
        // 順位は、立って 10 分たっていないスレを 10 分として数える(立った直後の 1 レスのスレが一番勢いがあることにならないように)
        val sorted = page.threads.map { it.key to momentum(it, maxOf(now, (it.createdAt ?: now) + 600_000L)) }.sortedByDescending { it.second }
        sorted.mapIndexed { i, (k, _) -> k to (1.0 - i.toDouble() / maxOf(1, sorted.size)) }.toMap()
    }
    // スレタイの NG と、ID の NG に当たる人が立てたスレは出さない(長押しの「立てた人を NG に追加」。data/Ng.kt)
    val ngRules = vm.prefs.ngRules
    val ngMatcher = remember(ngRules) { io.github.contentsview08.obb.data.NgMatcher(ngRules) }
    val sort = vm.prefs.threadSort
    val keywords = vm.prefs.keywords.lines().map { it.trim() }.filter { it.isNotEmpty() }
    val shown = remember(page.threads, page.states, tab, query, ngMatcher, sort, keywords, page.reversed, page.only) {
        // スレタイの NG・立てた人の NG に当たるスレは出さない
        var list = if (ngMatcher.isEmpty) page.threads else page.threads.filter { t -> !ngMatcher.thread(t) }
        // 全角半角・カナを同一視し、空白で区切った言葉はすべて含むもの。立てた人の ID も探す(PC 版と同じ)
        val terms = io.github.contentsview08.obb.data.searchTerms(query)
        if (terms.isNotEmpty()) list = list.filter { io.github.contentsview08.obb.data.matchesTerms("${it.title} ${it.authorId ?: ""}", terms) }
        // 差分の行から「新しいスレ」だけに絞った
        if (page.only == "new") list = list.filter { t -> page.newSince?.let { (t.createdAt ?: 0) > it } == true }
        list = when (tab) {
            // タブを選んでいないときは、設定の並び(板を開いたときの並び)
            null -> when (sort) {
                "momentum" -> list.sortedByDescending { momentum(it, now) }
                "newest" -> list.sortedByDescending { it.createdAt ?: 0 }
                "count" -> list.sortedByDescending { it.postCount }
                else -> list
            }
            ListTab.UNREAD -> list.filter { unreadOf(it, page.states) > 0 }
            ListTab.VISITED -> list.filter { page.states[it.key] != null }
            // 並べ替えのタブは、押すたびに 逆順 → 元の並び(page.reversed)
            ListTab.COUNT -> list.sortedByDescending { it.postCount }.let { if (page.reversed) it.reversed() else it }
            ListTab.MOMENTUM -> list.sortedByDescending { momentum(it, now) }.let { if (page.reversed) it.reversed() else it }
            ListTab.NEWEST -> list.sortedByDescending { it.createdAt ?: 0 }.let { if (page.reversed) it.reversed() else it }
        }
        // キーワードの入ったスレは一番上にまとめる(設定)。運営のお知らせは一番下に
        if (keywords.isNotEmpty()) {
            val (hit, rest) = list.partition { t -> keywords.any { t.title.contains(it, ignoreCase = true) } }
            list = hit + rest
        }
        list.filterNot { it.announcement } + list.filter { it.announcement }
    }

    var menuFor by remember { mutableStateOf<ThreadSummary?>(null) }
    val favIds = remember(vm.favThreads) { vm.favThreads.map { it.thread.id }.toSet() }
    var titleSheet by remember { mutableStateOf(false) }
    var styleSheet by remember { mutableStateOf(false) }
    var sizeDialog by remember { mutableStateOf(false) }
    var fontOnly by remember { mutableStateOf(false) }
    menuFor?.let { t -> ThreadMenu(vm, t, page.states[t.key] != null) { menuFor = null } }
    // 戻る操作で、まず検索を外す
    androidx.activity.compose.BackHandler(enabled = searching || query.isNotEmpty() || page.tab != null || page.only != null) {
        if (searching || query.isNotEmpty()) { searching = false; query = "" } else { page.tab = null; page.reversed = false; page.only = null }
    }
    // 取り直したら一番上へ戻す(上にあったスレの位置を保つと、その上に新しいスレが足されて分かりにくい)
    // (戻ってきたときにもう一度動かさないよう、戻した回を覚えておく。更新しない限り、一覧の位置はそのまま)
    LaunchedEffect(page.refreshed) {
        if (page.refreshed > page.scrolledFor) { page.scrolledFor = page.refreshed; listState.scrollToItem(0); bars.show() }
    }
    val swipe = rememberSwipeState()
    // なぞる操作(今のスマホ版の既定と同じ割り当て)
    val prefs = vm.prefs
    val gestures = if (!prefs.gesturesEnabled) emptyMap() else buildGestures(
        prefs.gestures("list"), "list",
        mapOf(
            // 絞り込み(未読など)・並べ替え・検索をしていれば、まずそれを外す。外れていればメニュー
            "drawer" to {
                if (page.tab != null || searching || query.isNotEmpty() || page.only != null) { page.tab = null; page.reversed = false; page.only = null; searching = false; query = ""; scope.launch { listState.scrollToItem(0) } }
                else vm.drawerOpen = true
            },
            "forward" to { vm.forward() },
            "bottom" to { scope.launch { listState.scrollToItem(maxOf(0, shown.size - 1)) }; Unit },
            "top" to { scope.launch { listState.scrollToItem(0); bars.show() }; Unit },
            "refresh" to { vm.refreshBoard(page) },
            "newThread" to { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
            "search" to { searching = true; bars.show() },
            "quick" to { vm.openQuick() },
        ),
    )
    bars.enabled = prefs.hideBarsOnScroll
    bars.atTop = { !listState.canScrollBackward }
    bars.atBottom = { !listState.canScrollForward }
    // 引っぱって更新(2ch Mate のように): 一番上で下へ引くと一覧が伸びて「引っぱって更新」→「離して更新」、
    // 離すと「更新中…」を出したまま取り直し、終わったら戻る(取り直しが速くても、更新したと分かるように)
    val pullPx = remember { Animatable(0f) }
    var pullRaw by remember { mutableFloatStateOf(0f) }
    var pulling by remember { mutableStateOf(false) }
    var pullRefreshing by remember { mutableStateOf(false) }
    val maxPull = with(density) { 140.dp.toPx() }
    val commitPull = with(density) { 64.dp.toPx() }
    val holdPull = with(density) { 52.dp.toPx() }
    fun damp(d: Float) = maxPull * d / (d + maxPull)
    val listPull = remember(page) {
        object : androidx.compose.ui.input.nestedscroll.NestedScrollConnection {
            override fun onPreScroll(available: androidx.compose.ui.geometry.Offset, source: androidx.compose.ui.input.nestedscroll.NestedScrollSource): androidx.compose.ui.geometry.Offset {
                if (pullRefreshing || source != androidx.compose.ui.input.nestedscroll.NestedScrollSource.UserInput) return androidx.compose.ui.geometry.Offset.Zero
                if (pullRaw > 0f && available.y < 0f) {
                    val d = minOf(pullRaw, -available.y); pullRaw -= d
                    scope.launch { pullPx.snapTo(damp(pullRaw)) }
                    return androidx.compose.ui.geometry.Offset(0f, -d)
                }
                return androidx.compose.ui.geometry.Offset.Zero
            }
            override fun onPostScroll(consumed: androidx.compose.ui.geometry.Offset, available: androidx.compose.ui.geometry.Offset, source: androidx.compose.ui.input.nestedscroll.NestedScrollSource): androidx.compose.ui.geometry.Offset {
                if (pullRefreshing || source != androidx.compose.ui.input.nestedscroll.NestedScrollSource.UserInput || available.y <= 0f) return androidx.compose.ui.geometry.Offset.Zero
                pulling = true
                val before = damp(pullRaw) >= commitPull
                pullRaw += available.y
                if (!before && damp(pullRaw) >= commitPull) Haptics.tick(hapticView)
                scope.launch { pullPx.snapTo(damp(pullRaw)) }
                return androidx.compose.ui.geometry.Offset(0f, available.y)
            }
            override suspend fun onPreFling(available: androidx.compose.ui.unit.Velocity): androidx.compose.ui.unit.Velocity {
                if (!pulling) return androidx.compose.ui.unit.Velocity.Zero
                pulling = false
                val reached = damp(pullRaw) >= commitPull
                pullRaw = 0f
                scope.launch {
                    if (reached) {
                        pullRefreshing = true
                        Haptics.confirm(hapticView)
                        pullPx.animateTo(holdPull, tween(180, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
                        vm.refreshBoard(page)?.join()
                        pullPx.animateTo(0f, tween(250, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
                        pullRefreshing = false
                    } else pullPx.animateTo(0f, tween(250))
                }
                return androidx.compose.ui.unit.Velocity.Zero
            }
        }
    }
    Box(modifier.fillMaxSize().background(Palette.base).clipToBounds().nestedScroll(bars.connection).nestedScroll(listPull).swipeGestures(swipe, gestures, sensitivity = prefs.gestureSensitivity)) {
        // 引っぱっている所(伸びたすき間)の案内
        if (pullPx.value > 1f) {
            Box(
                Modifier.fillMaxWidth().padding(top = with(density) { (bars.topHeight * (1f - bars.hidden)).toDp() }).height(with(density) { pullPx.value.toDp() }),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (pullRefreshing) {
                        androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), color = Palette.accent, strokeWidth = 2.dp)
                        Text("更新中…", color = Palette.textMuted, fontSize = 13.sp)
                    } else {
                        val over = pullPx.value >= commitPull
                        val rot by androidx.compose.animation.core.animateFloatAsState(if (over) 180f else 0f, label = "arrow")
                        Icon(Icons.Filled.ArrowDownward, null, tint = if (over) Palette.accent else Palette.textMuted, modifier = Modifier.size(18.dp).graphicsLayer { rotationZ = rot })
                        Text(if (over) "離して更新" else "引っぱって更新", color = if (over) Palette.accent else Palette.textMuted, fontSize = 13.sp)
                    }
                }
            }
        }
        Box(Modifier.fillMaxSize().graphicsLayer { translationY = pullPx.value }) {
            when {
                page.error != null && page.threads.isEmpty() -> LoadError(page.error, page.loading, with(density) { bars.topHeight.toDp() }, onBack = if (vm.stack.size > 1) ({ vm.back() }) else null, externalUrl = page.board.url) { vm.refreshBoard(page) }
                page.threads.isEmpty() && page.loading -> Skeleton(with(density) { bars.topHeight.toDp() }, post = false)
                else -> LazyColumn(
                    Modifier.fillMaxSize(), state = listState,
                    contentPadding = PaddingValues(
                        top = with(density) { bars.topHeight.toDp() },
                        bottom = with(density) { bars.bottomHeight.toDp() } + 24.dp,
                    ),
                ) {
                    val plain = tab == null && query.isBlank() && page.only == null
                    run {
                        items(shown, key = { it.key }, contentType = { 0 }) { t ->
                            ThreadRow(
                                t, page.states[t.key], momentum(t, now), rank[t.key] ?: 0.0, now,
                                isNew = page.newSince?.let { s -> (t.createdAt ?: 0) > s } == true, isFavorite = t.id in favIds,
                                onLongClick = { Haptics.longPress(hapticView); menuFor = t },
                            ) { vm.openThread(t) }
                            HorizontalDivider(color = Palette.border)
                        }
                    }
                }
            }
        }

        // 上の帯(スクロールで隠れる)
        Column(Modifier.fillMaxWidth().onSizeChanged { bars.topHeight = it.height.toFloat() }.graphicsLayer { translationY = -bars.hidden * bars.topHeight }) {
            if (searching) {
                SearchBar(query, { query = it }, "スレタイを探す") { searching = false; query = "" }
            } else {
                HeaderBar(
                    vm.prefs.boardMeta[page.board.url]?.alias ?: page.board.name, onNav = { vm.drawerOpen = true },
                    leading = { BoardIcon(page.board.url, 22.dp) { Icon(Icons.Filled.Forum, null, tint = Palette.textMuted, modifier = Modifier.size(24.dp)) } },
                    onTitle = { titleSheet = true },
                ) {
                    BarIcon(Icons.Filled.Search, "探す") { searching = true }
                    MoreButton { menu = true }
                }
            }
            HorizontalDivider(color = Palette.border)
        }

        // 取り直しの途中は、一覧を残したまま、上の帯の下に細い帯を流す(今のスマホ版の list-progress。0.9 秒で左から右へ)
        if (page.loading && page.threads.isNotEmpty()) {
            val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "progress").animateFloat(
                -0.35f, 1f, androidx.compose.animation.core.infiniteRepeatable(tween(900, easing = androidx.compose.animation.core.FastOutSlowInEasing)), label = "x",
            )
            BoxWithConstraints(Modifier.fillMaxWidth().padding(top = with(density) { (bars.topHeight * (1f - bars.hidden)).toDp() }).height(2.dp).clipToBounds()) {
                Box(Modifier.width(maxWidth * 0.35f).fillMaxHeight().graphicsLayer { translationX = t.value * constraints.maxWidth }.background(Palette.accent, RoundedCornerShape(1.dp)))
            }
        }

        // 下の帯(並び順と更新)
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { bars.bottomHeight = it.height.toFloat() }
                .graphicsLayer { translationY = bars.footerHidden * bars.bottomHeight },
        ) {
            HorizontalDivider(color = Palette.border)
            Row(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding().heightIn(min = vm.prefs.footerHeight.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                // 出すタブと並びは設定(スレ一覧 › タブ)
                val tabs = vm.prefs.listTabs.split(',').mapNotNull { k -> ListTab.entries.firstOrNull { it.key == k } }
                // タブが多くて入りきらないときは、横にずらせる
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                // 今のスマホ版のタブ: 選んでいるタブは強調色の文字と薄い色、上に線。未読のタブには未読の合計。
                // 並べ替えのタブは、押すたびに 逆順 → 元の並び(矢印で向き)。絞り込みのタブは押すたびに入り切り
                // NG で出していないスレは数えない
                val unreadTotal = remember(page.threads, page.states, ngMatcher) { page.threads.sumOf { t -> if (ngMatcher.thread(t)) 0 else unreadOf(t, page.states) } }
                for (t in tabs) {
                    val active = tab == t
                    val filterTab = t == ListTab.UNREAD || t == ListTab.VISITED
                    Box(
                        Modifier.clickable {
                            when {
                                filterTab -> page.tab = if (active) null else t.key
                                !active -> { page.tab = t.key; page.reversed = false }
                                !page.reversed -> page.reversed = true
                                else -> { page.tab = null; page.reversed = false }
                            }
                            scope.launch { listState.scrollToItem(0) }
                        }.background(if (active) Palette.accentWash else Color.Transparent).heightIn(min = vm.prefs.footerHeight.dp).padding(horizontal = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            val c = if (active) Palette.accent else Palette.textMuted
                            Icon(t.icon, null, tint = c, modifier = Modifier.size(17.dp))
                            Text(t.label, color = c, fontSize = 14.sp)
                            if (t == ListTab.UNREAD && unreadTotal > 0) {
                                Text(
                                    if (unreadTotal > 999) "+999+" else "+$unreadTotal",
                                    Modifier.background(Palette.unread, RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 1.dp),
                                    color = Palette.unreadText, fontSize = 9.sp, fontWeight = FontWeight.Bold,
                                )
                            }
                            if (!filterTab) Icon(
                                if (active && page.reversed) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward, null,
                                tint = if (active) c else Color.Transparent, modifier = Modifier.size(14.dp),
                            )
                        }
                        // 選んでいる印の線(フッターなので本文の側=上に)
                        if (active) Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(2.dp).background(Palette.accent, RoundedCornerShape(1.dp)))
                    }
                }
                }
                IconButton(onClick = { vm.refreshBoard(page) }, enabled = !page.loading) { Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted) }
            }
        }

        SwipeLabel(swipe)

        // スレを立てる(右下の丸いボタン)
        FloatingActionButton(
            onClick = { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
            containerColor = Palette.accent, contentColor = Palette.accentText, shape = CircleShape,
            // 下へスクロールしてフッターが隠れるときは、一緒に画面の下へ沈めて消す
            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 20.dp, bottom = 20.dp).navigationBarsPadding()
                .padding(bottom = with(density) { bars.bottomHeight.toDp() })
                .graphicsLayer {
                    val f = bars.footerHidden
                    translationY = f * (bars.bottomHeight + size.height + 40.dp.toPx())
                    alpha = 1f - f
                },
        ) { Icon(Icons.Filled.EditNote, "スレを立てる") }
    }

    // ︙ のメニュー(今のスマホ版の並び: スレを立てる・お気に入り板・スレッド検索・先頭へ・表示スタイル・文字の大きさ・余白・更新)
    if (menu) {
        val fav = vm.isFavorite(page.board)
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("スレを立てる", Icons.Filled.EditNote, Palette.markNew) { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
                    MenuItem(if (fav) "お気に入り板から外す" else "お気に入り板に追加", if (fav) Icons.Filled.Star else Icons.Outlined.Star, Palette.markFav) { vm.toggleFavorite(page.board) },
                    MenuItem("スレッド検索", Icons.Filled.Search, Palette.accent) { searching = true; bars.show() },
                    MenuItem("先頭へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                ),
                listOf(
                    MenuItem("表示スタイル", Icons.Filled.Palette, Palette.markPurple) { styleSheet = true },
                    MenuItem("文字の大きさ・余白", Icons.Filled.FormatSize) { sizeDialog = true },
                    MenuItem("スレッド一覧を更新", Icons.Filled.Refresh, Palette.accent) { vm.refreshBoard(page) },
                ),
            ),
        ) { menu = false }
    }
    // 板名を押したときのメニュー
    if (titleSheet) {
        val fav = vm.isFavorite(page.board)
        val context = androidx.compose.ui.platform.LocalContext.current
        MenuSheet(
            listOf(
                listOf(
                    MenuItem(if (fav) "お気に入り板から外す" else "お気に入り板に足す", if (fav) Icons.Filled.Star else Icons.Outlined.Star, Palette.markFav) { vm.toggleFavorite(page.board) },
                    MenuItem("スレを立てる", Icons.Filled.EditNote, Palette.markNew) { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
                ),
                listOf(
                    MenuItem("板名をコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, page.board.name); vm.toast = "板名をコピーしました" },
                    MenuItem("板の URL をコピー", Icons.Filled.Link, Palette.markLink) { copyText(context, page.board.url); vm.toast = "URL をコピーしました" },
                ),
                listOf(
                    MenuItem("先頭へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                    MenuItem("更新", Icons.Filled.Refresh, Palette.accent) { vm.refreshBoard(page) },
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, Palette.markLink) { openExternal(context, page.board.url, false) },
                ),
            ),
            MenuAt.TopStart,
        ) { titleSheet = false }
    }
    if (styleSheet) StyleSheet(vm.prefs, onFont = { fontOnly = true; sizeDialog = true }) { styleSheet = false }
    if (sizeDialog) SizeDialog({ sizeDialog = false; fontOnly = false }) {
        val p = vm.prefs
        if (fontOnly) SizeSlider("画面全体の文字", p.fontScale, 0.85f..1.3f, 8, "${(p.fontScale * 100).toInt()}%", 1f) { p.fontScale = (it * 20).toInt() / 20f }
        else {
            SizeSlider("スレ一覧の文字", p.listFontScale, 0.8f..1.4f, 11, "${(p.listFontScale * 100).toInt()}%", 1f) { p.listFontScale = (it * 20).toInt() / 20f }
            SizeSlider("スレの上下の余白", p.listPad.toFloat(), 0f..24f, 23, "${p.listPad}dp", 9f) { p.listPad = it.toInt() }
            BarSliders(p)
        }
    }
    NewThreadSheet(vm, page)
}

private fun unreadOf(t: ThreadSummary, states: Map<String, ThreadState>): Int {
    val s = states[t.key] ?: return 0
    return maxOf(0, t.postCount - s.readNo)
}

/**
 * スレ 1 行(今のスマホ版の ThreadCard のスマホの形): 1 段目にスレタイ(3 行まで。頭に「新」・お気に入りの星)、
 * 2 段目の左に立った時間・立てた人の ID・dat落ち、右に勢い・レス数・未読の数。開いたことのあるスレは左に線
 * (新着があれば未読の色)。スレタイの色: 新着があれば強く(太字)、開いて新着がなければ既読の色、開いていなければふつう
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ThreadRow(
    t: ThreadSummary, state: ThreadState?, momentum: Double, rank: Double, now: Long,
    isNew: Boolean, isFavorite: Boolean, onLongClick: () -> Unit, onClick: () -> Unit,
) {
    val unread = if (state == null) 0 else maxOf(0, t.postCount - state.readNo)
    val prefs = LocalPrefs.current
    val k = prefs.listFontScale
    val pad = prefs.listPad.dp
    val visited = state != null
    val archived = state?.archived == true
    val compact = prefs.listDensity == "compact"
    val heatC = when {
        rank >= 0.9 -> Palette.heatVeryHot
        rank >= 0.6 -> Palette.heatHot
        rank >= 0.3 -> Palette.heatWarm
        else -> Palette.textMuted
    }
    Box(Modifier.fillMaxWidth().height(IntrinsicSize.Min).graphicsLayer { alpha = if (archived) 0.6f else 1f }) {
        // 左の帯: 未読が多いほど濃く(+3 は薄く、+300 は濃く。札を見なくても溜まり具合が分かる)
        if (visited) Box(
            Modifier.width(3.dp).fillMaxHeight().background(
                if (unread > 0) Palette.unread.copy(alpha = (0.35f + 0.65f * minOf(1f, kotlin.math.log10(unread + 1f) / 2.5f))) else Palette.threadReadTitle,
            ),
        )
        if (compact) {
            // コンパクト: スレタイ 1 行と、右端にレス数と未読だけ
            Row(
                Modifier.fillMaxWidth().combinedClickable(onLongClick = onLongClick, onClick = onClick).padding(start = 14.dp, end = 12.dp, top = pad / 2 + 2.dp, bottom = pad / 2 + 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    buildAnnotatedString {
                        if (isNew) { appendInlineContent("new", "[新]"); append(" ") }
                        if (isFavorite) withStyle(SpanStyle(color = Palette.markFav)) { append("★ ") }
                        append(t.title)
                    },
                    Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = (14 * k).sp, inlineContent = chipInlineContent(),
                    color = if (visited) Palette.threadReadTitle else Palette.textStrong, fontWeight = if (!visited) FontWeight.SemiBold else FontWeight.Normal,
                )
                Text(
                    "${t.postCount}", Modifier.widthIn(min = 36.dp), fontSize = (11 * k).sp, textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                    color = heatC,
                )
                if (unread > 0) Text(
                    if (unread > 999) "+999+" else "+$unread",
                    Modifier.padding(start = 6.dp).widthIn(min = 30.dp).background(Palette.unread, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp),
                    color = Palette.unreadText, fontSize = (10 * k).sp, fontWeight = FontWeight.Bold, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
            return@Box
        }
        // スレの画像(1 レス目の最初の画像。hono-bbs)を左に、行の縦いっぱいに(web 版と同じ)
        val thumb = rememberListThumb(t.thumb)
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Min).combinedClickable(onLongClick = onLongClick, onClick = onClick)
                .padding(start = 14.dp, end = 12.dp, top = if (thumb != null) 2.dp else pad, bottom = if (thumb != null) 2.dp else pad),
        ) {
        if (thumb != null) {
            // 1:1 に切り取り、行の縦いっぱいに(幅は高さと同じ)
            StoredImage(thumb, Modifier.fillMaxHeight().heightIn(min = 64.dp).aspectRatio(1f, matchHeightConstraintsFirst = true).clip(RoundedCornerShape(6.dp)).background(Palette.surface2), showProgress = false)
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f).align(Alignment.CenterVertically).padding(vertical = if (thumb != null) (pad - 2.dp).coerceAtLeast(0.dp) else 0.dp)) {
            val titleColor = if (visited) Palette.threadReadTitle else Palette.textStrong
            Text(
                buildAnnotatedString {
                    if (isNew) { appendInlineContent("new", "[新]"); append(" ") }
                    if (isFavorite) withStyle(SpanStyle(color = Palette.markFav)) { append("★ ") }
                    append(t.title)
                },
                maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = (15 * k).sp, lineHeight = (20 * k).sp, inlineContent = chipInlineContent(),
                // まだ開いていないスレだけ太字。開いたスレは新着があっても細く既読の色に(新着は右の +N の札で分かる)
                color = titleColor, fontWeight = if (!visited) FontWeight.SemiBold else FontWeight.Normal,
            )
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                // 左(時間・ID・dat落ち)は残りの幅に収め、右の 3 つは右端にそろえる
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(relativeTime(t.createdAt, now), color = Palette.textMuted, fontSize = (11 * k).sp, maxLines = 1)
                if (t.authorId != null) {
                    Spacer(Modifier.width(8.dp))
                    Text(t.authorId, Modifier.weight(1f, fill = false), color = Palette.textMuted, fontSize = (11 * k).sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (archived) { Spacer(Modifier.width(8.dp)); Text("dat落ち", color = Palette.textMuted, fontSize = (11 * k).sp) }
                }
                // 右の 3 つ(勢い・レス数・未読)は右端に寄せる(勢い・レス数は幅をそろえて、数字の桁が縦にそろうように)
                Text(
                    if (momentum >= 100) "%.0f".format(momentum) else "%.1f".format(momentum), Modifier.widthIn(min = 44.dp), fontSize = (11 * k).sp, fontFamily = FontFamily.Monospace,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                    color = heatC,
                )
                Text(
                    buildAnnotatedString { append("${t.postCount}"); withStyle(SpanStyle(fontSize = (10 * k).sp)) { append("レス") } },
                    Modifier.widthIn(min = 60.dp), color = Palette.textMuted, fontSize = (11 * k).sp, textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                )
                if (unread > 0) Box(Modifier.padding(start = 8.dp), contentAlignment = Alignment.CenterEnd) {
                    // 数が増えたら、数字が下から繰り上がる(カウンターの回転)
                    androidx.compose.animation.AnimatedContent(
                        unread, Modifier.widthIn(min = 30.dp).background(Palette.unread, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp),
                        transitionSpec = {
                            if (Motion.reduced) androidx.compose.animation.EnterTransition.None togetherWith androidx.compose.animation.ExitTransition.None
                            else (androidx.compose.animation.slideInVertically { it } + androidx.compose.animation.fadeIn()) togetherWith (androidx.compose.animation.slideOutVertically { -it } + androidx.compose.animation.fadeOut())
                        },
                        contentAlignment = Alignment.Center, label = "unread",
                    ) { n ->
                        Text(
                            if (n > 999) "+999+" else "+$n",
                            color = Palette.unreadText, fontSize = (10 * k).sp, fontWeight = FontWeight.Bold, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
            }
        }
        }
    }
}

/** スレ一覧に出すサムネイルの URL。「サムネイルを読み込む」の設定に従い、取れなかった画像は出さない(×の枠が並ばないように) */
@Composable
private fun rememberListThumb(thumb: String?): String? {
    if (thumb == null) return null
    val prefs = LocalPrefs.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val allowed = remember(prefs.thumbMode) {
        when (prefs.thumbMode) { ThumbMode.ALWAYS -> true; ThumbMode.WIFI -> isWifi(context); ThumbMode.TAP, ThumbMode.NEVER -> false }
    }
    val failed = io.github.contentsview08.obb.data.ImageStore.states[thumb] is io.github.contentsview08.obb.data.ImageStore.State.Failed
    return thumb.takeIf { allowed && !failed }
}


/** 上の帯の検索欄(題の代わりに出す) */
@Composable
fun SearchBar(value: String, onChange: (String) -> Unit, placeholder: String, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "閉じる", tint = Palette.textMuted) }
        TextField(
            value, onChange, Modifier.weight(1f).focusRequester(focus), singleLine = true,
            placeholder = { Text(placeholder) },
            keyboardOptions = KeyboardOptions.Default,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Palette.surface2, unfocusedContainerColor = Palette.surface2,
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            ),
            shape = RoundedCornerShape(6.dp),
        )
        if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Close, "消す", tint = Palette.textMuted) }
        Spacer(Modifier.width(4.dp))
    }
}
