package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * スクロールで上下の帯を隠す(下へ送ると隠れ、上へ戻すとすぐ出る。今のスマホ版の useHideOnScroll と同じ動き)。
 * 帯の高さは onSizeChanged で測って入れる。帯は graphicsLayer で動かすだけなので、スクロール中も描き直しは軽い
 */
@Stable
class HideOnScroll {
    var topHeight by mutableFloatStateOf(0f)
    var bottomHeight by mutableFloatStateOf(0f)
    /** 0(出ている)〜1(隠れている) */
    var hidden by mutableFloatStateOf(0f)
        private set

    /** 設定で切ったら隠さない */
    var enabled = true

    fun show() { hidden = 0f }

    // 実際にスクロールした量で隠す(指が動いた量で隠すと、スクロールできない短いスレでも隠れて戻せなくなる)
    val connection = object : NestedScrollConnection {
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (!enabled) { hidden = 0f; return Offset.Zero }
            val h = maxOf(topHeight, 1f)
            hidden = (hidden - consumed.y / h).coerceIn(0f, 1f)
            // 一番上まで引っぱったら必ず出す
            if (available.y > 0f) hidden = 0f
            return Offset.Zero
        }
    }
}

@Composable
fun rememberHideOnScroll() = remember { HideOnScroll() }

/**
 * 上の帯。左に ☰(メニュー)か ←(戻る)、真ん中に題(2 行まで)、右にボタン。今のスマホ版の形
 */
@Composable
fun HeaderBar(
    title: String,
    onNav: () -> Unit,
    navIsBack: Boolean = false,
    leading: (@Composable () -> Unit)? = null,
    onTitle: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    val prefs = LocalPrefs.current
    Row(
        Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = prefs.headerHeight.dp).padding(start = 4.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onNav) {
            Icon(if (navIsBack) Icons.AutoMirrored.Filled.ArrowBack else Icons.Filled.Menu, if (navIsBack) "戻る" else "メニュー", tint = Palette.textMuted, modifier = Modifier.size(28.dp))
        }
        if (leading != null) {
            Spacer(Modifier.width(4.dp))
            leading()
        }
        Spacer(Modifier.width(8.dp))
        // 題は 2 行まで。入りきらなければ字を小さくして収める(今のスマホ版の fitTitle)。押すとメニュー(スレ・板の操作)
        val size = 15f * prefs.barFontScale
        androidx.compose.foundation.text.BasicText(
            title,
            Modifier.weight(1f).then(if (onTitle != null) Modifier.clickable(onClick = onTitle) else Modifier).padding(vertical = 4.dp),
            style = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontWeight = FontWeight.Bold, lineHeight = 1.25.em),
            maxLines = 2, overflow = TextOverflow.Ellipsis,
            autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = (size * 0.7f).sp, maxFontSize = size.sp, stepSize = 0.5.sp),
        )
        actions()
    }
}

/** 帯の右のボタン(︙ など)。押しやすいよう 48dp */
@Composable
fun BarIcon(icon: ImageVector, label: String, tint: Color = Palette.textMuted, onClick: () -> Unit) {
    IconButton(onClick = onClick) { Icon(icon, label, tint = tint, modifier = Modifier.size(26.dp)) }
}

@Composable
fun MoreButton(onClick: () -> Unit) = BarIcon(Icons.Filled.MoreVert, "その他", onClick = onClick)

/** 下から出るメニューの 1 行 */
class MenuItem(val label: String, val icon: ImageVector, val tint: Color = Palette.textMuted, val danger: Boolean = false, val onClick: () -> Unit)

/**
 * 下から出るメニュー(今のスマホ版の ︙ のメニュー)。groups の間に線を引く。危ない項目(削除)は赤く
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MenuSheet(groups: List<List<MenuItem>>, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp)) {
            groups.filter { it.isNotEmpty() }.forEachIndexed { gi, items ->
                if (gi > 0) HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = Palette.border)
                for (it in items) {
                    Row(
                        Modifier.fillMaxWidth().clickable { it.onClick(); onDismiss() }.heightIn(min = 52.dp).padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        Icon(it.icon, null, tint = if (it.danger) Palette.markDanger else it.tint, modifier = Modifier.size(24.dp))
                        Text(it.label, color = if (it.danger) Palette.markDanger else Palette.textStrong, fontSize = 16.sp)
                    }
                }
            }
        }
    }
}

/** 「3 分前」「約 2 か月前」の形 */
fun relativeTime(millis: Long?, now: Long = System.currentTimeMillis()): String {
    if (millis == null) return ""
    val s = (now - millis) / 1000
    return when {
        s < 60 -> "たった今"
        s < 3600 -> "${s / 60}分前"
        s < 86400 -> "${s / 3600}時間前"
        s < 86400 * 30 -> "${s / 86400}日前"
        s < 86400 * 365 -> "約${s / (86400 * 30)}か月前"
        else -> "約${s / (86400 * 365)}年前"
    }
}

/** 中身のない画面の案内 */
@Composable
fun Hint(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(text, color = Palette.textMuted, fontSize = 14.sp) }
}

/** 「文字の大きさ・余白」の 1 行(名前・いまの値・スライダー・元に戻す) */
@Composable
fun SizeSlider(label: String, value: Float, range: ClosedFloatingPointRange<Float>, steps: Int, text: String, default: Float, onChange: (Float) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = Palette.textBody, fontSize = 14.sp)
            Text(text, color = Palette.accent, fontSize = 13.sp)
            if (value != default) Text("元に戻す", Modifier.padding(start = 10.dp).clickable { onChange(default) }, color = Palette.textMuted, fontSize = 12.sp)
        }
        androidx.compose.material3.Slider(
            value, onChange, valueRange = range, steps = steps,
            colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent),
        )
    }
}

/** ヘッダー・フッターの高さと文字(今のスマホ版の BarSliders) */
@Composable
fun BarSliders(p: io.github.yumekui8.bbsnative.data.Prefs) {
    SizeSlider("ヘッダーの高さ", p.headerHeight.toFloat(), 44f..120f, 0, "${p.headerHeight}dp", 64f) { p.headerHeight = it.toInt() }
    SizeSlider("フッターの高さ", p.footerHeight.toFloat(), 44f..110f, 0, "${p.footerHeight}dp", 64f) { p.footerHeight = it.toInt() }
    SizeSlider("ヘッダー・フッターの文字", p.barFontScale, 0.8f..1.4f, 11, "${(p.barFontScale * 100).toInt()}%", 1f) { p.barFontScale = (it * 20).toInt() / 20f }
}

/** 真ん中に出す「文字の大きさ・余白」の小さな画面(動かすと後ろの画面がすぐ変わる) */
@Composable
fun SizeDialog(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("文字の大きさ・余白") },
        text = { Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) { content() } },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("閉じる") } },
    )
}

/**
 * 表示スタイル(今のスマホ版の StyleMenuItems): テーマ・レスの見た目・文字サイズ(画面全体)。下から出る
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StyleSheet(p: io.github.yumekui8.bbsnative.data.Prefs, onFont: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())) {
            @Composable fun group(t: String) = Text(t, Modifier.padding(start = 24.dp, top = 8.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            @Composable fun row(label: String, on: Boolean, lead: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
                Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 48.dp).padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (lead != null) { lead(); Spacer(Modifier.width(14.dp)) }
                    Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
                    if (on) Icon(Icons.Filled.Check, null, tint = Palette.accent, modifier = Modifier.size(18.dp))
                }
            }
            group("テーマ")
            val current = Palette.scheme.key
            for (s in SCHEMES) row(s.name, s.key == current, lead = { Box(Modifier.size(16.dp).background(s.accent, androidx.compose.foundation.shape.CircleShape).border(1.dp, s.border, androidx.compose.foundation.shape.CircleShape)) }) {
                // スマホのダーク・ライトに合わせているときは、いまの明るさの方の配色を変える(PC 版の pickSchemeNow)
                if (p.followSystem) { if (s.dark == Palette.dark) { if (s.dark) p.darkScheme = s.key else p.lightScheme = s.key } else { p.followSystem = false; p.scheme = s.key } }
                else p.scheme = s.key
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp), color = Palette.border)
            group("レスの見た目")
            for ((k, name) in listOf("card" to "カード", "discord" to "Discord 風", "line" to "LINE 風")) row(name, p.postStyle == k) { p.postStyle = k }
            HorizontalDivider(Modifier.padding(vertical = 4.dp), color = Palette.border)
            row("文字サイズ(画面全体)  ${(p.fontScale * 100).toInt()}%", false, lead = { Icon(Icons.Filled.FormatSize, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp)) }) { onDismiss(); onFont() }
        }
    }
}
