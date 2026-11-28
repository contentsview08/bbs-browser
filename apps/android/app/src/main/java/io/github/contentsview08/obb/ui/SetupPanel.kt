package io.github.contentsview08.obb.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.data.Prefs

/**
 * クイックセットアップ。初めて開いたとき(更新のあとの最初の起動も)に、配色 → レスの見た目 → 細かい表示 → ボタンの配置の順に選ぶ。
 * どの段でも「スキップ」で飛ばせ、選んだものはその場で効く(設定と同じ値を触るだけなので、あとから設定で変えられる)。
 * どの段も一番上に、スレッド表示画面の見本(ヘッダー・レス・フッター)を出し、選ぶたびにそこが変わる。
 * 設定 → スキンと配色 → 「クイックセットアップ」からも開く
 */
@Composable
fun SetupPanel(vm: AppViewModel) {
    OverlayPanel(visible = vm.setupOpen, onClose = { vm.finishSetup() }) {
        val p = vm.prefs
        var step by remember { mutableIntStateOf(0) }
        val steps = listOf("配色", "レスの見た目", "細かい表示", "ボタンの配置")
        // 開き直したら最初の段から
        LaunchedEffect(vm.setupOpen) { if (vm.setupOpen) step = 0 }
        Column(Modifier.fillMaxSize().background(Palette.base)) {
            HeaderBar(
                "クイックセットアップ", onNav = { if (step > 0) step-- else vm.finishSetup() }, navIsBack = true,
                actions = {
                    Text("スキップ", Modifier.clip(RoundedCornerShape(6.dp)).clickable { vm.finishSetup() }.padding(horizontal = 12.dp, vertical = 8.dp), color = Palette.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                },
            )
            HorizontalDivider(color = Palette.border)
            // 進み具合: 丸と段の名前
            Row(Modifier.fillMaxWidth().background(Palette.bar).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                steps.forEachIndexed { i, name ->
                    val on = i == step
                    val done = i < step
                    Box(
                        Modifier.size(20.dp).background(if (on || done) Palette.accent else Palette.surface2, CircleShape).border(1.dp, if (on || done) Palette.accent else Palette.border, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (done) Icon(Icons.Filled.Check, null, tint = Palette.accentText, modifier = Modifier.size(12.dp))
                        else Text("${i + 1}", color = if (on) Palette.accentText else Palette.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                    if (on) Text(name, color = Palette.textStrong, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    if (i < steps.lastIndex) Box(Modifier.weight(1f).height(1.dp).background(if (done) Palette.accent else Palette.border))
                }
            }
            HorizontalDivider(color = Palette.border)
            // 段の移り方: 次へは右から左へすべり込む、戻るは左から。動きを減らすときはふっと切り替える
            val ease = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
            AnimatedContent(
                step, Modifier.weight(1f),
                transitionSpec = {
                    if (Motion.reduced) fadeIn(tween(90)) togetherWith fadeOut(tween(90))
                    else if (targetState > initialState) (slideInHorizontally(tween(280, easing = ease)) { it } + fadeIn(tween(200))) togetherWith (slideOutHorizontally(tween(280, easing = ease)) { -it / 3 } + fadeOut(tween(200)))
                    else (slideInHorizontally(tween(280, easing = ease)) { -it / 3 } + fadeIn(tween(200))) togetherWith (slideOutHorizontally(tween(280, easing = ease)) { it } + fadeOut(tween(200)))
                },
                label = "setup-step",
            ) { st ->
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    // どの段も、一番上はスレッド表示画面の見本(選ぶたびに変わる)
                    ScreenSample(vm)
                    when (st) {
                        0 -> {
                            Lead("配色を選んでください。あとから「設定 → スキンと配色」で、スキンも含めて変えられます")
                            Group {
                                SwitchRow("スマホのダーク・ライトに合わせる", p.followOsTheme, desc = "オンにすると、スマホの設定で配色が切り替わります") { p.followOsTheme = it }
                            }
                            Group("配色") { SchemeRow(p) }
                        }
                        1 -> {
                            Lead("レスの見た目を選んでください。細かい設定は、あとから各画面の「表示スタイル」で")
                            Group("レスの見た目") {
                                for ((key, label) in pickablePostStyles(p.postStyle)) {
                                    ChoiceCard(label.substringBefore('('), STYLE_NOTES[key] ?: "", p.postStyle == key) { p.postStyle = key }
                                }
                            }
                        }
                        2 -> {
                            Lead("細かい表示です。名前・ID・日時の出し方、人気のレスと自分の書き込みの帯などを選んでください。あとからでも「表示スタイル」で変えられます")
                            Group("レスの頭と本文") { PostDisplayTab(p) }
                        }
                        else -> {
                            Lead("ヘッダー・フッターのボタンの置き方を選んでください。上の見本のヘッダーとフッターが変わります。1 つずつの並びは、あとから「設定 → ボタンの配置」で動かせます")
                            val cur = currentPreset(p)
                            Group("置き方") {
                                for (pr in LAYOUT_PRESETS) ChoiceCard(pr.name, pr.desc, cur == pr.key, leading = {
                                    MiniScreen("thread", pr.thread, Modifier.width(72.dp))
                                    MiniScreen("list", pr.list, Modifier.width(72.dp))
                                }) { saveToolbarLayouts(p, pr.thread, pr.list) }
                                if (cur == null) Text("いまは自分で並べた配置です(どれかを選ぶと置き換わります)", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = Palette.textMuted, fontSize = 12.sp)
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
            HorizontalDivider(color = Palette.border)
            Row(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (step > 0) Text("戻る", Modifier.clip(RoundedCornerShape(6.dp)).clickable { step-- }.padding(horizontal = 14.dp, vertical = 10.dp), color = Palette.textMuted, fontSize = 15.sp)
                Spacer(Modifier.weight(1f))
                val last = step == steps.lastIndex
                Text(
                    if (last) "完了" else "次へ",
                    Modifier.clip(RoundedCornerShape(8.dp)).background(Palette.accent).clickable { if (last) { vm.finishSetup(); vm.toast = "設定はいつでも「設定」から変えられます" } else step++ }
                        .padding(horizontal = 28.dp, vertical = 10.dp),
                    color = Palette.accentText, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun Lead(text: String) = Text(text, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), color = Palette.textMuted, fontSize = 13.sp, lineHeight = 19.sp)

/**
 * スレッド表示画面の見本: いまの配置のヘッダー(≡ スレタイ ボタン)・見本のレス(普通・自分・自分への返信・人気)・いまの配置のフッター(チャット欄・ボタン)。
 * 配色・レスの見た目・帯・ボタンの配置の、どれを変えてもここに映る。押しても何もしない
 */
@Composable
private fun ScreenSample(vm: AppViewModel) {
    val p = vm.prefs
    val l = toolbarLayout(p, "thread")
    val iconDp = toolbarIconDp(p).dp
    @Composable fun button(id: String) {
        val d = toolbarPart("thread", id) ?: return
        Box(Modifier.size((toolbarIconDp(p) + 20).dp), contentAlignment = Alignment.Center) { Icon(d.icon, d.name, tint = if (id == "reply") Palette.accent else Palette.textMuted, modifier = Modifier.size(iconDp)) }
    }
    val shape = RoundedCornerShape(12.dp)
    // 実際の画面の幅で組んでから 3/4 に縮めて出す(見本が画面の大半を取って、選択肢が下に隠れないように)。字の大きさの判断は表示スタイルの方で
    val screenW = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp.dp
    val scale = 0.76f
    Column(
        Modifier.padding(top = 12.dp).layout { m, c ->
            val realW = screenW.roundToPx().coerceAtLeast(1)
            val pl = m.measure(androidx.compose.ui.unit.Constraints.fixedWidth(realW))
            val w = (realW * scale).toInt(); val h = (pl.height * scale).toInt()
            layout(c.maxWidth, h) {
                pl.placeWithLayer((c.maxWidth - w) / 2, 0) { scaleX = scale; scaleY = scale; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f) }
            }
        }.clip(shape).border(1.dp, Palette.borderStrong, shape).background(Palette.base),
    ) {
        Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = p.headerHeight.dp).padding(start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Menu, null, tint = Palette.textStrong, modifier = Modifier.size(24.dp)) }
            Text("スレタイ", Modifier.weight(1f).padding(start = 4.dp), color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            for (id in l.header) button(id)
            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { Icon(Icons.Filled.MoreVert, null, tint = Palette.textMuted, modifier = Modifier.size(22.dp)) }
        }
        HorizontalDivider(color = Palette.border)
        SamplePosts(vm)
        HorizontalDivider(color = Palette.border)
        Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = p.footerHeight.dp).padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (l.footer.none { toolbarPart("thread", it)?.fills == true }) Spacer(Modifier.weight(1f))
            for (id in l.footer) when (id) {
                "replyField" -> Box(Modifier.weight(1f)) { ReplyFieldLook(p) }
                "spacer" -> Spacer(Modifier.weight(1f))
                else -> button(id)
            }
        }
    }
}

/** 選択肢の札(名前・説明・選んだ印。leading は左に添える見本など) */
@Composable
private fun ChoiceCard(name: String, note: String, on: Boolean, leading: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        leading?.invoke()
        Column(Modifier.weight(1f)) {
            Text(name, color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            if (note.isNotEmpty()) Text(note, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 16.sp)
        }
        Box(Modifier.size(22.dp).background(if (on) Palette.accent else Palette.surface2, CircleShape).border(1.dp, if (on) Palette.accent else Palette.border, CircleShape), contentAlignment = Alignment.Center) {
            if (on) Icon(Icons.Filled.Check, null, tint = Palette.accentText, modifier = Modifier.size(14.dp))
        }
    }
}

private val STYLE_NOTES = mapOf(
    "card" to "名前・ID・日時の行と本文を、1 枚ずつの札に。いちばん読みやすい並び",
    "discord" to "アイコンと名前の横に本文。続けて書いたレスはまとめる",
    "line" to "吹き出し。自分のレスは右に",
    "classic" to "詰めて並べる専ブラの見た目",
    "matome" to "人気のレスを大きく出す",
)

/** ボタンの配置の候補(スレ表示とスレ一覧の両方の並び) */
private class LayoutPreset(val key: String, val name: String, val desc: String, val thread: ToolbarLayout, val list: ToolbarLayout)

private val TABS = listOf("tab:unread", "tab:momentum", "tab:newest")
private val LAYOUT_PRESETS = listOf(
    LayoutPreset("standard", "標準", "上に検索、下にチャット欄と更新。スレ一覧は下にタブと更新", ToolbarLayout(listOf("search"), listOf("replyField", "refresh")), ToolbarLayout(listOf("search"), TABS + listOf("spacer", "refresh"))),
    LayoutPreset("rich", "ボタンを多めに", "下にクイックアクセスも。スレ一覧にはスレを立てるも", ToolbarLayout(listOf("search", "favorite"), listOf("replyField", "quickAccess", "refresh")), ToolbarLayout(listOf("search"), TABS + listOf("spacer", "quickAccess", "newThread", "refresh"))),
    LayoutPreset("buttons", "チャット欄なし", "書き込みは別の画面で。下はボタンだけ", ToolbarLayout(listOf("search"), listOf("quickAccess", "spacer", "reply", "refresh")), ToolbarLayout(listOf("search"), TABS + listOf("spacer", "quickAccess", "refresh"))),
    LayoutPreset("bottom", "下にまとめる", "上は題名だけ。片手で届く下に全部", ToolbarLayout(emptyList(), listOf("replyField", "search", "refresh")), ToolbarLayout(emptyList(), TABS + listOf("spacer", "search", "refresh"))),
)

/** いまの並びがどの候補と同じか(タブは並びの位置だけ見る)。どれとも違えば null */
private fun currentPreset(p: Prefs): String? {
    fun norm(l: ToolbarLayout) = l.header to l.footer.map { if (it.startsWith("tab:")) "tab" else it }
    val t = norm(toolbarLayout(p, "thread"))
    val l = norm(toolbarLayout(p, "list"))
    return LAYOUT_PRESETS.firstOrNull { norm(it.thread) == t && norm(it.list) == l }?.key
}

/** 画面の小さな見本(上の帯・行・下の帯)。候補の並びのアイコンを小さく並べる */
@Composable
private fun MiniScreen(area: String, l: ToolbarLayout, modifier: Modifier) {
    @Composable fun bar(ids: List<String>) = Row(
        Modifier.fillMaxWidth().height(16.dp).background(Palette.bar).padding(horizontal = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        // 幅を埋める部品も空きもなければ、実際の帯と同じく右に寄せる
        if (ids.none { it == "spacer" || toolbarPart(area, it)?.fills == true }) Spacer(Modifier.weight(1f))
        for (id in ids) {
            val d = toolbarPart(area, id) ?: continue
            when {
                id == "spacer" -> Spacer(Modifier.weight(1f))
                d.fills -> Box(Modifier.weight(1f).height(9.dp).background(Palette.surface, RoundedCornerShape(5.dp)).border(1.dp, Palette.border, RoundedCornerShape(5.dp)))
                d.tab -> Text(d.name, color = Palette.textMuted, fontSize = 6.sp, maxLines = 1)
                else -> Icon(d.icon, null, tint = Palette.textMuted, modifier = Modifier.size(9.dp))
            }
        }
    }
    Column(modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(6.dp)).background(Palette.base)) {
        bar(l.header)
        Column(Modifier.fillMaxWidth().height(40.dp).padding(5.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (w in listOf(0.9f, 0.6f, 0.75f)) Box(Modifier.fillMaxWidth(w).height(4.dp).background(Palette.surface2, RoundedCornerShape(2.dp)))
        }
        bar(l.footer)
    }
}
