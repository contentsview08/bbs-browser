package io.github.contentsview08.obb.ui

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.data.Prefs

/**
 * はじめの設定。初めて開いたとき(更新のあとの最初の起動も)に、配色 → レスの見た目 → ボタンの配置 → 細かい表示の順に選ぶ。
 * どの段でも「スキップ」で飛ばせ、選んだものはその場で効く(設定と同じ値を触るだけなので、あとから設定で変えられる)。
 * 設定 → スキンと配色 → 「はじめの設定をもう一度」からも開く
 */
@Composable
fun SetupPanel(vm: AppViewModel) {
    OverlayPanel(visible = vm.setupOpen, onClose = { vm.finishSetup() }) {
        val p = vm.prefs
        var step by remember { mutableIntStateOf(0) }
        val steps = listOf("配色", "レスの見た目", "ボタンの配置", "細かい表示")
        // 開き直したら最初の段から
        LaunchedEffect(vm.setupOpen) { if (vm.setupOpen) step = 0 }
        Column(Modifier.fillMaxSize().background(Palette.base)) {
            HeaderBar(
                "はじめの設定", onNav = { if (step > 0) step-- else vm.finishSetup() }, navIsBack = true,
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
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                when (step) {
                    0 -> {
                        Lead("配色を選んでください。見本がその場で変わります。あとから「設定 → スキンと配色」で、スキンも含めて変えられます")
                        Sample(vm)
                        Group {
                            SwitchRow("スマホのダーク・ライトに合わせる", p.followOsTheme, desc = "オンにすると、スマホの設定で配色が切り替わります") { p.followOsTheme = it }
                        }
                        Group("配色") { SchemeRow(p) }
                    }
                    1 -> {
                        Lead("レスの見た目を選んでください。細かい設定は、あとから各画面の「表示スタイル」で")
                        Sample(vm)
                        Group("レスの見た目") {
                            for ((key, label) in pickablePostStyles(p.postStyle)) {
                                ChoiceCard(label.substringBefore('('), STYLE_NOTES[key] ?: "", p.postStyle == key) { p.postStyle = key }
                            }
                        }
                    }
                    2 -> {
                        Lead("ヘッダー・フッターのボタンの置き方を選んでください。1 つずつの並びは、あとから「設定 → ボタンの配置」で動かせます")
                        val cur = currentPreset(p)
                        Group("置き方") {
                            for (pr in LAYOUT_PRESETS) {
                                Row(
                                    Modifier.fillMaxWidth().clickable { saveToolbarLayouts(p, pr.thread, pr.list) }.padding(horizontal = 16.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    MiniScreen("thread", pr.thread, Modifier.width(72.dp))
                                    MiniScreen("list", pr.list, Modifier.width(72.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(pr.name, color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                        Text(pr.desc, color = Palette.textMuted, fontSize = 12.sp, lineHeight = 16.sp)
                                    }
                                    Box(Modifier.size(22.dp).background(if (cur == pr.key) Palette.accent else Palette.surface2, CircleShape).border(1.dp, if (cur == pr.key) Palette.accent else Palette.border, CircleShape), contentAlignment = Alignment.Center) {
                                        if (cur == pr.key) Icon(Icons.Filled.Check, null, tint = Palette.accentText, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                            if (cur == null) Text("いまは自分で並べた配置です(どれかを選ぶと置き換わります)", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = Palette.textMuted, fontSize = 12.sp)
                        }
                    }
                    else -> {
                        Lead("細かい表示です。名前・ID・日時の出し方などを選んでください。あとからでも「表示スタイル」で変えられます")
                        Sample(vm)
                        Group("レスの頭と本文") { PostDisplayTab(p) }
                    }
                }
                Spacer(Modifier.height(16.dp))
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

/** 見本のレス(いまの配色・見た目で) */
@Composable
private fun Sample(vm: AppViewModel) {
    Box(Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(12.dp))) { SamplePosts(vm) }
}

/** 選択肢の札(名前・説明・選んだ印) */
@Composable
private fun ChoiceCard(name: String, note: String, on: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
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
