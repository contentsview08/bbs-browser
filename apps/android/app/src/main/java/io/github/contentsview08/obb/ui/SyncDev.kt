package io.github.contentsview08.obb.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.data.decodeQrLuma
import io.github.contentsview08.obb.data.qrMatrix
import io.github.contentsview08.obb.data.syncStartNav
import io.github.contentsview08.obb.data.SyncStartNav
import io.github.contentsview08.obb.sync.SyncText
import io.github.contentsview08.obb.sync.engine.PAIRING_SHOW_MS
import io.github.contentsview08.obb.sync.engine.SyncStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

// 開発用の同期の画面。隠してあり、版を押して開く。PC の設定の SyncDevSection.tsx と同じ言葉

private fun label(key: String) = SyncText.LABELS.getValue(key)
private fun clock(ms: Long?) = if (ms == null) "―" else DateFormat.getDateTimeInstance().format(Date(ms))

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
fun SyncDevPage(vm: AppViewModel) {
    val scope = rememberCoroutineScope()
    var st by remember { mutableStateOf<SyncStatus?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var url by remember { mutableStateOf<String?>(null) }
    var pairing by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<String?>(null) }
    var scanning by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            st = vm.syncStatus()
            delay(1000)
        }
    }
    fun act(done: String? = null, f: suspend () -> Unit) {
        busy = true
        message = null
        scope.launch {
            val failed = vm.syncAttempt(f)
            val now = vm.syncStatus()
            st = now
            // 窓を通っても領域を作れないことがある。その理由は状態の最後のエラーに出る
            message = failed ?: done?.takeIf { now.lastError == null }
            busy = false
        }
    }
    val s = st ?: return
    val needTicket = s.lastError?.startsWith("ticket_") == true
    Column(Modifier.padding(horizontal = 12.dp, vertical = 16.dp)) {
        Text("お気に入りのスレだけを同期します。サーバーは保管庫ではなく、端末の間の中継の置き場です", Modifier.padding(horizontal = 8.dp, vertical = 8.dp), color = Palette.textMuted, fontSize = 12.sp, lineHeight = 17.sp)
        Column(Modifier.fillMaxWidth().background(Palette.surface)) {
            StatusRow("状態", s.state)
            StatusRow(label("status_space"), s.space ?: "―")
            StatusRow(label("status_pending"), "${s.pending} 件")
            StatusRow("最後の受信", clock(s.lastPullAt))
            StatusRow("最後の送信", clock(s.lastPushAt))
            StatusRow(label("status_error"), s.lastErrorText ?: "―", if (s.lastError != null) Palette.markDanger else Palette.textMuted)
        }
        s.confirmLost?.let { lost ->
            Text("同期のデータで削除された $lost 件が、この端末からも消えます。", Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp)
            SyncButton("消さない", !busy) { act { vm.syncCtl.resolveConfirm("keep_local") } }
            SyncButton("進める", !busy) { act { vm.syncCtl.resolveConfirm("accept_removal") } }
        }
        Column(Modifier.fillMaxWidth().padding(top = 12.dp).background(Palette.surface)) {
            if (!s.enabled || needTicket) SyncButton(label("start"), !busy) { act("同期を始めました") { vm.syncCtl.start(); vm.reloadSide() } }
            if (s.enabled) {
                SyncButton(label("sync_now"), !busy) { act { vm.syncCtl.syncNow() } }
                SyncButton(label("add_device"), !busy) { act { pairing = vm.syncCtl.pairingCode() } }
                SyncButton(label("leave"), !busy, danger = true) { ask = "leave" }
            }
        }
        if (!s.enabled) {
            OutlinedTextField(code, { code = it }, Modifier.fillMaxWidth().padding(top = 12.dp), singleLine = true, placeholder = { Text("obb1.") })
            Row(Modifier.fillMaxWidth().padding(top = 4.dp).background(Palette.surface)) {
                Box(Modifier.weight(1f)) { SyncButton(label("join"), !busy && code.isNotBlank()) { act("同期を始めました") { vm.syncCtl.join(code); code = "" } } }
                Box(Modifier.weight(1f)) { SyncButton(label("scan"), !busy) { scanning = true } }
            }
        }
        Text(label("server_url"), Modifier.padding(start = 8.dp, top = 16.dp), color = Palette.textMuted, fontSize = 13.sp)
        OutlinedTextField(url ?: s.serverOverride.orEmpty(), { url = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(s.serverUrl, fontSize = 12.sp) })
        SyncButton("変える", !busy && url != null) { ask = "server" }
        message?.let { Text(it, Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp) }
    }
    pairing?.let { PairingWindow(it) { pairing = null } }
    vm.syncStartUrl?.let { SyncStartWindow(it, vm::finishSyncStart) }
    if (scanning) QrScanWindow({ scanning = false }) { read ->
        scanning = false
        act("同期を始めました") { vm.syncCtl.join(read) }
    }
    if (ask != null) {
        val leaving = ask == "leave"
        AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(if (leaving) label("leave") else label("server_url")) },
            text = { Text(if (leaving) "この端末の鍵と同期の表を消します。この端末のお気に入りは消えません。サーバーのデータはそのままです。" else "新しいサーバーに認証の情報を送ります。") },
            confirmButton = {
                TextButton({
                    ask = null
                    if (leaving) act { vm.syncCtl.leave() } else act { vm.syncCtl.setServerUrl(url.orEmpty()); url = null }
                }) { Text(if (leaving) "同期をやめる" else "変える") }
            },
            dismissButton = { TextButton({ ask = null }) { Text("閉じる") } },
        )
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
private fun PairingWindow(code: String, onEnd: () -> Unit) {
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

/** カメラで QR を読む。使うときだけ権限を聞く */
@Composable
private fun QrScanWindow(onDismiss: () -> Unit, onCode: (String) -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var denied by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        denied = !it
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    FullWindow(onDismiss = onDismiss) {
        Column(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 52.dp).padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onDismiss) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textStrong) }
                Text(label("scan"), color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
            if (granted) QrCameraView(onCode, Modifier.fillMaxWidth().weight(1f))
            else if (denied) Text("カメラを使えません。コードを貼って参加できます。", Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp)
        }
    }
}

@SuppressLint("MissingPermission")
@Composable
private fun QrCameraView(onCode: (String) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val camera = remember { QrCamera(context, onCode) }
    DisposableEffect(camera) { onDispose { camera.close() } }
    AndroidView(
        factory = { ctx ->
            TextureView(ctx).apply {
                surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    override fun onSurfaceTextureAvailable(t: SurfaceTexture, w: Int, h: Int) = camera.open(t)
                    override fun onSurfaceTextureSizeChanged(t: SurfaceTexture, w: Int, h: Int) {}
                    override fun onSurfaceTextureDestroyed(t: SurfaceTexture): Boolean { camera.close(); return true }
                    override fun onSurfaceTextureUpdated(t: SurfaceTexture) {}
                }
            }
        },
        modifier = modifier,
    )
}

/** Camera2 で明るさだけを読み、zxing に渡す。依存を増やさないため CameraX を使わない */
private class QrCamera(context: Context, private val onCode: (String) -> Unit) {
    private val manager = context.getSystemService(CameraManager::class.java)
    private val main = Handler(context.mainLooper)
    private var thread: HandlerThread? = null
    private var device: CameraDevice? = null
    private var reader: ImageReader? = null
    @Volatile private var done = false

    @SuppressLint("MissingPermission")
    fun open(texture: SurfaceTexture) {
        val id = manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK } ?: manager.cameraIdList.firstOrNull() ?: return
        val map = manager.getCameraCharacteristics(id).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return
        val size = map.getOutputSizes(ImageFormat.YUV_420_888).filter { it.width <= 1280 }.maxByOrNull { it.width * it.height } ?: return
        val t = HandlerThread("qr").also { it.start(); thread = it }
        val handler = Handler(t.looper)
        texture.setDefaultBufferSize(size.width, size.height)
        val preview = Surface(texture)
        val r = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2).also { reader = it }
        r.setOnImageAvailableListener({ ir ->
            val img = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
            img.use {
                if (done) return@use
                val plane = it.planes[0]
                val bytes = ByteArray(plane.buffer.remaining()).also { b -> plane.buffer.get(b) }
                decodeQrLuma(bytes, it.width, it.height, plane.rowStride)?.let { text ->
                    done = true
                    main.post { onCode(text) }
                }
            }
        }, handler)
        manager.openCamera(id, object : CameraDevice.StateCallback() {
            override fun onOpened(c: CameraDevice) {
                device = c
                @Suppress("DEPRECATION")
                c.createCaptureSession(listOf(preview, r.surface), object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(s: CameraCaptureSession) {
                        val req = c.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                            addTarget(preview)
                            addTarget(r.surface)
                            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                        }
                        runCatching { s.setRepeatingRequest(req.build(), null, handler) }
                    }
                    override fun onConfigureFailed(s: CameraCaptureSession) {}
                }, handler)
            }
            override fun onDisconnected(c: CameraDevice) = c.close()
            override fun onError(c: CameraDevice, error: Int) = c.close()
        }, handler)
    }

    fun close() {
        device?.close()
        device = null
        reader?.close()
        reader = null
        thread?.quitSafely()
        thread = null
    }
}
