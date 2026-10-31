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
    // 欄に入る: メニューの窓が閉じきってから入り、キーボードもはっきり出す(すぐに入ろうとすると、窓に取られてキーボードが出なかった)
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
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.attach(r, uri) }
    val disabled = if (page.archived) "dat 落ちしたスレには書き込めません" else null
    // 送る前の待ち(設定)。残り秒数。0 より大きい間は「取り消す」を出す
    var pending by remember { mutableStateOf(0) }
    LaunchedEffect(pending > 0) {
        while (pending > 0) { kotlinx.coroutines.delay(1000); if (pending > 0) pending-- ; if (pending == 0) vm.send(page) }
    }
    var preview by remember { mutableStateOf(false) }
    val canSend = !r.sending && r.body.isNotBlank() && disabled == null && pending == 0
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
        // 定型文のバー(書いている間)。押すとカーソルの所に入る
        val phrases = vm.prefs.quickPhrases.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (r.open && vm.prefs.phraseBar && phrases.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (ph in phrases) Text(
                    ph,
                    Modifier.clip(RoundedCornerShape(50)).background(Palette.surface2).border(1.dp, Palette.border, RoundedCornerShape(50))
                        .clickable {
                            val sel = field.selection
                            val t = field.text.substring(0, sel.min) + ph + field.text.substring(sel.max)
                            field = androidx.compose.ui.text.input.TextFieldValue(t, androidx.compose.ui.text.TextRange(sel.min + ph.length))
                            r.body = t; vm.saveDraftLater(page)
                        }.padding(horizontal = 12.dp, vertical = 5.dp),
                    color = Palette.textStrong, fontSize = 13.sp,
                )
            }
        }
        // 送るまでの待ち(取り消せる)
        if (pending > 0) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp).background(Palette.surface2, RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("$pending 秒後に送ります", Modifier.weight(1f), color = Palette.textStrong, fontSize = 13.sp)
                Text("取り消す", Modifier.clickable { pending = 0 }.padding(horizontal = 8.dp, vertical = 2.dp), color = Palette.accent, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = vm.prefs.footerHeight.dp).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
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
                    Box(Modifier.weight(1f).heightIn(min = 40.dp, max = 160.dp).padding(end = 14.dp, top = 10.dp, bottom = 10.dp)) {
                        BodyField(
                            field, { v -> field = v; r.body = v.text; vm.saveDraftLater(page) }, isAA(r, vm.prefs.aaAutoDetect), disabled ?: "書き込む", 15,
                            Modifier.fillMaxWidth().focusRequester(focus).onFocusChanged { r.open = it.isFocused; if (it.isFocused) plusMenu = false },
                            enabled = disabled == null,
                        )
                    }
                }
                // 定型文を選ぶ(＋ の「定型文」から)。押すとカーソルの所に入る
                if (phraseMenu) {
                    val phrases = vm.prefs.quickPhrases.lines().map { it.trim() }.filter { it.isNotEmpty() }
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
                                    val sel = field.selection
                                    val t = field.text.substring(0, sel.min) + ph + field.text.substring(sel.max)
                                    field = androidx.compose.ui.text.input.TextFieldValue(t, androidx.compose.ui.text.TextRange(sel.min + ph.length))
                                    r.body = t; vm.saveDraftLater(page)
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
                                if (vm.prefs.uploadEnabled) picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) else imageHint = true
                            }
                            PlusItem(Icons.Filled.Tune, if (options) "オプションを閉じる" else "オプション(名前・メール)") { plusMenu = false; options = !options }
                            PlusItem(Icons.Filled.Bolt, "定型文") { plusMenu = false; phraseMenu = true }
                            val aaNow = isAA(r, vm.prefs.aaAutoDetect)
                            PlusItem(if (aaNow) Icons.AutoMirrored.Filled.Notes else Icons.Filled.GridOn, if (aaNow) "文字列として表示" else "AAとして表示") { plusMenu = false; r.aaOverride = !aaNow }
                        }
                    }
                }
            }
            Spacer(Modifier.width(6.dp))
            // 送る(丸いボタン)
            Box(
                Modifier.padding(bottom = 1.dp).size(40.dp).graphicsLayer { alpha = if (canSend) 1f else 0.4f }.background(Palette.accent, CircleShape)
                    .combinedClickable(
                        enabled = canSend,
                        onLongClick = { preview = true },
                    ) { if (vm.prefs.sendDelay) pending = 3 else vm.send(page) },
                contentAlignment = Alignment.Center,
            ) {
                if (r.sending) CircularProgressIndicator(Modifier.size(18.dp), color = Palette.accentText, strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Send, "送る", tint = Palette.accentText, modifier = Modifier.size(20.dp))
            }
            // 更新(設定で消せる)。取っている間は回る
            if (vm.prefs.showRefreshButton) {
                val spin = androidx.compose.animation.core.rememberInfiniteTransition(label = "r").animateFloat(0f, 360f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(900, easing = androidx.compose.animation.core.LinearEasing)), label = "s")
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
                    Modifier.padding(start = 6.dp, end = 4.dp).size(44.dp).graphicsLayer { scaleX = sink; scaleY = sink }
                        .clickable(interactionSource = press, indication = null, onClick = onRefresh),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.animation.Crossfade(result, label = "result") { res ->
                        when (res) {
                            true -> Icon(Icons.Filled.Check, "新着あり", tint = Palette.own, modifier = Modifier.size(28.dp))
                            false -> Text("—", color = Palette.textMuted, fontSize = 22.sp)
                            null -> Icon(Icons.Filled.Refresh, "更新", tint = Palette.textMuted, modifier = Modifier.size(28.dp).graphicsLayer { rotationZ = if (page.loading) spin.value else 0f })
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
    val (maxBytes, maxLines) = remember(boardUrl) { io.github.yumekui8.bbsnative.bbs.TwoCh.cachedLimits(boardUrl) }
    val bytes = remember(body) { shiftJisByteLength(body) }
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
        val post = io.github.yumekui8.bbsnative.bbs.Post(
            (page.index.posts.lastOrNull()?.no ?: 0) + 1, r.name.ifBlank { "名無し" }, r.mail.trim(), "(送る前の見た目)", null, r.body,
        )
        val idx = io.github.yumekui8.bbsnative.bbs.PostIndex.build(page.index.posts + post)
        renderPosts(idx, PostLinks(), RenderOptions(style = "card"))[post.no]
    }
    CenterPanel("送る前の見た目", onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
            if (rendered != null) PostItem(rendered, aa = isAA(r, vm.prefs.aaAutoDetect))
            Text(
                "AA・改行・リンクの見え方を確かめてから送れます", Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                color = Palette.textMuted, fontSize = 12.sp,
            )
        }
    }
}

/** 本文を AA 用の字で出すか: 選んでいればそれ、なければ空白が 5 つ以上続く本文(設定の「AA を見分ける」がオンのとき) */
private fun isAA(r: ReplyState, auto: Boolean) = r.aaOverride ?: (auto && Regex("[ \t　]{5,}").containsMatchIn(r.body))

/**
 * 本文の欄。AA のときは AA 用の字で、折り返さず横にずらせる(レスの表示と同じ字なので、書いたとおりに見える。今のスマホ版の書き込み欄と同じ)
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

/**
 * スレを立てる画面(全画面)。下から出る欄だと、入れる欄を切り替えるたびにキーボードが出入りして画面ごと上下に動いていたので、
 * 画面いっぱいに置き、キーボードの分だけ下を縮める。上に ✕・板名・「立てる」、中にスレタイ・(オプションで名前とメール)・本文、
 * 本文に入れた画像のサムネイル、下にキーボードのすぐ上の道具(画像・バイト数)
 */
@Composable
fun NewThreadSheet(vm: AppViewModel, page: Page.Threads) {
    val r = page.newThread
    if (r.open) {
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { r.open = false },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            val view = androidx.compose.ui.platform.LocalView.current
            androidx.compose.runtime.SideEffect {
                (view.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window?.let { w ->
                    w.setDimAmount(0f)
                    w.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
                }
            }
            // 下からすべり上がって出る
            val rise = remember { androidx.compose.animation.core.Animatable(1f) }
            LaunchedEffect(Unit) { rise.animateTo(0f, androidx.compose.animation.core.tween(260, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f))) }
            val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.attach(r, uri) }
            var options by remember { mutableStateOf(false) }
            val titleFocus = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { titleFocus.requestFocus() } }
            val canSend = !r.sending && r.title.isNotBlank() && r.body.isNotBlank()
            Column(
                Modifier.fillMaxSize().graphicsLayer { translationY = rise.value * size.height * 0.15f; alpha = 1f - rise.value }
                    .background(Palette.base).statusBarsPadding().imePadding().navigationBarsPadding(),
            ) {
                // 上の帯
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
                // 返事(エラー)
                r.notice?.let { n ->
                    Text(n, Modifier.fillMaxWidth().background(Palette.surface).padding(horizontal = 16.dp, vertical = 8.dp), color = Palette.heatVeryHot, fontSize = 13.sp)
                    HorizontalDivider(color = Palette.border)
                }
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                    // スレタイ(大きく太く)
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
                    // 本文
                    var bodyField by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(r.body)) }
                    Box(Modifier.fillMaxWidth().heightIn(min = 240.dp).padding(horizontal = 16.dp, vertical = 14.dp)) {
                        BodyField(bodyField, { bodyField = it; r.body = it.text }, isAA(r, vm.prefs.aaAutoDetect), "本文", 16, Modifier.fillMaxWidth())
                    }
                    // 本文に入れた画像のサムネイル
                    val previews = remember(r.body) { Regex("https?://\\S+?\\.(?:jpe?g|png|gif|webp)", RegexOption.IGNORE_CASE).findAll(r.body).map { it.value }.distinct().toList() }
                    if (previews.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (u in previews) coil3.compose.AsyncImage(u, null, Modifier.size(72.dp).clip(RoundedCornerShape(5.dp)).border(1.dp, Palette.border, RoundedCornerShape(5.dp)).background(Palette.surface2), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                        }
                    }
                }
                // キーボードのすぐ上の道具: 画像・オプション(名前・メール)・バイト数
                HorizontalDivider(color = Palette.border)
                Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 48.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {
                        if (vm.prefs.uploadEnabled) picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        else r.notice = "画像を付けるには、設定の「画像のアップロードを使う」をオンにしてください"
                    }, enabled = !r.uploading) {
                        if (r.uploading) CircularProgressIndicator(Modifier.size(20.dp), color = Palette.accent, strokeWidth = 2.dp)
                        else Icon(Icons.Filled.Image, "画像を付ける", tint = Palette.textMuted)
                    }
                    IconButton(onClick = { options = !options }) { Icon(Icons.Filled.Tune, "名前・メール", tint = if (options || r.name.isNotEmpty() || r.mail.isNotEmpty()) Palette.accent else Palette.textMuted) }
                    // AA として表示・文字列として表示
                    val aaNow = isAA(r, vm.prefs.aaAutoDetect)
                    IconButton(onClick = { r.aaOverride = !aaNow }) { Icon(Icons.Filled.GridOn, if (aaNow) "文字列として表示" else "AAとして表示", tint = if (aaNow) Palette.accent else Palette.textMuted) }
                    Spacer(Modifier.weight(1f))
                    Text("${shiftJisByteLength(r.body)} バイト", Modifier.padding(end = 12.dp), color = Palette.textMuted, fontSize = 12.sp)
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
