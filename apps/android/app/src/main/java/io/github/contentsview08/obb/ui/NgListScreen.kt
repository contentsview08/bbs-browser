package io.github.contentsview08.obb.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.data.NG_TARGETS
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.active
import io.github.contentsview08.obb.data.ngTargetName
import io.github.contentsview08.obb.data.today

/**
 * NG の一覧の画面(設定 → NG →「NG の一覧」)。設定の長い一覧に埋め込まず、スレ一覧のような 1 つの画面にする。
 * 上に NG のヘッダー(検索・足す・閉じる)、その下に種類のタブ(すべて・本文・名前・ID・スレタイ。左右になぞって隣へ)。
 * 一覧はページに分けず、効いていないもの(無効・期限切れ)は下にまとめる。
 * 行を長押しで選び、長押ししたまま上下になぞると範囲で選ぶ。選んでいる間は一覧を動かさず、ヘッダーに重ねて件数とまとめ操作を出す。
 * PC 版の NgManager(管理表)に当たる
 */
@Composable
fun NgListPage(vm: AppViewModel, onBack: () -> Unit) {
    val p = vm.prefs
    val today = today()
    val tabs = listOf("all" to "すべて") + NG_TARGETS
    var tabIdx by rememberSaveable { mutableIntStateOf(0) }
    val tabKey = tabs[tabIdx].first
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<NgRule?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<List<NgRule>?>(null) }
    // 選んでいる NG の id。消えた NG は数えない
    var picked by remember { mutableStateOf(setOf<String>()) }
    val selected = remember(picked, p.ngRules) { val ids = p.ngRules.mapTo(HashSet()) { it.id }; picked.filterTo(HashSet()) { it in ids } }
    val selecting = selected.isNotEmpty()
    BackHandler(enabled = selecting) { picked = emptySet() }
    BackHandler(enabled = searching && !selecting) { searching = false; query = "" }

    val q = query.trim()
    // 種類と検索で絞り、効いているものを先に(無効・期限切れは下に)、それぞれ新しい順
    val shown = remember(p.ngRules, tabKey, q, today) {
        p.ngRules.filter { (tabKey == "all" || it.target == tabKey) && (q.isEmpty() || it.pattern.contains(q, true) || (it.note ?: "").contains(q, true) || (it.boardName ?: "").contains(q, true)) }
            .asReversed().sortedByDescending { it.createdAt }
            .sortedBy { if (it.active(today)) 0 else 1 }
    }
    val pickedRules = p.ngRules.filter { it.id in selected }
    val allShown = shown.isNotEmpty() && shown.all { it.id in selected }
    // 「この板だけ」にできる板: 開いているスレの板、なければ開いているスレ一覧の板(設定の NG のページと同じ)
    val board = when (val pg = vm.stack.lastOrNull { it is Page.Thread || it is Page.Threads }) {
        is Page.Thread -> pg.summary.boardUrl to (vm.favorites.firstOrNull { it.url == pg.summary.boardUrl }?.name ?: pg.summary.boardUrl)
        is Page.Threads -> pg.board.url to pg.board.name
        else -> null
    }

    val listState = rememberLazyListState()
    val view = androidx.compose.ui.platform.LocalView.current
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        Box {
            Column {
                HeaderBar("NG", onNav = onBack, navIsBack = true) {
                    BarIcon(Icons.Filled.Search, "文字・メモ・板の名前で探す") { searching = true }
                    BarIcon(Icons.Filled.Add, "NG を足す") { adding = true }
                    BarIcon(Icons.Filled.Close, "設定を閉じる") { vm.closeSettings() }
                }
                // 種類のタブ(件数付き)。入りきらなければ横に動かせる
                Row(Modifier.fillMaxWidth().background(Palette.bar).horizontalScroll(rememberScrollState())) {
                    tabs.forEachIndexed { i, (k, label) ->
                        val on = i == tabIdx
                        val n = if (k == "all") p.ngRules.size else p.ngRules.count { it.target == k }
                        Box(Modifier.clickable(enabled = !on) { tabIdx = i }.background(if (on) Palette.accentWash else Color.Transparent).heightIn(min = PAST_TAB_HEIGHT.dp).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
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
            // 選んでいる間の帯はヘッダーとタブに重ねる(差し込むと一覧が下にずれて、なぞって選んでいる所が動く)
            if (selecting) Column(Modifier.matchParentSize().background(Palette.bar)) {
                Row(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    BarIcon(Icons.Filled.Close, "選ぶのをやめる") { picked = emptySet() }
                    Text("${selected.size} 件を選択中", Modifier.weight(1f), color = Palette.textStrong, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    TextButton(onClick = { picked = if (allShown) emptySet() else shown.mapTo(HashSet()) { it.id } }) { Text(if (allShown) "すべて外す" else "すべて選ぶ", color = Palette.textBody) }
                }
                Row(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { vm.setNgEnabledAll(pickedRules, true) }) { Text("有効にする", color = Palette.textBody) }
                    TextButton(onClick = { vm.setNgEnabledAll(pickedRules, false) }) { Text("無効にする", color = Palette.textBody) }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { confirmDelete = pickedRules }) {
                        Icon(Icons.Filled.Delete, null, tint = Palette.heatVeryHot, modifier = Modifier.size(18.dp))
                        Text("削除", color = Palette.heatVeryHot, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        if (searching) SearchBar(query, { query = it }, "文字・メモ・板の名前で探す") { searching = false; query = "" }
        Box(
            Modifier.weight(1f).fillMaxWidth()
                // 左右になぞると隣のタブへ(右へなぞると前、左へなぞると次)
                .pointerInput(tabs.size) {
                    var total = 0f
                    val need = 72.dp.toPx()
                    detectHorizontalDragGestures(
                        onDragStart = { total = 0f },
                        onDragEnd = {
                            if (total > need && tabIdx > 0) tabIdx--
                            else if (total < -need && tabIdx < tabs.lastIndex) tabIdx++
                        },
                    ) { _, dx -> total += dx }
                },
        ) {
            if (shown.isEmpty()) Hint(if (p.ngRules.isEmpty()) "NG はまだありません。レスやスレを長押しするか、右上の ＋ から足せます" else "当てはまる NG はありません")
            else {
                // 長押しで選び、そのまま上下になぞると範囲で選ぶ(長押しした行をはじめに、指の下の行までを足す)
                var anchor: Int? = null
                var base = setOf<String>()
                fun indexAt(y: Float): Int? = listState.layoutInfo.visibleItemsInfo.firstOrNull { y >= it.offset && y < it.offset + it.size }?.index?.takeIf { it < shown.size }
                LazyColumn(
                    Modifier.fillMaxSize().pointerInput(shown) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { pos ->
                                val i = indexAt(pos.y) ?: return@detectDragGesturesAfterLongPress
                                Haptics.longPress(view)
                                anchor = i
                                val id = shown[i].id
                                base = if (id in picked) picked - id else picked + id
                                picked = base
                            },
                            onDrag = { change, _ ->
                                val a = anchor ?: return@detectDragGesturesAfterLongPress
                                val i = indexAt(change.position.y) ?: return@detectDragGesturesAfterLongPress
                                picked = base + (minOf(a, i)..maxOf(a, i)).map { shown[it].id }
                            },
                            onDragEnd = { anchor = null },
                            onDragCancel = { anchor = null },
                        )
                    },
                    state = listState,
                ) {
                    items(shown, key = { it.id }) { r ->
                        NgListRow(
                            r, today, selected = r.id in selected, selecting = selecting,
                            onClick = { if (selecting) picked = if (r.id in selected) selected - r.id else selected + r.id else editing = r },
                            onEnabled = { vm.saveNg(r.copy(enabled = it)) },
                        )
                    }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
        HorizontalDivider(color = Palette.border)
        Row(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("全部で ${p.ngRules.size} 件(効いているもの ${p.ngRules.count { it.active(today) }} 件)", Modifier.weight(1f), color = Palette.textMuted, fontSize = 12.sp)
            if (p.ngRules.isNotEmpty()) TextButton(onClick = { confirmDelete = p.ngRules }) { Text("すべて削除…", color = Palette.heatVeryHot, fontSize = 13.sp) }
        }
    }

    if (adding) NgEditSheet(NgRule(if (tabKey == "all") "content" else tabKey, ""), board, isNew = true, onDismiss = { adding = false }) { vm.saveNg(it); adding = false }
    editing?.let { r -> NgEditSheet(r, board, isNew = false, onDismiss = { editing = null }, onDelete = { vm.removeNg(r); editing = null }) { vm.saveNg(it); editing = null } }
    confirmDelete?.let { rules ->
        val all = rules.size == p.ngRules.size
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text(if (all) "NG をすべて削除" else "NG を ${rules.size} 件削除") },
            text = { Text("${if (all) "NG を ${rules.size} 件すべて" else "選んだ NG を ${rules.size} 件"}消します。元には戻せません。同期している端末からも消えます。") },
            confirmButton = { TextButton(onClick = { vm.removeNgAll(rules); picked = emptySet(); confirmDelete = null }) { Text("削除", color = Palette.heatVeryHot) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("やめる") } },
        )
    }
}

/** NG の 1 行: 種類の札・文字・印(正規表現・板・期限・メモ)。右は有効のスイッチ(選んでいる間はチェック。幅を同じにして行がずれないように) */
@Composable
private fun NgListRow(r: NgRule, today: String, selected: Boolean, selecting: Boolean, onClick: () -> Unit, onEnabled: (Boolean) -> Unit) {
    val expired = r.expiresOnDate != null && r.expiresOnDate < today
    val marks = listOfNotNull(
        if (r.isRegex) "正規表現" else null, r.boardUrl?.let { "${r.boardName ?: "この板"}だけ" },
        r.expiresOnDate?.let { if (expired) "期限切れ" else "${it}まで" }, if (!r.enabled) "無効" else null, r.note,
    )
    Row(
        Modifier.fillMaxWidth().background(if (selected) Palette.accentWash else Color.Transparent).clickable(onClick = onClick)
            .graphicsLayer { alpha = if (r.active(today)) 1f else 0.6f }.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(ngTargetName(r.target), Modifier.background(Palette.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.textMuted, fontSize = 11.sp)
                Text(r.pattern, Modifier.padding(start = 8.dp), color = Palette.textBody, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontFamily = if (r.isRegex) FontFamily.Monospace else null)
            }
            if (marks.isNotEmpty()) Text(marks.joinToString(" ・ "), Modifier.padding(top = 2.dp), color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.width(60.dp), contentAlignment = Alignment.Center) {
            if (selecting) Checkbox(selected, null, colors = CheckboxDefaults.colors(checkedColor = Palette.accent))
            else Switch(r.enabled, onEnabled, colors = accentSwitchColors())
        }
    }
    HorizontalDivider(color = Palette.border)
}
