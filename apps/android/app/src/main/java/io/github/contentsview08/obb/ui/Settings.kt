package io.github.contentsview08.obb.ui

import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.material.icons.filled.Delete
import io.github.contentsview08.obb.data.active
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.ColorLens
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Swipe
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.TravelExplore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.ThumbMode

/** 設定の画面(今のスマホ版の MobileSettings と同じ組み立て: 入口の一覧から、項目ごとの画面へ進む) */
private val TITLES = mapOf(
    "theme" to "テーマと色", "text" to "文字と余白", "list" to "スレ一覧", "thread" to "スレ表示", "media" to "画像と動画",
    "write" to "書き込み", "gestures" to "ジェスチャー", "behavior" to "スクロールと更新", "notify" to "通知", "ng" to "NG",
    "sites" to "お気に入り板", "menus" to "BBS メニュー", "accounts" to "サイトごとの設定", "backup" to "バックアップ", "about" to "このアプリについて", "custom" to "自分の配色",
)

/** 詳しい設定も出すか(設定の「詳しい設定を出す」か、検索から開いたとき) */
private val LocalAdvanced = androidx.compose.runtime.compositionLocalOf { false }

@Composable
fun SettingsScreen(vm: AppViewModel, start: String? = null) {
    var sub by rememberSaveable { mutableStateOf(start) }
    // 検索から開いたページは、探した項目が隠れないよう詳しい設定も出す
    var viaSearch by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = sub != null) { sub = null; viaSearch = false }
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        if (sub == null) HeaderBar("設定", onNav = { vm.drawerOpen = true })
        else HeaderBar(TITLES[sub] ?: "", onNav = { sub = null; viaSearch = false }, navIsBack = true)
        HorizontalDivider(color = Palette.border)
        // テーマと色のページは、今の配色の見本を上に止めておく(下で選ぶと、その場で変わる)
        if (sub == "theme") {
            SchemePreview(Palette.scheme, Palette.own, Palette.accent, Palette.accentText)
            HorizontalDivider(color = Palette.border)
        }
        androidx.compose.runtime.CompositionLocalProvider(LocalAdvanced provides (vm.prefs.showAdvanced || viaSearch)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp).navigationBarsPadding()) {
            when (sub) {
                null -> SettingsTop(vm, { sub = it; viaSearch = true }) { sub = it }
                "theme" -> ThemePage(vm) { sub = it }
                "text" -> TextPage(vm)
                "list" -> ListPage(vm)
                "thread" -> ThreadPage(vm)
                "media" -> MediaPage(vm)
                "write" -> WritePage(vm)
                "gestures" -> GesturesPage(vm)
                "behavior" -> BehaviorPage(vm)
                "notify" -> NotifyPage(vm)
                "ng" -> NgPage(vm)
                "sites" -> SitesPage(vm, menus = false)
                "menus" -> SitesPage(vm, menus = true)
                "accounts" -> AccountsPage(vm)
                "backup" -> BackupPage(vm)
                "about" -> AboutPage(vm)
                "custom" -> CustomSchemeEditor(vm.prefs)
            }
            // 詳しい項目を隠しているときは、ページの下に出し方を書いておく(押すとその場で出す)
            if (sub != null && sub !in setOf("about", "backup", "custom", "sites", "menus", "accounts") && !(vm.prefs.showAdvanced || viaSearch)) {
                Text(
                    "詳しい設定も出す",
                    Modifier.padding(16.dp).clip(RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp))
                        .clickable { vm.prefs.showAdvanced = true }.padding(horizontal = 14.dp, vertical = 8.dp),
                    color = Palette.accent, fontSize = 14.sp,
                )
            }
        }
        }
    }
}

@Composable
private fun SettingsTop(vm: AppViewModel, openFromSearch: (String) -> Unit, open: (String) -> Unit) {
    val p = vm.prefs
    // 設定の検索(項目の名前と説明から探し、押すとその項目のあるページを開く)
    var q by rememberSaveable { mutableStateOf("") }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp).background(Palette.surface2, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            if (q.isEmpty()) Text("設定を探す", color = Palette.textMuted, fontSize = 15.sp)
            androidx.compose.foundation.text.BasicTextField(
                q, { q = it }, Modifier.fillMaxWidth(), singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontSize = 15.sp),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
            )
        }
        if (q.isNotEmpty()) Icon(Icons.Filled.Close, "消す", tint = Palette.textMuted, modifier = Modifier.size(20.dp).clickable { q = "" })
    }
    val words = q.trim().split(Regex("[\\s　]+")).filter { it.isNotEmpty() }
    if (words.isNotEmpty()) {
        val hits = SETTINGS_INDEX.filter { (k, label, desc) -> words.all { w -> label.contains(w, true) || desc.contains(w, true) || (TITLES[k] ?: "").contains(w, true) } }
        Group(if (hits.isEmpty()) "見つかりませんでした" else "${hits.size} 件") {
            for ((k, label, desc) in hits) {
                Column(Modifier.fillMaxWidth().clickable { openFromSearch(k) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(label, color = Palette.textStrong, fontSize = 15.sp)
                    Text(listOfNotNull(TITLES[k], desc.ifEmpty { null }).joinToString(" ・ "), color = Palette.textMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        return
    }
    Group("見た目") {
        NavRow(Icons.Filled.ColorLens, Color(0xFF8B5CF6), "テーマと色", value = if (p.followSystem) "スマホに合わせる" else schemeOf(p.scheme).name) { open("theme") }
        NavRow(Icons.Filled.FormatSize, Color(0xFF6366F1), "文字と余白", value = "${(p.fontScale * 100).toInt()}%") { open("text") }
    }
    Group("画面") {
        NavRow(Icons.AutoMirrored.Filled.ViewList, Color(0xFF0EA5E9), "スレ一覧", desc = "並び順・キーワード・ログ") { open("list") }
        NavRow(Icons.Filled.Forum, Color(0xFF3B82F6), "スレ表示", desc = "開いたときの位置・本文・リンク") { open("thread") }
        NavRow(Icons.Filled.Image, Color(0xFF06B6D4), "画像と動画", desc = "サムネイル・読み込み・グロ注意") { open("media") }
    }
    Group("書き込み") {
        NavRow(Icons.Filled.Edit, Color(0xFFF59E0B), "書き込み", desc = "名前・定型文・画像のアップロード") { open("write") }
    }
    Group("操作") {
        NavRow(Icons.Filled.Swipe, Color(0xFFEC4899), "ジェスチャー", desc = "なぞって操作する形") { open("gestures") }
        NavRow(Icons.Filled.Sync, Color(0xFF10B981), "スクロールと更新", desc = "自動更新・閲覧履歴の新着の確認") { open("behavior") }
        NavRow(Icons.Filled.Notifications, Color(0xFFF43F5E), "通知", desc = "OS の通知・知らせる種類") { open("notify") }
    }
    Group("NG") {
        NavRow(Icons.Filled.Block, Color(0xFFEF4444), "NG", value = "${p.ngRules.size} 件") { open("ng") }
    }
    Group("板") {
        NavRow(Icons.Filled.Star, Color(0xFF14B8A6), "お気に入り板", value = "${vm.favorites.size} 板") { open("sites") }
        NavRow(Icons.Filled.Dns, Color(0xFF0E7490), "BBS メニュー", desc = "板一覧を取る掲示板") { vm.reloadSites(); open("menus") }
        NavRow(Icons.Filled.TravelExplore, Color(0xFF0891B2), "板を探す", desc = "BBS メニューから板を選ぶ") { vm.openRoot(Page.Boards()) }
        NavRow(Icons.Filled.AccountCircle, Color(0xFF7C3AED), "サイトごとの設定", desc = "アカウント(hono-bbs のユーザー ID とパスワード)", value = if (p.honoUser.isNotEmpty()) "登録済み" else null) { open("accounts") }
    }
    Group {
        SwitchRow("詳しい設定を出す", p.showAdvanced, desc = "オフのときは、よく使う項目だけを出します(検索ではいつも全部から探せます)") { p.showAdvanced = it }
        NavRow(Icons.Filled.Backup, Color(0xFF64748B), "バックアップ") { open("backup") }
        NavRow(Icons.Filled.Info, Color(0xFF6B7280), "このアプリについて") { open("about") }
    }
}

// ── 項目ごとの画面 ──

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThemePage(vm: AppViewModel, open: (String) -> Unit) {
    val p = vm.prefs
    Group {
        SwitchRow("スマホのダーク・ライトに合わせる", p.followSystem, desc = "オンにすると、スマホの設定で配色が切り替わります") { p.followSystem = it }
        if (LocalAdvanced.current) SwitchRow("動きを減らす", p.reduceMotion, desc = "画面の移り方・新着の光り方・数字の繰り上がりを省きます。スマホの「アニメーションを削除」がオンでも同じになります") { p.reduceMotion = it }
    }
    Group("レスの見た目") {
        ChoiceRow(
            "見た目", p.postStyle,
            POST_STYLES,
        ) { p.postStyle = it }
        SamplePosts(vm)
    }
    if (LocalAdvanced.current) Group("自分の配色", note = "地・面・字・強調・未読・自分の 6 色を選んで、配色を作れます。見本とコントラストの判定を見ながら決められます") {
        NavRow(Icons.Filled.ColorLens, Color(0xFF8B5CF6), if (p.customScheme.isEmpty()) "自分の配色を作る" else "自分の配色を直す") { open("custom") }
    }
    Group("差し色", note = "ボタン・選んだ印・タブの下線などの色。どのテーマの上でも読める濃さにしてあります") {
        ChoiceRow("差し色", p.accent, listOf("" to "テーマの色") + ACCENTS.map { it.key to it.name }) { p.accent = it }
    }
    if (!p.followSystem) {
        Group("配色") { SchemeGrid(p.scheme) { p.scheme = it } }
    } else {
        Group("ダークのとき") { SchemeGrid(p.darkScheme, dark = true) { p.darkScheme = it } }
        Group("ライトのとき") { SchemeGrid(p.lightScheme, dark = false) { p.lightScheme = it } }
    }
}

/** 配色の見本を並べて選ぶ。dark を渡すと、その明るさの配色だけ */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SchemeGrid(selected: String, dark: Boolean? = null, onPick: (String) -> Unit) {
    FlowRow(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (s in allSchemes().filter { dark == null || it.dark == dark }) {
            val on = s.key == selected
            Column(
                Modifier.width(100.dp).clip(RoundedCornerShape(6.dp)).border(if (on) 2.dp else 1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(6.dp))
                    .clickable { onPick(s.key) },
            ) {
                // 見本: 背景・面・強調色・未読の色
                Box(Modifier.fillMaxWidth().height(56.dp).background(s.base).padding(8.dp)) {
                    Column(Modifier.fillMaxWidth().background(s.surface2, RoundedCornerShape(4.dp)).padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Box(Modifier.width(48.dp).height(5.dp).background(s.textStrong, RoundedCornerShape(3.dp)))
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Box(Modifier.size(10.dp).background(s.accent, CircleShape))
                            Box(Modifier.size(10.dp).background(s.unread, CircleShape))
                            Box(Modifier.size(10.dp).background(s.heatVeryHot, CircleShape))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().background(Palette.surface).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(s.name, Modifier.weight(1f), color = Palette.textStrong, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (on) Icon(Icons.Filled.Check, null, tint = Palette.accent, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
private fun TextPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("字", note = "端末の標準以外は、選んだときに Google Fonts から 1 回だけ取ります(Wi-Fi のときがおすすめ)") {
        val context = androidx.compose.ui.platform.LocalContext.current
        val f = io.github.contentsview08.obb.data.Fonts
        ChoiceRow(
            "字", p.font,
            listOf("" to "端末の標準") + f.CHOICES.map { it.key to "${it.name}${if (f.isDownloaded(context, it.key)) "" else "(${it.desc.substringAfter('(').trimEnd(')')})"}" },
        ) { p.font = it }
        f.loading?.let { InfoRow("字を取っています", f.CHOICES.firstOrNull { c -> c.key == it }?.name ?: "") }
        f.error?.let { InfoRow("うまくいきませんでした", it) }
        if (f.CHOICES.any { it.key != p.font && f.isDownloaded(context, it.key) }) ActionRow("使っていない字を消す") { f.deleteUnused(context, p.font) }
    }
    Group("文字の大きさ") {
        SliderRow("画面全体", p.fontScale, 0.85f..1.3f, steps = 8, label = "${(p.fontScale * 100).toInt()}%") { p.fontScale = (it * 20).toInt() / 20f }
        SliderRow("レスの本文", p.bodyScale, 0.8f..1.4f, steps = 11, label = "${(p.bodyScale * 100).toInt()}%") { p.bodyScale = (it * 20).toInt() / 20f }
        if (LocalAdvanced.current) SliderRow("レスの本文の行間", p.lineHeight, 1.2f..1.9f, steps = 13, label = "%.2f".format(p.lineHeight)) { p.lineHeight = (it * 20).toInt() / 20f }
    }
    Group("見本") { SamplePosts(vm) }
}

@Composable
private fun ListPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("並び") {
        ChoiceRow(
            "板を開いたときの並び", p.threadSort,
            listOf("subject" to "更新順(掲示板の並び)", "momentum" to "勢い順", "newest" to "新しい順", "count" to "レス数順"),
        ) { p.threadSort = it }
    }
    if (LocalAdvanced.current) Group("行の見た目") {
        ChoiceRow("行の形", p.listDensity, listOf("normal" to "ふつう", "compact" to "コンパクト(スレタイ 1 行と数だけ)")) { p.listDensity = it }
    }
    if (LocalAdvanced.current) Group("タブ", note = "一覧の下に出すタブ。≡ を掴んで並べ替え、スイッチで出す・出さないを決めます(上が左)") {
        val all = listOf("unread" to "未読", "visited" to "閲覧済み", "momentum" to "勢い順", "newest" to "新しい順", "count" to "レス数順")
        val on = p.listTabs.split(',').filter { it.isNotEmpty() }
        @Composable fun TabRow(k: String, name: String, shown: Boolean, handle: Modifier?) =
            Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, Modifier.weight(1f), color = if (shown) Palette.textStrong else Palette.textMuted, fontSize = 15.sp)
                Switch(shown, { v -> p.listTabs = (if (v) on + k else on - k).joinToString(",") }, Modifier.padding(end = 4.dp), colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
                if (handle != null) DragHandleIcon(handle) else Spacer(Modifier.size(46.dp))
            }
        // 出しているものは掴んで並べ替える。出していないものは後ろに(並びはない)
        ReorderableColumn(on, { it }, { from, to -> p.listTabs = p.listTabs.split(',').filter { it.isNotEmpty() }.toMutableList().apply { add(to, removeAt(from)) }.joinToString(",") }) { k, handle, _ ->
            TabRow(k, all.firstOrNull { it.first == k }?.second ?: k, true, handle)
        }
        for ((k, name) in all.filter { it.first !in on }) TabRow(k, name, false, null)
    }
    Group("キーワード", note = "スレタイにこの言葉が入っているスレを、一覧のいちばん上にまとめて出します") {
        EditableWordList(p.keywords, "キーワード", "キーワードを足す", "まだありません", sortable = true) { p.keywords = it }
    }
    if (LocalAdvanced.current) Group("閲覧履歴(ログ)", note = "この日数より長く開いていないスレのログ(閲覧履歴とレス)を消します。0 なら消しません。お気に入りのスレ・自分が書き込んだスレは消しません。消したスレは、もう一度開けば取り直します") {
        NumberRow("残す日数", p.logRetentionDays, unit = "日", range = 0..3650, zeroLabel = "消さない", presets = listOf(7, 30, 90, 365, 0)) { p.logRetentionDays = it }
        ActionRow("今すぐ消す") { vm.pruneLogsNow() }
    }
}

@Composable
private fun ThreadPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("見本", note = "変えるとすぐ映ります") { SamplePosts(vm) }
    Group("開いたとき") {
        ChoiceRow("開く位置", p.openPosition, listOf("unread" to "最初の未読", "top" to "先頭", "bottom" to "いちばん下")) { p.openPosition = it }
    }
    Group("本文") {
        SwitchRow("名無しの名前を省く", p.omitNoname, desc = "そのスレで一番多い名前と、板の既定の名前(「名無しさん」など)を出しません") { p.omitNoname = it }
        if (LocalAdvanced.current) SwitchRow("空行を整える", p.tidyBlankLines, desc = "3 行以上続いた空行を 1 行にまとめます") { p.tidyBlankLines = it }
        SwitchRow("スレ主に「主」の印", p.highlightOp, desc = ">>1 と同じ ID のレス") { p.highlightOp = it }
        ChoiceRow(
            "日時の出し方", p.dateStyle,
            listOf("md_w_hms" to "月日・曜日・時刻(11/02(月) 19:01:15)", "md_hm" to "月日と時分(11/02 19:01)", "full" to "すべて(年・秒の下の桁まで)"),
        ) { p.dateStyle = it }
        SwitchRow("ID を短く出す", p.idShort, desc = "先頭の 6 文字だけにして「ID:」も省きます(数えるのと色は ID 全体で)") { p.idShort = it }
        SwitchRow("ID ごとに色を付ける", p.idStyle == "color", desc = "2 回以上書いた ID を、ID ごとの色で。同じ人の書き込みを目で追えます") { p.idStyle = if (it) "color" else "none" }
        ChoiceRow("ID の位置", p.idPosition, listOf("header" to "日時の後ろ", "topRight" to "レスの右上", "bottomRight" to "レスの右下")) { p.idPosition = it }
        SwitchRow("名前欄を目立たなくする", p.nameSubtle, desc = "名前とワッチョイを、日付や ID と同じ薄い色・同じ大きさにします。オフにすると名前の色で目立たせます") { p.nameSubtle = it }
        SwitchRow("ワッチョイを短く出す", p.watchoiShort, desc = "「(ワッチョイ 1a2b-3c4d)」を「(1a2b-3c4d)」にします(種類の言葉と IP を省く)") { p.watchoiShort = it }
        SwitchRow("ワッチョイがあるときは、アイコンをワッチョイから作る", p.iconFromWatchoi, desc = "Discord 風・LINE 風のアイコン。ID は日ごとに変わりますが、ワッチョイは週ごとなので同じ人が同じアイコンで続きます") { p.iconFromWatchoi = it }
        ChoiceRow(
            "人気のレスの示し方", p.heatStyle,
            listOf("left" to "左の帯", "right" to "右の帯", "text" to "本文の色"),
        ) { p.heatStyle = it }
        SwitchRow("ミニマップを出す", p.showMinimap, desc = "右端に、人気レス・自分のレス・画像の位置を示します") { p.showMinimap = it }
    }
    if (LocalAdvanced.current) Group("リンク") {
        SwitchRow("URL を短く見せる", p.urlShorten, desc = "https:// を外し、長いものは後ろを省きます。画像の URL は「画像」の札にし、続いたものは「画像 ×3」のようにまとめます") { p.urlShorten = it }
        SwitchRow("リンクのカードを出す", p.showLinkPreview, desc = "ページの題と画像を、本文の下に小さく") { p.showLinkPreview = it }
        SwitchRow("リンクをアプリの中で開く", p.openLinksInApp, desc = "オフにすると、ブラウザで開きます") { p.openLinksInApp = it }
    }
}

@Composable
private fun MediaPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("サムネイル") {
        ChoiceRow("サムネイルを読み込む", p.thumbMode.name, ThumbMode.entries.map { it.name to it.label }) { p.thumbMode = ThumbMode.valueOf(it) }
        // 大きさは 8dp ずつ。動かすと下の枠がその大きさになる
        SliderRow("大きさ", p.thumbSize.toFloat(), 56f..200f, steps = 17, label = "${p.thumbSize}dp") { p.thumbSize = ((it / 8).toInt() * 8).coerceIn(56, 200) }
        ThumbSample(p.thumbSize)
    }
    if (LocalAdvanced.current) Group("グロ注意", note = "この言葉を含むレスと、そのアンカー先の画像を、押すまでぼかします") {
        SwitchRow("グロ注意の画像をぼかす", p.blurGross) { p.blurGross = it }
        if (p.blurGross) EditableWordList(p.grossWords, "目印の言葉", "言葉を足す", "言葉がありません") { p.grossWords = it }
    }
}

@Composable
private fun WritePage(vm: AppViewModel) {
    val p = vm.prefs
    Group("名前") {
        TextRow("名前", p.postName, "名無し") { p.postName = it }
    }
    Group("定型文", note = "レスを長押しすると「「草」とすぐ書き込む」のように、その言葉を >>番号 付きですぐ書き込めます") {
        EditableWordList(p.quickPhrases, "定型文", "定型文を足す", "定型文はありません", sortable = true) { p.quickPhrases = it }
    }
    if (LocalAdvanced.current) Group("画像のアップロード", note = "画像を置き場に上げて、本文に URL を入れます。上げた画像は誰でも見られ、あとから消せません。撮影場所などの情報(EXIF)は描き直して取り除きます。hono-bbs の板では、いつもその掲示板の置き場に上げます。「サイトの画面」の上げ先は、画像を押すとそのサイトの画面が開き、上げたリンクを本文に入れます") {
        run {
            // 上げ先: サイトの画面(画像を押すとそのサイトの画面が開き、上げたリンクを本文に入れる)か API(キーを登録して、そのまま上げる)
            ChoiceRow(
                "上げ先", p.uploadHost,
                io.github.contentsview08.obb.data.Uploader.HOSTS.map { h -> h.key to "${h.name}(${if (h.kind == "web") "サイトの画面" else "API"})・${h.note}" },
            ) { p.uploadHost = it }
            if (p.uploadHost == "imgur") TextRow("imgur の Client-ID", p.imgurClientId, "api.imgur.com で登録した Client-ID") { p.imgurClientId = it.trim() }
            if (p.uploadHost == "imgbb") TextRow("imgbb の API キー", p.imgbbApiKey, "api.imgbb.com で発行した API キー") { p.imgbbApiKey = it.trim() }
            ChoiceRow(
                "大きい画像を縮める", p.uploadMaxDimension.toString(),
                listOf(0, 1280, 1920, 2560, 4096).map { it.toString() to if (it == 0) "縮めない" else "長い辺 ${it}px まで" },
            ) { p.uploadMaxDimension = it.toInt() }
        }
    }
}

@Composable
private fun GesturesPage(vm: AppViewModel) {
    val p = vm.prefs
    Group {
        SwitchRow("なぞって操作する", p.gesturesEnabled, desc = "左右になぞり、続けて上下になぞると、別の操作になります") { p.gesturesEnabled = it }
        SwitchRow("振動で知らせる", p.haptics, desc = "ジェスチャー・引っぱって更新が決まったとき、長押しのメニューで軽く振動します") { p.haptics = it }
        if (LocalAdvanced.current) SwitchRow("レスをダブルタップで返信", p.doubleTapReply, desc = ">>番号 を入れて書き込み欄を開きます。オンにすると、1 回のタップ(ツリーを開く)が少し遅れます") { p.doubleTapReply = it }
        if (p.gesturesEnabled) SliderRow("感度", p.gestureSensitivity.toFloat(), 1f..5f, steps = 3, label = listOf("鈍い", "少し鈍い", "標準", "少し敏感", "敏感")[p.gestureSensitivity - 1]) { p.gestureSensitivity = it.toInt().coerceIn(1, 5) }
    }
    if (p.gesturesEnabled) Group("ジェスチャーを試す", note = "枠の中でなぞると、何の操作になるかが出ます(実際には動かしません)。感度を変えながら試せます") {
        GesturePractice(p)
    }
    if (!p.gesturesEnabled || !LocalAdvanced.current) return
    for ((screen, title) in listOf("list" to "スレ一覧", "thread" to "スレ表示")) {
        Group(title) {
            val assign = p.gestures(screen)
            for (seq in listOf("right", "left", "right,up", "right,down", "left,up", "left,down", "left,right", "right,left")) {
                ChoiceRow(gestureArrows(seq), assign[seq] ?: "", GESTURE_ACTIONS.getValue(screen)) { p.setGesture(screen, seq, it) }
            }
        }
    }
    Group { ActionRow("割り当てを元に戻す") { p.resetGestures() } }
}

@Composable
private fun BehaviorPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("スクロール") {
        SwitchRow("下に「履歴・未読・スレ・板」のタブ", p.bottomTabs, desc = "2ch Mate のように、左のメニューを開かずに一覧を行き来できます") { p.bottomTabs = it }
        SwitchRow("下へスクロールしたら、ヘッダーとフッターを隠す", p.hideBarsOnScroll, desc = "上へスクロールすると、すぐ戻ります") { p.hideBarsOnScroll = it }
        if (LocalAdvanced.current) SwitchRow("いちばん下を見ているときは、新着まで送る", p.autoScrollOnNew) { p.autoScrollOnNew = it }
        if (LocalAdvanced.current) SwitchRow("ログを削除する前に確かめる", p.confirmDeleteLog) { p.confirmDeleteLog = it }
    }
    Group("更新") {
        if (LocalAdvanced.current) SwitchRow("書き込み欄の右に更新ボタン", p.showRefreshButton) { p.showRefreshButton = it }
        ChoiceRow(
            "開いているスレの自動更新", p.autoRefreshSec.toString(),
            listOf(0, 5, 10, 20, 30, 60).map { it.toString() to if (it == 0) "しない" else "$it 秒ごと" },
        ) { p.autoRefreshSec = it.toInt() }
    }
    if (LocalAdvanced.current) Group("お気に入りのスレの新着", note = "お気に入りのスレがある板のスレ一覧を取り、新着の数だけ確かめます(本文は開いたときに取ります)。アプリを開いている間だけ確かめます。掲示板に負担をかけないよう、5 分より短くはできません") {
        ChoiceRow(
            "お気に入りのスレを確かめる間隔", p.favCheckMin.toString(),
            listOf(0, 5, 10, 15, 30, 60).map { it.toString() to if (it == 0) "しない" else "$it 分ごと" },
        ) { p.favCheckMin = it.toInt() }
    }
    Group("閲覧履歴(既読のスレ)の新着", note = "閲覧履歴にあるスレの板のスレ一覧を取り、新着の数と dat 落ちを確かめます(本文は開いたときに取ります)。掲示板に負担をかけないよう、5 分より短くはできません。アプリを閉じている間は Android の決まりで 15 分より短くなりません") {
        ChoiceRow(
            "確かめる間隔", p.historyCheckMin.toString(),
            listOf(0, 5, 10, 15, 30, 60).map { it.toString() to if (it == 0) "しない" else "$it 分ごと" },
        ) { p.historyCheckMin = it.toInt() }
    }
}

/** 通知: OS の通知に出すか、知らせる種類 */
@Composable
private fun NotifyPage(vm: AppViewModel) {
    val p = vm.prefs
    val context = androidx.compose.ui.platform.LocalContext.current
    val ask = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok) vm.toast = "通知が許可されていません。Android の設定 → アプリ → OBB → 通知 から許可してください"
    }
    Group("OS の通知", note = "新着を Android の通知で知らせます。アプリを開いている間は、お気に入りのスレとキーワードをそれぞれの間隔で確かめます。アプリを閉じている間は「スクロールと更新」の閲覧履歴の間隔で確かめます(15 分より短くならず、端末の省電力の設定で遅れたり止められたりすることがあります)") {
        SwitchRow("OS の通知に出す", p.osNotify) { on ->
            p.osNotify = on
            if (on) {
                // 定期確認がオフだと何も届かないので、オンにする
                if (p.historyCheckMin <= 0) p.historyCheckMin = 15
                if (android.os.Build.VERSION.SDK_INT >= 33 && !io.github.contentsview08.obb.data.Notifier.enabled(context)) ask.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
    Group("知らせる種類") {
        SwitchRow("あなた宛てのレス", p.notifyReply, desc = "自分が書き込んだスレで、自分の書き込みにアンカーが付いたとき") { p.notifyReply = it }
        SwitchRow("お気に入りのスレの新着", p.notifyFav, desc = "お気に入りのスレに新しいレスが付いたとき") { p.notifyFav = it }
        SwitchRow("キーワードに合うスレ", p.notifyKeyword, desc = "お気に入り板に、「スレ一覧 → キーワード」に合うスレが立ったとき") { p.notifyKeyword = it }
    }
    Group("キーワードに合うスレが立ったら知らせる", note = "アプリを開いている間、お気に入り板のスレ一覧をこの間隔で見に行きます。OS の通知がオンで、キーワードがあるときだけ見に行きます") {
        ChoiceRow(
            "キーワードを確かめる間隔", p.keywordWatchMin.toString(),
            listOf(0, 5, 10, 30, 60).map { it.toString() to if (it == 0) "知らせない" else "$it 分ごと" },
        ) { p.keywordWatchMin = it.toInt() }
    }
}

@Composable
private fun NgPage(vm: AppViewModel) {
    val p = vm.prefs
    // 種類の切り替え(all か NG_TARGETS のキー)・検索・編集の板に出している NG
    var filter by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<NgRule?>(null) }
    var adding by remember { mutableStateOf(false) }
    val today = io.github.contentsview08.obb.data.today()
    Group("見せ方") {
        ChoiceRow("NG のレス", p.ngStyle, listOf("fold" to "あぼーん(1 行に畳む)", "hide" to "透明あぼーん(消す)", "dim" to "薄く表示(会話の流れを残す)")) { p.ngStyle = it }
    }
    Group("AI NG(条件で見つける)", note = "「他人を煽っている」のように文で書いた条件に当たるレスを、この端末の中の判定モデルで見つけます。条件ごとに、隠す・畳む・印だけを選べます") {
        AiNgSettings(vm)
    }
    Group("NG", note = "レスを長押しして、ID・名前・言葉を NG に足すこともできます。スレタイ・立てた人の NG は、スレを長押しして足せます") {
        // 種類の切り替え(件数付き)
        Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((k, label) in listOf("all" to "すべて") + io.github.contentsview08.obb.data.NG_TARGETS) {
                val on = k == filter
                val n = if (k == "all") p.ngRules.size else p.ngRules.count { it.target == k }
                Text(
                    "$label $n",
                    Modifier.clip(RoundedCornerShape(50)).background(if (on) Palette.accentWash else Palette.surface2).clickable { filter = k }.padding(horizontal = 12.dp, vertical = 6.dp),
                    color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
        Row(
            Modifier.padding(12.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Palette.surface2).padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Search, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) Text("文字・メモで探す", color = Palette.textMuted, fontSize = 14.sp)
                androidx.compose.foundation.text.BasicTextField(
                    query, { query = it }, Modifier.fillMaxWidth(), singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontSize = 14.sp), cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
                )
            }
        }
        val q = query.trim()
        val shown = p.ngRules.filter { (filter == "all" || it.target == filter) && (q.isEmpty() || it.pattern.contains(q, true) || (it.note ?: "").contains(q, true)) }
            .asReversed().sortedByDescending { it.createdAt }
        if (shown.isEmpty()) Text(if (p.ngRules.isEmpty()) "NG はまだありません" else "当てはまる NG はありません", Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), color = Palette.textMuted, fontSize = 14.sp)
        for (r in shown) {
            val expired = r.expiresOn != null && r.expiresOn < today
            val marks = listOfNotNull(
                if (r.isRegex) "正規表現" else null, r.boardUrl?.let { "${r.boardName ?: "この板"}だけ" },
                r.expiresOn?.let { if (expired) "期限切れ" else "${it}まで" }, r.note,
            )
            HorizontalDivider(color = Palette.border)
            Row(
                Modifier.fillMaxWidth().clickable { editing = r }.graphicsLayer { alpha = if (r.active(today)) 1f else 0.6f }.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            io.github.contentsview08.obb.data.ngTargetName(r.target),
                            Modifier.background(Palette.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.textMuted, fontSize = 11.sp,
                        )
                        Text(
                            r.pattern, Modifier.padding(start = 8.dp), color = Palette.textBody, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            fontFamily = if (r.isRegex) androidx.compose.ui.text.font.FontFamily.Monospace else null,
                        )
                    }
                    if (marks.isNotEmpty()) Text(marks.joinToString(" ・ "), Modifier.padding(top = 2.dp), color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Switch(r.enabled, { vm.saveNg(r.copy(enabled = it)) }, colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
            }
        }
        HorizontalDivider(color = Palette.border)
        ActionRow("NG を足す", Icons.Filled.Add) { adding = true }
        val expiredCount = p.ngRules.count { it.expiresOn != null && it.expiresOn < today }
        if (expiredCount > 0) ActionRow("期限の切れた $expiredCount 件を片づける", androidx.compose.material.icons.Icons.Filled.Delete) { vm.setNg(p.ngRules.filter { it.expiresOn == null || it.expiresOn >= today }) }
    }
    // 「この板だけ」にできる板: 開いているスレの板、なければ開いているスレ一覧の板
    val board = when (val pg = vm.stack.lastOrNull { it is io.github.contentsview08.obb.Page.Thread || it is io.github.contentsview08.obb.Page.Threads }) {
        is io.github.contentsview08.obb.Page.Thread -> pg.summary.boardUrl to (vm.favorites.firstOrNull { it.url == pg.summary.boardUrl }?.name ?: pg.summary.boardUrl)
        is io.github.contentsview08.obb.Page.Threads -> pg.board.url to pg.board.name
        else -> null
    }
    if (adding) NgEditSheet(NgRule(if (filter == "all") "body" else filter, ""), board, isNew = true, onDismiss = { adding = false }) { vm.saveNg(it); adding = false }
    editing?.let { r -> NgEditSheet(r, board, isNew = false, onDismiss = { editing = null }, onDelete = { vm.removeNg(r); editing = null }) { vm.saveNg(it); editing = null } }
}

/**
 * NG 1 つの編集(下から出る板): 種類・文字・正規表現(読めないときは理由)・有効・効く板・期限・メモ・試し(当たる所に色)。
 * hono-bbs の web・PC 版の NgEditor と同じ項目・同じ言葉
 */
@Composable
fun NgEditSheet(initial: NgRule, board: Pair<String, String>?, isNew: Boolean, onDismiss: () -> Unit, onDelete: (() -> Unit)? = null, onSave: (NgRule) -> Unit) {
    var r by remember { mutableStateOf(initial) }
    var sample by remember { mutableStateOf("") }
    val err = if (r.pattern.isBlank()) null else io.github.contentsview08.obb.data.ngPatternError(r.pattern.trim(), r.isRegex)
    val scope = r.boardUrl?.let { it to (r.boardName ?: it) } ?: board
    @Composable fun chip(label: String, on: Boolean, onClick: () -> Unit) = Text(
        label,
        Modifier.clip(RoundedCornerShape(50)).border(1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(50))
            .background(if (on) Palette.accentWash else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp, maxLines = 1,
    )
    androidx.compose.ui.window.Popup(onDismissRequest = onDismiss, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)).clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) { onDismiss() },
            contentAlignment = Alignment.BottomCenter,
        ) {
            val shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
            Column(
                Modifier.fillMaxWidth().clip(shape).background(Palette.surface)
                    .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) {}.navigationBarsPadding().imePadding(),
            ) {
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(Palette.borderStrong))
                }
                Text(if (isNew) "NG を足す" else "NG を直す", Modifier.padding(start = 18.dp, top = 10.dp, bottom = 6.dp), color = Palette.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for ((k, label) in io.github.contentsview08.obb.data.NG_TARGETS) chip(label, r.target == k) { r = r.copy(target = k) }
                    }
                    OutlinedTextField(
                        r.pattern, { r = r.copy(pattern = it) }, Modifier.fillMaxWidth(), isError = err != null,
                        placeholder = { Text(if (r.isRegex) "正規表現(例: ^ｷﾀ━+|ｗ{5,})" else "NG にする言葉") },
                        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = if (r.isRegex) androidx.compose.ui.text.font.FontFamily.Monospace else null),
                        supportingText = {
                            Text(err ?: if (r.isRegex) "正規表現で当てます(大文字と小文字は区別します)" else if (r.target == "id") "ID が同じときだけ当てます(完全一致)" else "この言葉を含めば当てます(部分一致。大文字と小文字は区別しません)")
                        },
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("正規表現", Modifier.weight(1f), color = Palette.textBody, fontSize = 14.sp)
                        Switch(r.isRegex, { r = r.copy(isRegex = it) }, colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
                        Spacer(Modifier.width(16.dp))
                        Text("有効", color = Palette.textBody, fontSize = 14.sp)
                        Spacer(Modifier.width(8.dp))
                        Switch(r.enabled, { r = r.copy(enabled = it) }, colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
                    }
                    Text("効く板", color = Palette.textMuted, fontSize = 12.sp)
                    Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        chip("すべての板", r.boardUrl == null) { r = r.copy(boardUrl = null, boardName = null) }
                        scope?.let { (url, name) -> chip("この板だけ($name)", r.boardUrl != null) { r = r.copy(boardUrl = url, boardName = name) } }
                    }
                    Text("期限", color = Palette.textMuted, fontSize = 12.sp)
                    Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val t = io.github.contentsview08.obb.data.today()
                        val w = io.github.contentsview08.obb.data.daysLater(7)
                        val m = io.github.contentsview08.obb.data.daysLater(30)
                        chip("ずっと", r.expiresOn == null) { r = r.copy(expiresOn = null) }
                        chip("今日だけ", r.expiresOn == t) { r = r.copy(expiresOn = t) }
                        chip("7 日", r.expiresOn == w) { r = r.copy(expiresOn = w) }
                        chip("30 日", r.expiresOn == m) { r = r.copy(expiresOn = m) }
                        if (r.expiresOn != null && r.expiresOn !in listOf(t, w, m)) chip("${r.expiresOn} まで", true) {}
                    }
                    OutlinedTextField(r.note ?: "", { r = r.copy(note = it.ifEmpty { null }) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("メモ(なぜ NG にしたか)") })
                    // 試し: 文を入れると、当たる所に色が付く
                    val ranges = if (err == null) io.github.contentsview08.obb.data.ngMatchRanges(r.copy(pattern = r.pattern.trim()), sample) else emptyList()
                    OutlinedTextField(
                        sample, { sample = it }, Modifier.fillMaxWidth(), label = { Text("試す(文を入れると、当たる所に色が付きます)") },
                        supportingText = { Text(if (ranges.isEmpty()) "当たらない" else "${ranges.size} か所に当たる", color = if (ranges.isEmpty()) Palette.textMuted else Palette.markDanger) },
                    )
                    if (sample.isNotEmpty()) Text(
                        androidx.compose.ui.text.buildAnnotatedString {
                            append(sample)
                            for (x in ranges) addStyle(androidx.compose.ui.text.SpanStyle(background = Palette.markDanger.copy(alpha = 0.35f)), x.first, x.last + 1)
                        },
                        Modifier.fillMaxWidth().background(Palette.surface2, RoundedCornerShape(6.dp)).padding(8.dp), color = Palette.textBody, fontSize = 13.sp,
                    )
                }
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (onDelete != null) TextButton(onClick = onDelete) { Text("削除", color = Palette.markDanger, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.weight(1f))
                    val ok = r.pattern.isNotBlank() && err == null
                    Text(
                        if (isNew) "足す" else "直す",
                        Modifier.clip(RoundedCornerShape(8.dp)).background(Palette.accent).graphicsLayer { alpha = if (ok) 1f else 0.5f }
                            .clickable(enabled = ok) { onSave(r.copy(pattern = r.pattern.trim())) }.padding(horizontal = 24.dp, vertical = 10.dp),
                        color = Palette.accentText, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

@Composable
private fun SitesPage(vm: AppViewModel, menus: Boolean) {
    var adding by remember { mutableStateOf(false) }
    /** 設定を開いている板(URL と板名) */
    var editingBoard by remember { mutableStateOf<Pair<String, String>?>(null) }
    editingBoard?.let { (url, name) -> BoardMetaSheet(vm, url, name) { editingBoard = null } }
    if (!menus) Group("お気に入り板", note = "左のメニューに出る順です。≡ を掴んで並べ替えます(左のメニューでも、長押しして動かせます)。⚙ でその板だけの設定(別名・名前欄・名無しの扱い)") {
        if (vm.favorites.isEmpty()) Text("お気に入り板はありません(板を探す・スレ一覧の ︙ から足せます)", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        ReorderableColumn(vm.favorites, { it.url }, { from, to -> vm.moveFavorite(from, to) }) { b, handle, _ ->
            Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(vm.prefs.boardMeta[b.url]?.alias ?: b.name, color = Palette.textStrong, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(b.url.removePrefix("https://"), color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { editingBoard = b.url to b.name }) {
                    Icon(Icons.Filled.Tune, "この板の設定", tint = if (vm.prefs.boardMeta[b.url] != null) Palette.accent else Palette.textMuted)
                }
                IconButton(onClick = { vm.toggleFavorite(b) }) { Icon(Icons.Filled.Close, "外す", tint = Palette.textMuted) }
                DragHandleIcon(handle)
            }
        }
    }
    if (menus) Group("サイト(BBS メニュー)", note = "「板を探す」で板を選べる掲示板です。bbsmenu.json か bbsmenu.html の URL を足せます。hono-bbs はサイトの URL(https://red-edge.net など)") {
        for ((url, name) in vm.sites) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                    Text(name, color = Palette.textStrong, fontSize = 15.sp)
                    Text(url, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (vm.sites.size > 1) IconButton(onClick = { vm.removeSite(url) }) { Icon(Icons.Filled.Close, "外す", tint = Palette.textMuted) }
            }
        }
        ActionRow("サイトを足す", Icons.Filled.Add) { adding = true }
    }
    if (adding) {
        var url by remember { mutableStateOf("") }
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("サイトを足す") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(url, { url = it }, singleLine = true, label = { Text("BBS メニュー・サイトの URL") }, placeholder = { Text("https://…/bbsmenu.json") })
                    OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("名前(なくてもよい)") })
                }
            },
            confirmButton = { TextButton(onClick = { if (url.isNotBlank()) vm.addSite(url, name); adding = false }) { Text("足す") } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("やめる") } },
        )
    }
}

/**
 * サイトごとの設定(PC 版の 掲示板ごとの設定 → サイトごと と同じ)。いまは hono-bbs のアカウントだけ。
 * ユーザー ID とパスワードを保存し、書き込むときにそのサイトにログインして使う(bbs/HonoBbs.kt)。
 * 「ログインして確かめる」は、知っているサイト(BBS メニューに登録した hono-bbs・お気に入り板)に今ログインしてみる。
 * 登録は、メールに確認コード → コード・ID・パスワードで作る(Turnstile が要れば、書き込みと同じく認証ページとコードを出す)
 */
@Composable
private fun AccountsPage(vm: AppViewModel) {
    val p = vm.prefs
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var auth by remember { mutableStateOf<io.github.contentsview08.obb.bbs.PostResult.Auth?>(null) }
    var register by remember { mutableStateOf(false) }
    // サイトの一覧は開いたときに取り直す(BBS メニューの画面を開いていないと空のことがある)
    androidx.compose.runtime.LaunchedEffect(Unit) { vm.reloadSites() }
    val origins = remember(vm.sites, vm.favorites) { vm.honoOrigins() }
    Group("hono-bbs(red-edge.net など)", note = "ログインすると、hono-bbs の掲示板に書き込むときに自動で使われます(名前にアカウントの表示名が付きます)。パスワードはこの端末にそのまま保存します") {
        TextRow("ユーザー ID", p.honoUser, "まだ登録していません") { vm.setHonoAccount(it, p.honoPassword); status = null }
        TextRow("パスワード", p.honoPassword, "", secret = true) { vm.setHonoAccount(p.honoUser, it); status = null }
        if (p.honoUser.isNotEmpty() && p.honoPassword.isNotEmpty()) {
            ActionRow(if (busy) "確かめています…" else "ログインして確かめる") {
                if (busy) return@ActionRow
                if (origins.isEmpty()) { status = "hono-bbs のサイトをまだ知りません。BBS メニューに red-edge.net などを足すか、その板をお気に入りに入れてください"; return@ActionRow }
                busy = true
                scope.launch {
                    val results = origins.map { o -> o to runCatching { io.github.contentsview08.obb.bbs.HonoBbs.login(o, io.github.contentsview08.obb.bbs.HonoBbs.Account(p.honoUser, p.honoPassword)) } }
                    status = results.joinToString("\n") { (o, r) -> "${o.removePrefix("https://")}: " + r.fold({ "ログインしました($it)" }, { "ログインできません(${it.message})" }) }
                    busy = false
                }
            }
            ActionRow("アカウントを消す", Icons.Filled.Delete) { vm.setHonoAccount("", ""); status = null }
        }
        ActionRow("新しく登録する(メールの確認コード)") { register = true }
        if (status != null) Text(status!!, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = Palette.textMuted, fontSize = 13.sp)
    }
    if (register) RegisterDialog(vm, origins, onAuth = { auth = it; register = false }, onDone = { msg -> status = msg; register = false })
    // Turnstile の認証(書き込みと同じ案内)
    auth?.let { a ->
        AlertDialog(
            onDismissRequest = { auth = null },
            title = { Text("人の確認が要ります") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("ブラウザで認証のページを開き、下の認証コードを入れてから、もう一度登録してください。", fontSize = 14.sp)
                    if (a.code != null) Text("認証コード: ${a.code}", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Palette.textStrong)
                    Text(a.message, fontSize = 12.sp, color = Palette.textMuted)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    a.code?.let { copyText(context, it) }
                    a.url?.let { runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(it))) } }
                    auth = null
                }) { Text(if (a.code != null) "コードをコピーして開く" else "ブラウザで開く") }
            },
            dismissButton = { TextButton(onClick = { auth = null }) { Text("閉じる") } },
        )
    }
}

/** 利用者の登録: サイトを選ぶ → メール → 確認コード・ユーザー ID・表示名・パスワード。できたらそのアカウントを保存してログイン済みにする */
@Composable
private fun RegisterDialog(vm: AppViewModel, origins: List<String>, onAuth: (io.github.contentsview08.obb.bbs.PostResult.Auth) -> Unit, onDone: (String) -> Unit) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var origin by remember { mutableStateOf(origins.firstOrNull() ?: "") }
    var email by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var id by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val field = Modifier.fillMaxWidth()
    AlertDialog(
        onDismissRequest = { if (!busy) onDone("") },
        title = { Text(if (sent) "確認コードと、ID・パスワード" else "新しく登録する") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (origins.isEmpty()) Text("hono-bbs のサイトをまだ知りません。BBS メニューに red-edge.net などを足してから登録してください", fontSize = 13.sp, color = Palette.textMuted)
                else if (origins.size > 1) {
                    Text("どのサイトに登録するか", fontSize = 12.sp, color = Palette.textMuted)
                    for (o in origins) Row(Modifier.fillMaxWidth().clickable { origin = o }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(selected = origin == o, onClick = { origin = o })
                        Text(o.removePrefix("https://"), fontSize = 14.sp)
                    }
                } else Text(origin.removePrefix("https://"), fontSize = 13.sp, color = Palette.textMuted)
                OutlinedTextField(email, { email = it }, field, singleLine = true, enabled = !sent, label = { Text("メールアドレス") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Email))
                if (sent) {
                    OutlinedTextField(code, { code = it.filter { c -> c.isDigit() }.take(6) }, field, singleLine = true, label = { Text("確認コード(6 桁)") },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number))
                    OutlinedTextField(id, { id = it }, field, singleLine = true, label = { Text("ユーザー ID(英数字・_・-、7 文字以上)") })
                    OutlinedTextField(name, { name = it }, field, singleLine = true, label = { Text("表示名(空なら ID)") })
                    OutlinedTextField(password, { password = it }, field, singleLine = true, label = { Text("パスワード(8 文字以上)") },
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Password))
                    Text("確認コードは 10 分有効です。届かないときは、閉じてもう一度送ってください", fontSize = 12.sp, color = Palette.textMuted)
                }
                if (error != null) Text(error!!, fontSize = 13.sp, color = Palette.markDanger)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && origin.isNotEmpty() && email.isNotBlank(), onClick = {
                error = null
                // 足りない所は、押したときに理由を出す(押せない理由が分からないと困るため)
                if (sent) {
                    val problem = when {
                        !Regex("^[0-9]{6}$").matches(code) -> "確認コード(6 桁の数字)を入れてください"
                        id.trim().length < 7 -> "ユーザー ID は 7 文字以上にしてください"
                        !Regex("^[a-zA-Z0-9_-]+$").matches(id.trim()) -> "ユーザー ID に使えるのは英数字・_・- だけです"
                        password.length < 8 -> "パスワードは 8 文字以上にしてください"
                        else -> null
                    }
                    if (problem != null) { error = problem; return@TextButton }
                }
                busy = true
                scope.launch {
                    val r = runCatching {
                        if (!sent) io.github.contentsview08.obb.bbs.HonoBbs.registerRequest(origin, email.trim())
                        else io.github.contentsview08.obb.bbs.HonoBbs.registerVerify(origin, email.trim(), code, id.trim(), name.trim(), password)
                    }.getOrElse { io.github.contentsview08.obb.bbs.PostResult.Error(it.message ?: it.toString()) }
                    busy = false
                    when (r) {
                        is io.github.contentsview08.obb.bbs.PostResult.Ok -> if (!sent) sent = true else { vm.setHonoAccount(id.trim(), password); onDone(r.message) }
                        is io.github.contentsview08.obb.bbs.PostResult.Auth -> onAuth(r)
                        is io.github.contentsview08.obb.bbs.PostResult.Error -> error = r.message
                        is io.github.contentsview08.obb.bbs.PostResult.Confirm -> error = r.message
                    }
                }
            }) { Text(if (busy) "送っています…" else if (sent) "登録する" else "確認コードを送る") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { onDone("") }) { Text("やめる") } },
    )
}

@Composable
private fun BackupPage(vm: AppViewModel) {
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> if (uri != null) vm.exportBackup(uri) }
    val load = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.importBackup(uri) }
    Group(note = "設定・NG・お気に入り板・お気に入りのスレ・サイトを 1 つのファイルに書き出します。スレのログは入りません") {
        ActionRow("バックアップを書き出す") { save.launch("OBB-backup.json") }
        ActionRow("バックアップから戻す") { load.launch(arrayOf("application/json", "text/plain", "*/*")) }
    }
}

@Composable
private fun AboutPage(vm: AppViewModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "" }
    Group("掲示板", note = "要望や不具合は、運営要望板か GitHub の Issues へ") {
        ActionRow("運営要望板を開く") { vm.openUrl("https://red-edge.net/boards/operation01/") }
    }
    Group {
        InfoRow("名前", "OBB(Open BBS Browser)")
        InfoRow("版", version)
        InfoRow("画像のアップロード", "catbox.moe")
        InfoRow("AA の字", "aahub_light")
    }
}

// ── 部品(今のスマホ版の components/mobile/ui.tsx にあたる) ──

/** 項目のまとまり。見出しと、下に小さな説明 */
@Composable
private fun Group(title: String? = null, note: String? = null, content: @Composable () -> Unit) {
    if (title != null) Text(title, Modifier.padding(start = 20.dp, top = 20.dp, bottom = 6.dp), color = Palette.textMuted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    else Spacer(Modifier.height(16.dp))
    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Palette.surface).border(1.dp, Palette.border, RoundedCornerShape(8.dp))) {
        content()
    }
    if (note != null) Text(note, Modifier.padding(start = 20.dp, end = 20.dp, top = 6.dp), color = Palette.textMuted, fontSize = 12.sp, lineHeight = 17.sp)
}

/** 次の画面へ進む行。左に色の付いた四角のアイコン */
@Composable
private fun NavRow(icon: ImageVector, color: Color, label: String, desc: String? = null, value: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 56.dp).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(32.dp).background(color, RoundedCornerShape(5.dp)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
        Column(Modifier.weight(1f).padding(start = 14.dp)) {
            Text(label, color = Palette.textStrong, fontSize = 15.sp)
            if (desc != null) Text(desc, color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (value != null) Text(value, Modifier.padding(start = 8.dp), color = Palette.textMuted, fontSize = 13.sp, maxLines = 1)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.textMuted)
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, desc: String? = null, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, color = Palette.textStrong, fontSize = 15.sp)
            if (desc != null) Text(desc, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 16.sp)
        }
        Spacer(Modifier.width(10.dp))
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
    }
}

/** 選ぶ行。押すと選べるものの一覧が出る */
@Composable
private fun ChoiceRow(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        Text(options.firstOrNull { it.first == value }?.second ?: value, color = Palette.textMuted, fontSize = 14.sp, maxLines = 1)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.textMuted)
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(label) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    for ((k, name) in options) {
                        val on = k == value
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(if (on) Palette.accentWash else Color.Transparent)
                                .clickable { onChange(k); open = false }.heightIn(min = 46.dp).padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(name, Modifier.weight(1f), color = if (on) Palette.accent else Palette.textBody, fontSize = 15.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                            if (on) Icon(Icons.Filled.Check, null, tint = Palette.accent, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text("閉じる") } },
        )
    }
}

@Composable
private fun SliderRow(title: String, value: Float, range: ClosedFloatingPointRange<Float>, steps: Int, label: String, onChange: (Float) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
            Text(label, color = Palette.accent, fontSize = 14.sp)
        }
        Slider(value, onChange, valueRange = range, steps = steps, colors = SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent))
    }
}

@Composable
private fun TextRow(label: String, value: String, placeholder: String, secret: Boolean = false, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        // パスワードは伏せて出す
        Text(if (value.isEmpty()) placeholder else if (secret) "●".repeat(8) else value, color = if (value.isEmpty()) Palette.textMuted else Palette.accent, fontSize = 14.sp, maxLines = 1)
    }
    if (open) {
        var text by remember { mutableStateOf(value) }
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(label) },
            text = {
                OutlinedTextField(
                    text, { text = it }, singleLine = true, placeholder = { Text(placeholder) },
                    visualTransformation = if (secret) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = if (secret) androidx.compose.ui.text.input.KeyboardType.Password else androidx.compose.ui.text.input.KeyboardType.Text),
                )
            },
            confirmButton = { TextButton(onClick = { onChange(text); open = false }) { Text("決める") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text("やめる") } },
        )
    }
}

@Composable
private fun ActionRow(label: String, icon: ImageVector? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = Palette.accent, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)) }
        Text(label, color = Palette.accent, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        Text(value, color = Palette.textMuted, fontSize = 13.sp)
    }
}
