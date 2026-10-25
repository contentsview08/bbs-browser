package io.github.yumekui8.bbsnative.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.bbs.shiftJisByteLength

/** スレ表示の下の帯: 書き込みの結果の知らせと、書き込み欄を開くボタン(親指の届く下に、幅いっぱい) */
@Composable
fun BottomBar(notice: String?, onWrite: () -> Unit) {
    HorizontalDivider(color = Palette.border)
    Column(Modifier.fillMaxWidth().background(Palette.base).padding(horizontal = 12.dp, vertical = 8.dp)) {
        if (notice != null) Text(notice, Modifier.padding(bottom = 6.dp), color = Palette.accent, fontSize = 13.sp)
        Button(onClick = onWrite, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(12.dp)) {
            Text("書き込む", fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** 下から出る書き込み欄。エッヂの認証・5ch の書き込み確認の画面もここで出す */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReplySheet(vm: AppViewModel, page: Page.Thread) {
    val r = page.reply
    val context = LocalContext.current
    if (r.open) {
        ModalBottomSheet(
            onDismissRequest = { r.open = false; vm.saveDraft(page) },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Palette.surface,
        ) {
            Column(
                Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(page.title, color = Palette.textMuted, fontSize = 13.sp, maxLines = 1)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(r.name, { r.name = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("名前") })
                    Checkbox(checked = r.sage, onCheckedChange = { r.sage = it })
                    Text("sage", color = Palette.textBody)
                }
                OutlinedTextField(
                    r.body, { r.body = it },
                    Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 360.dp),
                    placeholder = { Text("本文") },
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${shiftJisByteLength(r.body)} バイト", Modifier.weight(1f), color = Palette.textMuted, fontSize = 12.sp)
                    if (r.notice != null) Text(r.notice!!, Modifier.weight(2f), color = Palette.heatHot, fontSize = 12.sp)
                }
                Button(
                    onClick = { vm.send(page) },
                    enabled = !r.sending && r.body.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    shape = RoundedCornerShape(12.dp),
                ) { Text(if (r.sending) "送っています…" else "書き込む", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }

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
                    a.code?.let { copy(context, it) }
                    a.url?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
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
            confirmButton = { TextButton(onClick = { vm.acceptConfirm(page) }) { Text("承諾して書き込む") } },
            dismissButton = { TextButton(onClick = { r.confirm = null }) { Text("やめる") } },
        )
    }
}

private fun copy(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("認証コード", text))
}
