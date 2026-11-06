package io.github.contentsview08.obb.ui

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
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.material.icons.filled.Check
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.combinedClickable
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Sync
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
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.ReplyState
import io.github.contentsview08.obb.bbs.HonoBbs
import io.github.contentsview08.obb.bbs.shiftJisByteLength

/**
 * スレ表示のフッター: Discord・LINE のような 1 行の入力欄。
 * 丸い本文の欄(書くと 6 行ほどまで伸びる)の左の端に ＋(画像・オプションで名前とメール)、右に丸い送るボタンと更新ボタン。
 * 返事(エラー・書き込みました)は欄の上の面に出す。書き込めたらキーボードをしまう。キーボードが出たら、その上に持ち上がる
 */
@Composable
fun ThreadFooter(vm: AppViewModel, page: Page.Thread, onRefresh: () -> Unit) {
    val r = page.reply
    val focus = remember { FocusRequester() }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    var plusMenu by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    var field by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(r.body)) }
    // 定型文をカーソルの所に入れる
    fun insertPhrase(ph: String) {
        val sel = field.selection
        val t = field.text.substring(0, sel.min) + ph + field.text.substring(sel.max)
        field = androidx.compose.ui.text.input.TextFieldValue(t, androidx.compose.ui.text.TextRange(sel.min + ph.length))
        r.body = t; vm.saveDraftLater(page)
    }
    // 本文が外(返信の >>12・書き込めて空になった・下書き)で変わったら、欄に写す(カーソルは最後に)
    LaunchedEffect(r.body) { if (field.text != r.body) field = androidx.compose.ui.text.input.TextFieldValue(r.body, androidx.compose.ui.text.TextRange(r.body.length)) }
    LaunchedEffect(page) { vm.loadDraft(page) }
    // 欄に入る: メニューの窓が閉じきってから入り、キーボードもはっきり出す(すぐに入ると、窓に取られてキーボードが出ない)
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    LaunchedEffect(r.focusSeq) {
        if (r.focusSeq == 0) return@LaunchedEffect
        kotlinx.coroutines.delay(150)
        runCatching { focus.requestFocus() }
        keyboard?.show()
    }
    var phraseMenu by remember { mutableStateOf(false) }
    LaunchedEffect(r.blurSeq) { if (r.blurSeq > 0) focusManager.clearFocus() }
    // 「書き込みました」は少しで消す(出ている間はフッターを隠さないので、出しっぱなしにしない)
    LaunchedEffect(r.done) { if (r.done != null) { kotlinx.coroutines.delay(4000); r.done = null } }
    val picker = rememberImagePicker(vm, r)
    PickConfirm(vm, r, page.title, io.github.contentsview08.obb.bbs.TwoCh.webUrl(page.summary))
    r.webUpload?.let { job -> WebUploadScreen(job, onLink = { u, h -> vm.insertLink(r, u, h) }, onDismiss = { r.webUpload = null }) }
    val disabled = if (page.archived) "dat 落ちしたスレには書き込めません" else null
    var preview by remember { mutableStateOf(false) }
    val canSend = !r.sending && r.body.isNotBlank() && disabled == null
    val shape = RoundedCornerShape(10.dp)
    // キーボードの分はスレ表示ごと持ち上げる(ThreadScreen の imePadding)。ここはナビゲーションバーの分だけ
    Column(Modifier.fillMaxWidth().background(Palette.bar).navigationBarsPadding()) {
        HorizontalDivider(color = Palette.border)
        if (r.uploading) {
            val batch = r.uploads.filter { it.inBatch }
            val done = batch.count { it.state is io.github.contentsview08.obb.UploadItem.State.Done || it.state is io.github.contentsview08.obb.UploadItem.State.Failed }
            FooterNote(Icons.Filled.Sync, "画像をアップロード中… ${done + 1} / ${batch.size} 枚目", Palette.textMuted)
        }
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
        UploadStrip(vm, r, 56.dp, PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp))
        if (options) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmallField(r.name, { r.name = it }, "名前", Modifier.weight(1f))
                SmallField(r.mail, { r.mail = it }, "メール(sage など)", Modifier.weight(1f))
            }
        }
        // 定型文のバー(書いている間)。押すとカーソルの所に入る
        val phrases = vm.prefs.quickPhraseList
        if (r.open && phrases.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (ph in phrases) Text(
                    ph,
                    Modifier.clip(RoundedCornerShape(50)).background(Palette.surface2).border(1.dp, Palette.border, RoundedCornerShape(50))
                        .clickable { insertPhrase(ph) }.padding(horizontal = 12.dp, vertical = 5.dp),
                    color = Palette.textStrong, fontSize = 13.sp,
                )
            }
        }
        // フッターを低くしたら、欄とボタンも合わせて小さくする(本文の 1 行が切れない 28dp まで)
        val footerH = vm.prefs.footerHeight
        val control = (footerH - 8).coerceIn(28, 40)
        Row(Modifier.fillMaxWidth().heightIn(min = footerH.dp).padding(horizontal = 8.dp, vertical = ((footerH - control) / 2).coerceIn(2, 6).dp), verticalAlignment = Alignment.Bottom) {
            // 丸い本文の欄。左の端に ＋(画像・オプション)
            Box(Modifier.weight(1f)) {
                Row(
                    Modifier.fillMaxWidth().background(Palette.surface, shape).border(1.dp, if (r.open) Palette.accent else Palette.border, shape),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    val rot by androidx.compose.animation.core.animateFloatAsState(if (plusMenu) 45f else 0f, label = "plus")
                    IconButton(onClick = { plusMenu = !plusMenu }, Modifier.size(control.dp)) {
                        Icon(Icons.Filled.Add, "画像・オプション", tint = if (plusMenu || options || r.mail.isNotEmpty() || r.name.isNotEmpty()) Palette.accent else Palette.textMuted, modifier = Modifier.size(24.dp).graphicsLayer { rotationZ = rot })
                    }
                    Box(Modifier.weight(1f).heightIn(min = control.dp, max = 160.dp).padding(end = 14.dp, top = ((control - 20) / 2).dp, bottom = ((control - 20) / 2).dp)) {
                        BodyField(
                            field, { v -> field = v; r.body = v.text; vm.saveDraftLater(page) }, isAA(r), disabled ?: "書き込む", 15,
                            Modifier.fillMaxWidth().focusRequester(focus).onFocusChanged { r.open = it.isFocused; if (it.isFocused) plusMenu = false },
                            enabled = disabled == null,
                        )
                    }
                }
                // 定型文を選ぶ(＋ の「定型文」から)。押すとカーソルの所に入る
                if (phraseMenu) {
                    androidx.compose.ui.window.Popup(alignment = Alignment.BottomStart, offset = androidx.compose.ui.unit.IntOffset(0, -with(androidx.compose.ui.platform.LocalDensity.current) { 52.dp.roundToPx() }), onDismissRequest = { phraseMenu = false }) {
                        Column(
                            Modifier.widthIn(min = 200.dp, max = 320.dp).heightIn(max = 360.dp).shadow(10.dp, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp))
                                .border(1.dp, Palette.border, RoundedCornerShape(6.dp)).verticalScroll(rememberScrollState()).padding(vertical = 4.dp),
                        ) {
                            Text("定型文", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
                            if (phrases.isEmpty()) Text("定型文はありません(設定の書き込みで足せます)", Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = Palette.textMuted, fontSize = 13.sp)
                            for (ph in phrases) Text(
                                ph,
                                Modifier.fillMaxWidth().clickable {
                                    phraseMenu = false
                                    insertPhrase(ph)
                                    r.focusSeq++
                                }.padding(horizontal = 16.dp, vertical = 11.dp),
                                color = Palette.textStrong, fontSize = 15.sp, maxLines = 2,
                            )
                        }
                    }
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
                                startImagePick(vm, r, picker)
                            }
                            PlusItem(Icons.Filled.Tune, if (options) "オプションを閉じる" else "オプション(名前・メール)") { plusMenu = false; options = !options }
                            // 定型文は、設定にあるときだけ(既定は空)
                            if (phrases.isNotEmpty()) PlusItem(Icons.Filled.Bolt, "定型文") { plusMenu = false; phraseMenu = true }
                            val aaNow = isAA(r)
                            PlusItem(if (aaNow) Icons.AutoMirrored.Filled.Notes else Icons.Filled.GridOn, if (aaNow) "文字列として表示" else "AAとして表示") { plusMenu = false; r.aaOverride = !aaNow }
                        }
                    }
                }
            }
            Spacer(Modifier.width(6.dp))
            Box(
                Modifier.padding(bottom = 1.dp).size(control.dp).graphicsLayer { alpha = if (canSend) 1f else 0.4f }.background(Palette.accent, CircleShape)
                    .combinedClickable(
                        enabled = canSend,
                        onLongClick = { preview = true },
                    ) { vm.send(page) },
                contentAlignment = Alignment.Center,
            ) {
                if (r.sending) CircularProgressIndicator(Modifier.size(18.dp), color = Palette.accentText, strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Send, "送る", tint = Palette.accentText, modifier = Modifier.size(20.dp))
            }
            // 更新(設定で消せる)。取っている間は回る
            if (vm.prefs.showRefreshButton) {
                // 取り終えたら、新着があれば ✓、なければ「—」を少しだけ出して戻る(取れたか分かるように)
                var startCount by remember { mutableStateOf(-1) }
                var result by remember { mutableStateOf<Boolean?>(null) }
                LaunchedEffect(page.loading) {
                    if (page.loading) startCount = page.index.posts.size
                    else if (startCount >= 0) {
                        result = page.index.posts.size > startCount
                        startCount = -1
                        kotlinx.coroutines.delay(1200)
                        result = null
                    }
                }
                // 押した瞬間に軽く沈む
                val press = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
                val pressed by press.collectIsPressedAsState()
                val sink by androidx.compose.animation.core.animateFloatAsState(if (pressed) 0.86f else 1f, label = "sink")
                Box(
                    Modifier.padding(start = 6.dp, end = 4.dp).size((control + 4).dp).graphicsLayer { scaleX = sink; scaleY = sink }
                        .clickable(interactionSource = press, indication = null, onClick = onRefresh),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.animation.Crossfade(result, label = "result") { res ->
                        when (res) {
                            true -> Icon(Icons.Filled.Check, "新着あり", tint = Palette.own, modifier = Modifier.size(28.dp))
                            false -> Text("—", color = Palette.textMuted, fontSize = 22.sp)
                            null -> if (page.loading) SpinningRefreshIcon("更新", Palette.textMuted, 28.dp)
                            else Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted, modifier = Modifier.size(28.dp))
                        }
                    }
                }
            }
        }
        if (r.open && r.body.isNotEmpty()) ByteMeter(r.body, page.summary.boardUrl)
    }
    // 送る前の見た目(送るボタンの長押し)
    if (preview) PostPreview(vm, page) { preview = false }
    PostDialogs(r, onAccept = { vm.acceptConfirm(page) })
}

/**
 * バイト数・行数の目盛り(書いている間、欄の下に)。板の上限(SETTING.TXT)に対する割合を細い線で、9 割を超えたら暖色、超えたら赤
 */
@Composable
private fun ByteMeter(body: String, boardUrl: String) {
    val (maxBytes, maxLines) = remember(boardUrl) { io.github.contentsview08.obb.bbs.TwoCh.cachedLimits(boardUrl) }
    val bytes = remember(body, boardUrl) { io.github.contentsview08.obb.bbs.TwoCh.lengthOf(boardUrl, body) }
    val lines = body.count { it == '\n' } + 1
    val limit = maxBytes ?: 2048
    val f = maxOf(bytes.toFloat() / limit, maxLines?.let { lines.toFloat() / it } ?: 0f)
    val c = when { f > 1f -> Palette.markDanger; f > 0.9f -> Palette.markHot; else -> Palette.textMuted }
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(3.dp).background(Palette.border, RoundedCornerShape(2.dp))) {
            Box(Modifier.fillMaxWidth(f.coerceIn(0f, 1f)).fillMaxHeight().background(c, RoundedCornerShape(2.dp)))
        }
        Spacer(Modifier.width(8.dp))
        Text(
            "$bytes/${limit} バイト" + (maxLines?.let { "・$lines/$it 行" } ?: ""),
            color = c, fontSize = 11.sp,
        )
    }
}

/** 送る前の見た目: 書いた本文を、スレの中と同じ組み立てで 1 レスの形にして見せる */
@Composable
private fun PostPreview(vm: AppViewModel, page: Page.Thread, onDismiss: () -> Unit) {
    val r = page.reply
    val rendered = remember(r.body) {
        val post = io.github.contentsview08.obb.bbs.Post(
            (page.index.posts.lastOrNull()?.no ?: 0) + 1, r.name.ifBlank { "名無し" }, r.mail.trim(), "(送る前の見た目)", null, r.body,
        )
        val idx = io.github.contentsview08.obb.bbs.PostIndex.build(page.index.posts + post)
        renderPosts(idx, PostLinks(), RenderOptions(style = "card"))[post.no]
    }
    CenterPanel("送る前の見た目", onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
            if (rendered != null) WithoutBaseFont { PostItem(rendered, aa = isAA(r)) }
            Text(
                "AA・改行・リンクの見え方を確かめてから送れます", Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                color = Palette.textMuted, fontSize = 12.sp,
            )
        }
    }
}

/** AA 用の字で出すか: ボタンで選んだもの。選んでいなければ、空白が続く本文を AA とみなす */
private fun isAA(r: ReplyState) = r.aaOverride ?: AA_SPACES.containsMatchIn(r.body)
private val AA_SPACES = Regex("[ \t　]{5,}")

/**
 * 本文の欄。AA のときは AA 用の字で、折り返さず横にずらせる(レスの表示と同じ字なので、書いたとおりに見える)
 */
@Composable
private fun BodyField(
    value: androidx.compose.ui.text.input.TextFieldValue, onChange: (androidx.compose.ui.text.input.TextFieldValue) -> Unit,
    aa: Boolean, placeholder: String, fontSize: Int, modifier: Modifier, enabled: Boolean = true,
) {
    val style = if (aa) androidx.compose.ui.text.TextStyle(color = Palette.textBody, fontSize = 14.sp, fontFamily = AaFont, lineHeight = 17.sp, letterSpacing = 0.sp)
    else androidx.compose.ui.text.TextStyle(color = Palette.textBody, fontSize = fontSize.sp, lineHeight = (fontSize * 1.4f).sp)
    androidx.compose.foundation.text.BasicTextField(
        value, onChange,
        if (aa) modifier.horizontalScroll(rememberScrollState()) else modifier,
        enabled = enabled, textStyle = style, cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
        decorationBox = { inner -> Box { if (value.text.isEmpty()) Text(placeholder, color = Palette.textMuted, fontSize = fontSize.sp); inner() } },
    )
}

@Composable
private fun FooterNote(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: Color) {
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, tint = color, modifier = Modifier.size(14.dp).padding(top = 1.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, Modifier.weight(1f), color = color, fontSize = 12.sp, lineHeight = 16.sp)
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

/** ブラウザで済ませる認証の案内(書き込み・スレ立て・利用者の登録で共通) */
@Composable
fun AuthDialog(a: io.github.contentsview08.obb.bbs.PostResult.Auth, title: String, guide: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(guide, fontSize = 14.sp)
                if (a.code != null) Text("認証コード: ${a.code}", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Palette.textStrong)
                Text(a.message, fontSize = 12.sp, color = Palette.textMuted)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                a.code?.let { copyText(context, it) }
                a.url?.let { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }
                onDismiss()
            }) { Text(if (a.code != null) "コードをコピーして開く" else "ブラウザで開く") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("閉じる") } },
    )
}

/** エッヂの認証・5ch の書き込み確認の画面(書き込みとスレ立てで共通) */
@Composable
fun PostDialogs(r: ReplyState, onAccept: () -> Unit) {
    r.auth?.let { a ->
        AuthDialog(a, "認証が要ります", "ブラウザで認証のページを開き、下の認証コードを入れてから、もう一度書き込んでください。") { r.auth = null }
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

/**
 * スレを立てる画面(全画面)。入れる欄を切り替えても画面が上下に動かないよう、
 * 画面いっぱいに置き、キーボードの分だけ下を縮める。上に ✕・板名・「立てる」、中にスレタイ・(オプションで名前とメール)・本文、
 * 本文に入れた画像のサムネイル、下にキーボードのすぐ上の道具(画像・バイト数)
 */
@Composable
fun NewThreadSheet(vm: AppViewModel, page: Page.Threads) {
    val r = page.newThread
    // 書きかけを戻す(開いたとき、まだ何も書いていなければ)・書くたびに覚える(閉じても消えないように)
    fun saveDraftNow() = vm.prefs.setNewThreadDraft(page.board.url, r.title, r.name, r.mail, r.body)
    // 覚えるのを待っている書きかけがあるか
    val draftPending = remember(r) { booleanArrayOf(false) }
    androidx.compose.runtime.LaunchedEffect(r.open) {
        if (draftPending[0]) { draftPending[0] = false; saveDraftNow() }
        if (r.open && r.title.isEmpty() && r.body.isEmpty()) vm.prefs.newThreadDraft(page.board.url)?.let { (t, n, m, b) ->
            r.title = t; if (n.isNotEmpty()) r.name = n; r.mail = m; r.body = b
        }
    }
    // 全部の板の書きかけを読み直して書き戻すので、打っている間は待ち、止まってから覚える
    androidx.compose.runtime.LaunchedEffect(r.title, r.name, r.mail, r.body) {
        if (r.open || r.title.isNotEmpty() || r.body.isNotEmpty()) {
            draftPending[0] = true
            kotlinx.coroutines.delay(500)
            draftPending[0] = false
            saveDraftNow()
        }
    }
    androidx.compose.runtime.DisposableEffect(r) {
        onDispose { if (draftPending[0]) { draftPending[0] = false; saveDraftNow() } }
    }
    if (r.open) {
        FullWindow(onDismiss = { r.open = false }) {
            // 下からすべり上がって出る
            val rise = remember { androidx.compose.animation.core.Animatable(1f) }
            LaunchedEffect(Unit) { rise.animateTo(0f, androidx.compose.animation.core.tween(260, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f))) }
            val picker = rememberImagePicker(vm, r)
            PickConfirm(vm, r, r.title, page.board.url)
            r.webUpload?.let { job -> WebUploadScreen(job, onLink = { u, h -> vm.insertLink(r, u, h) }, onDismiss = { r.webUpload = null }) }
            var options by remember { mutableStateOf(false) }
            val titleFocus = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { titleFocus.requestFocus() } }
            val canSend = !r.sending && r.title.isNotBlank() && r.body.isNotBlank()
            Column(
                Modifier.fillMaxSize().graphicsLayer { translationY = rise.value * size.height * 0.15f; alpha = 1f - rise.value }
                    .background(Palette.base).statusBarsPadding().imePadding().navigationBarsPadding(),
            ) {
                Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = vm.prefs.headerHeight.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { r.open = false }) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textMuted) }
                    Column(Modifier.weight(1f)) {
                        Text("スレを立てる", color = Palette.textStrong, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text(page.board.name, color = Palette.textMuted, fontSize = 12.sp, maxLines = 1)
                    }
                    Box(
                        Modifier.padding(end = 8.dp).graphicsLayer { alpha = if (canSend) 1f else 0.4f }.background(Palette.accent, RoundedCornerShape(6.dp))
                            .clickable(enabled = canSend) { vm.createThread(page) }.padding(horizontal = 16.dp, vertical = 9.dp),
                    ) {
                        if (r.sending) CircularProgressIndicator(Modifier.size(18.dp), color = Palette.accentText, strokeWidth = 2.dp)
                        else Text("立てる", color = Palette.accentText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    }
                }
                HorizontalDivider(color = Palette.border)
                r.notice?.let { n ->
                    Text(n, Modifier.fillMaxWidth().background(Palette.surface).padding(horizontal = 16.dp, vertical = 8.dp), color = Palette.heatVeryHot, fontSize = 13.sp)
                    HorizontalDivider(color = Palette.border)
                }
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                    androidx.compose.foundation.text.BasicTextField(
                        r.title, { r.title = it },
                        Modifier.fillMaxWidth().focusRequester(titleFocus).padding(horizontal = 16.dp, vertical = 14.dp),
                        singleLine = false, maxLines = 3,
                        textStyle = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontSize = 18.sp, fontWeight = FontWeight.Bold, lineHeight = 24.sp),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.accent),
                        decorationBox = { inner -> Box { if (r.title.isEmpty()) Text("スレタイ", color = Palette.textMuted, fontSize = 18.sp, fontWeight = FontWeight.Bold); inner() } },
                    )
                    HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = Palette.border)
                    if (options) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SmallField(r.name, { r.name = it }, "名前", Modifier.weight(1f))
                            SmallField(r.mail, { r.mail = it }, "メール(sage など)", Modifier.weight(1f))
                        }
                        HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = Palette.border)
                    }
                    var bodyField by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(r.body)) }
                    // 画像の URL など、外から本文が変わったら欄にも映す(映さないと、書き足したときに URL が消える)
                    LaunchedEffect(r.body) { if (bodyField.text != r.body) bodyField = androidx.compose.ui.text.input.TextFieldValue(r.body, androidx.compose.ui.text.TextRange(r.body.length)) }
                    Box(Modifier.fillMaxWidth().heightIn(min = 240.dp).padding(horizontal = 16.dp, vertical = 14.dp)) {
                        BodyField(bodyField, { bodyField = it; r.body = it.text }, isAA(r), "本文", 16, Modifier.fillMaxWidth())
                    }
                    UploadStrip(vm, r, 72.dp, PaddingValues(horizontal = 16.dp, vertical = 8.dp))
                }
                // キーボードのすぐ上の道具: 画像・オプション(名前・メール)・バイト数
                HorizontalDivider(color = Palette.border)
                Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 48.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { startImagePick(vm, r, picker) }, enabled = !r.uploading) {
                        if (r.uploading) CircularProgressIndicator(Modifier.size(20.dp), color = Palette.accent, strokeWidth = 2.dp)
                        else Icon(Icons.Filled.Image, "画像を付ける", tint = Palette.textMuted)
                    }
                    IconButton(onClick = { options = !options }) { Icon(Icons.Filled.Tune, "名前・メール", tint = if (options || r.name.isNotEmpty() || r.mail.isNotEmpty()) Palette.accent else Palette.textMuted) }
                    val aaNow = isAA(r)
                    IconButton(onClick = { r.aaOverride = !aaNow }) { Icon(Icons.Filled.GridOn, if (aaNow) "文字列として表示" else "AAとして表示", tint = if (aaNow) Palette.accent else Palette.textMuted) }
                    Spacer(Modifier.weight(1f))
                    Text(if (io.github.contentsview08.obb.bbs.HonoBbs.isBoardUrl(page.board.url)) "${r.body.length} 文字" else "${shiftJisByteLength(r.body)} バイト", Modifier.padding(end = 12.dp), color = Palette.textMuted, fontSize = 12.sp)
                }
            }
        }
    }
    PostDialogs(r, onAccept = { r.confirm = null; vm.toast = "書き込み確認が出ました。もう一度「立てる」を押してください" })
}

fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("bbs", text))
}

/** 画像を付ける: 写真を選ぶ。どこへ渡すかは選んだあとに決まる(AppViewModel.attach) */
private fun startImagePick(vm: AppViewModel, r: io.github.contentsview08.obb.ReplyState, picker: () -> Unit) {
    val problem = if (HonoBbs.isBoardUrl(r.boardUrl)) null else io.github.contentsview08.obb.data.Uploader.hostProblem(vm.prefs.uploadHost, vm.prefs.imgurClientId, vm.prefs.imgbbApiKey)
    if (problem != null) r.notice = problem else picker()
}

/** 写真の選択画面(何枚でも選べる。一度に 10 枚まで)を開く関数。選んだ画像は順番に上げる */
@Composable
fun rememberImagePicker(vm: AppViewModel, r: io.github.contentsview08.obb.ReplyState): () -> Unit {
    // 選んだら、すぐ上げずに確かめの窓(PickConfirm)へ。どれを上げるか・スレタイと URL を描き込むかを決めてから上げる
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris -> if (uris.isNotEmpty()) r.pendingPick = uris }
    return { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }
}

/**
 * 上げる前の確かめ(PC 版の useMediaInput の confirmView と同じ): 選んだ画像をサムネイルで並べ、上げないものはチェックを外す。
 * 「画像にスレタイと URL を入れる」(左下 / 右下。最後の選びを覚える)。title・url はこのスレ(スレ立てはスレタイの欄と板)
 */
@Composable
fun PickConfirm(vm: AppViewModel, r: io.github.contentsview08.obb.ReplyState, title: String, url: String) {
    val uris = r.pendingPick ?: return
    val p = vm.prefs
    val on = remember(uris) { androidx.compose.runtime.mutableStateListOf(*Array(uris.size) { true }) }
    var stampOn by remember { mutableStateOf(p.uploadStamp.isNotEmpty()) }
    var corner by remember { mutableStateOf(p.uploadStamp.ifEmpty { "right" }) }
    val close = { r.pendingPick = null }
    val accentBox = CheckboxDefaults.colors(checkedColor = Palette.accent, checkmarkColor = Palette.accentText, uncheckedColor = Palette.borderStrong)
    CenterPanel("画像を上げる", close) {
        Column(Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
            uris.forEachIndexed { i, u ->
                Row(Modifier.fillMaxWidth().clickable { on[i] = !on[i] }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = on[i], onCheckedChange = { on[i] = it }, colors = accentBox)
                    coil3.compose.AsyncImage(u, null, Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp)).background(Palette.surface2), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                    Spacer(Modifier.width(12.dp))
                    Text("${i + 1} 枚目", color = Palette.textBody, fontSize = 14.sp)
                }
            }
        }
        HorizontalDivider(color = Palette.border)
        // 画像の隅にスレタイと URL を描き込む(JPEG・PNG・WebP だけ)
        Row(Modifier.fillMaxWidth().clickable { stampOn = !stampOn; p.uploadStamp = if (stampOn) corner else "" }.padding(start = 12.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = stampOn, onCheckedChange = { stampOn = it; p.uploadStamp = if (it) corner else "" }, colors = accentBox)
            Text("画像にスレタイと URL を入れる", Modifier.weight(1f), color = Palette.textBody, fontSize = 14.sp)
            if (stampOn) for ((k, label) in listOf("left" to "左下", "right" to "右下")) Text(
                label,
                Modifier.padding(start = 6.dp).clip(RoundedCornerShape(6.dp)).border(1.dp, if (corner == k) Palette.accent else Palette.border, RoundedCornerShape(6.dp))
                    .background(if (corner == k) Palette.accentWash else Color.Transparent).clickable { corner = k; p.uploadStamp = k }.padding(horizontal = 10.dp, vertical = 4.dp),
                color = if (corner == k) Palette.accent else Palette.textMuted, fontSize = 13.sp,
            )
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = close) { Text("やめる", color = Palette.textMuted) }
            val chosen = uris.filterIndexed { i, _ -> on[i] }
            TextButton(enabled = chosen.isNotEmpty(), onClick = {
                close()
                vm.attach(r, chosen, if (stampOn) io.github.contentsview08.obb.data.Uploader.Stamp(listOf(title, url), corner) else null)
            }) { Text("${chosen.size} 枚を上げる", color = Palette.accent, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold) }
        }
    }
}

/**
 * 書き込み欄の画像の帯: 本文に入れた画像の URL と、上げている途中・待っている・失敗した画像を、選んだ順に 1 枚ずつ並べる。
 * 上げた画像は端末の画像をそのまま出す(ネットから取り直さないので、すぐ見える)。押すと画像ビューアーで開き、× で本文から外す。
 * 失敗した画像は押すと上げ直す
 */
@Composable
private fun UploadStrip(vm: AppViewModel, r: io.github.contentsview08.obb.ReplyState, size: androidx.compose.ui.unit.Dp, padding: PaddingValues) {
    val urls = remember(r.body) { Regex("https?://\\S+?\\.(?:jpe?g|png|gif|webp)", RegexOption.IGNORE_CASE).findAll(r.body).map { it.value }.distinct().toList() }
    val pending = r.uploads.filter { it.state !is io.github.contentsview08.obb.UploadItem.State.Done }
    if (urls.isEmpty() && pending.isEmpty()) return
    val shape = RoundedCornerShape(6.dp)
    // 押した画像を、本文に入れた画像の並びのまま画像ビューアーで開く(スレの画像と同じビューアー)
    var viewing by remember { mutableStateOf<String?>(null) }
    viewing?.let { u -> ImageViewer(urls, u, onClose = { viewing = null }) }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(padding), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (u in urls) Box(Modifier.size(size)) {
            val local = r.localOf(u)
            val m = Modifier.matchParentSize().clip(shape).border(1.dp, Palette.border, shape).background(Palette.surface2).clickable { viewing = u }
            if (local != null) coil3.compose.AsyncImage(local, null, m, contentScale = androidx.compose.ui.layout.ContentScale.Crop)
            else StoredImage(u, m, showProgress = false)
            Box(
                Modifier.align(Alignment.TopEnd).padding(3.dp).size(20.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color.Black.copy(alpha = 0.6f))
                    .clickable { vm.removeImageUrl(r, u) },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Close, "外す", tint = Color.White, modifier = Modifier.size(13.dp)) }
        }
        for (item in pending) Box(
            Modifier.size(size).clip(shape).border(1.dp, Palette.border, shape).background(Palette.surface2)
                .clickable(enabled = item.state is io.github.contentsview08.obb.UploadItem.State.Failed) { vm.retryUpload(r, item) },
            contentAlignment = Alignment.Center,
        ) {
            coil3.compose.AsyncImage(item.uri, null, Modifier.matchParentSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
            // 上げる前・途中は暗くして、印を重ねる
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.5f)))
            when (val st = item.state) {
                is io.github.contentsview08.obb.UploadItem.State.Uploading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    Text("上げ中", color = Color.White, fontSize = 10.sp, modifier = Modifier.padding(top = 3.dp))
                }
                is io.github.contentsview08.obb.UploadItem.State.Failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.Refresh, st.message, tint = Palette.markDanger, modifier = Modifier.size(20.dp))
                    Text("再送", color = Color.White, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
                }
                else -> Text("待ち", color = Color.White.copy(alpha = 0.85f), fontSize = 10.sp)
            }
        }
    }
}
