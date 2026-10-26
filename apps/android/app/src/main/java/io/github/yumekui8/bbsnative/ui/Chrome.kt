package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
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
    actions: @Composable () -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 64.dp).padding(start = 4.dp, end = 8.dp),
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
        Text(
            title, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 19.sp,
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
