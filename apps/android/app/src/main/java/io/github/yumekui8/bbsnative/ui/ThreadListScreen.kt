package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.draw.clipToBounds
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
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import io.github.yumekui8.bbsnative.data.ThreadState
import kotlinx.coroutines.launch

/** 一覧の並び。どれも選ばなければサーバーの順(更新順) */
private enum class ListTab(val label: String, val icon: ImageVector, val color: Color) {
    UNREAD("未読", Icons.Filled.MarkEmailUnread, Palette.unread),
    MOMENTUM("勢い順", Icons.Filled.LocalFireDepartment, Palette.markHot),
    NEWEST("新しい順", Icons.Filled.Schedule, Palette.markLink),
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
    var tab by rememberSaveable { mutableStateOf<ListTab?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    val now = remember(page.threads) { System.currentTimeMillis() }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val bars = rememberHideOnScroll()
    val density = LocalDensity.current

    // 勢いの色は、板の中での順位で決める(過疎板でも一番勢いのあるスレは赤くなるように。今の専ブラと同じ)
    val rank = remember(page.threads) {
        val sorted = page.threads.map { it.key to momentum(it, now) }.sortedByDescending { it.second }
        sorted.mapIndexed { i, (k, _) -> k to (1.0 - i.toDouble() / maxOf(1, sorted.size)) }.toMap()
    }
    val ngTitles = vm.prefs.ngRules.filter { it.target == "title" }.map { it.pattern }
    val sort = vm.prefs.threadSort
    val keywords = vm.prefs.keywords.lines().map { it.trim() }.filter { it.isNotEmpty() }
    val shown = remember(page.threads, page.states, tab, query, ngTitles, sort, keywords) {
        // スレタイの NG に当たるスレは出さない
        var list = if (ngTitles.isEmpty()) page.threads else page.threads.filter { t -> ngTitles.none { t.title.contains(it, ignoreCase = true) } }
        if (query.isNotBlank()) list = list.filter { it.title.contains(query.trim(), ignoreCase = true) }
        list = when (tab) {
            // タブを選んでいないときは、設定の並び(板を開いたときの並び)
            null -> when (sort) {
                "momentum" -> list.sortedByDescending { momentum(it, now) }
                "newest" -> list.sortedByDescending { it.createdAt ?: 0 }
                "count" -> list.sortedByDescending { it.postCount }
                else -> list
            }
            ListTab.UNREAD -> list.filter { unreadOf(it, page.states) > 0 }
            ListTab.MOMENTUM -> list.sortedByDescending { momentum(it, now) }
            ListTab.NEWEST -> list.sortedByDescending { it.createdAt ?: 0 }
        }
        // キーワードの入ったスレは一番上にまとめる(設定)。運営のお知らせは一番下に
        if (keywords.isNotEmpty()) {
            val (hit, rest) = list.partition { t -> keywords.any { t.title.contains(it, ignoreCase = true) } }
            list = hit + rest
        }
        list.filterNot { it.announcement } + list.filter { it.announcement }
    }

    var menuFor by remember { mutableStateOf<ThreadSummary?>(null) }
    menuFor?.let { t -> ThreadMenu(vm, t, page.states[t.key] != null) { menuFor = null } }
    val swipe = rememberSwipeState()
    // なぞる操作(今のスマホ版の既定と同じ割り当て)
    val prefs = vm.prefs
    val gestures = if (!prefs.gesturesEnabled) emptyMap() else buildGestures(
        prefs.gestures("list"), "list",
        mapOf(
            "drawer" to { vm.drawerOpen = true },
            "forward" to { vm.forward() },
            "bottom" to { scope.launch { listState.scrollToItem(maxOf(0, shown.size - 1)) }; Unit },
            "top" to { scope.launch { listState.scrollToItem(0); bars.show() }; Unit },
            "refresh" to { vm.refreshBoard(page) },
            "newThread" to { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
            "search" to { searching = true; bars.show() },
        ),
    )
    bars.enabled = prefs.hideBarsOnScroll
    Box(modifier.fillMaxSize().background(Palette.base).clipToBounds().nestedScroll(bars.connection).swipeGestures(swipe, gestures, sensitivity = prefs.gestureSensitivity)) {
        // 引っぱって更新は設定で切れる(切ったら包まない)
        val pull: @Composable (@Composable () -> Unit) -> Unit = { body ->
            if (prefs.pullToRefreshList) PullToRefreshBox(isRefreshing = page.loading, onRefresh = { vm.refreshBoard(page) }, modifier = Modifier.fillMaxSize()) { body() }
            else Box(Modifier.fillMaxSize()) { body() }
        }
        pull {
            when {
                page.error != null && page.threads.isEmpty() -> Hint("読み込めませんでした: ${page.error}")
                page.threads.isEmpty() && page.loading -> Hint("読み込み中…")
                else -> LazyColumn(
                    Modifier.fillMaxSize(), state = listState,
                    contentPadding = PaddingValues(
                        top = with(density) { bars.topHeight.toDp() },
                        bottom = with(density) { bars.bottomHeight.toDp() } + 24.dp,
                    ),
                ) {
                    items(shown, key = { it.key }, contentType = { 0 }) { t ->
                        ThreadRow(t, page.states[t.key], momentum(t, now), rank[t.key] ?: 0.0, now, onLongClick = { menuFor = t }) { vm.openThread(t) }
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
                    page.board.name, onNav = { vm.drawerOpen = true },
                    leading = { Icon(Icons.Filled.Forum, null, tint = Palette.textMuted, modifier = Modifier.size(24.dp)) },
                ) {
                    BarIcon(Icons.Filled.Search, "探す") { searching = true }
                    MoreButton { menu = true }
                }
            }
            HorizontalDivider(color = Palette.border)
        }

        // 下の帯(並び順と更新)
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { bars.bottomHeight = it.height.toFloat() }
                .graphicsLayer { translationY = bars.hidden * bars.bottomHeight },
        ) {
            HorizontalDivider(color = Palette.border)
            Row(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding().heightIn(min = 60.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                for (t in ListTab.entries) {
                    val active = tab == t
                    Row(
                        Modifier.clickable { tab = if (active) null else t }.background(if (active) Palette.accentWash else Color.Transparent, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Icon(t.icon, null, tint = t.color, modifier = Modifier.size(18.dp))
                        Text(t.label, color = if (active) Palette.accent else Palette.textMuted, fontSize = 15.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
                    }
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { vm.refreshBoard(page) }, enabled = !page.loading) { Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted) }
            }
        }

        SwipeLabel(swipe)

        // スレを立てる(右下の丸いボタン)
        FloatingActionButton(
            onClick = { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
            containerColor = Palette.accent, contentColor = Color.White, shape = CircleShape,
            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 20.dp, bottom = 20.dp).navigationBarsPadding()
                .padding(bottom = with(density) { bars.bottomHeight.toDp() })
                .graphicsLayer { translationY = bars.hidden * bars.bottomHeight },
        ) { Icon(Icons.Filled.EditNote, "スレを立てる") }
    }

    if (menu) {
        val fav = vm.isFavorite(page.board)
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("スレを立てる", Icons.Filled.EditNote, Palette.markNew) { page.newThread.name = vm.prefs.postName; page.newThread.open = true },
                    MenuItem(if (fav) "お気に入り板から外す" else "お気に入り板に追加", if (fav) Icons.Filled.Star else Icons.Outlined.Star, Palette.markFav) { vm.toggleFavorite(page.board) },
                ),
                listOf(MenuItem("いちばん上へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } }),
            ),
        ) { menu = false }
    }
    NewThreadSheet(vm, page)
}

private fun unreadOf(t: ThreadSummary, states: Map<String, ThreadState>): Int {
    val s = states[t.key] ?: return 0
    return maxOf(0, t.postCount - s.readNo)
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ThreadRow(t: ThreadSummary, state: ThreadState?, momentum: Double, rank: Double, now: Long, onLongClick: () -> Unit, onClick: () -> Unit) {
    val unread = if (state == null) 0 else maxOf(0, t.postCount - state.readNo)
    Box(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
    // 読んだスレは左に線(新着があれば未読の色)。今のスマホ版と同じ
    if (state != null) Box(Modifier.width(3.dp).fillMaxHeight().background(if (unread > 0) Palette.unread else Palette.threadReadTitle))
    Column(Modifier.fillMaxWidth().combinedClickable(onLongClick = onLongClick, onClick = onClick).padding(start = 28.dp, end = 16.dp, top = 9.dp, bottom = 9.dp)) {
        Text(
            t.title, maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = 16.sp, lineHeight = 21.sp,
            // 読んだことがあって未読がないスレは、読んだ色に
            color = if (state != null && unread == 0) Palette.threadReadTitle.copy(alpha = 0.75f) else Palette.textStrong,
            fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal,
        )
        Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(relativeTime(t.createdAt, now), color = Palette.textMuted, fontSize = 12.sp)
            if (t.authorId != null) {
                Spacer(Modifier.width(8.dp))
                Text(t.authorId, color = Palette.textMuted, fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
            }
            Spacer(Modifier.weight(1f))
            Text(
                if (momentum >= 100) "%.0f".format(momentum) else "%.1f".format(momentum), fontSize = 12.sp, fontFamily = FontFamily.Monospace,
                color = when {
                    rank >= 0.9 -> Palette.heatVeryHot
                    rank >= 0.6 -> Palette.heatHot
                    rank >= 0.3 -> Palette.heatWarm
                    else -> Palette.textMuted
                },
            )
            Spacer(Modifier.width(10.dp))
            Text("${t.postCount}レス", color = Palette.textMuted, fontSize = 12.sp)
            if (unread > 0) {
                Spacer(Modifier.width(8.dp))
                Text(
                    "+$unread", Modifier.background(Palette.unread, RoundedCornerShape(10.dp)).padding(horizontal = 7.dp, vertical = 1.dp),
                    color = Palette.unreadText, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
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
            shape = RoundedCornerShape(12.dp),
        )
        if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Close, "消す", tint = Palette.textMuted) }
        Spacer(Modifier.width(4.dp))
    }
}
