package io.github.contentsview08.obb.ui

import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.ui.focus.onFocusChanged
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.material.icons.filled.StarBorder
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import io.github.contentsview08.obb.data.ThumbMode
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
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
import io.github.contentsview08.obb.bbs.legacyAuthorId
import io.github.contentsview08.obb.data.normalizeForSearch
import io.github.contentsview08.obb.data.ThreadState
import io.github.contentsview08.obb.data.threadUnread
import io.github.contentsview08.obb.data.unreadFirstOrder
import kotlinx.coroutines.launch

/** 一覧のタブ(PC 版の LIST_TABS と同じ)。どれも選ばなければ設定の並び */
private enum class ListTab(val key: String, val label: String, val icon: ImageVector) {
    UNREAD("unread", "未読", Icons.Filled.MarkEmailUnread),
    VISITED("visited", "閲覧済み", Icons.Filled.History),
    MOMENTUM("momentum", "勢い順", Icons.Filled.LocalFireDepartment),
    NEWEST("newest", "新しい順", Icons.Filled.Schedule),
    COUNT("count", "レス数順", Icons.Filled.FormatListNumbered),
}

/** 勢い(1 日あたりのレス数) */
fun momentum(t: ThreadSummary, now: Long): Double {
    val c = t.createdAt ?: return 0.0
    return momentumOf(t.postCount, c, now)
}

fun momentumOf(count: Int, createdAt: Long, now: Long): Double = count / (maxOf(now - createdAt, 60_000L) / 86_400_000.0)

/** 100 からは整数 */
fun momentumText(m: Double): String = if (m >= 100) "%.0f".format(m) else "%.1f".format(m)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadListScreen(vm: AppViewModel, page: Page.Threads, modifier: Modifier = Modifier) {
    // タブ・検索・スクロールの位置は、スレを開いて戻っても残すためページに持つ
    val tab = ListTab.entries.firstOrNull { it.key == page.tab }
    // 行ごとに通信の状態を調べないよう、画面で見張る(Wi-Fi ⇄ モバイル通信の切り替えにはすぐ合わせる)
    val wifi = rememberIsWifi(vm.prefs.thumbMode == ThumbMode.WIFI)
    val thumbAllowed = when (vm.prefs.thumbMode) { ThumbMode.ALWAYS -> true; ThumbMode.WIFI -> wifi; ThumbMode.TAP, ThumbMode.NEVER -> false }
    var searching by page::searching
    var query by page::query
    var menu by remember { mutableStateOf(false) }
    val now = remember(page.threads) { System.currentTimeMillis() }
    val listState = page.listState
    val scope = rememberCoroutineScope()
    val bars = rememberHideOnScroll()
    val density = LocalDensity.current
    val hapticView = androidx.compose.ui.platform.LocalView.current

    // 勢いの色は板の中での順位で決める。過疎板でも一番勢いのあるスレを赤くするため(PC 版と同じ)
    val rank = remember(page.threads) {
        // 立って 10 分未満のスレは 10 分として数える。立った直後の 1 レスのスレが一番になるのを防ぐ
        val sorted = page.threads.map { it.key to momentum(it, maxOf(now, (it.createdAt ?: now) + 600_000L)) }.sortedByDescending { it.second }
        sorted.mapIndexed { i, (k, _) -> k to (1.0 - i.toDouble() / maxOf(1, sorted.size)) }.toMap()
    }
    val ngRules = vm.prefs.ngRules
    val ngMatcher = remember(ngRules) { io.github.contentsview08.obb.data.NgMatcher(ngRules) }
    val sort = vm.prefs.threadSort
    val keywords = vm.prefs.keywords.lines().map { it.trim() }.filter { it.isNotEmpty() }
    val keywordAuthors = vm.prefs.keywordAuthors.lines().map { it.trim() }.filter { it.isNotEmpty() }
    val hasKeywords = keywords.isNotEmpty() || keywordAuthors.isNotEmpty()
    val unreadFirst = vm.prefs.unreadFirst
    // 既読が進むたびに並べ直さないよう、中身で絞るタブのときだけ既読の変化をきっかけにする
    val statesKey = if (tab == ListTab.UNREAD || tab == ListTab.VISITED) page.states else null
    val shown = remember(page.threads, statesKey, tab, query, ngMatcher, sort, keywords, keywordAuthors, page.reversed, page.only, unreadFirst) {
        // スレタイの NG・立てた人の NG に当たるスレは出さない
        var list = if (ngMatcher.isEmpty) page.threads else page.threads.filter { t -> !ngMatcher.thread(t) }
        // 立てた人の ID も探す(PC 版と同じ)
        val terms = io.github.contentsview08.obb.data.searchTerms(query)
        if (terms.isNotEmpty()) list = list.filter { io.github.contentsview08.obb.data.matchesTerms("${it.title} ${it.authorId ?: ""}", terms) }
        if (page.only == "new") list = list.filter { t -> page.newSince?.let { (t.createdAt ?: 0) > it } == true }
        list = when (tab) {
            null -> when (sort) {
                "momentum" -> list.sortedByDescending { momentum(it, now) }
                "newest" -> list.sortedByDescending { it.createdAt ?: 0 }
                "count" -> list.sortedByDescending { it.postCount }
                else -> list
            }
            ListTab.UNREAD -> list.filter { unreadOf(it, page.states[it.key]) > 0 }
            ListTab.VISITED -> list.filter { page.states[it.key] != null }
            // 並べ替えのタブは、押すたびに 逆順 → 元の並び(page.reversed)
            ListTab.COUNT -> list.sortedByDescending { it.postCount }.let { if (page.reversed) it.reversed() else it }
            ListTab.MOMENTUM -> list.sortedByDescending { momentum(it, now) }.let { if (page.reversed) it.reversed() else it }
            ListTab.NEWEST -> list.sortedByDescending { it.createdAt ?: 0 }.let { if (page.reversed) it.reversed() else it }
        }
        // 未読のタブの中はすべて未読なので分けない
        if (unreadFirst && tab != ListTab.UNREAD) {
            val top = page.unreadTop { page.threads.filter { unreadOf(it, page.states[it.key]) > 0 }.map { it.key }.toSet() }
            list = unreadFirstOrder(list) { it.key in top }
        }
        if (hasKeywords) keywordGroups(list, keywords, keywordAuthors).flatMap { it.second }
        else list.filterNot { it.announcement } + list.filter { it.announcement }
    }
    // キーワードのまとまりの頭に出す帯(PC のスレ一覧と同じ: キーワードごとに差し色の帯、残りは「その他のスレ」)
    val bandBefore = remember(shown, keywords, keywordAuthors) {
        if (!hasKeywords) emptyMap() else keywordGroups(shown, keywords, keywordAuthors).filter { it.second.isNotEmpty() }.let { groups ->
            if (groups.none { it.first != null }) emptyMap()
            else groups.associate { (k, ts) -> ts.first().key to ListBand(k ?: "その他のスレ", ts.size, accent = k != null) }
        }
    }

    var menuFor by remember { mutableStateOf<PeekTarget?>(null) }
    val favIds = remember(vm.favThreads) { vm.favThreads.map { it.thread.id }.toSet() }
    var styleSheet by remember { mutableStateOf(false) }
    menuFor?.let { p -> ThreadPeek(vm, p, page.states[p.thread.key] != null) { menuFor = null } }
    androidx.activity.compose.BackHandler(enabled = searching || query.isNotEmpty() || page.tab != null || page.only != null) {
        if (searching || query.isNotEmpty()) { searching = false; query = "" } else { page.tab = null; page.reversed = false; page.only = null }
    }
    // 取り直したら一番上へ戻す。位置を保つと、その上に新しいスレが足されて分かりにくい
    // 戻ってきたときにもう一度動かさないよう、戻した回を覚えておく
    LaunchedEffect(page.refreshed) {
        if (page.refreshed > page.scrolledFor) { page.scrolledFor = page.refreshed; listState.scrollToItem(0); bars.show() }
    }
    val swipe = rememberSwipeState()
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
            "newThread" to { vm.openNewThread(page) },
            "search" to { searching = true; bars.show() },
            "quick" to { vm.openQuick() },
        ),
    )
    bars.enabled = prefs.hideBarsOnScroll
    bars.atTop = { !listState.canScrollBackward }
    bars.atBottom = { !listState.canScrollForward }
    // 離したあとは「更新中…」を出したまま取り直す。取り直しが速くても更新したと分かるように
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
    // ピンチの間の字の大きさ。保存は指を離したときに 1 回だけ
    var pinchScale by remember { mutableStateOf<Float?>(null) }
    var pinchLabel by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pinchLabel) { if (pinchLabel != null) { kotlinx.coroutines.delay(900); pinchLabel = null } }
    Box(
        modifier.fillMaxSize().background(Palette.base).clipToBounds().nestedScroll(bars.connection).nestedScroll(listPull).swipeGestures(swipe, gestures, sensitivity = prefs.gestureSensitivity)
            // 1 本指の操作には触らない。2 本指になってからは指を全部離すまで受け、残った指でスクロールや行の押下にならないようにする
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    var zoom = 1f
                    val start = vm.prefs.listFontScale
                    var pinching = false
                    do {
                        val e = awaitPointerEvent(PointerEventPass.Initial)
                        if (e.changes.count { it.pressed } >= 2) {
                            pinching = true
                            zoom *= e.calculateZoom()
                            val v = pinchedScale(start, zoom, 15)
                            if (v != (pinchScale ?: start)) { pinchScale = v; Haptics.tick(hapticView) }
                            pinchLabel = "スレ一覧 ${fontSizeOf(v, 15)}"
                        }
                        if (pinching) e.changes.forEach { it.consume() }
                    } while (e.changes.any { it.pressed })
                    pinchScale?.let { if (it != start) vm.prefs.listFontScale = it }
                    pinchScale = null
                }
            },
    ) {
        if (pullPx.value > 1f) {
            Box(
                Modifier.fillMaxWidth().barPadding(top = { bars.topHeight * (1f - bars.hidden) }).height(with(density) { pullPx.value.toDp() }),
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
                else -> { LazyColumn(
                    Modifier.fillMaxSize(), state = listState,
                    contentPadding = PaddingValues(
                        top = with(density) { bars.topHeight.toDp() },
                        bottom = with(density) { bars.bottomHeight.toDp() } + 24.dp,
                    ),
                ) {
                    items(shown, key = { it.key }, contentType = { 0 }) { t ->
                        bandBefore[t.key]?.let { KeywordBand(it) }
                        ThreadRow(
                            t, pinchScale ?: prefs.listFontScale, page.states[t.key], momentum(t, now), rank[t.key] ?: 0.0, now,
                            isNew = page.newSince?.let { s -> (t.createdAt ?: 0) > s } == true, isFavorite = t.id in favIds, thumbAllowed = thumbAllowed,
                            onLongClick = { from -> Haptics.longPress(hapticView); menuFor = PeekTarget(t, from) },
                        ) { vm.openThread(t) }
                        HorizontalDivider(color = Palette.border)
                    }
                }
                    // 今どの辺かを見せるだけの細いバー。上下の帯に隠れない所に出す
                    ThinScrollbar(listState, top = { bars.topHeight * (1f - bars.hidden) }, bottom = { bars.bottomHeight * (1f - bars.footerHidden) })
                }
            }
        }

        Column(Modifier.fillMaxWidth().onSizeChanged { bars.topHeight = it.height.toFloat() }.graphicsLayer { translationY = -bars.hidden * bars.topHeight }) {
            if (searching) {
                SearchBar(query, { query = it }, "スレタイを探す") { searching = false; query = "" }
            } else {
                HeaderBar(
                    vm.prefs.boardMeta[page.board.url]?.alias ?: page.board.name, onNav = { vm.drawerOpen = true },
                    leading = { BoardIcon(page.board.url, 22.dp) { Icon(Icons.Filled.Forum, null, tint = Palette.textMuted, modifier = Modifier.size(24.dp)) } },
                    onTitle = { menu = true },
                ) {
                    BarIcon(Icons.Filled.Search, "探す") { searching = true }
                    MoreButton { menu = true }
                }
            }
            HorizontalDivider(color = Palette.border)
        }

        // 取り直しの途中は、一覧を残したまま細い帯を流す(PC 版の list-progress)
        if (page.loading && page.threads.isNotEmpty()) {
            val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "progress").animateFloat(
                -0.35f, 1f, androidx.compose.animation.core.infiniteRepeatable(tween(900, easing = androidx.compose.animation.core.FastOutSlowInEasing)), label = "x",
            )
            BoxWithConstraints(Modifier.fillMaxWidth().barPadding(top = { bars.topHeight * (1f - bars.hidden) }).height(2.dp).clipToBounds()) {
                Box(Modifier.width(maxWidth * 0.35f).fillMaxHeight().graphicsLayer { translationX = t.value * constraints.maxWidth }.background(Palette.accent, RoundedCornerShape(1.dp)))
            }
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { bars.bottomHeight = it.height.toFloat() }
                .graphicsLayer { translationY = bars.footerHidden * bars.bottomHeight },
        ) {
            HorizontalDivider(color = Palette.border)
            Row(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding().heightIn(min = vm.prefs.footerHeight.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                val tabs = vm.prefs.listTabs.split(',').mapNotNull { k -> ListTab.entries.firstOrNull { it.key == k } }
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                // NG で出していないスレは数えない
                val unreadTotal = remember(page.threads, page.states, ngMatcher) { page.threads.sumOf { t -> if (ngMatcher.thread(t)) 0 else unreadOf(t, page.states[t.key]) } }
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
                                Badge(badgeCount(unreadTotal), Palette.unread, Palette.unreadText)
                            }
                            if (!filterTab) Icon(
                                if (active && page.reversed) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward, null,
                                tint = if (active) c else Color.Transparent, modifier = Modifier.size(14.dp),
                            )
                        }
                        // フッターなので、選んでいる印の線は本文の側(上)に引く
                        // 横に動かせる並びの中では幅が決まらないので、タブの大きさに合わせてから引く
                        if (active) Box(Modifier.matchParentSize()) {
                            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(2.dp).background(Palette.accent, RoundedCornerShape(1.dp)))
                        }
                    }
                }
                }
                val footerH = vm.prefs.footerHeight
                Box(
                    Modifier.size(barButtonSize(footerH).dp).clip(CircleShape).clickable(enabled = !page.loading) { vm.refreshBoard(page) },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted, modifier = Modifier.size(minOf(24, footerH - 6).dp)) }
            }
        }

        SwipeLabel(swipe)

        FloatingActionButton(
            onClick = { vm.openNewThread(page) },
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
        pinchLabel?.let {
            Text(
                it, Modifier.align(Alignment.Center).background(Palette.surface3.copy(alpha = 0.95f), RoundedCornerShape(8.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
                color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
        }
    }

    // ヘッダーの板名と ︙ は同じメニュー
    if (menu) {
        val fav = vm.isFavorite(page.board)
        val context = androidx.compose.ui.platform.LocalContext.current
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("スレを立てる", Icons.Filled.EditNote) { vm.openNewThread(page) },
                    MenuItem(if (fav) "お気に入り板から外す" else "お気に入り板に追加", if (fav) Icons.Filled.Star else Icons.Filled.StarBorder) { vm.toggleFavorite(page.board) },
                    MenuItem("更新", Icons.Filled.Refresh) { vm.refreshBoard(page) },
                    MenuItem("スレッド検索", Icons.Filled.Search) { searching = true; bars.show() },
                    styleMenuItem { styleSheet = true },
                    MenuItem("先頭へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                ),
                listOf(
                    MenuItem("コピー", Icons.Filled.ContentCopy, children = listOf(
                        MenuItem("板名をコピー", Icons.Filled.ContentCopy) { copyText(context, page.board.name); vm.toast = "板名をコピーしました" },
                        MenuItem("板の URL をコピー", Icons.Filled.Link) { copyText(context, page.board.url); vm.toast = "URL をコピーしました" },
                    )) {},
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew) { openExternal(context, page.board.url, false) },
                ),
            ),
            header = { MenuInfo(page.board.name, "${page.threads.size}スレ") },
        ) { menu = false }
    }
    if (styleSheet) StyleSheet(vm.prefs, thread = false) { styleSheet = false }
    NewThreadSheet(vm, page)
}

private fun unreadOf(t: ThreadSummary, state: ThreadState?): Int = threadUnread(state?.readNo, t.postCount)

private fun threadTitleText(t: ThreadSummary, isNew: Boolean, isFavorite: Boolean) = buildAnnotatedString {
    if (isNew) { appendInlineContent("new", "[新]"); append(" ") }
    if (isFavorite) withStyle(SpanStyle(color = Palette.markFav)) { append("★ ") }
    append(t.title)
}

/** スレ 1 行(PC 版の ThreadCard のスマホの形) */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ThreadRow(
    t: ThreadSummary, k: Float, state: ThreadState?, momentum: Double, rank: Double, now: Long,
    isNew: Boolean, isFavorite: Boolean, thumbAllowed: Boolean, onLongClick: (androidx.compose.ui.geometry.Rect?) -> Unit, onClick: () -> Unit,
) = WithoutBaseFont {
    // のぞく窓をこの行の位置から広げる
    val anchor = rememberPeekAnchor()
    val view = androidx.compose.ui.platform.LocalView.current
    val longClick = { onLongClick(anchor.screenRect(view)) }
    val unread = unreadOf(t, state)
    val prefs = LocalPrefs.current
    val pad = prefs.listPad.dp
    val visited = state != null
    val archived = state?.archived == true
    val compact = prefs.listShape == "compact"
    val heatC = when {
        rank >= 0.9 -> Palette.heatVeryHot
        rank >= 0.6 -> Palette.heatHot
        rank >= 0.3 -> Palette.heatWarm
        else -> Palette.textMuted
    }
    Box(Modifier.fillMaxWidth().height(IntrinsicSize.Min).peekAnchor(anchor).graphicsLayer { alpha = if (archived) 0.6f else 1f }) {
        // 未読が多いほど左の帯を濃くする。札を見なくても溜まり具合が分かるように
        if (visited) Box(
            Modifier.width(3.dp).fillMaxHeight().background(
                if (unread > 0) Palette.unread.copy(alpha = (0.35f + 0.65f * minOf(1f, kotlin.math.log10(unread + 1f) / 2.5f))) else Palette.threadReadTitle,
            ),
        )
        if (compact) {
            Row(
                Modifier.fillMaxWidth().combinedClickable(onLongClick = longClick, onClick = onClick).padding(start = 14.dp, end = 12.dp, top = pad / 2 + 2.dp, bottom = pad / 2 + 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    threadTitleText(t, isNew, isFavorite),
                    Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = (14 * k).sp, inlineContent = chipInlineContent(),
                    color = if (visited) Palette.threadReadTitle else Palette.textStrong, fontWeight = FontWeight.Normal,
                )
                Text(
                    "${t.postCount}", Modifier.widthIn(min = 36.dp), fontSize = (11 * k).sp, textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                    color = heatC,
                )
                if (unread > 0) Badge(badgeCount(unread), Palette.unread, Palette.unreadText, Modifier.padding(start = 6.dp))
            }
            return@Box
        }
        val thumb = rememberListThumb(t.thumb, thumbAllowed)
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Min).combinedClickable(onLongClick = longClick, onClick = onClick)
                .padding(start = 14.dp, end = 12.dp, top = if (thumb != null) 2.dp else pad, bottom = if (thumb != null) 2.dp else pad),
        ) {
        if (thumb != null) {
            StoredImage(thumb, Modifier.fillMaxHeight().heightIn(min = 64.dp).aspectRatio(1f, matchHeightConstraintsFirst = true).clip(RoundedCornerShape(6.dp)).background(Palette.surface2), showProgress = false)
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f).align(Alignment.CenterVertically).padding(vertical = if (thumb != null) (pad - 2.dp).coerceAtLeast(0.dp) else 0.dp)) {
            val titleColor = if (visited) Palette.threadReadTitle else Palette.textStrong
            Text(
                threadTitleText(t, isNew, isFavorite),
                maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = (15 * k).sp, lineHeight = (20 * k).sp, inlineContent = chipInlineContent(),
                // 開いたスレは新着があっても既読の色にする。新着は右の数の札で分かる
                color = titleColor, fontWeight = FontWeight.Normal,
            )
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(relativeTime(t.createdAt, now), color = Palette.textMuted, fontSize = (11 * k).sp, maxLines = 1)
                if (t.authorId != null) {
                    Spacer(Modifier.width(8.dp))
                    Text(t.authorId, Modifier.weight(1f, fill = false), color = Palette.textMuted, fontSize = (11 * k).sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (archived) { Spacer(Modifier.width(8.dp)); Text("dat 落ち", color = Palette.textMuted, fontSize = (11 * k).sp) }
                }
                // 勢い・レス数は幅をそろえ、数字の桁を縦にそろえる
                Text(
                    momentumText(momentum), Modifier.widthIn(min = 44.dp), fontSize = (11 * k).sp, fontFamily = FontFamily.Monospace,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                    color = heatC,
                )
                Text(
                    buildAnnotatedString { append("${t.postCount}"); withStyle(SpanStyle(fontSize = (10 * k).sp)) { append("レス") } },
                    Modifier.widthIn(min = 60.dp), color = Palette.textMuted, fontSize = (11 * k).sp, textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                )
                if (unread > 0) Box(Modifier.padding(start = 8.dp).badgeShape(Palette.unread), contentAlignment = Alignment.Center) {
                    androidx.compose.animation.AnimatedContent(
                        unread,
                        transitionSpec = {
                            if (Motion.reduced) androidx.compose.animation.EnterTransition.None togetherWith androidx.compose.animation.ExitTransition.None
                            else (androidx.compose.animation.slideInVertically { it } + androidx.compose.animation.fadeIn()) togetherWith (androidx.compose.animation.slideOutVertically { -it } + androidx.compose.animation.fadeOut())
                        },
                        contentAlignment = Alignment.Center, label = "unread",
                    ) { n ->
                        BadgeText(badgeCount(n), Palette.unreadText)
                    }
                }
            }
        }
        }
    }
}

/** スレ一覧に出すサムネイルの URL。取れなかった画像・取り消した画像は出さない(×の枠が並ばないように) */
@Composable
private fun rememberListThumb(thumb: String?, allowed: Boolean): String? {
    if (thumb == null) return null
    // 読み込みの進み具合では行を組み直さない
    val failed by remember(thumb) { androidx.compose.runtime.derivedStateOf { io.github.contentsview08.obb.data.ImageStore.stateOf(thumb).let { it is io.github.contentsview08.obb.data.ImageStore.State.Failed || it is io.github.contentsview08.obb.data.ImageStore.State.Canceled } } }
    return thumb.takeIf { allowed && !failed }
}


/** 検索の帯。ヘッダーと同じ高さ・同じ戻るボタンで、書き込み欄と同じ「帯の上の面の丸い枠」を置く */
@Composable
fun SearchBar(value: String, onChange: (String) -> Unit, placeholder: String, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    LaunchedEffect(Unit) { focus.requestFocus() }
    var focused by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = LocalPrefs.current.headerHeight.dp).padding(start = 4.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BarIcon(Icons.AutoMirrored.Filled.ArrowBack, "閉じる", onClick = onClose)
        Spacer(Modifier.width(4.dp))
        androidx.compose.foundation.text.BasicTextField(
            value, onChange,
            Modifier.weight(1f).focusRequester(focus).onFocusChanged { focused = it.isFocused },
            singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontSize = 15.sp),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { focusManager.clearFocus() }),
            decorationBox = { field ->
                val shape = RoundedCornerShape(20.dp)
                Row(
                    Modifier.height(minOf(40, LocalPrefs.current.headerHeight - 4).coerceAtLeast(28).dp).background(Palette.surface, shape)
                        .border(if (focused) 1.5.dp else 1.dp, if (focused) Palette.accent else Palette.border, shape)
                        .padding(start = 12.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Search, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) Text(placeholder, color = Palette.textMuted, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        field()
                    }
                    if (value.isNotEmpty()) ClearTextButton { onChange("") }
                }
            },
        )
    }
}

/**
 * 検索・絞り込みの欄の中の右に出す、文字を消す ×。文字が入っているときだけ置く。
 * PC・Web の components/ClearButton.tsx と同じ形・色(塗りの cancel・18dp・薄い文字の色、押せる所 32dp)。消しても欄は打ち続けられるまま
 */
@Composable
fun ClearTextButton(onClear: () -> Unit) {
    Box(Modifier.size(32.dp).clip(CircleShape).clickable(onClick = onClear), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Cancel, "消す", tint = Palette.textMuted, modifier = Modifier.size(18.dp))
    }
}

/** 立てた人のキーワードの帯・通知に出す名前(PC の utils/watch.ts の authorKeywordLabel と同じ) */
internal fun authorKeywordLabel(authorId: String) = "立てた人 $authorId"

/** スレ一覧の帯(キーワードのまとまりの頭)。PC の Band と同じ見た目 */
class ListBand(val label: String, val count: Int, val accent: Boolean)

/**
 * キーワードごとにスレをまとめる。先のキーワードに当たったスレは後のキーワードに数えない。
 * 当たりは検索と同じく全角半角・大文字小文字・カナとかなを同じに扱う(normalizeForSearch。PC と同じ)。
 * 戻りは (キーワード, スレ) の並びで、最後に (null, 残り)。並びは元の一覧の順。
 * 運営のお知らせはどのまとまりにも入れず、残りの最後に置く(一番下に回すので、キーワードの帯の下に並ばない)。
 * 立てた人のキーワード(authors)は、スレタイのキーワードの後に、authorId が同じスレを authorKeywordLabel の名前でまとめる(PC と同じ)
 */
internal fun keywordGroups(list: List<ThreadSummary>, keywords: List<String>, authors: List<String> = emptyList()): List<Pair<String?, List<ThreadSummary>>> {
    val (normal, notices) = list.partition { !it.announcement }
    val titles = normal.associate { it.key to normalizeForSearch(it.title) }
    val taken = HashSet<String>()
    val groups = ArrayList<Pair<String?, List<ThreadSummary>>>()
    for (k in keywords) {
        val nk = normalizeForSearch(k)
        if (nk.isEmpty()) continue
        val hits = normal.filter { it.key !in taken && titles.getValue(it.key).contains(nk) }
        hits.forEach { taken += it.key }
        if (hits.isNotEmpty()) groups += k to hits
    }
    for (a in authors) {
        if (a.isEmpty()) continue
        val hits = normal.filter { it.key !in taken && it.authorId == legacyAuthorId(a) }
        hits.forEach { taken += it.key }
        if (hits.isNotEmpty()) groups += authorKeywordLabel(a) to hits
    }
    groups += null to normal.filter { it.key !in taken } + notices
    return groups
}

@Composable
private fun KeywordBand(b: ListBand) {
    Row(
        Modifier.fillMaxWidth().background(if (b.accent) Palette.accentWash else Palette.surface2).padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (b.accent) Icons.Filled.Sell else Icons.AutoMirrored.Filled.List, null, Modifier.size(16.dp), tint = if (b.accent) Palette.accent else Palette.textMuted)
        Spacer(Modifier.width(6.dp))
        Text(b.label, color = if (b.accent) Palette.accent else Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text(b.count.toString(), color = if (b.accent) Palette.accent else Palette.textMuted, fontSize = 12.sp)
    }
}
