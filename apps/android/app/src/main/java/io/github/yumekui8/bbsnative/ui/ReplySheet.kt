package io.github.yumekui8.bbsnative.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.ReplyState
import io.github.yumekui8.bbsnative.bbs.shiftJisByteLength

/**
 * スレ表示の下の帯。閉じているときは「＋ 書き込む」の欄・送るボタン・更新(今のスマホ版と同じ)。
 * 欄を押すと、その場で書き込み欄(名前・sage・本文)に広がる。キーボードの上に持ち上がる
 */
@Composable
fun ThreadFooter(vm: AppViewModel, page: Page.Thread, onRefresh: () -> Unit) {
    val r = page.reply
    val focus = remember { FocusRequester() }
    Column(Modifier.fillMaxWidth().background(Palette.bar).imePadding().navigationBarsPadding()) {
        HorizontalDivider(color = Palette.border)
        if (r.open) {
            LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    r.name, { r.name = it }, Modifier.weight(1f).heightIn(min = 48.dp), singleLine = true, placeholder = { Text("名前") },
                    colors = fieldColors(), shape = RoundedCornerShape(10.dp),
                )
                Checkbox(r.sage, { r.sage = it }, colors = CheckboxDefaults.colors(checkedColor = Palette.accent))
                Text("sage", color = Palette.textBody, fontSize = 14.sp)
                AttachButton(vm, r)
                IconButton(onClick = { r.open = false; vm.saveDraft(page) }) { Icon(Icons.Filled.Close, "しまう", tint = Palette.textMuted) }
            }
            TextField(
                r.body, { r.body = it },
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).heightIn(min = 120.dp, max = 280.dp).focusRequester(focus),
                placeholder = { Text("本文") }, colors = fieldColors(), shape = RoundedCornerShape(12.dp),
            )
        }
        Row(Modifier.fillMaxWidth().heightIn(min = vm.prefs.footerHeight.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!r.open) {
                // 押すと書き込み欄に広がる、入力欄の形のボタン
                Row(
                    Modifier.weight(1f).heightIn(min = 46.dp).border(1.dp, Palette.borderStrong, RoundedCornerShape(23.dp)).background(Palette.surface2, RoundedCornerShape(23.dp))
                        .clickable { vm.openReply(page) }.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Filled.Add, null, tint = Palette.textMuted, modifier = Modifier.size(22.dp))
                    Text(if (r.body.isNotBlank()) r.body.lineSequence().first() else "書き込む", color = if (r.body.isNotBlank()) Palette.textBody else Palette.textMuted, fontSize = 16.sp, maxLines = 1)
                }
            } else {
                // 広げているときは、送るボタンの左にバイト数と知らせを出す(1 行ぶん詰める)
                Column(Modifier.weight(1f).padding(start = 4.dp)) {
                    Text("${shiftJisByteLength(r.body)} バイト", color = Palette.textMuted, fontSize = 12.sp)
                    if (r.notice != null) Text(r.notice!!, color = Palette.markDanger, fontSize = 12.sp, maxLines = 3)
                }
            }
            Spacer(Modifier.width(10.dp))
            // 送る
            val canSend = !r.sending && r.body.isNotBlank()
            Box(
                Modifier.size(48.dp).background(if (canSend) Palette.accent else Palette.accent.copy(alpha = 0.35f), CircleShape).clickable(enabled = canSend) { vm.send(page) },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.AutoMirrored.Filled.Send, if (r.sending) "送っています" else "書き込む", tint = Color.White.copy(alpha = if (canSend) 1f else 0.6f), modifier = Modifier.size(22.dp)) }
            Spacer(Modifier.width(6.dp))
            if (vm.prefs.showRefreshButton) IconButton(onClick = onRefresh, enabled = !page.loading) { Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted, modifier = Modifier.size(28.dp)) }
        }
    }
    PostDialogs(r, onAccept = { vm.acceptConfirm(page) })
}

/**
 * 画像を付けるボタン(端末の写真の選択画面を開き、選んだ画像を catbox に上げて URL を本文に入れる)。
 * 設定で切っているときは、押すと案内を出す(PC 版と同じ)
 */
@Composable
fun AttachButton(vm: AppViewModel, r: ReplyState) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.attach(r, uri) }
    IconButton(
        onClick = {
            if (!vm.prefs.uploadEnabled) r.notice = "画像を付けるには、設定の「書き込み欄から画像を上げる」をオンにしてください"
            else picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
        },
        enabled = !r.uploading,
    ) {
        if (r.uploading) CircularProgressIndicator(Modifier.size(22.dp), color = Palette.accent, strokeWidth = 2.dp)
        else Icon(Icons.Filled.AddPhotoAlternate, "画像を付ける", tint = Palette.markImage)
    }
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Palette.surface2, unfocusedContainerColor = Palette.surface2,
    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
)

/** エッヂの認証・5ch の書き込み確認の画面(書き込みとスレ立てで共通) */
@Composable
fun PostDialogs(r: ReplyState, onAccept: () -> Unit) {
    val context = LocalContext.current
    r.auth?.let { a ->
        AlertDialog(
            onDismissRequest = { r.auth = null },
            title = { Text("認証が要ります") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("ブラウザで認証のページを開き、下の認証コードを入れてから、もう一度書き込んでください。", fontSize = 14.sp)
                    if (a.code != null) Text("認証コード: ${a.code}", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Palette.textStrong)
                    Text(a.message, fontSize = 12.sp, color = Palette.textMuted)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    a.code?.let { copyText(context, it) }
                    a.url?.let { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }
                    r.auth = null
                }) { Text(if (a.code != null) "コードをコピーして開く" else "ブラウザで開く") }
            },
            dismissButton = { TextButton(onClick = { r.auth = null }) { Text("閉じる") } },
        )
    }
    r.confirm?.let { c ->
        AlertDialog(
            onDismissRequest = { r.confirm = null },
            title = { Text("書き込み確認") },
            text = { Text(c.message, Modifier.verticalScroll(rememberScrollState()), fontSize = 13.sp) },
            confirmButton = { TextButton(onClick = onAccept) { Text("承諾して書き込む") } },
            dismissButton = { TextButton(onClick = { r.confirm = null }) { Text("やめる") } },
        )
    }
}

/** スレを立てる欄(下から出る) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewThreadSheet(vm: AppViewModel, page: Page.Threads) {
    val r = page.newThread
    if (r.open) {
        ModalBottomSheet(onDismissRequest = { r.open = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.surface) {
            Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("スレを立てる ・ ${page.board.name}", color = Palette.textStrong, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                OutlinedTextField(r.title, { r.title = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("スレタイ") }, textStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(r.name, { r.name = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("名前") })
                    Checkbox(r.sage, { r.sage = it })
                    Text("sage", color = Palette.textBody)
                    AttachButton(vm, r)
                }
                OutlinedTextField(r.body, { r.body = it }, Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 320.dp), placeholder = { Text("本文") })
                if (r.notice != null) Text(r.notice!!, color = Palette.markDanger, fontSize = 12.sp)
                Button(
                    onClick = { vm.createThread(page) }, enabled = !r.sending && r.title.isNotBlank() && r.body.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(12.dp),
                ) { Text(if (r.sending) "送っています…" else "スレを立てる", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
    PostDialogs(r, onAccept = { r.confirm = null; vm.toast = "書き込み確認が出ました。もう一度「スレを立てる」を押してください" })
}

fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("bbs", text))
}
