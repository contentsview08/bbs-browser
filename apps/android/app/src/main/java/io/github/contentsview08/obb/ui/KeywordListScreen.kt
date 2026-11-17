package io.github.contentsview08.obb.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.data.KeywordRule
import kotlinx.coroutines.launch

/** キーワードの種類(タブと編集の板で同じ言葉) */
private val KEYWORD_KINDS = listOf("title" to "スレタイ", "author" to "立てた人")

/**
 * キーワードの一覧の画面(設定 → スレ一覧 →「キーワードの一覧」)。1 つのキーワード(言葉か正規表現、または立てた人の ID)が 1 つの帯。NG の一覧(NgListScreen)と同じ作り:
 * ヘッダー(検索・足す)、種類のタブ(すべて・スレタイ・立てた人。ページャーで横に流れる)、長押しで選び、なぞって範囲選択(端で自動スクロール)、
 * 選んでいる間はヘッダーに重ねて件数・有効・無効・削除。行を押すと編集。PC 版の設定「キーワード」の表に当たる
 */
@Composable
fun KeywordListPage(vm: AppViewModel, onBack: () -> Unit) {
    val p = vm.prefs
    val tabs = listOf("all" to "すべて") + KEYWORD_KINDS
    val pager = rememberPagerState(initialPage = 0) { tabs.size }
    val tabIdx = pager.currentPage
    val tabKey = tabs[tabIdx].first
    val scope = rememberCoroutineScope()
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<KeywordRule?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<List<KeywordRule>?>(null) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    val all = p.keywordRules
    val selected = remember(picked, all) { val ids = all.mapTo(HashSet()) { it.id }; picked.filterTo(HashSet()) { it in ids } }
    val selecting = selected.isNotEmpty()
    BackHandler(enabled = selecting) { picked = emptySet() }
    BackHandler(enabled = searching && !selecting) { searching = false; query = "" }
    val q = query.trim()
    // 種類と検索で絞り、効いているものを先に(無効は下に)
    fun shownFor(key: String): List<KeywordRule> =
        all.filter { (key == "all" || it.kind == key) && (q.isEmpty() || it.displayLabel().contains(q, true) || it.pattern.contains(q, true) || (it.boardName ?: "").contains(q, true)) }
            .sortedBy { if (it.enabled) 0 else 1 }
    val shown = remember(all, tabKey, q) { shownFor(tabKey) }
    val pickedRules = all.filter { it.id in selected }
    val allShown = shown.isNotEmpty() && shown.all { it.id in selected }
    val board = openBoardOf(vm)
    val favBoards = vm.favorites.map { it.url to it.name }

    Column(Modifier.fillMaxSize().background(Palette.base)) {
        Box {
            Column {
                HeaderBar("キーワード", onNav = onBack, navIsBack = true) {
                    BarIcon(Icons.Filled.Search, "名前・言葉・板の名前で探す") { searching = true }
                    BarIcon(Icons.Filled.Add, "キーワードを足す") { adding = true }
                    BarIcon(Icons.Filled.Close, "設定を閉じる") { vm.closeSettings() }
                }
                Row(Modifier.fillMaxWidth().background(Palette.bar).horizontalScroll(rememberScrollState())) {
                    tabs.forEachIndexed { i, (k, label) ->
                        val on = i == tabIdx
                        val n = if (k == "all") all.size else all.count { it.kind == k }
                        Box(
                            Modifier.clickable(enabled = !on) { scope.launch { pager.animateScrollToPage(i) } }
                                .background(if (on) Palette.accentWash else Color.Transparent).heightIn(min = PAST_TAB_HEIGHT.dp).padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(label, color = if (on) Palette.accent else Palette.textMuted, fontSize = 14.sp, maxLines = 1, softWrap = false)
                                if (n > 0) Text(badgeCount(n), color = Palette.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false)
                            }
                            if (on) Box(Modifier.matchParentSize()) { Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(2.dp).background(Palette.accent, RoundedCornerShape(1.dp))) }
                        }
                    }
                }
                HorizontalDivider(color = Palette.border)
            }
            if (selecting) Column(Modifier.matchParentSize().background(Palette.bar)) {
                Row(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    BarIcon(Icons.Filled.Close, "選ぶのをやめる") { picked = emptySet() }
                    Text("${selected.size} 件を選択中", Modifier.weight(1f), color = Palette.textStrong, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    TextButton(onClick = { picked = if (allShown) selected - shown.mapTo(HashSet()) { it.id } else selected + shown.map { it.id } }) { Text(if (allShown) "すべて外す" else "すべて選ぶ", color = Palette.textBody) }
                }
                Row(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { p.updateKeywordRules(pickedRules.map { it.copy(enabled = true) }) }) { Text("有効にする", color = Palette.textBody) }
                    TextButton(onClick = { p.updateKeywordRules(pickedRules.map { it.copy(enabled = false) }) }) { Text("無効にする", color = Palette.textBody) }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { confirmDelete = pickedRules }) {
                        Icon(Icons.Filled.Delete, null, tint = Palette.heatVeryHot, modifier = Modifier.size(18.dp))
                        Text("削除", color = Palette.heatVeryHot, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        if (searching) SearchBar(query, { query = it }, "名前・言葉・板の名前で探す") { searching = false; query = "" }
        HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth(), beyondViewportPageCount = 0) { pageIdx ->
            val key = tabs[pageIdx].first
            val rules = remember(all, key, q) { shownFor(key) }
            if (rules.isEmpty()) Hint(if (all.isEmpty()) "キーワードはまだありません。スレを長押しするか、右上の ＋ から足せます" else "当てはまるキーワードはありません")
            else KeywordTabList(rules, selected, selecting, onPicked = { picked = it }, onEdit = { editing = it }, onEnabled = { r, on -> p.upsertKeywordRule(r.copy(enabled = on)) })
        }
        HorizontalDivider(color = Palette.border)
        Row(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("全部で ${all.size} 件(効いているもの ${all.count { it.enabled }} 件)", Modifier.weight(1f), color = Palette.textMuted, fontSize = 12.sp)
            if (all.isNotEmpty()) TextButton(onClick = { confirmDelete = all }) { Text("すべて削除…", color = Palette.heatVeryHot, fontSize = 13.sp) }
        }
    }

    if (adding) KeywordEditSheet(KeywordRule(kind = if (tabKey == "author") "author" else "title"), board, favBoards, isNew = true, onDismiss = { adding = false }) { p.upsertKeywordRule(it); adding = false }
    editing?.let { r -> KeywordEditSheet(r, board, favBoards, isNew = false, onDismiss = { editing = null }, onDelete = { p.removeKeywordRules(setOf(r.id)); editing = null }) { p.upsertKeywordRule(it); editing = null } }
    confirmDelete?.let { rules ->
        val whole = rules.size == all.size
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text(if (whole) "キーワードをすべて削除" else "キーワードを ${rules.size} 件削除") },
            text = { Text("${if (whole) "キーワードを ${rules.size} 件すべて" else "選んだキーワードを ${rules.size} 件"}消します。元には戻せません。同期している端末からも消えます。") },
            confirmButton = { TextButton(onClick = { p.removeKeywordRules(rules.mapTo(HashSet()) { it.id }); picked = emptySet(); confirmDelete = null }) { Text("削除", color = Palette.heatVeryHot) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("やめる") } },
        )
    }
}

/** 「この板だけ」にできる板: 開いているスレの板、なければ開いているスレ一覧の板 */
internal fun openBoardOf(vm: AppViewModel): Pair<String, String>? = when (val pg = vm.stack.lastOrNull { it is Page.Thread || it is Page.Threads }) {
    is Page.Thread -> pg.summary.boardUrl to (vm.favorites.firstOrNull { it.url == pg.summary.boardUrl }?.name ?: pg.summary.boardUrl)
    is Page.Threads -> pg.board.url to pg.board.name
    else -> null
}

private const val EDGE_DP = 72f
private const val EDGE_MAX_PX_PER_FRAME = 28f

/** 1 つのタブの一覧(NG の一覧と同じ長押し・なぞりの範囲選択と、端での自動スクロール) */
@Composable
private fun KeywordTabList(
    rules: List<KeywordRule>, selected: Set<String>, selecting: Boolean,
    onPicked: (Set<String>) -> Unit, onEdit: (KeywordRule) -> Unit, onEnabled: (KeywordRule, Boolean) -> Unit,
) {
    val listState = rememberLazyListState()
    val view = androidx.compose.ui.platform.LocalView.current
    val selectedNow by rememberUpdatedState(selected)
    var heightPx by remember { mutableStateOf(0) }
    var fingerY by remember { mutableFloatStateOf(-1f) }
    var autoScroll by remember { mutableFloatStateOf(0f) }
    var anchor by remember { mutableStateOf<Int?>(null) }
    var base by remember { mutableStateOf(setOf<String>()) }
    var ignoreClickUntil by remember { mutableStateOf(0L) }
    fun indexAt(y: Float): Int? = listState.layoutInfo.visibleItemsInfo.firstOrNull { y >= it.offset && y < it.offset + it.size }?.index?.takeIf { it < rules.size }
    fun extendTo(i: Int) { val a = anchor ?: return; onPicked(base + (minOf(a, i)..maxOf(a, i)).map { rules[it].id }) }
    fun updateAutoScroll() {
        val edge = EDGE_DP * view.resources.displayMetrics.density
        val y = fingerY
        autoScroll = when {
            y < 0 || heightPx == 0 || anchor == null -> 0f
            y < edge -> -EDGE_MAX_PX_PER_FRAME * ((edge - y) / edge).coerceIn(0.15f, 1f)
            y > heightPx - edge -> EDGE_MAX_PX_PER_FRAME * ((y - (heightPx - edge)) / edge).coerceIn(0.15f, 1f)
            else -> 0f
        }
    }
    LaunchedEffect(autoScroll) {
        while (autoScroll != 0f) {
            listState.scrollBy(autoScroll)
            indexAt(fingerY)?.let { extendTo(it) }
            withFrameNanos { }
        }
    }
    LazyColumn(
        Modifier.fillMaxSize().onSizeChanged { heightPx = it.height }.pointerInput(rules) {
            detectDragGesturesAfterLongPress(
                onDragStart = { pos ->
                    val i = indexAt(pos.y) ?: return@detectDragGesturesAfterLongPress
                    Haptics.longPress(view)
                    anchor = i
                    val id = rules[i].id
                    base = if (id in selectedNow) selectedNow - id else selectedNow + id
                    onPicked(base)
                    fingerY = pos.y
                },
                onDrag = { change, _ ->
                    if (anchor == null) return@detectDragGesturesAfterLongPress
                    fingerY = change.position.y
                    indexAt(fingerY)?.let { extendTo(it) }
                    updateAutoScroll()
                },
                onDragEnd = { anchor = null; fingerY = -1f; autoScroll = 0f; ignoreClickUntil = System.currentTimeMillis() + 400 },
                onDragCancel = { anchor = null; fingerY = -1f; autoScroll = 0f; ignoreClickUntil = System.currentTimeMillis() + 400 },
            )
        },
        state = listState,
    ) {
        items(rules, key = { it.id }) { r ->
            val on = r.id in selected
            val marks = listOfNotNull(if (r.isRegex) "正規表現" else null, r.boardUrl?.let { "${r.boardName ?: "この板"}だけ" }, if (!r.enabled) "無効" else null)
            Row(
                Modifier.fillMaxWidth().background(if (on) Palette.accentWash else Color.Transparent)
                    .clickable {
                        if (anchor != null || System.currentTimeMillis() < ignoreClickUntil) return@clickable
                        if (selecting) onPicked(if (on) selected - r.id else selected + r.id) else onEdit(r)
                    }
                    .graphicsLayer { alpha = if (r.enabled) 1f else 0.6f }.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(KEYWORD_KINDS.firstOrNull { it.first == r.kind }?.second ?: r.kind, Modifier.background(Palette.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.textMuted, fontSize = 11.sp)
                        Text(r.displayLabel(), Modifier.padding(start = 8.dp), color = Palette.textBody, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    // 別名を付けているときは言葉(正規表現)そのものも、板限定・無効の印も
                    val sub = listOfNotNull(if (r.label.isNotBlank()) r.pattern else null) + marks
                    if (sub.isNotEmpty()) Text(sub.joinToString(" ・ "), Modifier.padding(top = 2.dp), color = Palette.textMuted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.width(60.dp).height(40.dp), contentAlignment = Alignment.Center) {
                    if (selecting) Icon(if (on) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, if (on) "選んでいる" else "選んでいない", Modifier.size(24.dp), tint = if (on) Palette.accent else Palette.textMuted)
                    else Switch(r.enabled, { onEnabled(r, it) }, colors = accentSwitchColors())
                }
            }
            HorizontalDivider(color = Palette.border)
        }
        item { Spacer(Modifier.navigationBarsPadding()) }
    }
}

/**
 * キーワード 1 つの編集(下から出る板。NG の NgEditSheet と同じ形):
 * 有効・種類(スレタイの言葉 / 立てた人の ID)・言葉(正規表現も)・別名(帯に出す名前。正規表現が長くて読めないときに)・効く板
 */
@Composable
fun KeywordEditSheet(
    initial: KeywordRule, board: Pair<String, String>?, boards: List<Pair<String, String>>, isNew: Boolean,
    onDismiss: () -> Unit, onDelete: (() -> Unit)? = null, onSave: (KeywordRule) -> Unit,
) {
    var r by remember { mutableStateOf(initial) }
    val err = if (!r.isRegex || r.isAuthor || r.pattern.isBlank()) null else io.github.contentsview08.obb.data.ngPatternError(r.pattern.trim(), true)
    val boardOptions = remember(board, boards, r.boardUrl) {
        val list = ArrayList<Pair<String, String>>()
        if (board != null) list += board
        for (b in boards) if (list.none { it.first == b.first }) list += b
        r.boardUrl?.let { u -> if (list.none { it.first == u }) list += u to (r.boardName ?: u) }
        list
    }
    fun boardLabel(url: String, name: String) = if (board != null && url == board.first) "$name(開いている板)" else name
    FullWindow(onDismiss = onDismiss) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)).clickable(remember { MutableInteractionSource() }, null) { onDismiss() }, contentAlignment = Alignment.BottomCenter) {
            val shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(Palette.surface).clickable(remember { MutableInteractionSource() }, null) {}.navigationBarsPadding().imePadding()) {
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(Palette.borderStrong))
                }
                Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 12.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (isNew) "キーワードを足す" else "キーワードを直す", Modifier.weight(1f), color = Palette.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Text("有効", color = Palette.textBody, fontSize = 14.sp)
                    Spacer(Modifier.width(8.dp))
                    Switch(r.enabled, { r = r.copy(enabled = it) }, colors = accentSwitchColors())
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PickerRow("種類", KEYWORD_KINDS.firstOrNull { it.first == r.kind }?.second ?: r.kind, KEYWORD_KINDS.map { (k, name) -> name to { r = r.copy(kind = k) } })
                    OutlinedTextField(
                        r.pattern, { r = r.copy(pattern = it) }, Modifier.fillMaxWidth(), singleLine = true, isError = err != null,
                        label = { Text(if (r.isAuthor) "立てた人の ID" else if (r.isRegex) "正規表現" else "言葉") },
                        placeholder = { Text(if (r.isAuthor) "ID の文字" else if (r.isRegex) "例: 絵|絵画|イラスト" else "例: 実況") },
                        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = if (r.isRegex && !r.isAuthor) androidx.compose.ui.text.font.FontFamily.Monospace else null),
                        supportingText = {
                            Text(
                                err ?: if (r.isAuthor) "この人が立てたスレをまとめます。スレの長押し →「立てた人で登録」でも足せます"
                                else if (r.isRegex) "正規表現で当てます(NG と同じ書き方。大文字と小文字は区別します。先頭に (?i) と書くと区別しません)"
                                else "スレタイにこの言葉を含むスレをまとめます(全角半角・大文字小文字・カナかなは同じ扱い)",
                            )
                        },
                    )
                    if (!r.isAuthor) Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("正規表現", Modifier.weight(1f), color = Palette.textBody, fontSize = 14.sp)
                        Switch(r.isRegex, { r = r.copy(isRegex = it) }, colors = accentSwitchColors())
                    }
                    OutlinedTextField(
                        r.label, { r = r.copy(label = it) }, Modifier.fillMaxWidth(), singleLine = true,
                        label = { Text("別名(帯に出す名前。空なら言葉そのもの)") },
                        placeholder = { Text(if (r.isRegex) "例: お絵描き(長い正規表現の代わりに)" else "例: お絵描き") },
                    )
                    PickerRow(
                        "効く板", r.boardUrl?.let { u -> boardOptions.firstOrNull { it.first == u }?.let { boardLabel(it.first, it.second) } ?: u } ?: "すべての板",
                        listOf<Pair<String, () -> Unit>>("すべての板" to { r = r.copy(boardUrl = null, boardName = null) }) +
                            boardOptions.map { (url, name) -> boardLabel(url, name) to { r = r.copy(boardUrl = url, boardName = name) } },
                    )
                }
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (onDelete != null) TextButton(onClick = onDelete) { Text("削除", color = Palette.markDanger, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.weight(1f))
                    val ok = r.pattern.isNotBlank() && err == null
                    Text(
                        if (isNew) "足す" else "直す",
                        Modifier.clip(RoundedCornerShape(8.dp)).background(Palette.accent).graphicsLayer { alpha = if (ok) 1f else 0.5f }
                            .clickable(enabled = ok) { onSave(r.copy(label = r.label.trim(), pattern = r.pattern.trim(), isRegex = r.isRegex && !r.isAuthor)) }.padding(horizontal = 24.dp, vertical = 10.dp),
                        color = Palette.accentText, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}
