package io.github.contentsview08.obb.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.provider.Settings
import android.util.Size as CameraSize
import android.view.Surface
import android.view.TextureView
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.BuildConfig
import io.github.contentsview08.obb.data.decodeQrLuma
import io.github.contentsview08.obb.data.qrMatrix
import io.github.contentsview08.obb.data.readSyncQr
import io.github.contentsview08.obb.data.SyncQrRead
import io.github.contentsview08.obb.data.syncStartNav
import io.github.contentsview08.obb.data.SyncStartNav
import io.github.contentsview08.obb.sync.SyncText
import io.github.contentsview08.obb.sync.engine.CycleResult
import io.github.contentsview08.obb.sync.engine.JOIN_DATA_CONFIRM
import io.github.contentsview08.obb.sync.engine.PAIRING_SHOW_MS
import io.github.contentsview08.obb.sync.engine.SYNC_GROUPS
import io.github.contentsview08.obb.sync.engine.MismatchSummary
import io.github.contentsview08.obb.sync.engine.SyncStatus
import io.github.contentsview08.obb.sync.engine.SyncSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

// 同期の小画面。PC の設定の SyncTab.tsx と同じ言葉

private fun label(key: String) = SyncText.LABELS.getValue(key)
private fun clock(ms: Long?) = if (ms == null) "―" else DateFormat.getDateTimeInstance().format(Date(ms))
private const val JOINED = "同期を始めました"

@Composable
private fun SyncButton(text: String, enabled: Boolean = true, danger: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = if (!enabled) Palette.textMuted else if (danger) Palette.markDanger else Palette.accent, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun StatusRow(name: String, value: String, valueColor: Color = Palette.textMuted) {
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, Modifier.padding(end = 12.dp), color = Palette.textStrong, fontSize = 14.sp)
        Text(value, Modifier.weight(1f), color = valueColor, fontSize = 13.sp)
    }
}

@Composable
fun SyncPage(vm: AppViewModel, advanced: Boolean) {
    val scope = rememberCoroutineScope()
    var st by remember { mutableStateOf<SyncStatus?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var url by remember { mutableStateOf<String?>(null) }
    var pairing by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<String?>(null) }
    var scanning by remember { mutableStateOf(false) }
    var summary by remember { mutableStateOf<SyncSummary?>(null) }
    var mismatch by remember { mutableStateOf<MismatchSummary?>(null) }
    val context = LocalContext.current
    LaunchedEffect(Unit) { summary = runCatching { vm.syncSummary() }.getOrNull() }
    LaunchedEffect(Unit) {
        while (true) {
            st = vm.syncStatus()
            delay(1000)
        }
    }
    fun act(done: String? = null, after: () -> Unit = {}, f: suspend () -> Unit) {
        busy = true
        message = null
        scope.launch {
            // 操作そのものは ViewModel で動かす(画面を離れても切れない)。ここで待つのは画面に出す分だけ
            val failed = vm.syncRun(f).await()

            val now = vm.syncStatus()
            st = now
            summary = runCatching { vm.syncSummary() }.getOrNull()
            // 窓を通っても領域を作れないことがある。その理由は状態の最後のエラーに出る
            message = failed ?: done?.takeIf { now.lastError == null }
            busy = false
            after()
        }
    }
    /** 参加。手元に送るものがあるか、ふだんと違うサーバーなら確認で止まる(状態の欄に出る)ので、done は参加したときだけ */
    fun join(done: String, f: suspend () -> CycleResult) {
        var r: CycleResult? = null
        act(after = {
            scanning = false
            if (r != null && r?.confirm == null && st?.lastError == null) message = done
        }) { r = f() }
    }
    val s = st ?: return
    val needTicket = s.lastError?.startsWith("ticket_") == true
    Group(note = label("intro")) {
        SwitchRow(label("master"), s.master, desc = label("master_note")) { on -> if (!busy) act { vm.syncCtl.setMaster(on); if (on) vm.reloadSyncedScreens() } }
    }
    message?.let { Text(it, Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp), color = Palette.textStrong, fontSize = 14.sp) }
    if (s.master) {
        Group("状態") {
            StatusRow("状態", s.state)
            StatusRow(label("status_space"), s.space ?: "―")
            StatusRow(label("status_pending"), "${s.pending} 件")
            StatusRow("最後の同期", clock(listOfNotNull(s.lastPullAt, s.lastPushAt).maxOrNull()))
            StatusRow("最後の受信", clock(s.lastPullAt))
            StatusRow("最後の送信", clock(s.lastPushAt))
            StatusRow(label("status_error"), s.lastErrorText ?: "―", if (s.lastError != null) Palette.markDanger else Palette.textMuted)
        }
        s.confirm?.let { c ->
            Group {
                if (c.type == JOIN_DATA_CONFIRM) {
                    Text(label("join_ask"), Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp)
                    c.host?.let { Text(label("join_ask_server").replace("{host}", it), Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), color = Palette.textStrong, fontSize = 14.sp) }
                    SyncButton(label("join_cancel"), !busy) { act { vm.syncCtl.resolveConfirm("keep_local") } }
                    SyncButton(label("join_ok"), !busy) { act(JOINED) { vm.syncCtl.resolveConfirm("accept_removal"); vm.reloadSyncedScreens() } }
                } else {
                    Text("同期のデータで削除された ${c.lost} 件が、この端末からも消えます。", Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp)
                    SyncButton("消さない", !busy) { act { vm.syncCtl.resolveConfirm("keep_local") } }
                    SyncButton("進める", !busy) { act { vm.syncCtl.resolveConfirm("accept_removal") } }
                }
            }
        }
        Group {
            if (!s.enabled || needTicket) SyncButton(label("start"), !busy) { act(JOINED) { vm.syncCtl.start(); vm.reloadSide() } }
            if (!s.enabled && s.confirm == null) SyncButton(label("add_device"), !busy) { scanning = true }
            if (s.enabled) {
                SyncButton(label("sync_now"), !busy) { act { vm.syncCtl.syncNow(); vm.reloadSyncedScreens() } }
                SyncButton(label("add_device"), !busy) { act { pairing = vm.syncCtl.pairingCode() } }
                SyncButton(label("leave"), !busy, danger = true) { ask = "leave" }
            }
        }
    }
    Group(label("kinds"), note = label("kinds_note") + label("kinds_resume_note")) {
        for (g in SYNC_GROUPS) {
            val on = s.kinds[g.id] == true
            SwitchRow(g.label, on, desc = if (g.id == "secret") label("secret_note") else null) { next ->
                if (busy) return@SwitchRow
                if (next && g.id == "secret") ask = "secret"
                else act { vm.syncCtl.setKind(g.id, next); if (next) vm.reloadSyncedScreens() }
            }
        }
    }
    if (s.master && s.enabled) summary?.let { sum ->
        SyncSummaryView(sum, mismatch, !busy, onCopy = { copyText(context, sum.text); vm.toast = "コピーしました" }, onCheck = { act { mismatch = vm.syncMismatches() } })
    }
    if (advanced) Group(label("advanced")) {
        Text(label("server_url"), Modifier.padding(start = 16.dp, top = 12.dp), color = Palette.textMuted, fontSize = 13.sp)
        OutlinedTextField(url ?: s.serverOverride.orEmpty(), { url = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp), singleLine = true, placeholder = { Text(s.serverUrl, fontSize = 12.sp) })
        SyncButton("変える", !busy && url != null) { ask = "server" }
    }
    pairing?.let { code ->
        PairingWindow(code, onScan = { pairing = null; scanning = true }, onEnd = { pairing = null })
    }
    vm.syncStartUrl?.let { SyncStartWindow(it, vm::finishSyncStart) }
    if (scanning) QrScanWindow(
        enabled = s.enabled,
        space = s.space,
        pending = s.pending,
        onDismiss = { scanning = false },
        onJoin = { read -> join(JOINED) { vm.syncCtl.join(read) } },
        onMove = { read ->
            join("同期を移りました") {
                vm.syncCtl.leave()
                // やめるとスイッチは既定へ戻るので、続けて入るためにオンにする
                vm.syncCtl.setMaster(true)
                vm.syncCtl.join(read)
            }
        },
        onOwn = {
            scanning = false
            if (s.enabled) act { pairing = vm.syncCtl.pairingCode() }
            else act(JOINED) {
                vm.syncCtl.start()
                vm.reloadSide()
                // 領域を作れなかったときは、相手に渡しても使えない
                if (vm.syncStatus().lastError == null) pairing = vm.syncCtl.pairingCode()
            }
        },
    )
    if (ask != null) {
        val which = ask
        AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(when (which) { "leave" -> label("leave"); "secret" -> label("secret_ask_title"); else -> label("server_url") }) },
            text = { Text(when (which) { "leave" -> label("leave_ask"); "secret" -> label("secret_ask_body"); else -> label("server_ask") }) },
            confirmButton = {
                TextButton({
                    ask = null
                    when (which) {
                        "leave" -> act { vm.syncCtl.leave() }
                        "secret" -> act { vm.syncCtl.setKind("secret", true) }
                        else -> act { vm.syncCtl.setServerUrl(url.orEmpty()); url = null }
                    }
                }) { Text(when (which) { "leave" -> "同期をやめる"; "secret" -> label("secret_ask_ok"); else -> "変える" }) }
            },
            dismissButton = { TextButton({ ask = null }) { Text("閉じる") } },
        )
    }
}

/** 端末どうしで見比べる値。本文や URL は出さない */
@Composable
private fun SyncSummaryView(summary: SyncSummary, mismatch: MismatchSummary?, enabled: Boolean, onCopy: () -> Unit, onCheck: () -> Unit) {
    fun counts(m: Map<String, Int>) = m.entries.joinToString("、") { "${it.key} ${it.value}" }.ifEmpty { "なし" }
    Column(Modifier.fillMaxWidth().padding(top = 12.dp).background(Palette.surface)) {
        Text("同期の要約", Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp), color = Palette.textStrong, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        @Composable fun Heading(text: String) = Text(text, Modifier.padding(start = 16.dp, top = 8.dp, end = 16.dp), color = Palette.textMuted, fontSize = 13.sp)
        @Composable fun Mono(text: String) = Text(text, Modifier.padding(horizontal = 16.dp), color = Palette.textStrong, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        Heading("同期の表(生きている+削除:ハッシュ)")
        for (k in summary.kinds) {
            Mono("${k.kind} ${k.live}+${k.tombstones}:${k.hash}" + (if (k.pending > 0) " 送信待ち ${k.pending}" else "") + (if (k.needsApply > 0) " 適用待ち ${k.needsApply}" else ""))
        }
        Heading("手元(件数:ハッシュ)")
        for (l in summary.local) Mono("${l.area} ${l.count}:${l.hash}")
        if (summary.notes.isNotEmpty()) {
            Heading("手元の件数が合わない理由")
            for ((k, n) in summary.notes) Text("${io.github.contentsview08.obb.sync.SyncText.NOTES[k] ?: k}: $n 件", Modifier.padding(horizontal = 16.dp), color = Palette.textStrong, fontSize = 12.sp)
        }
        SyncButton("要約をコピー", onClick = onCopy)
        SyncButton("不一致の検査", enabled, onClick = onCheck)
        mismatch?.let { m ->
            StatusRow("違い", counts(m.differs))
            StatusRow("表にない手元の行", counts(m.missing))
            if (m.samples.isNotEmpty()) StatusRow("レコード", m.samples.joinToString(" "))
        }
    }
}

/** 開いたページへアプリの命令を渡さない(addJavascriptInterface を使わない)。移動を止めて許可証を受け取る */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SyncStartWindow(url: String, onDone: (String?) -> Unit) {
    FullWindow(onDismiss = { onDone(null) }) {
        Column(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 52.dp).padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton({ onDone(null) }) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textStrong) }
                Text(label("start"), color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            private var taken = false
                            private fun route(view: WebView, target: String, mainFrame: Boolean): Boolean = when (val nav = syncStartNav(target, url)) {
                                is SyncStartNav.Ticket -> {
                                    if (mainFrame && !taken) {
                                        taken = true
                                        view.stopLoading()
                                        onDone(nav.value)
                                    }
                                    true
                                }
                                SyncStartNav.Allow -> false
                                SyncStartNav.Block -> true
                            }
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = route(view, request.url.toString(), request.isForMainFrame)
                            // スクリプトの移動で上を通らない版がある。.invalid は名前解決されないので、ここで止めても外へ出ない
                            override fun onPageStarted(view: WebView, target: String?, favicon: android.graphics.Bitmap?) {
                                if (target != null && syncStartNav(target, url) is SyncStartNav.Ticket) route(view, target, true)
                            }
                        }
                        loadUrl(url)
                    }
                },
                modifier = Modifier.fillMaxWidth().weight(1f),
                onRelease = {
                    it.clearHistory()
                    it.clearCache(true)
                    it.destroy()
                },
            )
        }
    }
}

/** QR とコピー用のコード。60 秒で消す。表示の間は画面の撮影を止める */
@Composable
private fun PairingWindow(code: String, onScan: () -> Unit, onEnd: () -> Unit) {
    val context = LocalContext.current
    var left by remember { mutableLongStateOf(PAIRING_SHOW_MS / 1000) }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(code) {
        val started = System.currentTimeMillis()
        while (true) {
            left = (PAIRING_SHOW_MS - (System.currentTimeMillis() - started) + 999) / 1000
            if (left <= 0) { onEnd(); break }
            delay(250)
        }
    }
    FullWindow(onDismiss = onEnd) {
        val view = LocalView.current
        DisposableEffect(view) {
            val dialog = (view.parent as? DialogWindowProvider)?.window
            val activity = (context as? android.app.Activity)?.window
            dialog?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            activity?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            onDispose {
                dialog?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                activity?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                if (copied) clearClipboard(context)
            }
        }
        Column(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(label("add_device"), color = Palette.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text("${label("pairing_warning")}(あと ${left.coerceAtLeast(0)} 秒)", color = Palette.markDanger, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            val matrix = remember(code) { qrMatrix(code) }
            // 背景と点の色は読み取りのために固定する
            Canvas(Modifier.fillMaxWidth().aspectRatio(1f).background(Color.White)) {
                val cell = size.width / matrix.size
                for (y in matrix.indices) for (x in matrix.indices) if (matrix[y][x]) drawRect(Color.Black, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
            }
            Text(code, color = Palette.textMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton({ copySecret(context, code); copied = true }) { Text(label("copy")) }
                TextButton(onScan) { Text("カメラで読む") }
                TextButton(onEnd) { Text("閉じる") }
            }
        }
    }
}

private fun copySecret(context: Context, text: String) {
    val clip = ClipData.newPlainText("OBB", text)
    // 通知や履歴に中身を出さない印(Android 13 から)
    clip.description.extras = android.os.PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
}

private fun clearClipboard(context: Context) {
    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("", ""))
}

/**
 * 端末を足す相手の QR を読む。開いたらすぐカメラを動かし、obb1 のコードなら確認なしで参加する。
 * 同期している端末では、別の領域のときだけ移るかを聞く
 */
@Composable
private fun QrScanWindow(enabled: Boolean, space: String?, pending: Long, onDismiss: () -> Unit, onJoin: (String) -> Unit, onMove: (String) -> Unit, onOwn: () -> Unit) {
    val context = LocalContext.current
    val view = LocalView.current
    fun hasCamera() = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    var granted by remember { mutableStateOf(hasCamera()) }
    var denied by remember { mutableStateOf(false) }
    var broken by remember { mutableStateOf(false) }
    var pasting by remember { mutableStateOf(false) }
    var pasted by remember { mutableStateOf("") }
    var hint by remember { mutableStateOf<String?>(null) }
    var hintTick by remember { mutableIntStateOf(0) }
    var taken by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf<SyncQrRead.OtherSpace?>(null) }
    var declined by remember { mutableStateOf<String?>(null) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        denied = !it
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    val life by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val resumed = life.isAtLeast(Lifecycle.State.RESUMED)
    // 設定で許可して戻ってきたら、そのまま読み始める
    LaunchedEffect(resumed) {
        if (resumed && hasCamera()) {
            granted = true
            denied = false
        }
    }
    // 同じ QR が映っている間は延び、外すと消える
    LaunchedEffect(hintTick) {
        delay(2500)
        hint = null
    }
    fun say(text: String) {
        hint = text
        hintTick++
    }
    fun handle(text: String): Boolean {
        if (text == declined) {
            say("別の同期の QR です")
            return false
        }
        return when (val r = readSyncQr(text, enabled, space, BuildConfig.SYNC_ALLOW_LOCALHOST)) {
            is SyncQrRead.Join -> {
                Haptics.confirm(view)
                taken = "同期を始めています"
                onJoin(r.code)
                true
            }
            is SyncQrRead.OtherSpace -> {
                Haptics.confirm(view)
                moving = r
                false
            }
            SyncQrRead.SameSpace -> {
                say("この端末はすでにこの同期を使っています")
                false
            }
            is SyncQrRead.Bad -> {
                say(SyncText.message(r.reason))
                false
            }
        }
    }
    FullWindow(onDismiss = onDismiss) {
        Column(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 52.dp).padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onDismiss) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textStrong) }
                Text(label(if (pasting) "join" else "scan"), color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
            Box(Modifier.fillMaxWidth().weight(1f)) {
                val done = taken
                when {
                    done != null -> Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Filled.CheckCircle, null, Modifier.size(48.dp), tint = Palette.accent)
                        Text("読み取りました", color = Palette.textStrong, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text(done, color = Palette.textMuted, fontSize = 14.sp)
                    }
                    pasting -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("obb1.") })
                        SyncButton(label("join"), pasted.isNotBlank()) { handle(pasted) }
                        hint?.let { Text(it, color = Palette.markDanger, fontSize = 14.sp) }
                    }
                    granted && !broken -> {
                        // 映像の上なので、配色によらず黒地と白で読めるようにする
                        Box(Modifier.fillMaxSize().background(Color.Black))
                        // 確認の間と裏にいる間は、カメラを手放す
                        if (resumed && moving == null) QrCameraView(::handle, { broken = true }, Modifier.fillMaxSize())
                        Box(Modifier.align(Alignment.Center).fillMaxWidth(0.7f).aspectRatio(1f).border(2.dp, Color.White))
                        Text(
                            hint ?: "QR を枠に入れてください",
                            Modifier.align(Alignment.BottomCenter).padding(16.dp).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 12.dp, vertical = 6.dp),
                            color = Color.White,
                            fontSize = 14.sp,
                        )
                    }
                    denied || broken -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (broken) "カメラを開けません。コードを貼って参加できます。"
                            else "QR を読むにはカメラの許可が必要です。カメラの映像は QR を読むだけに使います。設定で許可するか、コードを貼って参加できます。",
                            color = Palette.textStrong,
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                        )
                        if (!broken) SyncButton("設定を開く") {
                            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
                        }
                    }
                }
            }
            if (taken == null) Column(Modifier.fillMaxWidth().background(Palette.surface)) {
                if (pasting) SyncButton("カメラで読む") { pasting = false }
                else SyncButton("コードを貼る") {
                    val clip = context.getSystemService(ClipboardManager::class.java).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (pasted.isBlank() && clip?.trim()?.startsWith("obb1.") == true) pasted = clip
                    pasting = true
                }
                SyncButton(if (enabled) "自分の QR を出す" else "自分で始める(QR を出す)", onClick = onOwn)
            }
        }
        moving?.let { m ->
            AlertDialog(
                onDismissRequest = { declined = m.code; moving = null },
                title = { Text("今の同期から移りますか") },
                text = {
                    val unsent = if (pending > 0) "まだ送っていない $pending 件は、今の同期に届きません。" else ""
                    Text("この QR は別の同期のものです(${m.serverUrl})。今の同期をやめて、こちらに移ります。この端末のお気に入りは消えず、移った先へ送られます。今の同期のサーバーのデータはそのままです。$unsent")
                },
                confirmButton = {
                    TextButton({
                        moving = null
                        taken = "同期を移っています"
                        onMove(m.code)
                    }) { Text("移る") }
                },
                dismissButton = { TextButton({ declined = m.code; moving = null }) { Text("閉じる") } },
            )
        }
    }
}

/** [onText] が true を返すまで読み続ける */
@SuppressLint("MissingPermission")
@Composable
private fun QrCameraView(onText: (String) -> Boolean, onFail: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val text by rememberUpdatedState(onText)
    val fail by rememberUpdatedState(onFail)
    val camera = remember { QrCamera(context, { text(it) }, { fail() }) }
    DisposableEffect(camera) { onDispose { camera.close() } }
    AndroidView(
        factory = { ctx ->
            TextureView(ctx).apply {
                surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    override fun onSurfaceTextureAvailable(t: SurfaceTexture, w: Int, h: Int) = camera.open(this@apply, t)
                    override fun onSurfaceTextureSizeChanged(t: SurfaceTexture, w: Int, h: Int) = camera.fit(this@apply)
                    override fun onSurfaceTextureDestroyed(t: SurfaceTexture): Boolean { camera.close(); return true }
                    override fun onSurfaceTextureUpdated(t: SurfaceTexture) {}
                }
            }
        },
        modifier = modifier,
    )
}

/** Camera2 で明るさだけを読み、zxing に渡す。依存を増やさないため CameraX を使わない。片づけはカメラの糸の上で順に行う */
private class QrCamera(context: Context, private val onText: (String) -> Boolean, private val onFail: () -> Unit) {
    private val manager = context.getSystemService(CameraManager::class.java)
    private val main = Handler(context.mainLooper)
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var device: CameraDevice? = null
    private var reader: ImageReader? = null
    private var surface: Surface? = null
    private var preview: CameraSize? = null
    @Volatile private var done = false
    @Volatile private var closed = false
    // 開いている途中で糸を止めると onOpened が届かず、カメラを握ったままになる
    @Volatile private var opening = false

    private fun fail() = main.post { if (!closed) onFail() }

    @SuppressLint("MissingPermission")
    fun open(view: TextureView, texture: SurfaceTexture) {
        if (closed) return
        try {
            val id = manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK } ?: manager.cameraIdList.firstOrNull()
            val map = id?.let { manager.getCameraCharacteristics(it).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) }
            val size = map?.getOutputSizes(ImageFormat.YUV_420_888)?.filter { it.width <= 1280 }?.maxByOrNull { it.width * it.height }
            if (id == null || size == null) {
                fail()
                return
            }
            val t = HandlerThread("qr").also { it.start(); thread = it }
            val h = Handler(t.looper).also { handler = it }
            texture.setDefaultBufferSize(size.width, size.height)
            preview = size
            fit(view)
            val out = Surface(texture).also { surface = it }
            val r = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2).also { reader = it }
            r.setOnImageAvailableListener({ ir ->
                val img = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
                img.use {
                    if (done) return@use
                    val plane = it.planes[0]
                    val bytes = ByteArray(plane.buffer.remaining()).also { b -> plane.buffer.get(b) }
                    decodeQrLuma(bytes, it.width, it.height, plane.rowStride)?.let { text ->
                        main.post { if (!done && !closed && onText(text)) done = true }
                    }
                }
            }, h)
            opening = true
            manager.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(c: CameraDevice) {
                    opening = false
                    device = c
                    if (closed) {
                        release()
                        return
                    }
                    try {
                        @Suppress("DEPRECATION")
                        c.createCaptureSession(listOf(out, r.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(s: CameraCaptureSession) {
                                if (closed) return
                                val req = c.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                    addTarget(out)
                                    addTarget(r.surface)
                                    set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                                }
                                runCatching { s.setRepeatingRequest(req.build(), null, h) }
                            }
                            override fun onConfigureFailed(s: CameraCaptureSession) { fail() }
                        }, h)
                    } catch (_: Exception) {
                        fail()
                    }
                }
                override fun onDisconnected(c: CameraDevice) = lost(c)
                override fun onError(c: CameraDevice, error: Int) = lost(c)
            }, h)
        } catch (_: Exception) {
            opening = false
            fail()
        }
    }

    private fun lost(c: CameraDevice) {
        opening = false
        c.close()
        if (closed) release() else fail()
    }

    /** 映像を歪めず、枠いっぱいに切り抜いて出す */
    fun fit(view: TextureView) {
        val p = preview ?: return
        val w = view.width.toFloat()
        val h = view.height.toFloat()
        if (w <= 0f || h <= 0f) return
        val rotation = view.display?.rotation ?: Surface.ROTATION_0
        val cx = w / 2
        val cy = h / 2
        val m = Matrix()
        if (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270) {
            val buffer = RectF(0f, 0f, p.height.toFloat(), p.width.toFloat())
            buffer.offset(cx - buffer.centerX(), cy - buffer.centerY())
            m.setRectToRect(RectF(0f, 0f, w, h), buffer, Matrix.ScaleToFit.FILL)
            val scale = maxOf(h / p.height, w / p.width)
            m.postScale(scale, scale, cx, cy)
            m.postRotate(if (rotation == Surface.ROTATION_90) -90f else 90f, cx, cy)
        } else {
            // 映像は端末の縦向きにそろえて渡されるので、幅と高さを入れ替えて比べる
            val content = p.height.toFloat() / p.width
            val frame = w / h
            if (content > frame) m.setScale(content / frame, 1f, cx, cy) else m.setScale(1f, frame / content, cx, cy)
            if (rotation == Surface.ROTATION_180) m.postRotate(180f, cx, cy)
        }
        view.setTransform(m)
    }

    private fun release() {
        device?.close()
        device = null
        reader?.close()
        reader = null
        surface?.release()
        surface = null
        thread?.quitSafely()
        thread = null
    }

    fun close() {
        if (closed) return
        closed = true
        handler?.post { if (!opening) release() }
    }
}
