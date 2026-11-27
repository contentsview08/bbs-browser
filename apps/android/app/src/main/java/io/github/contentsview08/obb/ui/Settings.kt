package io.github.contentsview08.obb.ui

import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.material.icons.filled.Delete
import io.github.contentsview08.obb.data.active
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sell
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
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.CloudSync
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
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.LicensesFile
import io.github.contentsview08.obb.data.ThumbMode
import io.github.contentsview08.obb.data.PAST_TABS
import io.github.contentsview08.obb.data.shownPastTabs
import io.github.contentsview08.obb.data.normalizeForSearch
import io.github.contentsview08.obb.data.BoardMeta
import io.github.contentsview08.obb.bbs.siteDomain
import io.github.contentsview08.obb.bbs.uniqueSiteDomains
import io.github.contentsview08.obb.data.filterLicenses
import io.github.contentsview08.obb.data.parseLicenses
import io.github.contentsview08.obb.data.spdxLinks

private val TITLES = mapOf(
    "theme" to "スキンと配色", "text" to "文字", "list" to "スレ一覧", "thread" to "スレ表示", "media" to "画像と動画",
    "write" to "書き込み", "gestures" to "ジェスチャー", "bars" to "ツールバー設定", "behavior" to "スクロールと更新", "notify" to "通知", "ng" to "NG", "nglist" to "NG の一覧", "kwlist" to "キーワードの一覧",
    "sites" to "お気に入り板", "menus" to "BBS メニュー", "accounts" to "掲示板ごとの設定", "history" to "履歴", "backup" to "バックアップ", "about" to "このアプリについて", "custom" to "配色を編集", "skin" to "スキンを編集", "licenses" to "使っているソフトウェア", "sync" to io.github.contentsview08.obb.sync.SyncText.LABELS.getValue("section"),
)

/** 詳しい設定も出すか(設定の「詳しい設定を出す」か、検索から開いたとき) */
private val LocalAdvanced = androidx.compose.runtime.compositionLocalOf { false }

/**
 * 設定のパネル: 今の画面の上に下からせり上がって重なる。画面の積み重ねには入れないので、
 * × か戻る 1 回で閉じると、下の画面(スレの読んでいた位置も)がそのまま出てくる
 */
@Composable
fun SettingsPanel(vm: AppViewModel) {
    OverlayPanel(visible = vm.settingsOpen, onClose = { vm.closeSettings() }) {
        // 帯の左の長押し(たどってきた画面の一覧)は、下の画面のものなので出さない
        androidx.compose.runtime.CompositionLocalProvider(LocalNavLong provides null) {
            androidx.compose.runtime.key(vm.settingsKey) { SettingsScreen(vm, vm.settingsStart) }
        }
    }
}

/**
 * 上に重ねるパネルの殻(設定・未読)。下からせり上がり、戻るのジェスチャーで指に合わせて少し下がって縮み、離すと閉じる。
 * 開いたときに組み込むので、下の画面(スレの検索・ポップアップなど)の戻るより先に受ける
 */
@Composable
fun OverlayPanel(visible: Boolean, onClose: () -> Unit, content: @Composable () -> Unit) {
    val ease = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
    androidx.compose.animation.AnimatedVisibility(
        visible = visible,
        enter = if (Motion.reduced) androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(90))
        else androidx.compose.animation.slideInVertically(androidx.compose.animation.core.tween(320, easing = ease)) { it },
        exit = if (Motion.reduced) androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(90))
        else androidx.compose.animation.slideOutVertically(androidx.compose.animation.core.tween(240, easing = ease)) { it },
    ) {
        // 戻るのジェスチャーの途中の量(0〜1)
        var drag by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
        // 中のページにいるときは中の画面の戻るが後から足されて先に受け、1 つ上のページへ戻る
        androidx.activity.compose.PredictiveBackHandler(enabled = visible) { progress ->
            try {
                progress.collect { drag = it.progress }
                onClose()
            } catch (e: kotlinx.coroutines.CancellationException) {
                androidx.compose.animation.core.Animatable(drag).animateTo(0f, androidx.compose.animation.core.tween(160)) { drag = value }
                throw e
            }
        }
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    val sc = 1f - 0.06f * drag
                    scaleX = sc; scaleY = sc
                    translationY = drag * size.height * 0.08f
                    shape = RoundedCornerShape((24 * drag).dp)
                    clip = drag > 0f
                }
                .background(Palette.base)
                // 下の画面に指が抜けないようにする
                .pointerInput(Unit) {},
        ) {
            content()
        }
    }
}

/** 設定の画面: 入口の一覧から、項目ごとの画面へ進む */
@Composable
fun SettingsScreen(vm: AppViewModel, start: String? = null) {
    var sub by rememberSaveable { mutableStateOf(start) }
    // 検索から開いたページは、探した項目が隠れないよう詳しい設定も出す
    var viaSearch by rememberSaveable { mutableStateOf(false) }
    // ページの下の画面(使っているソフトウェア・自分の配色)は、戻ると親のページへ。検索から開いたページの詳しい設定は、そのページを出るまで出しておく
    val goBack = {
        sub = when (sub) {
            "licenses" -> "about"
            "nglist" -> "ng"
            "kwlist" -> "list"
            "custom" -> "theme"
            "skin" -> "theme"
            else -> if (sub?.startsWith(SITE_PAGE) == true) "accounts" else null
        }
        viaSearch = viaSearch && sub != null
    }
    BackHandler(enabled = sub != null) { goBack() }
    // 横になぞる操作は受けない(スライダーなどとぶつかる)。閉じるのは ×・OS の戻る
    Column(Modifier.fillMaxSize().background(Palette.base)) {
        // NG の一覧は、スレ一覧のような 1 つの画面(自分のヘッダーとタブ。一覧は自分でスクロール)
        if (sub == "nglist") { NgListPage(vm, onBack = goBack); return@Column }
        if (sub == "kwlist") { KeywordListPage(vm, onBack = goBack); return@Column }
        val close: @Composable () -> Unit = { BarIcon(Icons.Filled.Close, "設定を閉じる") { vm.closeSettings() } }
        if (sub == null) HeaderBar("設定", onNav = { vm.drawerOpen = true }, actions = close)
        else HeaderBar(TITLES[sub] ?: sub.orEmpty().removePrefix(SITE_PAGE), onNav = { goBack() }, navIsBack = true, actions = close)
        HorizontalDivider(color = Palette.border)
        // 一覧は長いので、外のスクロールに入れず自分でスクロールする
        if (sub == "licenses") { LicensesPage(); return@Column }
        androidx.compose.runtime.CompositionLocalProvider(LocalAdvanced provides (vm.prefs.showAdvanced || viaSearch)) {
        // ページを切り替えたら先頭から(スクロールの状態を使い回すと、上の画面で下の方の項目を押して開いたページが、その分ずれた所から始まる)
        androidx.compose.runtime.key(sub) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp).navigationBarsPadding()) {
            when (sub) {
                null -> SettingsTop(vm, { sub = it; viaSearch = true }) { sub = it }
                "theme" -> ThemePage(vm) { sub = it }
                "text" -> TextPage(vm)
                "list" -> ListPage(vm) { sub = it }
                "history" -> HistoryPage(vm)
                "thread" -> ThreadPage(vm)
                "media" -> MediaPage(vm)
                "write" -> WritePage(vm)
                "gestures" -> GesturesPage(vm)
                "bars" -> ToolbarPage(vm)
                "behavior" -> BehaviorPage(vm)
                "notify" -> NotifyPage(vm)
                "ng" -> NgPage(vm) { sub = it }
                "sites" -> SitesPage(vm, menus = false)
                "menus" -> SitesPage(vm, menus = true)
                "accounts" -> AccountsPage(vm) { sub = it }
                "backup" -> BackupPage(vm)
                "about" -> AboutPage(vm) { sub = it }
                "custom" -> CustomSchemeEditor(vm.prefs)
                "skin" -> SkinEditPage(vm)
                "sync" -> SyncPage(vm, LocalAdvanced.current)
                else -> if (sub?.startsWith(SITE_PAGE) == true) SiteSettings(vm, sub.orEmpty().removePrefix(SITE_PAGE))
            }
            // 詳しい項目を隠しているときは、ページの下に出し方を書いておく(押すとその場で出す)
            if (sub != null && sub !in setOf("about", "backup", "custom", "skin", "sites", "menus", "accounts", "history") && sub?.startsWith(SITE_PAGE) != true && !(vm.prefs.showAdvanced || viaSearch)) {
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
}

/** 検索欄(設定の上・使っているソフトウェアの一覧) */
@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String) {
    Row(
        // 高さを決めておく(× が出ても行の高さを変えない)
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp).background(Palette.surface2, RoundedCornerShape(10.dp)).heightIn(min = 40.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = Palette.textMuted, fontSize = 15.sp)
            androidx.compose.foundation.text.BasicTextField(
                value, onChange, Modifier.fillMaxWidth(), singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontSize = 15.sp),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
            )
        }
        if (value.isNotEmpty()) ClearTextButton { onChange("") }
    }
}

@Composable
private fun SettingsTop(vm: AppViewModel, openFromSearch: (String) -> Unit, open: (String) -> Unit) {
    val p = vm.prefs
    // 設定の検索(項目の名前と説明から探し、押すとその項目のあるページを開く)
    var q by rememberSaveable { mutableStateOf("") }
    SearchField(q, { q = it }, "設定を探す")
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
        NavRow(Icons.Filled.ColorLens, Color(0xFF8B5CF6), "スキンと配色", value = if (p.followOsTheme) "スマホに合わせる" else schemeOf(p.scheme).name) { open("theme") }
        NavRow(Icons.Filled.FormatSize, Color(0xFF6366F1), "文字", value = io.github.contentsview08.obb.data.Fonts.CHOICES.firstOrNull { it.key == p.fontFamily }?.name ?: "端末の標準") { open("text") }
    }
    Group("画面") {
        NavRow(Icons.AutoMirrored.Filled.ViewList, Color(0xFF0EA5E9), "スレ一覧", desc = "並び順・キーワード・ログ") { open("list") }
        NavRow(Icons.Filled.Forum, Color(0xFF3B82F6), "スレ表示", desc = "開いたときの位置・本文・リンク") { open("thread") }
        NavRow(Icons.Filled.History, Color(0xFF0D9488), "履歴", desc = "タブの並び・置き場") { open("history") }
        NavRow(Icons.Filled.Image, Color(0xFF06B6D4), "画像と動画", desc = "サムネイル・読み込み・グロ注意") { open("media") }
    }
    Group("書き込み") {
        NavRow(Icons.Filled.Edit, Color(0xFFF59E0B), "書き込み", desc = "名前・定型文・画像のアップロード") { open("write") }
    }
    Group("操作") {
        NavRow(Icons.Filled.Swipe, Color(0xFFEC4899), "ジェスチャー", desc = "なぞって操作する形") { open("gestures") }
        NavRow(Icons.Filled.Tune, Color(0xFF64748B), "ツールバー設定", desc = "ヘッダー・フッターのボタンと並び・大きさ・文字") { open("bars") }
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
        NavRow(Icons.Filled.Tune, Color(0xFF7C3AED), "掲示板ごとの設定", desc = "サイトごと・板ごとに変えたいもの") { open("accounts") }
    }
    Group {
        SwitchRow("詳しい設定を出す", p.showAdvanced, desc = "オフのときは、よく使う項目だけを出します(検索ではいつも全部から探せます)") { p.showAdvanced = it }
        NavRow(Icons.Filled.CloudSync, Color(0xFF2563EB), io.github.contentsview08.obb.sync.SyncText.LABELS.getValue("section"), desc = "別の端末と履歴やお気に入りを同期") { open("sync") }
        NavRow(Icons.Filled.Backup, Color(0xFF64748B), "バックアップ") { open("backup") }
        NavRow(Icons.Filled.Info, Color(0xFF6B7280), "このアプリについて") { open("about") }
    }
}

// ── 項目ごとの画面 ──

@Composable
private fun ThemePage(vm: AppViewModel, open: (String) -> Unit) {
    SchemePreview(Palette.scheme, Palette.own, Palette.accent, Palette.accentText)
    HorizontalDivider(color = Palette.border)
    val p = vm.prefs
    Group {
        SwitchRow("スマホのダーク・ライトに合わせる", p.followOsTheme, desc = "オンにすると、スマホの設定で配色が切り替わります") { p.followOsTheme = it }
        if (LocalAdvanced.current) SwitchRow("動きを減らす", p.reduceMotion, desc = "画面の移り方・新着の光り方・数字の繰り上がりを省きます。スマホの「アニメーションを削除」がオンでも同じになります") { p.reduceMotion = it }
    }
    // 配色とスキンは同じ族(スキン = 色だけ、または見た目まで含めたまとまり)。選ぶのは上に重ねるパネル(SkinPanel)で
    Group("スキン", note = "同梱の配色と、保存した・取り込んだスキンから選びます。スキンの保存・色の編集もそこで") {
        NavRow(Icons.Filled.ColorLens, Color(0xFF8B5CF6), "スキンを選ぶ…", value = currentSkinName(p)) { vm.openSkins() }
    }
    Group("差し色", note = "ボタン・選んだ印・タブの下線などの色。どのテーマの上でも読める濃さにしてあります") {
        ChoiceRow("差し色", p.accent, listOf("" to "テーマの色") + ACCENTS.map { it.key to it.name }) { p.accent = it }
    }
    Group("スタイル") {
        SegmentRow("レスの見た目", p.postStyle, pickablePostStyles(p.postStyle)) { p.postStyle = it }
    }
    StyleOptionsGroup(p)
    // 配色を 1 色ずつ編集する(前の「自分の配色を作る」。保存の場所は同じ customScheme なので、前に作った配色はそのまま使える)
    Group("配色を編集", note = "地・面・字・強調・未読・自分の 6 色と、帯・線・印などの細かい色を 1 つずつ選べます。編集した配色は「自分の配色」として使え、スキンとして保存もできます") {
        NavRow(Icons.Filled.ColorLens, Color(0xFF8B5CF6), "配色を編集…", value = if (p.customScheme.isEmpty()) null else if (p.scheme == "custom" && !p.followOsTheme) "自分の配色(使っています)" else "自分の配色") { open("custom") }
    }
}

/** いま使っているスキン(か配色)の名前。設定の「スキンを選ぶ…」の右に出す */
private fun currentSkinName(p: io.github.contentsview08.obb.data.Prefs): String {
    val key = p.lookThemeKey
    if (key.startsWith("saved:")) return key.removePrefix("saved:")
    if (key.startsWith("builtin:")) return schemeOf(key.removePrefix("builtin:")).name
    if (p.followOsTheme) return "OS に合わせる"
    return schemeOf(p.scheme).name
}

/**
 * スキンを選ぶパネル: 設定・未読と同じく上に重ねる(閉じると元の画面にそのまま戻る)。
 * 配色もスキンも同じ族として、大きな見本の札を縦に並べて眺めて選ぶ(拡張機能の一覧のように)。
 * 前の方が同梱の配色、後ろが保存した・取り込んだスキン。OS に合わせているときはダーク・ライトの配色を分けて並べる。下にスキンの管理
 */
@Composable
fun SkinPanel(vm: AppViewModel) {
    OverlayPanel(visible = vm.skinOpen, onClose = { vm.closeSkins() }) {
        androidx.compose.runtime.CompositionLocalProvider(LocalNavLong provides null, LocalAdvanced provides vm.prefs.showAdvanced) {
            val p = vm.prefs
            val lt = io.github.contentsview08.obb.data.LookTheme
            val sc = io.github.contentsview08.obb.data.SkinCatalog
            val savedThemes = remember(p.lookThemes) { lt.saved(p) }
            val context = androidx.compose.ui.platform.LocalContext.current
            // 配色だけのものと、スキン(見た目まで含む)に二分する。Discord 風・LINE 風の配色は同梱のスキンとして並べる
            val plain = SCHEMES.filter { it.key !in lt.BUILTIN_SCHEME_KEYS }
            fun schemeEntry(s: Scheme, on: Boolean, onPick: () -> Unit) = SkinEntry(
                s, Palette.extraOf(s, "own"), s.name, if (s.dark) "暗い配色" else "明るい配色", on = on,
                menu = listOf("この配色を元にスキンを作る…" to { vm.editSkin("scheme:${s.key}") }),
                onPick = onPick,
            )
            Column(Modifier.fillMaxSize().background(Palette.base)) {
                HeaderBar("スキン", onNav = { vm.closeSkins() }, navIsBack = true, actions = { BarIcon(Icons.Filled.Close, "閉じる") { vm.closeSkins() } })
                HorizontalDivider(color = Palette.border)
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    // OS のダーク・ライトに合わせる切り替えは設定のページに(ここは選ぶだけ)。合わせているときはダーク・ライトを分けて並べる
                    if (!p.followOsTheme) {
                        Group("配色", note = "色だけを変えます。押すとその場で切り替わります。長押しで、その配色を元にスキンを作れます") {
                            SkinCards(plain.map { s -> schemeEntry(s, on = p.lookThemeKey.isEmpty() && p.scheme == s.key) { p.scheme = s.key; p.lookThemeKey = "" } })
                        }
                    } else {
                        Group("ダークのとき") { SkinCards(plain.filter { it.dark }.map { s -> schemeEntry(s, on = p.darkScheme == s.key) { p.darkScheme = s.key } }) }
                        Group("ライトのとき") { SkinCards(plain.filter { !it.dark }.map { s -> schemeEntry(s, on = p.lightScheme == s.key) { p.lightScheme = s.key } }) }
                    }
                    Group("スキン", note = "配色とレスの見た目(と細かい表示・文字と余白)をまとめたものです。前の方が同梱、後ろが入れた・保存したスキン。長押しで、編集・消す") {
                        val builtin = lt.BUILTIN_SKINS.map { (key, style) ->
                            val s = schemeOf(key)
                            SkinEntry(
                                s, Palette.extraOf(s, "own"), s.name, "レスの見た目: " + postStyleName(style), on = p.lookThemeKey == "builtin:$key",
                                menu = listOf("このスキンを元に編集…" to { vm.editSkin("builtin:$key") }),
                            ) { vm.pickLookTheme("builtin:$key") }
                        }
                        val saved = savedThemes.map { t ->
                            val key = "saved:${lt.nameOf(t)}"
                            val s = lt.schemeOf(t) ?: Palette.scheme
                            SkinEntry(
                                s, lt.ownOf(t, s), lt.nameOf(t), lt.captionOf(t), on = p.lookThemeKey == key,
                                menu = listOf(
                                    "編集…" to { vm.editSkin(key) },
                                    "文字(JSON)でコピー" to { copyText(context, t.toString(2)); vm.toast = "コピーしました。掲示板などに貼って配れます" },
                                    "消す" to { vm.removeLookTheme(lt.nameOf(t)) },
                                ),
                            ) { vm.pickLookTheme(key) }
                        }
                        SkinCards(builtin + saved)
                    }
                    // 配っているスキンの一覧(data/SkinCatalog.kt)。押すと入る。入れてあれば押すと当てる
                    if (sc.ENABLED) Group("もっと探す", note = "配っているスキンの一覧です。入れたスキンは、配る側が新しくすると自動で入れ替わります") {
                        val cat = vm.skinCatalog
                        val err = vm.skinCatalogError
                        when {
                            err != null -> Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(err, Modifier.weight(1f), color = Palette.textMuted, fontSize = 13.sp)
                                TextButton(onClick = { vm.loadSkinCatalog() }) { Text("取り直す") }
                            }
                            cat == null -> Text("一覧を取っています…", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 13.sp)
                            cat.isEmpty() -> Text("配っているスキンはまだありません", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 13.sp)
                            else -> SkinCards(cat.map { e ->
                                val have = sc.installedOf(savedThemes, e.id)
                                val def = e.scheme?.let { CustomDef.parse(it.toString()) }
                                val s = def?.let { buildScheme(it) } ?: SCHEMES.firstOrNull { it.key == e.settings?.optString("scheme") } ?: Palette.scheme
                                val caption = e.note.ifEmpty { e.settings?.optString("postStyle")?.takeIf { it.isNotEmpty() }?.let { "レスの見た目: " + postStyleName(it) } ?: "" }
                                SkinEntry(
                                    s, def?.own ?: Palette.extraOf(s, "own"), e.name, caption,
                                    on = have != null && p.lookThemeKey == "saved:${lt.nameOf(have)}",
                                    action = if (have == null) "入れる" else null, busy = vm.skinBusy == e.id,
                                ) { if (have != null) vm.pickLookTheme("saved:${lt.nameOf(have)}") else vm.installCatalogSkin(e) }
                            })
                        }
                    }
                    // 色の編集は設定のページ(スキンを閉じて設定を開く。設定を閉じれば元の画面)
                    LookThemeGroup(vm) { vm.openSettings(it) }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

/**
 * スキンの編集のページ(設定 "skin")。vm.editSkin で開く。そのスキンが当たっていて、配色は「自分の配色」に写してあるので、
 * 配色の編集・差し色・スタイル・レスの出し方を変えるとすぐ映る。終わったら「このスキンに保存」
 */
@Composable
private fun SkinEditPage(vm: AppViewModel) {
    val p = vm.prefs
    val name = vm.editingSkin
    var saveDialog by remember { mutableStateOf(false) }
    PageLead(if (name != null) "スキン「$name」を編集しています。変えるとすぐ映ります。終わったら一番下の「このスキンに保存」" else "同梱のものを元に、新しいスキンを作ります。変えるとすぐ映ります。終わったら一番下の「スキンとして保存…」")
    Spacer(Modifier.height(8.dp))
    CustomSchemeEditor(p)
    Group("差し色") {
        ChoiceRow("差し色", p.accent, listOf("" to "テーマの色") + ACCENTS.map { it.key to it.name }) { p.accent = it }
    }
    Group("スタイル") {
        SegmentRow("レスの見た目", p.postStyle, pickablePostStyles(p.postStyle)) { p.postStyle = it }
    }
    StyleOptionsGroup(p)
    PostDisplayGroups(vm)
    Group {
        if (name != null) ActionRow("このスキンに保存", Icons.Filled.Check) { vm.saveEditedSkin(name) }
        ActionRow(if (name != null) "別の名前で保存…" else "スキンとして保存…") { saveDialog = true }
    }
    if (name != null) Text("入れたスキンを編集して保存すると、配る側が新しくしても自動では入れ替わらなくなります", Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = Palette.textMuted, fontSize = 12.sp)
    if (saveDialog) {
        var newName by remember { mutableStateOf(name ?: "") }
        AlertDialog(
            onDismissRequest = { saveDialog = false },
            title = { Text("スキンとして保存") },
            text = { OutlinedTextField(newName, { newName = it }, singleLine = true, label = { Text("名前") }) },
            confirmButton = { TextButton(enabled = newName.isNotBlank(), onClick = { vm.saveEditedSkin(newName); saveDialog = false }) { Text("保存") } },
            dismissButton = { TextButton(onClick = { saveDialog = false }) { Text("やめる") } },
        )
    }
}

/** スキン(配色)の札 1 枚分の中身 */
private class SkinEntry(
    val scheme: Scheme, val own: Color, val name: String, val caption: String, val on: Boolean,
    /** 右下のボタンの字(一覧の「入れる」)。null なら出さない */
    val action: String? = null,
    /** 入れている途中(ボタンを「…」に) */
    val busy: Boolean = false,
    /** 長押しで出すメニュー(名前と操作)。空なら長押しは何もしない */
    val menu: List<Pair<String, () -> Unit>> = emptyList(),
    val onPick: () -> Unit,
)

/** スキンの札を、横に 2 枚(広い画面では 3 枚)ずつ詰めて並べる */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkinCards(entries: List<SkinEntry>) {
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        val gap = 8.dp
        val cols = maxOf(2, (maxWidth / 200.dp).toInt())
        val w = (maxWidth - gap * (cols - 1)) / cols
        FlowRow(horizontalArrangement = Arrangement.spacedBy(gap), verticalArrangement = Arrangement.spacedBy(gap)) {
            for (e in entries) Box(Modifier.width(w)) { SkinCard(e) }
        }
    }
}

/** スキン(配色)1 つの札: 小さな見本(上の帯・スレ一覧の行・レス・書き込み欄)と、名前・一言。押すと当てる */
@Composable
private fun SkinCard(e: SkinEntry) {
    var menuOpen by remember { mutableStateOf(false) }
    Box {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .border(if (e.on) 2.dp else 1.dp, if (e.on) Palette.accent else Palette.border, RoundedCornerShape(8.dp))
            .background(Palette.surface).combinedClickable(onClick = e.onPick, onLongClick = if (e.menu.isEmpty()) null else ({ menuOpen = true })),
    ) {
        SkinMiniPreview(e.scheme, e.own)
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(e.name, color = Palette.textStrong, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (e.caption.isNotEmpty()) Text(e.caption, color = Palette.textMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (e.on) Icon(Icons.Filled.Check, "使っています", tint = Palette.accent, modifier = Modifier.size(18.dp))
            if (e.action != null) Text(
                if (e.busy) "…" else e.action,
                Modifier.background(Palette.accent, RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
                color = Palette.accentText, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            )
        }
    }
    // 長押しのメニュー(編集・消す など)
    androidx.compose.material3.DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
        for ((label, act) in e.menu) androidx.compose.material3.DropdownMenuItem(
            text = { Text(label, color = if (label == "消す") Palette.markDanger else Palette.textBody, fontSize = 14.sp) },
            onClick = { menuOpen = false; act() },
        )
    }
    }
}

/** 札の中の小さな見本(SchemePreview を半分ほどの大きさに詰めたもの。文字は 1 行ずつ) */
@Composable
private fun SkinMiniPreview(s: Scheme, own: Color) {
    val base = s.base
    Column(Modifier.fillMaxWidth().background(base)) {
        Row(Modifier.fillMaxWidth().background(s.bar).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ニュー速", color = s.textStrong, fontWeight = FontWeight.Bold, fontSize = 10.sp, modifier = Modifier.weight(1f), maxLines = 1)
            Text("︙", color = s.textMuted, fontSize = 10.sp)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(s.border))
        Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(s.unread))
            Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 5.dp)) {
                Text("読んだスレ", color = s.threadReadTitle, fontSize = 9.sp, maxLines = 1)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("3 時間前", color = s.textMuted, fontSize = 7.sp, modifier = Modifier.weight(1f), maxLines = 1)
                    Text("+12", color = s.unreadText, fontSize = 7.sp, fontWeight = FontWeight.Bold, modifier = Modifier.background(s.unread, RoundedCornerShape(50)).padding(horizontal = 4.dp, vertical = 1.dp))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(s.border))
        Text("まだ開いていないスレ", Modifier.padding(horizontal = 10.dp, vertical = 5.dp), color = s.textStrong, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        Box(Modifier.fillMaxWidth().height(1.dp).background(s.border))
        Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min).background(s.surface)) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(own))
            Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("12 ", color = s.textMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                    Text("名無し", color = s.posterName, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                    Text(" 12:34 ID:AbCd", color = s.textMuted, fontSize = 7.sp, maxLines = 1)
                }
                Text(">>10", color = s.link, fontSize = 9.sp)
                Text("本文はこの字の色", color = s.textBody, fontSize = 9.sp, maxLines = 1)
            }
        }
        Row(Modifier.fillMaxWidth().background(s.bar).padding(5.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("書き込む", Modifier.weight(1f).background(s.surface, RoundedCornerShape(6.dp)).border(1.dp, s.border, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 4.dp), color = s.textMuted, fontSize = 8.sp, maxLines = 1)
            Spacer(Modifier.width(5.dp))
            Box(Modifier.size(20.dp).background(s.accent, CircleShape), contentAlignment = Alignment.Center) { Text("➤", color = s.accentText, fontSize = 8.sp) }
        }
    }
}

/**
 * スキン(data/LookTheme.kt): 配色・レスの見た目・細かい表示・文字と余白をまとめたもの。
 * 保存したスキンをドロップダウンで選んで当てる(最初は 1 つもない)。いまの見た目に名前を付けて保存できる。
 * JSON の貼り付け・コピーは詳細設定(貼り付けたスキンは保存されて、次からドロップダウンに出る)。ファイルの書き出し・読み込みはバックアップから
 */
@Composable
private fun LookThemeGroup(vm: AppViewModel, open: (String) -> Unit) {
    val p = vm.prefs
    val lt = io.github.contentsview08.obb.data.LookTheme
    val context = androidx.compose.ui.platform.LocalContext.current
    val savedThemes = remember(p.lookThemes) { lt.saved(p) }
    val saved = remember(savedThemes) { savedThemes.map { lt.nameOf(it) } }
    var saveDialog by remember { mutableStateOf(false) }
    var removeDialog by remember { mutableStateOf(false) }
    val loadSkin = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.importScheme(uri) }
    val saveSkin = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> if (uri != null) vm.exportTheme(uri) }
    Group("スキンの管理", note = "スキンは、配色・レスの見た目・細かい表示・文字と余白をまとめたものです(色だけのスキンも作れます)。いまの見た目に名前を付けて保存すると、上の「配色とスキン」に並びます。スキンに入っている項目だけを上書きするので、当ててから気に入らない所を直せます。配られたスキンは、詳細設定の「JSON を貼り付けて当てる」で入ります") {
        // 色を 1 つずつ選ぶ(地・面・字・強調・未読・自分の 6 色と、細かい色)。編集した色は上の配色の「自分の配色」になり、スキンとして保存できる
        NavRow(Icons.Filled.ColorLens, Color(0xFF8B5CF6), "配色を編集…", value = if (p.customScheme.isEmpty()) null else "自分の配色") { open("custom") }
        ActionRow("いまの見た目をスキンとして保存…") { saveDialog = true }
        ActionRow("ファイルから入れる") { loadSkin.launch(arrayOf("application/json", "text/plain", "*/*")) }
        ActionRow("ファイルに書き出す") { saveSkin.launch("OBB-skin.json") }
        if (saved.isNotEmpty()) ActionRow("入れたスキンを消す…") { removeDialog = true }
        if (LocalAdvanced.current) {
            ActionRow("文字(JSON)を貼り付けて入れる") {
                val clip = runCatching {
                    context.getSystemService(android.content.ClipboardManager::class.java).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.trim()
                }.getOrNull()
                if (clip.isNullOrEmpty()) vm.toast = "クリップボードに JSON がありません" else vm.applyLookJsonNow(clip)
            }
            ActionRow("文字(JSON)でコピー") { copyText(context, vm.themeJson()); vm.toast = "コピーしました。掲示板などに貼って配れます" }
        }
    }
    if (saveDialog) {
        val current = p.lookThemeKey.takeIf { it.startsWith("saved:") }?.removePrefix("saved:") ?: ""
        var name by remember { mutableStateOf(current) }
        AlertDialog(
            onDismissRequest = { saveDialog = false },
            title = { Text("スキンとして保存") },
            text = {
                Column {
                    Text("いまの配色・レスの見た目・細かい表示・文字と余白を、この名前のスキンとして保存します。同じ名前があれば入れ替えます", color = Palette.textMuted, fontSize = 13.sp)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("名前") })
                }
            },
            confirmButton = { TextButton(enabled = name.isNotBlank(), onClick = { vm.saveLookTheme(name); saveDialog = false }) { Text("保存") } },
            dismissButton = { TextButton(onClick = { saveDialog = false }) { Text("やめる") } },
        )
    }
    if (removeDialog) AlertDialog(
        onDismissRequest = { removeDialog = false },
        title = { Text("入れたスキンを消す") },
        text = {
            Column {
                if (saved.isEmpty()) Text("保存したスキンはありません", color = Palette.textMuted, fontSize = 13.sp)
                for (n in saved) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(n, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
                    IconButton(onClick = { vm.removeLookTheme(n) }) { Icon(Icons.Filled.Delete, "消す", tint = Palette.markDanger) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { removeDialog = false }) { Text("閉じる") } },
    )
}

/** 選んでいる見た目だけの設定(見出しは「〇〇の設定」)。表示スタイルのシートの「スタイル」と同じ言葉・同じ並び。値は見た目ごとに別々に覚える */
@Composable
private fun StyleOptionsGroup(p: io.github.contentsview08.obb.data.Prefs) {
    val style = p.postStyle
    val o = p.styleOptions(style)
    fun set(n: io.github.contentsview08.obb.data.StyleOptions) = p.setStyleOptions(style, n)
    Group("${postStyleName(style)}の設定", note = "見た目ごとに別々に覚えます") {
        if (style in io.github.contentsview08.obb.bbs.TREE_STYLES) {
            SwitchRow("ツリー表示", o.tree, desc = "アンカーの付いたレスを、最初のアンカー先のすぐ下に字下げして並べます。絞り込み・検索・実況モードの間は番号の順です") { set(o.copy(tree = it)) }
            if (o.tree) {
                val d = io.github.contentsview08.obb.data.TREE_DEPTH_RANGE
                SliderRow("字下げの深さの上限", o.treeDepth.toFloat(), d.first.toFloat()..d.last.toFloat(), steps = d.last - d.first - 1, label = "${o.treeDepth} 段") { set(o.copy(treeDepth = snapInt(it).coerceIn(d))) }
            }
        } else {
            SegmentRow("返信先の引用", o.quote, io.github.contentsview08.obb.data.QUOTE_MODES) { set(o.copy(quote = it)) }
            SwitchRow("続けて書いたレスをまとめる", o.group, desc = "同じ人が続けて書いたレスの名前・アイコンを省きます") { set(o.copy(group = it)) }
        }
    }
}

/**
 * 配色の見本を並べて選ぶ。dark を渡すと、その明るさの配色だけ。
 * skins を渡すと、同じ並びの後ろに保存したスキンの札(地の上に 面・強調・未読・字の代表の色。LookTheme.swatch)を足す。押すと当てる
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SchemeGrid(
    selected: String, dark: Boolean? = null,
    skins: List<org.json.JSONObject> = emptyList(), skinKey: String = "", showSchemes: Boolean = true, onPickSkin: (String) -> Unit = {},
    onPick: (String) -> Unit,
) {
    FlowRow(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (s in if (showSchemes) allSchemes().filter { dark == null || it.dark == dark } else emptyList()) {
            val on = s.key == selected
            Column(
                Modifier.width(100.dp).clip(RoundedCornerShape(6.dp)).border(if (on) 2.dp else 1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(6.dp))
                    .clickable { onPick(s.key) },
            ) {
                // 見本: 地・面・字・強調色・未読・人気の色
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
        val lt = io.github.contentsview08.obb.data.LookTheme
        for (t in skins) {
            val name = lt.nameOf(t)
            val key = "saved:$name"
            val on = key == skinKey
            val sw = lt.swatch(t) ?: listOf(Palette.base, Palette.surface, Palette.accent, Palette.unread, Palette.textStrong)
            Column(
                Modifier.width(100.dp).clip(RoundedCornerShape(6.dp)).border(if (on) 2.dp else 1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(6.dp))
                    .clickable { onPickSkin(key) },
            ) {
                Box(Modifier.fillMaxWidth().height(56.dp).background(sw[0]).padding(10.dp), contentAlignment = Alignment.Center) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (c in sw.drop(1)) Box(Modifier.size(16.dp).background(c, RoundedCornerShape(4.dp)).border(1.dp, Palette.border.copy(alpha = 0.6f), RoundedCornerShape(4.dp)))
                    }
                }
                Row(Modifier.fillMaxWidth().background(Palette.surface).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(name, Modifier.weight(1f), color = Palette.textStrong, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (on) Icon(Icons.Filled.Check, null, tint = Palette.accent, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
private fun TextPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("字", note = "端末の標準以外は、選んだときに Google Fonts から 1 回だけ取り、取り終えてから切り替わります(Wi-Fi のときがおすすめ)") {
        val context = androidx.compose.ui.platform.LocalContext.current
        val f = io.github.contentsview08.obb.data.Fonts
        // ファイルがあるかの確かめは、スライダーを動かすたびに走らせない(字を取り終えた・消したときだけ調べ直す)
        var fontsDeleted by remember { androidx.compose.runtime.mutableIntStateOf(0) }
        val downloaded = remember(p.fontFamily, f.loading, fontsDeleted, p.userFontName) { (f.CHOICES.map { it.key } + f.FILE).filter { f.isDownloaded(context, it) }.toSet() }
        FontRow(p.fontFamily, downloaded, fileName = p.userFontName.takeIf { f.FILE in downloaded }) { key -> f.pick(context, key) { p.fontFamily = it } }
        // 自分のフォントのファイル(ttf・otf・ttc)。その字にない文字(絵文字など)は端末の字で出る
        val pickFont = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) { vm.importUserFont(uri); fontsDeleted++ } }
        ActionRow(if (f.FILE in downloaded) "別のフォントのファイルを選ぶ…" else "フォントのファイルから選ぶ…") { pickFont.launch(arrayOf("font/*", "application/x-font-ttf", "application/x-font-otf", "font/collection", "application/octet-stream")) }
        if ((f.CHOICES.any { it.key != p.fontFamily && it.key in downloaded }) || (p.fontFamily != f.FILE && f.FILE in downloaded)) ActionRow("使っていない字を消す") { f.deleteUnused(context, p.fontFamily); fontsDeleted++ }
    }
    Group("見本") { SamplePosts(vm) }
}

@Composable
private fun ListPage(vm: AppViewModel, open: (String) -> Unit) {
    val p = vm.prefs
    Group("並び") {
        ChoiceRow(
            "板を開いたときの並び", p.threadSort,
            listOf("subject" to "スレ順(標準)", "momentum" to "勢い順", "newest" to "新しい順", "count" to "レス数順"),
        ) { p.threadSort = it }
        SwitchRow("未読を上に", p.unreadFirst, desc = "一度見たことがあり、新着レスのあるスレを今の並びのまま一覧の上にまとめます。見たことのないスレは入りません") { p.unreadFirst = it }
    }
    if (LocalAdvanced.current) Group("行の見た目") {
        ChoiceRow("行の形", p.listShape, listOf("normal" to "ふつう", "compact" to "コンパクト(スレタイ 1 行と数だけ)")) { p.listShape = it }
    }
    // 「板を開いたときの並び」の説明がここを指すので、ふだんの設定に出す
    Group("タブ", note = "一覧の下に出すタブと、その並び(左から)") {
        val all = listOf("order" to "スレ順", "unread" to "未読", "visited" to "閲覧済み", "momentum" to "勢い順", "newest" to "新しい順", "count" to "レス数順", "keyword" to "キーワード")
        val on = p.listTabs.split(',').filter { k -> all.any { it.first == k } }
        fun item(k: String) = DockItem(k, all.first { it.first == k }.second, ListTab.entries.firstOrNull { it.key == k }?.icon)
        ChipDock(
            docks = listOf(DockSpec("tabs", "一覧の下のタブ(実際のフッターと同じ並び)", on.map(::item), emptyHint = "ここに入れる", alignEnd = false)),
            palette = all.filter { it.first !in on }.map { item(it.first) },
            onPlace = { _, id, index -> p.listTabs = on.toMutableList().apply { add(index.coerceIn(0, size), id) }.joinToString(",") },
            onMove = { _, from, to -> p.listTabs = on.toMutableList().apply { add(to, removeAt(from)) }.joinToString(",") },
            onRemove = { _, index -> p.listTabs = on.filterIndexed { i, _ -> i != index }.joinToString(",") },
            paletteTitle = "使えるタブ",
            plainPlaced = true,
            // 実際のフッターのタブと同じ見た目(アイコン・名前・並べ方は下向きの矢印)。箱の外も同じ形で
            look = { it, _ ->
                Row(Modifier.heightIn(min = 40.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (it.icon != null) Icon(it.icon, null, tint = Palette.textMuted, modifier = Modifier.size(17.dp))
                    Text(it.name, color = Palette.textMuted, fontSize = 14.sp)
                    if (it.id !in setOf("unread", "visited", "keyword")) Icon(Icons.Filled.ArrowDownward, null, tint = Palette.textMuted.copy(alpha = 0.5f), modifier = Modifier.size(14.dp))
                }
            },
        )
    }
    var kwAdding by remember { mutableStateOf(false) }
    Group("キーワード", note = "スレタイの言葉(正規表現も)や立てた人で、スレを一覧のいちばん上に帯でまとめて出します。正規表現には別名を付けて帯に出せます。板ごとにもできます。帯を長押しすると直せます") {
        NavRow(Icons.Filled.Sell, Color(0xFF0EA5E9), "キーワードの一覧", desc = "スレタイの言葉・立てた人。長押しで選んでまとめて有効・無効・削除", value = "${p.keywordRules.size} 件") { open("kwlist") }
        ActionRow("キーワードを足す", Icons.Filled.Add) { kwAdding = true }
        SwitchRow("キーワードに当たるスレを帯で上にまとめる", p.keywordBands, desc = "切ると、ふだんの並びのまま出します。キーワードに当たるスレだけを見るには、タブに「キーワード」を出します") { p.keywordBands = it }
    }
    if (kwAdding) KeywordEditSheet(io.github.contentsview08.obb.data.KeywordRule(), openBoardOf(vm), vm.favorites.map { it.url to it.name }, isNew = true, onDismiss = { kwAdding = false }) { p.upsertKeywordRule(it); kwAdding = false }
    if (LocalAdvanced.current) Group("閲覧履歴(ログ)", note = "この日数より長く開いていないスレのログ(閲覧履歴とレス)を消します。0 なら消しません。お気に入りのスレ・自分が書き込んだスレは消しません。消したスレは、もう一度開けば取り直します") {
        NumberRow("残す日数", p.logRetentionDays, unit = "日", range = 0..3650, zeroLabel = "消さない", presets = listOf(7, 30, 90, 365, 0)) { p.logRetentionDays = it }
        ActionRow("今すぐ消す") { vm.pruneLogsNow() }
    }
}

@Composable
private fun HistoryPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("タブ", note = "履歴の画面に出すタブと、その並び(左から)。すべては外せません") {
        val on = shownPastTabs(p.pastTabs)
        fun item(k: String) = DockItem(k, PAST_TABS.first { it.first == k }.second, null)
        ChipDock(
            docks = listOf(DockSpec("tabs", "履歴のタブ", on.map(::item), minItems = 1, alignEnd = false)),
            palette = PAST_TABS.filter { it.first !in on }.map { item(it.first) },
            onPlace = { _, id, index -> p.pastTabs = on.toMutableList().apply { add(index.coerceIn(0, size), id) }.joinToString(",") },
            onMove = { _, from, to -> p.pastTabs = on.toMutableList().apply { add(to, removeAt(from)) }.joinToString(",") },
            onRemove = { _, index -> if (on.size > 1) p.pastTabs = on.filterIndexed { i, _ -> i != index }.joinToString(",") },
            paletteTitle = "使えるタブ",
        )
    }
    Group(note = "履歴の画面のタブを置く場所です。既定はフッター(下)です") {
        ChoiceRow("タブの置き場", p.pastTabsPosition, listOf("footer" to "フッター(下)", "header" to "ヘッダー(上)")) { p.pastTabsPosition = it }
    }
}

/** 選べるもの。表示スタイルのシートの「レスの表示」と同じ言葉にするため、ここにまとめる */
internal val DATE_STYLES = listOf("md_w_hms" to "月日・曜日・時刻(11/02(月) 19:01:15)", "md_hm" to "月日と時分(11/02 19:01)", "full" to "すべて(年・秒の下の桁まで)")
internal val ID_POSITIONS = listOf("header" to "日時の後ろ", "topRight" to "レスの右上", "bottomRight" to "レスの右下")
internal val HEAT_STYLES = listOf("left" to "左の帯", "right" to "右の帯", "text" to "本文の色")

@Composable
private fun ThreadPage(vm: AppViewModel) {
    val p = vm.prefs
    // 段は 1 つの話題ずつ(開いたとき / 名前と ID / 日時 / 人気のレス / リンクと本文 / ミニマップ)。行の名前は「もの」の名前、説明は 1 行。
    // PC 版の設定「スレ表示」と同じ段・同じ順(docs/settings-plan.md)
    PageLead("スレを開いたときの位置と、レスの出し方。変えるとすぐ下の見本に映ります")
    Group { SamplePosts(vm) }
    Group("開いたとき") {
        ChoiceRow("開く位置", p.openPosition, listOf("unread" to "前回読んだところ", "top" to "先頭", "bottom" to "いちばん下")) { p.openPosition = it }
        SwitchRow("次スレの候補", p.showNextCandidatesAtEnd, desc = "スレが終わったら一番下に出します。︙ の「次スレを探す」でも探せます") { p.showNextCandidatesAtEnd = it }
        SwitchRow("次の未読スレへのボタン", p.showNextUnreadAtEnd, desc = "一番下に、スレ一覧で次に未読のあるスレへ") { p.showNextUnreadAtEnd = it }
    }
    PostDisplayGroups(vm)
}

/** レスの出し方の段(名前と ID / 日時 / 人気のレス / リンクと本文 / ミニマップ)。スレ表示のページと、スキンの編集のページで使う */
@Composable
private fun PostDisplayGroups(vm: AppViewModel) {
    val p = vm.prefs
    Group("名前と ID") {
        SwitchRow("名無しの名前を省く", p.omitNoname, desc = "そのスレで一番多い名前と、板の既定の名前") { p.omitNoname = it }
        SwitchRow("名前欄を薄く", p.nameSubtle, desc = "日付や ID と同じ色・同じ大きさに") { p.nameSubtle = it }
        SwitchRow("ワッチョイを短く", p.watchoiShort, desc = "(ワッチョイ 1a2b-3c4d) → (1a2b-3c4d)") { p.watchoiShort = it }
        SwitchRow("ID を短く", p.idShort, desc = "先頭の 6 文字だけ。数えるのと色は ID 全体で") { p.idShort = it }
        SwitchRow("ID ごとの色", p.idStyle == "color", desc = "2 回以上書いた ID に色を付け、同じ人を目で追えるように") { p.idStyle = if (it) "color" else "none" }
        ChoiceRow("ID の位置", p.idPosition, ID_POSITIONS) { p.idPosition = it }
        // Discord 風・LINE 風のアイコンの種。ワッチョイは週ごとなので、同じ人が同じアイコンで続く
        ChoiceRow("アイコンの種", if (p.iconFromWatchoi) "watchoi" else "id", listOf("watchoi" to "ワッチョイ(あれば)", "id" to "ID")) { p.iconFromWatchoi = it == "watchoi" }
        SwitchRow("スレ主の印", p.highlightOp, desc = ">>1 と同じ ID のレスに「主」") { p.highlightOp = it }
    }
    // LINE 風は吹き出しの隣に時刻だけを出すので、日時の出し方は効かない
    if (p.postStyle != "line") Group("日時") {
        ChoiceRow("日時の出し方", p.dateStyle, DATE_STYLES) { p.dateStyle = it }
    }
    Group("人気のレス", note = "返信が 3 件からのレス。多いほど赤く") {
        ChoiceRow("示し方", p.heatStyle, HEAT_STYLES) { p.heatStyle = it }
    }
    Group("リンクと本文") {
        SwitchRow("リンクのカード", p.showLinkPreview, desc = "ページの題と画像を、本文の下に小さく") { p.showLinkPreview = it }
        SwitchRow("リンクをアプリの中で開く", p.openLinksInApp, desc = "オフ: ブラウザで開く") { p.openLinksInApp = it }
        SwitchRow("URL を短く", p.urlShorten, desc = "https:// を外し、画像の URL は「画像」の札に") { p.urlShorten = it }
        SwitchRow("空行を整える", p.tidyBlankLines, desc = "3 行以上続いた空行を 1 行に") { p.tidyBlankLines = it }
    }
    Group("ミニマップ") {
        SwitchRow("ミニマップ", p.showMinimap, desc = "右端に、人気レス・自分のレス・画像の位置") { p.showMinimap = it }
    }
}

@Composable
private fun MediaPage(vm: AppViewModel) {
    val p = vm.prefs
    Group("サムネイル") {
        ChoiceRow("サムネイルを読み込む", p.thumbMode.name, ThumbMode.entries.map { it.name to it.label }) { p.thumbMode = ThumbMode.valueOf(it) }
        // 大きさは 8dp ずつ。動かすと下の枠がその大きさになる
        SliderRow("大きさ", p.postThumbSize.toFloat(), 56f..200f, steps = 17, label = "${p.postThumbSize}dp") { p.postThumbSize = snapInt(it, 8).coerceIn(56, 200) }
        ThumbSample(p.postThumbSize)
    }
    if (LocalAdvanced.current) Group("グロ注意", note = "この言葉を含むレスと、そのアンカー先の画像を、押すまでぼかします") {
        SwitchRow("グロ注意の画像をぼかす", p.blurGross) { p.blurGross = it }
        if (p.blurGross) EditableWordList(p.grossWords, "目印の言葉", "言葉を足す", "言葉がありません") { p.grossWords = it }
    }
    if (LocalAdvanced.current) {
        Group("画像の保存先", note = "画像ビューアーの保存で、ここへ保存します。フォルダとファイル名は、板・スレの名前や日付で分けられます") {
            SegmentRow("保存先", p.imageSaveBase, listOf("pictures" to "ピクチャ", "download" to "ダウンロード")) { p.imageSaveBase = it }
            SaveNameRow(p.imageSaveName) { p.imageSaveName = it }
        }
        SaveNamePreview(p.imageSaveBase, p.imageSaveName)
        SaveNameHelp { p.imageSaveName = it }
    }
}

/** 見本の画像の保存先(土台のフォルダの名前から) */
private fun saveNamePreview(base: String, pattern: String): String =
    (listOf(io.github.contentsview08.obb.data.saveBaseLabel(base)) + io.github.contentsview08.obb.data.savePath(pattern, io.github.contentsview08.obb.data.SAVE_NAME_SAMPLE_URL, "jpg", io.github.contentsview08.obb.data.saveNameSample())).joinToString("/")

/** フォルダとファイル名の書き方。決める前の入力にも見本を出す */
@Composable
private fun SaveNameRow(value: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("フォルダとファイル名", Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        Text(value.ifEmpty { io.github.contentsview08.obb.data.Prefs.DEFAULT_IMAGE_SAVE_NAME }, color = Palette.accent, fontSize = 14.sp, maxLines = 1)
    }
    if (open) {
        var text by remember { mutableStateOf(value) }
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text("フォルダとファイル名") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    OutlinedTextField(text, { text = it }, singleLine = true, placeholder = { Text(io.github.contentsview08.obb.data.Prefs.DEFAULT_IMAGE_SAVE_NAME) })
                    Text("見本: " + saveNamePreview(LocalPrefs.current.imageSaveBase, text), Modifier.padding(top = 8.dp), color = Palette.textMuted, fontSize = 12.sp, lineHeight = 17.sp)
                    Text("押すと書き方に足します", Modifier.padding(top = 10.dp, bottom = 2.dp), color = Palette.textMuted, fontSize = 12.sp)
                    for ((name, label) in io.github.contentsview08.obb.data.SAVE_NAME_VARS) {
                        Row(Modifier.fillMaxWidth().clickable { text += name.substringBefore(' ') }.padding(vertical = 3.dp)) {
                            Text(name, Modifier.width(120.dp), color = Palette.accent, fontSize = 12.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                            Text(label, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 16.sp)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { onChange(text.trim().ifEmpty { io.github.contentsview08.obb.data.Prefs.DEFAULT_IMAGE_SAVE_NAME }); open = false }) { Text("決める") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text("やめる") } },
        )
    }
}

@Composable
private fun SaveNamePreview(base: String, pattern: String) {
    Text(
        "見本(エッヂの「なんでも実況E」の 12 番の abc123.jpg): " + saveNamePreview(base, pattern),
        Modifier.padding(start = 20.dp, end = 20.dp, top = 6.dp), color = Palette.textMuted, fontSize = 12.sp, lineHeight = 17.sp,
    )
}

/** 使える変数と例(例を押すとその書き方にする) */
@Composable
private fun SaveNameHelp(onPick: (String) -> Unit) {
    Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp)) {
        Text(io.github.contentsview08.obb.data.SAVE_NAME_NOTE, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 17.sp)
        Spacer(Modifier.height(6.dp))
        for ((name, label) in io.github.contentsview08.obb.data.SAVE_NAME_VARS) {
            Row(Modifier.padding(vertical = 1.dp)) {
                Text(name, Modifier.width(120.dp), color = Palette.textBody, fontSize = 12.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                Text(label, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 16.sp)
            }
        }
        Text("例(押すとその書き方にします)", Modifier.padding(top = 8.dp, bottom = 2.dp), color = Palette.textMuted, fontSize = 12.sp)
        val sample = io.github.contentsview08.obb.data.saveNameSample()
        for (ex in io.github.contentsview08.obb.data.SAVE_NAME_EXAMPLES) {
            Column(Modifier.fillMaxWidth().clickable { onPick(ex) }.padding(vertical = 4.dp)) {
                Text(ex, color = Palette.accent, fontSize = 12.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                Text("→ " + io.github.contentsview08.obb.data.savePath(ex, io.github.contentsview08.obb.data.SAVE_NAME_SAMPLE_URL, "jpg", sample).joinToString("/"), color = Palette.textMuted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun WritePage(vm: AppViewModel) {
    val p = vm.prefs
    // 書き込むと、そのとき使った名前に変わる(PC 版と同じ)。それを言っておかないと、設定が勝手に変わったように見える
    Group("名前", note = "書き込み欄に最初に入る名前です。書き込むと、そのとき使った名前に変わります(板ごとの名前を決めた板は別)") {
        TextRow("名前", p.postName, "名無し") { p.postName = it }
        TextRow("メール", p.postMail, "sage など") { p.postMail = it }
    }
    Group("定型文", note = "レスを長押しすると「「草」とすぐ書き込む」のように、その言葉を >>番号 付きですぐ書き込めます") {
        EditableWordList(p.quickPhrases, "定型文", "定型文を足す", "定型文はありません", sortable = true) { p.quickPhrases = it }
    }
    if (LocalAdvanced.current) Group("画像のアップロード", note = "画像を置き場に上げて、本文に URL を入れます。上げた画像は誰でも見られ、このアプリからは置き場から消せません(imgbb は履歴の長押しから削除ページを開けます)。撮影場所などの情報(EXIF)は描き直して取り除きます。hono-bbs の板では、いつもその掲示板の置き場に上げます。「サイトの画面」の上げ先は、画像を押すとそのサイトの画面が開き、上げたリンクを本文に入れます") {
        ChoiceRow(
            "上げ先", p.uploadHost,
            io.github.contentsview08.obb.data.Uploader.HOSTS.map { h -> h.key to "${h.name}(${if (h.kind == "web") "サイトの画面" else "API"})・${h.note}" },
        ) { p.uploadHost = it }
        // 鍵は画面をのぞかれても読めないよう伏せる
        if (p.uploadHost == "imgur") TextRow("imgur の Client-ID", p.imgurClientId, "api.imgur.com で登録した Client-ID", secret = true) { p.imgurClientId = it.trim() }
        if (p.uploadHost == "imgbb") TextRow("imgbb の API キー", p.imgbbApiKey, "api.imgbb.com で発行した API キー", secret = true) { p.imgbbApiKey = it.trim() }
        ChoiceRow(
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
        if (LocalAdvanced.current) SwitchRow("レスをダブルタップで返信", p.doubleTapReply, desc = ">>番号 を入れて書き込み欄を開きます。オンにすると、1 回のタップ(ツリーを開く)が少し遅れます") { p.doubleTapReply = it }
        if (p.gesturesEnabled) SliderRow("感度", p.gestureSensitivity.toFloat(), 1f..5f, steps = 3, label = listOf("鈍い", "少し鈍い", "標準", "少し敏感", "敏感")[p.gestureSensitivity - 1]) { p.gestureSensitivity = snapInt(it).coerceIn(1, 5) }
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
        SwitchRow("下へスクロールしたら、ヘッダーとフッターを隠す", p.hideBarsOnScroll, desc = "上へスクロールすると、すぐ戻ります") { p.hideBarsOnScroll = it }
        if (LocalAdvanced.current) SwitchRow("いちばん下を見ているときは、新着まで送る", p.autoScrollOnNew) { p.autoScrollOnNew = it }
        if (LocalAdvanced.current) SwitchRow("ログを削除する前に確かめる", p.confirmDeleteLog) { p.confirmDeleteLog = it }
    }
    Group("更新") {
        ChoiceRow(
            "開いているスレの自動更新", p.autoRefreshSec.toString(),
            listOf(0, 5, 10, 20, 30, 60).map { it.toString() to if (it == 0) "しない" else "$it 秒ごと" },
        ) { p.autoRefreshSec = it.toInt() }
    }
    Group("実況モード", note = "スレ表示の ︙ の「実況モード」で入ります。下まで読むまでは流す速さで流し、追いついた後は届いたレスを 1 つずつ下に積みます。流す速さは、実況モードの間に右上のスライダーでも変えられます") {
        ChoiceRow(
            "更新の間隔", p.liveRefreshSec.toString(),
            LIVE_REFRESH_CHOICES.map { it.toString() to "$it 秒ごと" },
        ) { p.liveRefreshSec = it.toInt() }
        SliderRow("流す速さ", posOfLiveSpeed(p.liveSpeed), 0f..1f, steps = 0, label = "1 秒に ${liveSpeedText(p.liveSpeed)} 行") { p.liveSpeed = liveSpeedOfPos(it) }
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
        // 拒まれたら、届かない通知をオンのまま見せない
        if (!ok) {
            p.osNotify = false
            vm.toast = "通知が許可されていません。Android の設定 → アプリ → OBB → 通知 から許可してください"
        }
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
        SwitchRow("あなた宛てのレス", p.notifyReply, desc = "自分が書き込んだスレで、自分の書き込みにアンカーが付いたとき。「スクロールと更新」の閲覧履歴の新着の確認の間隔で確かめます(「しない」なら届きません)") { p.notifyReply = it }
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
private fun NgPage(vm: AppViewModel, open: (String) -> Unit) {
    val p = vm.prefs
    var adding by remember { mutableStateOf(false) }
    val today = io.github.contentsview08.obb.data.today()
    Group("一覧", note = "レスを長押しして、ID・名前・言葉を NG に足すこともできます。スレタイ・立てた人の NG は、スレを長押しして足せます") {
        // 一覧は長くなるので、設定の中に埋め込まず 1 つの画面で(種類のタブ・検索・長押しとなぞりで選んでまとめて操作)
        NavRow(Icons.Filled.Block, Color(0xFFEF4444), "NG の一覧", desc = "種類ごとのタブと検索。行を長押しして選び、なぞって範囲を選べます", value = "${p.ngRules.size} 件") { open("nglist") }
        ActionRow("NG を足す", Icons.Filled.Add) { adding = true }
        val expiredCount = p.ngRules.count { it.expiresOnDate != null && it.expiresOnDate < today }
        if (expiredCount > 0) ActionRow("期限の切れた $expiredCount 件を片づける", androidx.compose.material.icons.Icons.Filled.Delete) { vm.dropExpiredNg() }
    }
    Group("見せ方") {
        ChoiceRow("NG のレス", p.ngMode, listOf("aborn" to "あぼーん(1 行に畳む)", "hide" to "透明あぼーん(消す)", "dim" to "薄く表示(会話の流れを残す)")) { p.ngMode = it }
        SwitchRow("2 つ以上続いたあぼーんを 1 行にまとめる", p.groupNg, desc = "「あぼーん × 12(NG 12)」のように出します。押すと 1 つずつのあぼーんに広がり、そこから中身を見られます") { p.groupNg = it }
    }
    Group("AI NG(条件で見つける)", note = "「他人を煽っている」のように文で書いた条件に当たるレスを、この端末の中の判定モデルで見つけます。条件ごとに、隠す・畳む・印だけを選べます") {
        AiNgSettings(vm)
    }
    // 「この板だけ」にできる板: 開いているスレの板、なければ開いているスレ一覧の板
    val board = when (val pg = vm.stack.lastOrNull { it is io.github.contentsview08.obb.Page.Thread || it is io.github.contentsview08.obb.Page.Threads }) {
        is io.github.contentsview08.obb.Page.Thread -> pg.summary.boardUrl to (vm.favorites.firstOrNull { it.url == pg.summary.boardUrl }?.name ?: pg.summary.boardUrl)
        is io.github.contentsview08.obb.Page.Threads -> pg.board.url to pg.board.name
        else -> null
    }
    if (adding) NgEditSheet(NgRule("content", ""), board, isNew = true, onDismiss = { adding = false }, boards = vm.favorites.map { it.url to it.name }) { vm.saveNg(it); adding = false }
}

/** 名前と今の値を 1 行に出し、押すとドロップダウンで選ぶ(NG の効く板・期限) */
@Composable
internal fun PickerRow(label: String, value: String, options: List<Pair<String, () -> Unit>>) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, Palette.border, RoundedCornerShape(8.dp)).clickable { open = true }.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = Palette.textMuted, fontSize = 12.sp)
            Spacer(Modifier.width(12.dp))
            Text(value, Modifier.weight(1f), color = Palette.textStrong, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Filled.ArrowDropDown, null, tint = Palette.textMuted)
        }
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((name, pick) in options) androidx.compose.material3.DropdownMenuItem(
                text = { Text(name, color = if (name == value) Palette.accent else Palette.textBody, fontSize = 14.sp) },
                onClick = { open = false; pick() },
            )
        }
    }
}

/**
 * NG 1 つの編集(下から出る板): 種類・文字・正規表現(読めないときは理由)・有効・効く板・期限・メモ・試し(当たる所に色)。
 * hono-bbs の web・PC 版の NgEditor と同じ項目・同じ言葉
 */
@Composable
fun NgEditSheet(
    initial: NgRule, board: Pair<String, String>?, isNew: Boolean, onDismiss: () -> Unit, onDelete: (() -> Unit)? = null,
    /** 「効く板」で選べる板(お気に入り板。URL と名前)。開いている板(board)はなくても選べる */
    boards: List<Pair<String, String>> = emptyList(),
    onSave: (NgRule) -> Unit,
) {
    var r by remember { mutableStateOf(initial) }
    var sample by remember { mutableStateOf("") }
    val err = if (r.pattern.isBlank()) null else io.github.contentsview08.obb.data.ngPatternError(r.pattern.trim(), r.isRegex)
    // 効く板の選択肢: すべての板・開いている板・お気に入り板(・今選んでいる板がそのどれでもなければそれも)
    val boardOptions = remember(board, boards, r.boardUrl) {
        val list = ArrayList<Pair<String, String>>()
        if (board != null) list += board
        for (b in boards) if (list.none { it.first == b.first }) list += b
        r.boardUrl?.let { u -> if (list.none { it.first == u }) list += u to (r.boardName ?: u) }
        list
    }
    FullWindow(onDismiss = onDismiss) {
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
                // 有効のスイッチは一番上(題の横)
                Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 12.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (isNew) "NG を足す" else "NG を直す", Modifier.weight(1f), color = Palette.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Text("有効", color = Palette.textBody, fontSize = 14.sp)
                    Spacer(Modifier.width(8.dp))
                    Switch(r.enabled, { r = r.copy(enabled = it) }, colors = accentSwitchColors())
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // 何を NG にするかもドロップダウン(本文・名前・ID・スレタイ)
                    PickerRow("種類", io.github.contentsview08.obb.data.ngTargetName(r.target), io.github.contentsview08.obb.data.NG_TARGETS.map { (k, label) -> label to { r = r.copy(target = k) } })
                    OutlinedTextField(
                        r.pattern, { r = r.copy(pattern = it) }, Modifier.fillMaxWidth(), isError = err != null,
                        placeholder = { Text(if (r.isRegex) "正規表現(例: ^ｷﾀ━+|ｗ{5,})" else "NG にする言葉") },
                        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = if (r.isRegex) androidx.compose.ui.text.font.FontFamily.Monospace else null),
                        supportingText = {
                            Text(err ?: if (r.isRegex) "正規表現で当てます(大文字と小文字は区別します。先頭に (?i) と書くと区別しません)" else if (r.target == "id") "ID が同じときだけ当てます(完全一致)" else "この言葉を含めば当てます(部分一致。大文字と小文字は区別しません)")
                        },
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("正規表現", Modifier.weight(1f), color = Palette.textBody, fontSize = 14.sp)
                        Switch(r.isRegex, { r = r.copy(isRegex = it) }, colors = accentSwitchColors())
                    }
                    // 効く板・期限は選択肢が多いのでドロップダウンで(お気に入り板から選べる)
                    // 選択肢と今の値は同じ付け方の名前にする(開いている板は「(開いている板)」付き。選んでいる印はこの名前で比べる)
                    fun boardLabel(url: String, name: String) = if (board != null && url == board.first) "$name(開いている板)" else name
                    PickerRow(
                        "効く板", r.boardUrl?.let { u -> boardOptions.firstOrNull { it.first == u }?.let { boardLabel(it.first, it.second) } ?: u } ?: "すべての板",
                        listOf<Pair<String, () -> Unit>>("すべての板" to { r = r.copy(boardUrl = null, boardName = null) }) +
                            boardOptions.map { (url, name) -> boardLabel(url, name) to { r = r.copy(boardUrl = url, boardName = name) } },
                    )
                    val t = io.github.contentsview08.obb.data.today()
                    val spans = listOf("今日だけ" to 0L, "3 日" to 3L, "7 日" to 7L, "30 日" to 30L, "90 日" to 90L)
                    val expiryLabel = r.expiresOnDate?.let { d -> if (d == t) "今日だけ" else spans.firstOrNull { io.github.contentsview08.obb.data.daysLater(it.second) == d }?.first ?: "$d まで" } ?: "ずっと"
                    PickerRow(
                        "期限", expiryLabel,
                        listOf<Pair<String, () -> Unit>>("ずっと" to { r = r.copy(expiresOnDate = null) }) +
                            spans.map { (label, days) -> label to { r = r.copy(expiresOnDate = if (days == 0L) t else io.github.contentsview08.obb.data.daysLater(days)) } },
                    )
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

/** hono-bbs のログインの欄を出すか。保存したアカウントは、この値にかかわらず書き込みに使う */
private const val SHOW_HONO_LOGIN = false

/** サイト 1 つぶんの画面のキーの頭(続けて主ドメイン) */
private const val SITE_PAGE = "site:"

/** 設定の板の一覧に出す、URL だけの板の名前 */
private fun boardLabel(url: String) = url.removePrefix("https://").removePrefix("http://").trimEnd('/')

/** 板の設定の中身を短く(PC 版の 板ごとの設定 と同じ言葉) */
private fun boardMetaSummary(m: BoardMeta?): String = listOfNotNull(
    m?.alias?.let { "別名「$it」" },
    m?.defaultName?.let { "名前「$it」" },
    m?.defaultMail?.let { "メール「$it」" },
    m?.omitNoname?.let { if (it) "名無しを省く" else "名無しを省かない" },
    m?.nonames?.takeIf { it.isNotEmpty() }?.let { "名無し扱い ${it.size} 件" },
).joinToString("・")

/** 板の 1 行: 名前と設定の中身。押すと板の設定を開く */
@Composable
private fun BoardMetaRow(vm: AppViewModel, url: String, name: String, onOpen: () -> Unit) {
    val m = vm.prefs.boardMeta[url]
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(m?.alias ?: name, color = Palette.textStrong, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(boardMetaSummary(m).ifEmpty { "全体の設定のまま" }, color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.textMuted)
    }
}

/** 板の URL を設定の鍵の形に(開いたときの板の URL と同じにしないと効かない)。板として読めなければ null */
private fun boardKeyOf(url: String): String? = when (val r = io.github.contentsview08.obb.bbs.UrlRoute.parse(url)) {
    is io.github.contentsview08.obb.bbs.UrlRoute.BoardPage -> r.boardUrl
    is io.github.contentsview08.obb.bbs.UrlRoute.Thread -> r.thread.boardUrl
    else -> null
}

/**
 * 掲示板ごとの設定(PC 版と同じ分け方)。全体の設定の上に、サイトごと・板ごとに変えたいものを重ねる。
 * サイトは BBS メニュー・板一覧・お気に入り・閲覧履歴・板ごとの設定の URL の主ドメイン(bbs/SiteDomain.kt)
 */
/**
 * 書き込み・ログインの Cookie(5ch の書き込みの認証・エッヂの認証・BE のログインなど)。ドメインごとに消せる。
 * 消すと、その掲示板では次の書き込みで認証からやり直しになる。PC 版の設定「掲示板ごとの設定」の Cookie の段と同じ
 */
@Composable
private fun CookieGroup(vm: AppViewModel) {
    val http = io.github.contentsview08.obb.data.Http
    var seq by remember { androidx.compose.runtime.mutableIntStateOf(0) }
    val domains = remember(seq) { http.cookieDomains() }
    Group("Cookie", note = "書き込みとログインで掲示板から受け取った Cookie。消すと、その掲示板では次の書き込みで認証からやり直しになります") {
        if (domains.isEmpty()) Text("Cookie はありません", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 13.sp)
        for ((d, n) in domains) Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(d, Modifier.weight(1f), color = Palette.textStrong, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("$n 件", color = Palette.textMuted, fontSize = 12.sp)
            TextButton(onClick = { val k = http.clearCookies(d); vm.toast = "$d の Cookie を $k 件消しました"; seq++ }) { Text("消す", color = Palette.markDanger) }
        }
        if (domains.isNotEmpty()) ActionRow("すべての Cookie を消す", danger = true) { val k = http.clearCookies(null); vm.toast = "Cookie を $k 件消しました"; seq++ }
    }
}

@Composable
private fun AccountsPage(vm: AppViewModel, open: (String) -> Unit) {
    val p = vm.prefs
    var menuBoards by remember { mutableStateOf(emptyList<String>()) }
    androidx.compose.runtime.LaunchedEffect(Unit) { vm.reloadSites(); menuBoards = vm.menuBoardUrls() }
    val sites = uniqueSiteDomains(
        vm.sites.map { it.first } + menuBoards + vm.favorites.map { it.url } + vm.favThreads.map { it.thread.boardUrl } +
            p.boardMeta.keys,
    )
    Text(
        "ほかの分類の設定はすべての掲示板に効きます。ここでは、サイトごと・板ごとに変えたいものだけを決めます。決めていないものは全体の設定のままです",
        Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp), color = Palette.textMuted, fontSize = 12.sp, lineHeight = 17.sp,
    )
    Group("サイトごとの設定", note = "BBS メニュー・板・お気に入り・開いたスレの URL から、サイトを自動で並べます(サブドメインはまとめます)") {
        if (sites.isEmpty()) Text("まだありません(BBS メニューや板を足すと出ます)", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        for (d in sites) SiteRow(d, vm.sites.firstOrNull { siteDomain(it.first) == d }?.let { siteLabel(it.first, it.second) }?.takeIf { it != d }) { open(SITE_PAGE + d) }
    }
    // 名前の分かっている板(お気に入り)と、設定のある板。URL で足した板は、設定を入れるまで覚えておくだけ
    var added by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var editing by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val boards = vm.favorites.map { it.url to it.name } + (p.boardMeta.keys + added).distinct().filter { u -> vm.favorites.none { it.url == u } }.map { it to boardLabel(it) }
    val q = normalizeForSearch(query.trim())
    val shown = if (q.isEmpty()) boards else boards.filter { (u, n) -> normalizeForSearch("${p.boardMeta[u]?.alias.orEmpty()} $n $u").contains(q) }
    Group("板ごとの設定", note = "別名・ファビコン・名前欄とメール欄の既定値・名無しの扱いを、板ごとに決めます。お気に入りの板と、設定のある板が並びます") {
        if (boards.size > 8) SearchField(query, { query = it }, "${boards.size} 板から絞り込む")
        for ((u, n) in shown) BoardMetaRow(vm, u, n) { editing = u }
        if (shown.isEmpty()) Text(if (boards.isEmpty()) "お気に入りの板がまだありません" else "見つかりません", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        ActionRow("お気に入りでない板を設定する", Icons.Filled.Add) { adding = true }
    }
    editing?.let { u -> BoardMetaSheet(vm, u, boards.firstOrNull { it.first == u }?.second ?: boardLabel(u)) { editing = null } }
    if (adding) {
        var url by remember { mutableStateOf("") }
        var error by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = {},
            title = { Text("板の URL") },
            text = {
                OutlinedTextField(
                    url, { url = it; error = false }, singleLine = true, placeholder = { Text("https://eagle.5ch.io/livejupiter/") }, isError = error,
                    supportingText = if (error) ({ Text("板の URL として読めません") }) else null,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val key = boardKeyOf(url)
                    if (key == null) error = true
                    else { if (key !in added) added = added + key; editing = key; adding = false }
                }) { Text("設定する") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("やめる") } },
        )
    }
    CookieGroup(vm)
}

/** サイトの行: 主ドメインと、分かっていればサイトの名前 */
@Composable
private fun SiteRow(title: String, sub: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = Palette.textStrong, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.textMuted)
    }
}

/** サイト 1 つぶんの設定。いまサイトだけで決めるものはなく、そのサイトの板の設定へ入る入口 */
@Composable
private fun SiteSettings(vm: AppViewModel, domain: String) {
    val p = vm.prefs
    if (SHOW_HONO_LOGIN && io.github.contentsview08.obb.bbs.HonoBbs.isAccountSite("https://$domain/")) HonoAccountSection(vm)
    var editing by remember { mutableStateOf<String?>(null) }
    val boards = (vm.favorites.map { it.url to it.name } + (vm.favThreads + vm.history).map { it.thread.boardUrl to boardLabel(it.thread.boardUrl) } + p.boardMeta.keys.map { it to boardLabel(it) })
        .distinctBy { it.first }.filter { siteDomain(it.first) == domain }
    Group("このサイトの板", note = "押すとその板の設定を開きます。お気に入りの板・お気に入りのスレや開いたスレの板・設定のある板が並びます") {
        if (boards.isEmpty()) Text("まだありません", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        for ((u, n) in boards) BoardMetaRow(vm, u, n) { editing = u }
    }
    editing?.let { u -> BoardMetaSheet(vm, u, boards.firstOrNull { it.first == u }?.second ?: boardLabel(u)) { editing = null } }
}

/**
 * hono-bbs のアカウント(SHOW_HONO_LOGIN で出す)。
 * ユーザー ID とパスワードを保存し、書き込むときにそのサイトにログインして使う(bbs/HonoBbs.kt)。
 * 「ログインして確かめる」は、知っているサイト(BBS メニューに登録した hono-bbs・お気に入り板)に今ログインしてみる。
 * 登録は、メールに確認コード → コード・ID・パスワードで作る(Turnstile が要れば、書き込みと同じく認証ページとコードを出す)
 */
@Composable
private fun HonoAccountSection(vm: AppViewModel) {
    val p = vm.prefs
    val scope = androidx.compose.runtime.rememberCoroutineScope()
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
    if (register) RegisterDialog(vm, origins, onAuth = { auth = it; register = false }, onDone = { msg -> if (msg.isNotEmpty()) status = msg; register = false })
    // Turnstile の認証(書き込みと同じ案内)
    auth?.let { a ->
        AuthDialog(a, "人の確認が要ります", "ブラウザで認証のページを開き、下の認証コードを入れてから、もう一度登録してください。") { auth = null }
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
    // 設定だけの JSON のバックアップ(書き出す・戻す)は画面から外した(まるごとバックアップと取り違えるため)
    val loadScheme = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.importScheme(uri) }
    val saveScheme = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> if (uri != null) vm.exportTheme(uri) }
    val loadChmate = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.importChmate(uri) }
    val saveFull = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri -> if (uri != null) vm.exportFullBackup(uri) }
    val loadFull = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.importFullBackup(uri) }
    var confirmFullRestore by remember { mutableStateOf(false) }
    Group("まるごとバックアップ", note = "ログ・既読・お気に入り・書き込み履歴・自分のレスの印・アカウント・設定・NG・書き込みの認証の状態(Cookie)を 1 つの ZIP に書き出します。アカウントのパスワードや認証の状態も入るので、ファイルの置き場所に気をつけてください。戻すときはアプリを一度閉じ、開き直すとその状態になります。いまの DB は消さずに別の名前で残します") {
        ActionRow("まるごと書き出す") { saveFull.launch("OBB-full-backup.zip") }
        ActionRow("まるごと戻す…", danger = true) { confirmFullRestore = true }
    }
    Group("スキン", note = "いまの見た目(配色・差し色・レスの見た目・細かい表示・文字と余白)を 1 つの JSON に書き出します。読み込むと、入っている項目だけを上書きし、スキンとして保存します(自分の配色だけの JSON も読めます。PC 版で書き出したものも同じ形)") {
        ActionRow("スキンを書き出す") { saveScheme.launch("OBB-skin.json") }
        ActionRow("スキンを読み込む") { loadScheme.launch(arrayOf("application/json", "text/plain", "*/*")) }
    }
    var confirmReset by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    if (confirmFullRestore) AlertDialog(
        onDismissRequest = { confirmFullRestore = false },
        title = { Text("まるごと戻す") },
        text = { Text("いまのログ・既読・お気に入り・設定をバックアップの時点に戻し、アプリを閉じます。いまの DB は消さずに別の名前で残します。") },
        confirmButton = { TextButton(onClick = { confirmFullRestore = false; loadFull.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream", "*/*")) }) { Text("ファイルを選んで戻す") } },
        dismissButton = { TextButton(onClick = { confirmFullRestore = false }) { Text("やめる") } },
    )
    Group("ほかのアプリから取り込む", note = "ChMate の「バックアップ」で書き出した ZIP から、スレのログと既読・自分の書き込みの印・お気に入りのスレ・NG・書き込みの履歴・スレタイのキーワードを取り込みます。今あるものに足し、同じものは重ねません。見た目などの設定は取り込みません。板のサーバーが分からないスレや、OBB が対応していない掲示板のスレは読みません") {
        ActionRow("ChMate のバックアップ(ZIP)を読み込む") { loadChmate.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream", "*/*")) }
        vm.chmateProgress?.let { (stage, done, total) ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(if (total > 0) "$stage $done / $total(${done * 100 / total}%)" else stage, fontSize = 12.sp, color = Palette.textBody)
                Spacer(Modifier.height(6.dp))
                if (total > 0) androidx.compose.material3.LinearProgressIndicator({ done.toFloat() / total }, Modifier.fillMaxWidth(), color = Palette.accent, trackColor = Palette.border)
                else androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth(), color = Palette.accent, trackColor = Palette.border)
            }
        }
    }
    Group("はじめの状態に戻す", note = "ログ・既読・お気に入り・書き込み履歴・設定・NG・アカウント・画像のキャッシュをすべて消し、入れたばかりの状態に戻します(アプリは閉じます)。戻す前に「まるごと書き出す」で控えを取れます") {
        ActionRow("はじめの状態に戻す…", danger = true) { confirmReset = true }
    }
    if (confirmReset) AlertDialog(
        onDismissRequest = { confirmReset = false },
        title = { Text("はじめの状態に戻す") },
        text = { Text("ログ・既読・お気に入り・書き込み履歴・設定・NG・アカウントをすべて消します。元には戻せません。") },
        confirmButton = {
            TextButton(onClick = {
                confirmReset = false
                // Android にアプリのデータをまるごと消してもらう(アプリは終わる)
                (context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager).clearApplicationUserData()
            }) { Text("消して戻す", color = Palette.heatVeryHot) }
        },
        dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("やめる") } },
    )
}

@Composable
private fun AboutPage(vm: AppViewModel, open: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "" }
    Group("掲示板", note = "要望や不具合は、運営要望板か GitHub の Issues へ") {
        ActionRow("運営要望板を開く") { vm.openUrl("https://red-edge.net/boards/operation01/") }
    }
    Group("ライセンス", note = "このアプリに入っているオープンソースのソフトウェアと、そのライセンスを見られます") {
        ActionRow("使っているソフトウェア") { open("licenses") }
    }
    Group {
        InfoRow("名前", "OBB(Open BBS Browser)")
        InfoRow("版", version)
        InfoRow("AA の字", "aahub_light")
    }
}

/** 使っているソフトウェアの一覧。検索でき、押すとその場にライセンスの全文を開く(PC 版の LicensesDialog と同じ) */
@Composable
private fun LicensesPage() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    // 大きいので、この画面を開いたときだけ読む
    val data by androidx.compose.runtime.produceState<LicensesFile?>(null) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { parseLicenses(context.assets.open("licenses.json").bufferedReader().use { it.readText() }) }.getOrNull()
        }
    }
    var q by rememberSaveable { mutableStateOf("") }
    var opened by rememberSaveable { mutableStateOf<String?>(null) }
    val file = data ?: return
    val shown = remember(file, q) { filterLicenses(file.packages, q) }
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().navigationBarsPadding(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 32.dp)) {
        item {
            SearchField(q, { q = it }, "名前・版・ライセンスで探す")
            Text("${shown.size} 件。押すとライセンスの全文を開きます", Modifier.padding(start = 20.dp, end = 20.dp, bottom = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
        }
        items(shown.size, key = { shown[it].id }) { i ->
            val p = shown[i]
            val isOpen = opened == p.id
            Column(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().clickable { opened = if (isOpen) null else p.id }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (p.version.isEmpty()) p.name else "${p.name} ${p.version}", color = Palette.textStrong, fontSize = 15.sp)
                        Text("${p.license} ・ ${p.kindLabel}", color = Palette.textMuted, fontSize = 12.sp)
                    }
                    Icon(if (isOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, tint = Palette.textMuted)
                }
                if (isOpen) {
                    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                        if (p.note != null) Text(p.note, Modifier.padding(bottom = 8.dp), color = Palette.textBody, fontSize = 13.sp)
                        if (p.url.isNotEmpty()) Text(p.url, Modifier.padding(bottom = 8.dp).clickable { uri.openUri(p.url) }, color = Palette.accent, fontSize = 13.sp)
                        for ((name, index) in p.texts) {
                            Text(name, Modifier.padding(top = 4.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
                            Text(file.texts[index], Modifier.fillMaxWidth().background(Palette.surface2, RoundedCornerShape(6.dp)).padding(10.dp), color = Palette.textBody, fontSize = 12.sp, lineHeight = 16.sp)
                        }
                        if (p.texts.isEmpty()) {
                            val links = spdxLinks(p.license)
                            Text(if (links.isEmpty()) "全文のファイルは入っていません。" else "全文のファイルは入っていません。ライセンスの標準文:", color = Palette.textMuted, fontSize = 12.sp)
                            for ((id, url) in links) Text(id, Modifier.padding(top = 4.dp).clickable { uri.openUri(url) }, color = Palette.accent, fontSize = 13.sp)
                        }
                    }
                }
                HorizontalDivider(color = Palette.border)
            }
        }
    }
}

// ── 部品 ──

/** 項目のまとまり。見出しと、下に小さな説明 */
/** ページの頭の 1 行の案内(このページで変わるもの)。段の見出しより先に、薄い字で */
@Composable
internal fun PageLead(text: String) {
    Text(text, Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp), color = Palette.textMuted, fontSize = 13.sp, lineHeight = 18.sp)
}

@Composable
internal fun Group(title: String? = null, note: String? = null, content: @Composable () -> Unit) {
    // 段の見出しは差し色で(説明の薄い字と見分けがつくように。字の大きさは説明より少し大きいだけ)
    if (title != null) Text(title, Modifier.padding(start = 20.dp, top = 22.dp, bottom = 6.dp), color = Palette.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.3.sp)
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
internal fun SwitchRow(label: String, checked: Boolean, desc: String? = null, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, color = Palette.textStrong, fontSize = 15.sp)
            if (desc != null) Text(desc, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 16.sp)
        }
        Spacer(Modifier.width(10.dp))
        Switch(checked, onChange, colors = accentSwitchColors())
    }
}

/** 選ぶ行。押すと選べるものの一覧が出る */
/** 取っている字の進み具合のバー。全体の大きさが分からない間は流れる形 */
@Composable
private fun FontProgress(modifier: Modifier = Modifier) {
    val done = io.github.contentsview08.obb.data.Fonts.progress
    if (done != null) androidx.compose.material3.LinearProgressIndicator({ done }, modifier.fillMaxWidth(), color = Palette.accent, trackColor = Palette.border)
    else androidx.compose.material3.LinearProgressIndicator(modifier.fillMaxWidth(), color = Palette.accent, trackColor = Palette.border)
}

private fun fontProgressText() = io.github.contentsview08.obb.data.Fonts.progress?.let { "取得中 ${percent(it)}%" } ?: "取得中"

/**
 * 字を選ぶ行。取り終えるまで今の字のまま(取り終えると自動で切り替わる)。
 * 取っている行を押すと取り消す。別の字を選ぶと、取っている分はやめて選び直した字にする。失敗したら理由を出し、今の字のまま
 */
@Composable
private fun FontRow(value: String, downloaded: Set<String>, fileName: String? = null, onPick: (String) -> Unit) {
    val f = io.github.contentsview08.obb.data.Fonts
    /** 表示用の名前(選択肢の順。自分のファイルは入れてあるときだけ) */
    val names = listOf(f.SYSTEM to "端末の標準") + f.CHOICES.map { it.key to it.name } + (if (fileName != null) listOf(f.FILE to "ファイル($fileName)") else emptyList())
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.Center) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("字", Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
            Text(names.firstOrNull { it.first == value }?.second ?: "端末の標準", color = Palette.textMuted, fontSize = 14.sp, maxLines = 1)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.textMuted)
        }
        f.loading?.let { key ->
            Text("${f.CHOICES.firstOrNull { it.key == key }?.name ?: key}を${fontProgressText()}(取り終えると切り替わります)", Modifier.padding(top = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
            FontProgress(Modifier.padding(top = 4.dp))
        }
        f.error?.let { Text(it, Modifier.padding(top = 4.dp), color = Palette.markDanger, fontSize = 12.sp) }
    }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        title = { Text("字") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                for ((k, name) in names) {
                    val on = k == value
                    val loading = f.loading == k
                    val failed = f.errorKey == k
                    val size = f.CHOICES.firstOrNull { it.key == k }?.takeIf { k !in downloaded }?.desc?.substringAfter('(')?.trimEnd(')')
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(if (on) Palette.accentWash else Color.Transparent)
                            .clickable {
                                onPick(k)
                                // 取り始めたときは、進み具合が見えるように開いたままにする
                                if (k in downloaded || k == f.SYSTEM || k == f.FILE) open = false
                            }.heightIn(min = 46.dp).padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(name, Modifier.weight(1f), color = if (on) Palette.accent else if (loading) Palette.textMuted else Palette.textBody, fontSize = 15.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                            if (on) Icon(Icons.Filled.Check, null, tint = Palette.accent, modifier = Modifier.size(18.dp))
                            else if (loading) Icon(Icons.Filled.Close, "取り消す", tint = Palette.textMuted, modifier = Modifier.size(18.dp))
                            else if (size != null) Text(size, color = Palette.textMuted, fontSize = 12.sp)
                        }
                        if (loading) {
                            FontProgress(Modifier.padding(top = 6.dp))
                            Text("${fontProgressText()}。取り終えるまで使えません(押すと取り消し)", Modifier.padding(top = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
                        }
                        if (failed) Text("${f.error.orEmpty()}。押すともう一度取ります", Modifier.padding(top = 4.dp), color = Palette.markDanger, fontSize = 12.sp)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { open = false }) { Text("閉じる") } },
    )
}

@Composable
internal fun ChoiceRow(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    // 1 つを選ぶ項目はどれもドロップダウン(SegmentRow と同じ見え方。窓を開かずにその場で選べる)
    var open by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
            Text(options.firstOrNull { it.first == value }?.second ?: value, color = Palette.textMuted, fontSize = 14.sp, maxLines = 1)
            Icon(Icons.Filled.ArrowDropDown, null, tint = Palette.textMuted)
        }
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((k, name) in options) {
                val on = k == value
                androidx.compose.material3.DropdownMenuItem(
                    text = { Text(name, color = if (on) Palette.accent else Palette.textBody, fontSize = 14.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal) },
                    trailingIcon = if (on) ({ Icon(Icons.Filled.Check, null, tint = Palette.accent, modifier = Modifier.size(18.dp)) }) else null,
                    onClick = { onChange(k); open = false },
                )
            }
        }
    }
}

/**
 * 少ない選択肢から 1 つを選ぶ行(ドロップダウン)。選択肢の名前の括弧の中(例: 日時の見本)は説明として扱い、
 * 選んでいるものの分だけ行の下に添える(ChoiceRow は名前をそのまま出す)
 */
@Composable
internal fun SegmentRow(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    // 排他の選択は、つながった切り替えボタンではなくドロップダウンで(選択肢の名前が長くても収まり、ほかの設定の行と同じ見え方)。
    // 選択肢の「(説明)」は、選んでいるものの説明として行の下に出す
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.first == value }?.second ?: value
    val note = current.takeIf { '(' in it }?.substringAfter('(')?.removeSuffix(")")
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
                Text(current.substringBefore('('), color = Palette.textMuted, fontSize = 14.sp, maxLines = 1)
                Icon(Icons.Filled.ArrowDropDown, null, tint = Palette.textMuted)
            }
            androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                for ((k, name) in options) androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Column {
                            Text(name.substringBefore('('), color = if (k == value) Palette.accent else Palette.textBody, fontSize = 14.sp)
                            name.takeIf { '(' in it }?.let { Text(it.substringAfter('(').removeSuffix(")"), color = Palette.textMuted, fontSize = 11.sp) }
                        }
                    },
                    onClick = { open = false; onChange(k) },
                )
            }
        }
        if (note != null) Text(note, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), color = Palette.textMuted, fontSize = 12.sp)
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
private fun ActionRow(label: String, icon: ImageVector? = null, /** 消すなど取り返しのつかない操作は赤で */ danger: Boolean = false, onClick: () -> Unit) {
    val color = if (danger) Palette.heatVeryHot else Palette.accent
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = color, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)) }
        Text(label, color = color, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        Text(value, color = Palette.textMuted, fontSize = 13.sp)
    }
}
