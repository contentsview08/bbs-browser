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
import androidx.compose.animation.core.animateFloat
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Info
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.horizontalScroll
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
 * スレ表示のフッター(今のスマホ版の ReplyForm の chat と同じ): Discord・LINE のような 1 行の入力欄。
 * 丸い本文の欄(書くと 6 行ほどまで伸びる)の左の端に ＋(画像・オプションで名前とメール)、右に丸い送るボタンと更新ボタン。
 * 返事(エラー・書き込みました)は欄の上の面に出す。書き込めたらキーボードをしまう。キーボードが出たら、その上に持ち上がる
 */
@Composable
fun ThreadFooter(vm: AppViewModel, page: Page.Thread, onRefresh: () -> Unit) {
    val r = page.reply
    val focus = remember { FocusRequester() }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    val context = LocalContext.current
    var plusMenu by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    var imageHint by remember { mutableStateOf(false) }
    var field by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(r.body)) }
    // 本文が外(返信の >>12・書き込めて空になった・下書き)で変わったら、欄に写す(カーソルは最後に)
    LaunchedEffect(r.body) { if (field.text != r.body) field = androidx.compose.ui.text.input.TextFieldValue(r.body, androidx.compose.ui.text.TextRange(r.body.length)) }
    // 下書きを戻す
    LaunchedEffect(page) { vm.loadDraft(page) }
    LaunchedEffect(r.focusSeq) { if (r.focusSeq > 0) runCatching { focus.requestFocus() } }
    LaunchedEffect(r.blurSeq) { if (r.blurSeq > 0) focusManager.clearFocus() }
    // 「書き込みました」は少しで消す(出ている間はフッターを隠さないので、出しっぱなしにしない)
    LaunchedEffect(r.done) { if (r.done != null) { kotlinx.coroutines.delay(4000); r.done = null } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.attach(r, uri) }
    val disabled = if (page.archived) "dat 落ちしたスレには書き込めません" else null
    val canSend = !r.sending && r.body.isNotBlank() && disabled == null
    val shape = RoundedCornerShape(10.dp)
    // キーボードの分はスレ表示ごと持ち上げる(ThreadScreen の imePadding)。ここはナビゲーションバーの分だけ
    Column(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding()) {
        HorizontalDivider(color = Palette.border)
        if (imageHint) FooterNote(Icons.Filled.Info, "画像を付けるには、設定の「画像のアップロードを使う」をオンにしてください(catbox に上げて URL を本文に入れます)", Palette.textMuted) { imageHint = false }
        if (r.uploading) FooterNote(Icons.Filled.Sync, "画像をアップロード中…", Palette.textMuted, null)
        // 返事は、後ろのレスが透けて読めなくならないよう、塗りつぶした面に出す
        val result = r.notice ?: r.done
        if (result != null) {
            Box(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp).fillMaxWidth().heightIn(max = 160.dp).shadow(6.dp, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp))) {
                Text(
                    result, Modifier.padding(start = 12.dp, end = 34.dp, top = 8.dp, bottom = 8.dp).verticalScroll(rememberScrollState()),
                    color = if (r.notice != null) Palette.heatVeryHot else Palette.own, fontSize = 13.sp,
                )
                IconButton(onClick = { r.notice = null; r.done = null }, Modifier.align(Alignment.TopEnd).size(32.dp)) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textMuted, modifier = Modifier.size(16.dp)) }
            }
        }
        // 本文に入れた画像のリンクのサムネイル(欄の上)
        val previews = remember(r.body) { Regex("https?://\\S+?\\.(?:jpe?g|png|gif|webp)", RegexOption.IGNORE_CASE).findAll(r.body).map { it.value }.distinct().toList() }
        if (previews.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (u in previews) coil3.compose.AsyncImage(u, null, Modifier.size(48.dp).clip(RoundedCornerShape(5.dp)).border(1.dp, Palette.border, RoundedCornerShape(5.dp)).background(Palette.surface2), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
            }
        }
        // オプション: 名前・メール
        if (options) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmallField(r.name, { r.name = it }, "名前", Modifier.weight(1f))
                SmallField(r.mail, { r.mail = it }, "メール(sage など)", Modifier.weight(1f))
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = vm.prefs.footerHeight.dp).padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            // 丸い本文の欄。左の端に ＋(画像・オプション)
            Box(Modifier.weight(1f)) {
                Row(
                    Modifier.fillMaxWidth().background(Palette.surface, shape).border(1.dp, if (r.open) Palette.accent else Palette.border, shape),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    val rot by androidx.compose.animation.core.animateFloatAsState(if (plusMenu) 45f else 0f, label = "plus")
                    IconButton(onClick = { plusMenu = !plusMenu }, Modifier.size(40.dp)) {
                        Icon(Icons.Filled.Add, "画像・オプション", tint = if (plusMenu || options || r.mail.isNotEmpty() || r.name.isNotEmpty()) Palette.accent else Palette.textMuted, modifier = Modifier.size(24.dp).graphicsLayer { rotationZ = rot })
                    }
                    androidx.compose.foundation.text.BasicTextField(
                        field, { v -> field = v; r.body = v.text; vm.saveDraftLater(page) },
                        Modifier.weight(1f).heightIn(min = 40.dp, max = 160.dp).padding(end = 14.dp, top = 10.dp, bottom = 10.dp).focusRequester(focus)
                            .onFocusChanged { r.open = it.isFocused; if (it.isFocused) plusMenu = false },
                        enabled = disabled == null,
                        textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textBody, fontSize = 15.sp, lineHeight = 20.sp),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
                        decorationBox = { inner ->
                            Box { if (field.text.isEmpty()) Text(disabled ?: "書き込む", color = Palette.textMuted, fontSize = 15.sp); inner() }
                        },
                    )
                }
                // ＋ のメニュー(欄の上にふわっと出る)
                if (plusMenu) {
                    androidx.compose.ui.window.Popup(alignment = Alignment.BottomStart, offset = androidx.compose.ui.unit.IntOffset(0, -with(androidx.compose.ui.platform.LocalDensity.current) { 52.dp.roundToPx() }), onDismissRequest = { plusMenu = false }) {
                        val rise = remember { androidx.compose.animation.core.Animatable(0f) }
                        LaunchedEffect(Unit) { rise.animateTo(1f, androidx.compose.animation.core.tween(200, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
                        Column(
                            Modifier.graphicsLayer { alpha = rise.value; val sc = 0.94f + 0.06f * rise.value; scaleX = sc; scaleY = sc; translationY = (1f - rise.value) * 12.dp.toPx() }
                                .widthIn(min = 176.dp).shadow(10.dp, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp)).padding(vertical = 4.dp),
                        ) {
                            PlusItem(Icons.Filled.Image, if (r.uploading) "画像(アップロード中)" else "画像") {
                                plusMenu = false
                                if (vm.prefs.uploadEnabled) picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) else imageHint = true
                            }
                            PlusItem(Icons.Filled.Tune, if (options) "オプションを閉じる" else "オプション(名前・メール)") { plusMenu = false; options = !options }
                        }
                    }
                }
            }
            Spacer(Modifier.width(6.dp))
            // 送る(丸いボタン)
            Box(
                Modifier.padding(bottom = 1.dp).size(40.dp).graphicsLayer { alpha = if (canSend) 1f else 0.4f }.background(Palette.accent, CircleShape).clickable(enabled = canSend) { vm.send(page) },
                contentAlignment = Alignment.Center,
            ) {
                if (r.sending) CircularProgressIndicator(Modifier.size(18.dp), color = Palette.accentText, strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Send, "送る", tint = Palette.accentText, modifier = Modifier.size(20.dp))
            }
            // 更新(設定で消せる)。取っている間は回る
            if (vm.prefs.showRefreshButton) {
                val spin = androidx.compose.animation.core.rememberInfiniteTransition(label = "r").animateFloat(0f, 360f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(900, easing = androidx.compose.animation.core.LinearEasing)), label = "s")
                IconButton(onClick = onRefresh, Modifier.padding(start = 6.dp, end = 4.dp).size(44.dp)) {
                    Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted, modifier = Modifier.size(28.dp).graphicsLayer { rotationZ = if (page.loading) spin.value else 0f })
                }
            }
        }
    }
    PostDialogs(r, onAccept = { vm.acceptConfirm(page) })
}

@Composable
private fun FooterNote(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: Color, onClose: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, tint = color, modifier = Modifier.size(14.dp).padding(top = 1.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, Modifier.weight(1f), color = color, fontSize = 12.sp, lineHeight = 16.sp)
        if (onClose != null) Icon(Icons.Filled.Close, "閉じる", tint = color, modifier = Modifier.size(16.dp).clickable(onClick = onClose))
    }
}

@Composable
private fun PlusItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Row(Modifier.clickable(onClick = onClick).heightIn(min = 44.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, color = Palette.textBody, fontSize = 15.sp)
    }
}

@Composable
private fun SmallField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier) {
    androidx.compose.foundation.text.BasicTextField(
        value, onChange, modifier.heightIn(min = 38.dp).background(Palette.surface, RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 9.dp),
        singleLine = true, textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textBody, fontSize = 14.sp), cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
        decorationBox = { inner -> Box { if (value.isEmpty()) Text(placeholder, color = Palette.textMuted, fontSize = 14.sp); inner() } },
    )
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
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(6.dp),
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
