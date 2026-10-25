package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page

/** 左から出るメニュー(今のスマホ版のサイドバーの引き出しと同じ並び) */
@Composable
fun DrawerContent(vm: AppViewModel) {
    var favOpen by rememberSaveable { mutableStateOf(true) }
    var histOpen by rememberSaveable { mutableStateOf(false) }
    var urlDialog by rememberSaveable { mutableStateOf(false) }
    val current = vm.stack.lastOrNull()
    Column(Modifier.fillMaxHeight().width(300.dp).background(Palette.surface).safeDrawingPadding()) {
        Text("bbs N", Modifier.padding(start = 24.dp, top = 20.dp, bottom = 12.dp), color = Palette.textStrong, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            DrawerRow(Icons.Filled.Star, "お気に入り板", Palette.markFav, trailing = if (favOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore) { favOpen = !favOpen }
            if (favOpen) {
                for (b in vm.favorites) {
                    val active = current is Page.Threads && current.board.url == b.url
                    DrawerRow(Icons.Filled.Forum, b.name, Palette.textMuted, sub = true, active = active) { vm.openBoard(b) }
                }
                DrawerRow(Icons.Filled.Add, "板を追加", Palette.textMuted, sub = true, muted = true) { vm.openRoot(Page.Boards()) }
            }
            DrawerRow(Icons.Filled.Bookmark, "お気に入りのスレ", Palette.markHot, active = current is Page.FavThreads) { vm.openRoot(Page.FavThreads()) }
            DrawerRow(Icons.Filled.History, "閲覧履歴", Palette.markLink, active = current is Page.History, trailing = if (histOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, onTrailing = { histOpen = !histOpen }) {
                vm.openRoot(Page.History())
            }
            if (histOpen) {
                for (h in vm.history.take(8)) {
                    Text(
                        h.thread.title, Modifier.fillMaxWidth().clickable { vm.openThread(h.thread) }.padding(start = 64.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                        color = Palette.textBody, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            DrawerRow(Icons.Filled.Link, "URL を開く", Palette.markLink) { urlDialog = true }
            DrawerRow(Icons.Filled.EditNote, "書き込み履歴", Palette.markNew, active = current is Page.PostHistory) { vm.openRoot(Page.PostHistory()) }
        }
        HorizontalDivider(color = Palette.border)
        DrawerRow(Icons.Filled.Settings, "設定", Palette.textMuted, active = current is Page.Settings) { vm.openRoot(Page.Settings()) }
    }

    if (urlDialog) {
        var url by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { urlDialog = false },
            title = { Text("URL を開く") },
            text = { OutlinedTextField(url, { url = it }, singleLine = true, placeholder = { Text("https://…/test/read.cgi/板/番号/") }) },
            confirmButton = {
                TextButton(onClick = {
                    if (vm.openUrl(url)) urlDialog = false else vm.toast = "開けない URL です(2ch 互換のスレ・板の URL を入れてください)"
                }) { Text("開く") }
            },
            dismissButton = { TextButton(onClick = { urlDialog = false }) { Text("やめる") } },
        )
    }
}

@Composable
private fun DrawerRow(
    icon: ImageVector,
    label: String,
    tint: Color,
    sub: Boolean = false,
    active: Boolean = false,
    muted: Boolean = false,
    trailing: ImageVector? = null,
    onTrailing: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp)
            .background(if (active) Palette.accentWash else Color.Transparent, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .heightIn(min = if (sub) 44.dp else 54.dp)
            .padding(start = if (sub) 28.dp else 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(if (sub) 20.dp else 26.dp))
        Text(
            label, Modifier.weight(1f), color = if (muted) Palette.textMuted else if (active) Palette.accent else Palette.textStrong,
            fontSize = if (sub) 15.sp else 17.sp, fontWeight = if (sub) FontWeight.Normal else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        if (trailing != null) {
            Box(Modifier.size(40.dp).clickable(onClick = onTrailing ?: onClick), contentAlignment = Alignment.Center) {
                Icon(trailing, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
            }
        } else Spacer(Modifier.width(4.dp))
    }
}
