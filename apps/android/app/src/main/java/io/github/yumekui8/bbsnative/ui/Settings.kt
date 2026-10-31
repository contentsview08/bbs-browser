package io.github.yumekui8.bbsnative.ui

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.data.NgRule
import io.github.yumekui8.bbsnative.data.ThumbMode

/** 設定の画面(今のスマホ版の MobileSettings と同じ組み立て: 入口の一覧から、項目ごとの画面へ進む) */
private val TITLES = mapOf(
    "theme" to "テーマと色", "text" to "文字と余白", "list" to "スレ一覧", "thread" to "スレ表示", "media" to "画像と動画",
    "write" to "書き込み", "gestures" to "ジェスチャー", "behavior" to "スクロールと更新", "ng" to "NG",
    "sites" to "お気に入り板とサイト", "backup" to "バックアップ", "about" to "このアプリについて",
)

@Composable
fun SettingsScreen(vm: AppViewModel) {
    var sub by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(enabled = sub != null) { sub = null }
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        if (sub == null) HeaderBar("設定", onNav = { vm.drawerOpen = true })
        else HeaderBar(TITLES[sub] ?: "", onNav = { sub = null }, navIsBack = true)
        HorizontalDivider(color = Palette.border)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp).navigationBarsPadding()) {
            when (sub) {
                null -> SettingsTop(vm) { sub = it }
                "theme" -> ThemePage(vm)
                "text" -> TextPage(vm)
                "list" -> ListPage(vm)
                "thread" -> ThreadPage(vm)
                "media" -> MediaPage(vm)
                "write" -> WritePage(vm)
                "gestures" -> GesturesPage(vm)
                "behavior" -> BehaviorPage(vm)
                "ng" -> NgPage(vm)
                "sites" -> SitesPage(vm)
                "backup" -> BackupPage(vm)
                "about" -> AboutPage()
            }
        }
    }
}

@Composable
private fun SettingsTop(vm: AppViewModel, open: (String) -> Unit) {
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
                Column(Modifier.fillMaxWidth().clickable { open(k) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
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
        NavRow(Icons.Filled.Sync, Color(0xFF10B981), "スクロールと更新", desc = "自動更新・引っぱって更新") { open("behavior") }
    }
    Group("NG") {
        NavRow(Icons.Filled.Block, Color(0xFFEF4444), "NG", value = "${p.ngRules.size} 件") { open("ng") }
    }
    Group("板") {
        NavRow(Icons.Filled.Star, Color(0xFF14B8A6), "お気に入り板とサイト", value = "${vm.favorites.size} 板") { vm.reloadSites(); open("sites") }
        NavRow(Icons.Filled.TravelExplore, Color(0xFF0891B2), "板を探す", desc = "BBS メニューから板を選ぶ") { vm.openRoot(Page.Boards()) }
    }
    Group {
        NavRow(Icons.Filled.Backup, Color(0xFF64748B), "バックアップ") { open("backup") }
        NavRow(Icons.Filled.Info, Color(0xFF6B7280), "このアプリについて") { open("about") }
    }
}

// ── 項目ごとの画面 ──

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThemePage(vm: AppViewModel) {
    val p = vm.prefs
    Group {
        SwitchRow("スマホのダーク・ライトに合わせる", p.followSystem, desc = "オンにすると、スマホの設定で配色が切り替わります") { p.followSystem = it }
    }
    Group("レスの見た目") {
        ChoiceRow(
            "見た目", p.postStyle,
            listOf("card" to "カード", "discord" to "Discord 風", "line" to "LINE 風"),
        ) { p.postStyle = it }
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
        for (s in SCHEMES.filter { dark == null || it.dark == dark }) {
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
    Group("文字の大きさ") {
        SliderRow("画面全体", p.fontScale, 0.85f..1.3f, steps = 8, label = "${(p.fontScale * 100).toInt()}%") { p.fontScale = (it * 20).toInt() / 20f }
        SliderRow("レスの本文", p.bodyScale, 0.8f..1.4f, steps = 11, label = "${(p.bodyScale * 100).toInt()}%") { p.bodyScale = (it * 20).toInt() / 20f }
        SliderRow("レスの本文の行間", p.lineHeight, 1.2f..1.9f, steps = 13, label = "%.2f".format(p.lineHeight)) { p.lineHeight = (it * 20).toInt() / 20f }
    }
    Group("見本") {
        Text(
            "1  名無し  2026/10/26(月) 12:34:56.78  ID:AbCdEfGh\nスレ表示の本文はこの大きさと行間で出ます。\n長い文は画面の幅で折り返します。",
            Modifier.padding(16.dp), color = Palette.textBody, fontSize = (15 * p.bodyScale).sp, lineHeight = p.lineHeight.em,
        )
    }
}

@Composable
private fun ListPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("並び") {
        ChoiceRow(
            "板を開いたときの並び", p.threadSort,
            listOf("subject" to "更新順(掲示板の並び)", "momentum" to "勢い順", "newest" to "新しい順", "count" to "レス数順"),
        ) { p.threadSort = it }
        SwitchRow("引っぱって更新", p.pullToRefreshList, desc = "いちばん上で下へ引くと、スレ一覧を取り直します") { p.pullToRefreshList = it }
        SwitchRow("見出しで区切る", p.listSections, desc = "並べ替えていないとき、キーワード・新しいスレ・新着のある読んだスレ・その他に分けて出します") { p.listSections = it }
        SwitchRow("前回からの差分を出す", p.listDiff, desc = "一覧の上に「前回から +12 スレ・新着 3」の行。押すとそのスレだけに絞ります") { p.listDiff = it }
    }
    Group("行の見た目") {
        ChoiceRow("行の形", p.listDensity, listOf("normal" to "ふつう", "compact" to "コンパクト(スレタイ 1 行と数だけ)")) { p.listDensity = it }
        ChoiceRow("勢いの示し方", p.momentumStyle, listOf("number" to "数字の色", "bar" to "行の下のバー", "both" to "両方")) { p.momentumStyle = it }
    }
    Group("タブ", note = "一覧の下に出すタブ。矢印で並べ替え、スイッチで出す・出さないを決めます(上が左)") {
        val all = listOf("unread" to "未読", "visited" to "閲覧済み", "momentum" to "勢い順", "newest" to "新しい順", "count" to "レス数順")
        val on = p.listTabs.split(',').filter { it.isNotEmpty() }
        // 出しているものを並びのとおりに先に、出していないものを後ろに
        val rows = on.mapNotNull { k -> all.firstOrNull { it.first == k } } + all.filter { it.first !in on }
        for ((k, name) in rows) {
            val shown = k in on
            val i = on.indexOf(k)
            Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, Modifier.weight(1f), color = if (shown) Palette.textStrong else Palette.textMuted, fontSize = 15.sp)
                IconButton(onClick = { p.listTabs = on.toMutableList().apply { add(i - 1, removeAt(i)) }.joinToString(",") }, enabled = shown && i > 0) { Icon(Icons.Filled.KeyboardArrowUp, "左へ", tint = Palette.textMuted) }
                IconButton(onClick = { p.listTabs = on.toMutableList().apply { add(i + 1, removeAt(i)) }.joinToString(",") }, enabled = shown && i < on.lastIndex) { Icon(Icons.Filled.KeyboardArrowDown, "右へ", tint = Palette.textMuted) }
                Switch(shown, { v -> p.listTabs = (if (v) on + k else on - k).joinToString(",") }, Modifier.padding(end = 12.dp), colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
            }
        }
    }
    Group("キーワード", note = "スレタイにこの言葉が入っているスレを、一覧のいちばん上にまとめて出します") {
        WordList(p.keywords, "キーワードを足す", "まだありません") { p.keywords = it }
    }
    Group("ログ", note = "お気に入りのスレ・自分が書き込んだスレは消しません。消したスレは、もう一度開けば取り直します") {
        ChoiceRow(
            "開いていないスレのログを消す", p.logRetentionDays.toString(),
            listOf(30 to "30 日たったら", 90 to "90 日たったら", 180 to "180 日たったら", 365 to "1 年たったら", 0 to "消さない").map { it.first.toString() to it.second },
        ) { p.logRetentionDays = it.toInt() }
        ActionRow("今すぐ消す") { vm.pruneLogsNow() }
    }
}

@Composable
private fun ThreadPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("開いたとき") {
        ChoiceRow("開く位置", p.openPosition, listOf("unread" to "最初の未読", "top" to "先頭", "bottom" to "いちばん下")) { p.openPosition = it }
    }
    Group("本文") {
        SwitchRow("名無しの名前を省く", p.omitNoname, desc = "板の既定の名前(「名無しさん」など)を出しません") { p.omitNoname = it }
        SwitchRow("続いた空行を 1 行にまとめる", p.collapseBlankLines) { p.collapseBlankLines = it }
        SwitchRow("AA を見分けて、AA 用の字で出す", p.aaAutoDetect) { p.aaAutoDetect = it }
        SwitchRow("スレ主に「主」の印", p.highlightOp, desc = ">>1 と同じ ID のレス") { p.highlightOp = it }
        SwitchRow("書き込みの多い ID を赤く", p.idHeat) { p.idHeat = it }
        SwitchRow("ID ごとに色を付ける", p.idColor, desc = "2 回以上書いた ID を、ID ごとの色で。同じ人の書き込みを目で追えます") { p.idColor = it }
        ChoiceRow(
            "人気のレスの示し方", p.heatStyle,
            listOf("left" to "左の帯", "right" to "右の帯", "text" to "本文の色", "none" to "示さない"),
        ) { p.heatStyle = it }
        SwitchRow("ミニマップを出す", p.showMinimap, desc = "右端に、人気レス・自分のレス・画像の位置を示します") { p.showMinimap = it }
        SwitchRow("時間が空いたところに区切りを入れる", p.timeGap, desc = "前のレスから 1 時間以上空いたところや、日付が変わったところに線を引きます") { p.timeGap = it }
    }
    Group("リンク") {
        SwitchRow("URL を短く見せる", p.urlShorten, desc = "https:// を外し、長いものは後ろを省きます") { p.urlShorten = it }
        SwitchRow("画像の URL を「画像」の札に", p.imageUrlOmit) { p.imageUrlOmit = it }
        SwitchRow("続いた画像の URL をまとめる", p.imageUrlCollapse, desc = "「画像 ×3」のように 1 つの札に") { p.imageUrlCollapse = it }
        SwitchRow("リンクのカードを出す", p.showLinkPreview, desc = "ページの題と画像を、本文の下に小さく") { p.showLinkPreview = it }
        SwitchRow("リンクをアプリの中で開く", p.openLinksInApp, desc = "オフにすると、ブラウザで開きます") { p.openLinksInApp = it }
    }
}

@Composable
private fun MediaPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("サムネイル") {
        SwitchRow("本文の画像をサムネイルで出す", p.showThumbnails) { p.showThumbnails = it }
        ChoiceRow("サムネイルを読み込む", p.thumbMode.name, ThumbMode.entries.map { it.name to it.label }) { p.thumbMode = ThumbMode.valueOf(it) }
        ChoiceRow("大きさ", p.thumbSize.toString(), listOf("72" to "小", "96" to "中", "128" to "大")) { p.thumbSize = it.toInt() }
    }
    Group("グロ注意", note = "この言葉を含むレスと、そのアンカー先の画像を、押すまでぼかします") {
        SwitchRow("グロ注意の画像をぼかす", p.blurGross) { p.blurGross = it }
        if (p.blurGross) WordList(p.grossWords, "言葉を足す", "言葉がありません") { p.grossWords = it }
    }
}

@Composable
private fun WritePage(vm: AppViewModel) {
    val p = vm.prefs
    Group("名前") {
        TextRow("名前", p.postName, "名無し") { p.postName = it }
    }
    Group("定型文", note = "レスを長押しすると「「草」とすぐ書き込む」のように、その言葉を >>番号 付きですぐ書き込めます") {
        WordList(p.quickPhrases, "定型文を足す", "定型文はありません") { p.quickPhrases = it }
    }
    Group("画像のアップロード(catbox.moe)", note = "画像を catbox.moe に上げて、本文に URL を入れます。上げた画像は誰でも見られ、あとから消せません。撮影場所などの情報(EXIF)は描き直して取り除きます") {
        SwitchRow("画像のアップロードを使う", p.uploadEnabled) { p.uploadEnabled = it }
        if (p.uploadEnabled) ChoiceRow(
            "大きい画像を縮める", p.uploadMaxDimension.toString(),
            listOf(0, 1280, 1920, 2560, 4096).map { it.toString() to if (it == 0) "縮めない" else "長い辺 ${it}px まで" },
        ) { p.uploadMaxDimension = it.toInt() }
    }
}

@Composable
private fun GesturesPage(vm: AppViewModel) {
    val p = vm.prefs
    Group {
        SwitchRow("なぞって操作する", p.gesturesEnabled, desc = "左右になぞり、続けて上下になぞると、別の操作になります") { p.gesturesEnabled = it }
        SwitchRow("振動で知らせる", p.haptics, desc = "ジェスチャー・引っぱって更新が決まったとき、長押しのメニューで軽く振動します") { p.haptics = it }
        SwitchRow("レスをダブルタップで返信", p.doubleTapReply, desc = ">>番号 を入れて書き込み欄を開きます。オンにすると、1 回のタップ(ツリーを開く)が少し遅れます") { p.doubleTapReply = it }
        if (p.gesturesEnabled) SliderRow("感度", p.gestureSensitivity.toFloat(), 1f..5f, steps = 3, label = listOf("鈍い", "少し鈍い", "標準", "少し敏感", "敏感")[p.gestureSensitivity - 1]) { p.gestureSensitivity = it.toInt().coerceIn(1, 5) }
    }
    if (!p.gesturesEnabled) return
    for ((screen, title) in listOf("list" to "スレ一覧", "thread" to "スレ表示")) {
        Group(title) {
            val assign = p.gestures(screen)
            for (seq in listOf("right", "left", "right,up", "right,down", "left,up", "left,down")) {
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
        SwitchRow("下へスクロールしたら、ヘッダーとフッターを隠す", p.hideBarsOnScroll, desc = "上へスクロールすると、すぐ戻ります") { p.hideBarsOnScroll = it }
        SwitchRow("いちばん下を見ているときは、新着まで送る", p.autoScrollOnNew) { p.autoScrollOnNew = it }
        SwitchRow("ログを削除する前に確かめる", p.confirmDeleteLog) { p.confirmDeleteLog = it }
    }
    Group("更新") {
        SwitchRow("書き込み欄の右に更新ボタン", p.showRefreshButton) { p.showRefreshButton = it }
        SwitchRow("スレ一覧も引っぱって更新", p.pullToRefreshList) { p.pullToRefreshList = it }
        ChoiceRow(
            "開いているスレの自動更新", p.autoRefreshSec.toString(),
            listOf(0, 5, 10, 20, 30, 60).map { it.toString() to if (it == 0) "しない" else "$it 秒ごと" },
        ) { p.autoRefreshSec = it.toInt() }
    }
}

@Composable
private fun NgPage(vm: AppViewModel) {
    val p = vm.prefs
    var adding by remember { mutableStateOf(false) }
    Group("見せ方") {
        ChoiceRow("NG のレス", p.ngStyle, listOf("fold" to "あぼーん(1 行に畳む)", "hide" to "透明あぼーん(消す)", "dim" to "薄く表示(会話の流れを残す)")) { p.ngStyle = it }
    }
    Group(note = "レスを長押しして、ID・名前・言葉を NG に足すこともできます。スレタイの NG は、スレを長押しして足せます") {
        if (p.ngRules.isEmpty()) Text("NG はまだありません", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        for (r in p.ngRules) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    ngLabel(r.target),
                    Modifier.background(Palette.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.textMuted, fontSize = 12.sp,
                )
                Text(r.pattern, Modifier.weight(1f).padding(start = 10.dp), color = Palette.textBody, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = { vm.removeNg(r) }) { Icon(Icons.Filled.Close, "外す", tint = Palette.textMuted) }
            }
        }
        ActionRow("NG を足す", Icons.Filled.Add) { adding = true }
    }
    if (adding) {
        var target by remember { mutableStateOf("body") }
        var word by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("NG を足す") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (t in listOf("body", "name", "id", "title")) {
                            val on = t == target
                            Text(
                                ngLabel(t),
                                Modifier.clip(RoundedCornerShape(5.dp)).background(if (on) Palette.accentWash else Palette.surface2).clickable { target = t }.padding(horizontal = 10.dp, vertical = 6.dp),
                                color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp,
                            )
                        }
                    }
                    OutlinedTextField(word, { word = it }, singleLine = true, placeholder = { Text("NG にする文字") })
                }
            },
            confirmButton = { TextButton(onClick = { if (word.isNotBlank()) vm.addNg(NgRule(target, word.trim())); adding = false }) { Text("足す") } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("やめる") } },
        )
    }
}

private fun ngLabel(target: String) = when (target) { "id" -> "ID"; "name" -> "名前"; "title" -> "スレタイ"; else -> "言葉" }

@Composable
private fun SitesPage(vm: AppViewModel) {
    var adding by remember { mutableStateOf(false) }
    Group("お気に入り板", note = "左のメニューに出る順です。矢印で並べ替えます") {
        if (vm.favorites.isEmpty()) Text("お気に入り板はありません(板を探す・スレ一覧の ︙ から足せます)", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        vm.favorites.forEachIndexed { i, b ->
            Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(b.name, color = Palette.textStrong, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(b.url.removePrefix("https://"), color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { vm.moveFavorite(b, -1) }, enabled = i > 0) { Icon(Icons.Filled.KeyboardArrowUp, "上へ", tint = Palette.textMuted) }
                IconButton(onClick = { vm.moveFavorite(b, 1) }, enabled = i < vm.favorites.lastIndex) { Icon(Icons.Filled.KeyboardArrowDown, "下へ", tint = Palette.textMuted) }
                IconButton(onClick = { vm.toggleFavorite(b) }) { Icon(Icons.Filled.Close, "外す", tint = Palette.textMuted) }
            }
        }
    }
    Group("サイト(BBS メニュー)", note = "「板を探す」で板を選べる掲示板です。bbsmenu.json か bbsmenu.html の URL を足せます") {
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
                    OutlinedTextField(url, { url = it }, singleLine = true, label = { Text("BBS メニューの URL") }, placeholder = { Text("https://…/bbsmenu.json") })
                    OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("名前(なくてもよい)") })
                }
            },
            confirmButton = { TextButton(onClick = { if (url.isNotBlank()) vm.addSite(url, name); adding = false }) { Text("足す") } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("やめる") } },
        )
    }
}

@Composable
private fun BackupPage(vm: AppViewModel) {
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> if (uri != null) vm.exportBackup(uri) }
    val load = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.importBackup(uri) }
    Group(note = "設定・NG・お気に入り板・お気に入りのスレ・サイトを 1 つのファイルに書き出します。スレのログは入りません") {
        ActionRow("バックアップを書き出す") { save.launch("bbs-native-backup.json") }
        ActionRow("バックアップから戻す") { load.launch(arrayOf("application/json", "text/plain", "*/*")) }
    }
}

@Composable
private fun AboutPage() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "" }
    Group {
        InfoRow("名前", "bbs N(専ブラのネイティブ版)")
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
private fun TextRow(label: String, value: String, placeholder: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        Text(value.ifEmpty { placeholder }, color = if (value.isEmpty()) Palette.textMuted else Palette.accent, fontSize = 14.sp, maxLines = 1)
    }
    if (open) {
        var text by remember { mutableStateOf(value) }
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(label) },
            text = { OutlinedTextField(text, { text = it }, singleLine = true, placeholder = { Text(placeholder) }) },
            confirmButton = { TextButton(onClick = { onChange(text); open = false }) { Text("決める") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text("やめる") } },
        )
    }
}

/** 言葉の一覧(改行区切りの文字列で持つ)。× で外し、下の欄で足す */
@Composable
private fun WordList(value: String, placeholder: String, empty: String, onChange: (String) -> Unit) {
    val words = value.lines().map { it.trim() }.filter { it.isNotEmpty() }
    if (words.isEmpty()) Text(empty, Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
    for (w in words) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(w, Modifier.weight(1f), color = Palette.textBody, fontSize = 15.sp)
            IconButton(onClick = { onChange((words - w).joinToString("\n")) }) { Icon(Icons.Filled.Close, "外す", tint = Palette.textMuted) }
        }
    }
    var text by remember { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(text, { text = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text(placeholder) })
        IconButton(onClick = { if (text.isNotBlank() && text.trim() !in words) onChange((words + text.trim()).joinToString("\n")); text = "" }) {
            Icon(Icons.Filled.Add, "足す", tint = Palette.accent)
        }
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
