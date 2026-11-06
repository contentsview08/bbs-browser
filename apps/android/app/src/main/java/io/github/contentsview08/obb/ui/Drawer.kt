package io.github.contentsview08.obb.ui

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
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page

private const val BAD_URL_NOTICE = "開けない URL です(2ch 互換・したらば・まちBBS・hono-bbs のスレ・板の URL を入れてください)"

/** 左から出るメニュー */
@Composable
fun DrawerContent(vm: AppViewModel) {
    var favOpen by rememberSaveable { mutableStateOf(true) }
    var histOpen by rememberSaveable { mutableStateOf(false) }
    var urlDialog by rememberSaveable { mutableStateOf(false) }
    val current = vm.stack.lastOrNull()
    Column(Modifier.fillMaxHeight().width(300.dp).background(Palette.surface).safeDrawingPadding()) {
        Text("OBB", Modifier.padding(start = 24.dp, top = 20.dp, bottom = 12.dp), color = Palette.textStrong, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            DrawerRow(Icons.Filled.Star, "お気に入り板", Palette.markFav, trailing = if (favOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore) { favOpen = !favOpen }
            if (favOpen) {
                // 長押しして掴むと、上下に動かして並べ替えられる
                ReorderableColumn(vm.favorites, { it.url }, { from, to -> vm.moveFavorite(from, to) }, longPress = true) { b, handle, _ ->
                    val active = current is Page.Threads && current.board.url == b.url
                    Box(handle) { DrawerRow(Icons.Filled.Forum, boardUrl = b.url, label = vm.prefs.boardMeta[b.url]?.alias ?: b.name, tint = Palette.textMuted, sub = true, active = active) { vm.openBoard(b) } }
                }
                DrawerRow(Icons.Filled.Add, "板を追加", Palette.textMuted, sub = true, muted = true) { vm.openRoot(Page.Boards()) }
            }
            // 過去に見たスレの一覧(未読・閲覧履歴・お気に入りのスレ・書き込み履歴・上げた画像)は 1 つの画面にまとめ、上のタブで切り替える
            val past = current is Page.History || current is Page.AllUnread || current is Page.FavThreads || current is Page.PostHistory || current is Page.Uploads
            // 行を押すと小項目(最近見たスレ)を広げる。画面へは一番下の「すべて見る」から
            DrawerRow(Icons.Filled.History, "履歴", Palette.textMuted, active = past, trailing = if (histOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, onTrailing = { histOpen = !histOpen }) {
                histOpen = !histOpen
            }
            if (histOpen) {
                for (h in vm.history.take(8)) {
                    Text(
                        h.thread.title, Modifier.fillMaxWidth().clickable { vm.openThread(h.thread) }.padding(start = 64.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                        color = Palette.textBody, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                DrawerRow(Icons.Filled.History, "すべて見る", Palette.textMuted, sub = true, muted = true) { vm.openPast("history") } // 前に見ていたタブではなく、いつも閲覧のタブで開く
            }
            DrawerRow(Icons.Filled.Link, "URL を開く", Palette.textMuted) { urlDialog = true }
        }
        HorizontalDivider(color = Palette.border)
        DrawerRow(Icons.Filled.Settings, "設定", Palette.textMuted, active = current is Page.Settings) { vm.openRoot(Page.Settings()) }
    }

    if (urlDialog) OpenUrlDialog(vm) { urlDialog = false }
}

/** URL を開く(左のメニュー・板を探す)。クリップボードに URL があれば、はじめから入れておく */
@Composable
fun OpenUrlDialog(vm: AppViewModel, onDismiss: () -> Unit) {
        val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
        var url by rememberSaveable {
            mutableStateOf(runCatching { clipboard.getText()?.text?.trim() }.getOrNull()?.takeIf { Regex("^(h?ttps?://|//)?[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/\\S*$").matches(it) } ?: "")
        }
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("URL を開く") },
            text = {
                OutlinedTextField(
                    url, { url = it }, singleLine = true, placeholder = { Text("https://…/test/read.cgi/板/番号/") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri, imeAction = androidx.compose.ui.text.input.ImeAction.Go),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onGo = { if (vm.openUrl(url)) onDismiss() else vm.toast = BAD_URL_NOTICE }),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (vm.openUrl(url)) onDismiss() else vm.toast = BAD_URL_NOTICE
                }) { Text("開く") }
            },
            dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
        )
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
    /** 板のファビコンを出すとき、その板の URL */
    boardUrl: String? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp)
            .background(if (active) Palette.accentWash else Color.Transparent, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .heightIn(min = if (sub) 44.dp else 54.dp)
            .padding(start = if (sub) 28.dp else 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (boardUrl != null) Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
            BoardIcon(boardUrl, 18.dp) { Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp)) }
        } else Icon(icon, null, tint = tint, modifier = Modifier.size(if (sub) 20.dp else 26.dp))
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
