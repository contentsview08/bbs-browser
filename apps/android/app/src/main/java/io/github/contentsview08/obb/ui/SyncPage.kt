package io.github.contentsview08.obb.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
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
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.provider.Settings
import android.util.Size as CameraSize
import android.view.Surface
import android.view.TextureView
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
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.data.decodeQrLuma
import io.github.contentsview08.obb.data.readSyncQr
import io.github.contentsview08.obb.data.SyncQrRead
import io.github.contentsview08.obb.sync.DriveText
import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.SyncText
import io.github.contentsview08.obb.sync.engine.CycleResult
import io.github.contentsview08.obb.sync.engine.JOIN_DATA_CONFIRM
import io.github.contentsview08.obb.sync.engine.SYNC_GROUPS
import io.github.contentsview08.obb.sync.engine.MismatchSummary
import io.github.contentsview08.obb.sync.engine.SyncStatus
import io.github.contentsview08.obb.sync.engine.SyncSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

// 同期の小画面。PC の設定の SyncTab.tsx と同じ言葉。置き場は Google ドライブだけで、スマホは PC の QR を読んで参加する

private fun label(key: String) = SyncText.LABELS.getValue(key)
private fun drive(key: String) = DriveText.LABELS.getValue(key)
private const val JOIN_BY_QR = "QR を読んで参加"
private fun clock(ms: Long?) = if (ms == null) "―" else DateFormat.getDateTimeInstance().format(Date(ms))
private const val JOINED = "同期を始めました"

/** 参加できたら、貼ったコードをクリップボードから消す。今の中身がそのコードのときだけ(その後に利用者がコピーしたものを消さない) */
private fun clearClipIf(context: Context, code: String?) {
    if (code == null) return
    val cm = context.getSystemService(ClipboardManager::class.java) ?: return
    val now = runCatching { cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString() }.getOrNull()
    if (now?.trim() != code.trim()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip() else cm.setPrimaryClip(ClipData.newPlainText("", ""))
}

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
fun SyncPage(vm: AppViewModel, @Suppress("UNUSED_PARAMETER") advanced: Boolean) {
    val scope = rememberCoroutineScope()
    var st by remember { mutableStateOf<SyncStatus?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<String?>(null) }
    var scanning by remember { mutableStateOf(false) }
    var summary by remember { mutableStateOf<SyncSummary?>(null) }
    var mismatch by remember { mutableStateOf<MismatchSummary?>(null) }
    /** ドライブで使っている量。毎周は読まず、画面を開いたときと操作の後だけ読み直す */
    var usage by remember { mutableStateOf<String?>(null) }
    /** 読んだコード。参加できたらクリップボードから消すために覚える */
    var readCode by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    LaunchedEffect(Unit) { summary = runCatching { vm.syncSummary() }.getOrNull() }
    LaunchedEffect(Unit) { usage = vm.syncDriveUsage() }
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
            usage = vm.syncDriveUsage()
            message = failed ?: done?.takeIf { now.lastError == null }
            busy = false
            after()
        }
    }
    /** 参加。手元に送るものがあれば確認で止まる(状態の欄に出る)ので、done は参加したときだけ */
    fun join(done: String, f: suspend () -> CycleResult) {
        var r: CycleResult? = null
        act(after = {
            scanning = false
            if (r != null && r?.confirm == null && st?.lastError == null) {
                message = done
                clearClipIf(context, readCode)
            }
        }) { r = f() }
    }
    val s = st ?: return
    Group(note = drive("intro")) {
        SwitchRow(label("master"), s.master, desc = drive("master_note")) { on -> if (!busy) act { vm.syncCtl.setMaster(on); if (on) vm.reloadSyncedScreens() } }
    }
    message?.let { Text(it, Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp), color = Palette.textStrong, fontSize = 14.sp) }
    s.driveUnavailable?.let { Text(SyncText.message(it), Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp), color = Palette.markDanger, fontSize = 14.sp) }
    if (s.master) {
        Group("状態") {
            StatusRow("状態", s.state)
            StatusRow(drive("store"), drive("store_drive"))
            if (s.enabled) StatusRow("Google アカウント", s.email?.ifEmpty { null } ?: "―")
            StatusRow(label("status_space"), s.space ?: "―")
            if (s.enabled) StatusRow(drive("usage"), usage ?: "―")
            StatusRow(label("status_pending"), "${s.pending} 件")
            StatusRow("最後の同期", clock(listOfNotNull(s.lastPullAt, s.lastPushAt).maxOrNull()))
            StatusRow("最後の受信", clock(s.lastPullAt))
            StatusRow("最後の送信", clock(s.lastPushAt))
            StatusRow(label("status_error"), s.lastErrorText ?: "―", if (s.lastError != null) Palette.markDanger else Palette.textMuted)
        }
        s.confirm?.let { c ->
            Group {
                if (c.type == JOIN_DATA_CONFIRM) {
                    // 手元に送るものがないときは、どのアカウントの同期に入るかだけを確かめる
                    Text(if (c.data == false) drive("join_ask_drive") else label("join_ask"), Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp)
                    c.account?.let { Text(drive("join_ask_account").replace("{email}", it), Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), color = Palette.textStrong, fontSize = 14.sp) }
                    SyncButton(label("join_cancel"), !busy) { act { vm.syncCtl.resolveConfirm("keep_local") } }
                    SyncButton(label("join_ok"), !busy) {
                        act(JOINED, after = { if (st?.enabled == true) clearClipIf(context, readCode) }) { vm.syncCtl.resolveConfirm("accept_removal"); vm.reloadSyncedScreens() }
                    }
                } else {
                    Text("同期のデータで削除された ${c.lost} 件が、この端末からも消えます。", Modifier.padding(16.dp), color = Palette.textStrong, fontSize = 14.sp)
                    SyncButton("消さない", !busy) { act { vm.syncCtl.resolveConfirm("keep_local") } }
                    SyncButton("進める", !busy) { act { vm.syncCtl.resolveConfirm("accept_removal") } }
                }
            }
        }
        Group(note = if (s.enabled) null else drive("join_note")) {
            // 最初の 1 台は PC。スマホは PC の「端末を追加」の QR(か、そのコード)で参加する
            if (!s.enabled && s.confirm == null) SyncButton(JOIN_BY_QR, !busy && s.driveUnavailable == null) { scanning = true }
            if (s.enabled) {
                SyncButton(label("sync_now"), !busy) { act { vm.syncCtl.syncNow(); vm.reloadSyncedScreens() } }
                // Google との接続が切れたとき(取り消し・期限切れ)は、PC の QR を読み直してトークンだけを置き直す
                SyncButton(drive("rescan"), !busy) { scanning = true }
                SyncButton(label("leave"), !busy, danger = true) { ask = "leave" }
            }
        }
    }
    if (s.master) Group(note = drive("interval_note")) {
        ChoiceRow(drive("interval"), vm.prefs.syncInterval, SyncConfig.SYNC_INTERVALS.map { it.first to DriveText.INTERVAL_LABELS.getValue(it.first) }) { vm.setSyncInterval(it) }
    }
    Group(label("kinds"), note = drive("kinds_note") + label("kinds_resume_note")) {
        for (g in SYNC_GROUPS) {
            val on = s.kinds[g.id] == true
            SwitchRow(g.label, on, desc = if (g.id == "secret") drive("secret_note") else null) { next ->
                if (busy) return@SwitchRow
                if (next && g.id == "secret") ask = "secret"
                else act { vm.syncCtl.setKind(g.id, next); if (next) vm.reloadSyncedScreens() }
            }
        }
    }
    if (s.master && s.enabled) summary?.let { sum ->
        SyncSummaryView(sum, mismatch, !busy, onCopy = { copyText(context, sum.text); vm.toast = "コピーしました" }, onCheck = { act { mismatch = vm.syncMismatches() } })
    }
    if (scanning) QrScanWindow(
        enabled = s.enabled,
        space = s.space,
        pending = s.pending,
        onDismiss = { scanning = false },
        onJoin = { read ->
            readCode = read
            join(JOINED) { vm.syncCtl.join(read) }
        },
        onRenew = { read ->
            readCode = read
            join("Google の接続を置き直しました") { vm.syncCtl.join(read).also { vm.reloadSyncedScreens() } }
        },
        onMove = { read ->
            readCode = read
            join("同期を移りました") {
                vm.syncCtl.leave()
                // やめるとスイッチは既定へ戻るので、続けて入るためにオンにする
                vm.syncCtl.setMaster(true)
                vm.syncCtl.join(read)
            }
        },
    )
    if (ask != null) {
        val which = ask
        AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(if (which == "leave") label("leave") else label("secret_ask_title")) },
            text = { Text(if (which == "leave") drive("leave_ask") else label("secret_ask_body")) },
            confirmButton = {
                TextButton({
                    ask = null
                    if (which == "leave") act { vm.syncCtl.leave() } else act { vm.syncCtl.setKind("secret", true) }
                }) { Text(if (which == "leave") "同期をやめる" else label("secret_ask_ok")) }
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

/**
 * PC の「端末を追加」の QR を読む。開いたらすぐカメラを動かし、obb2 のコードなら確認なしで参加する。
 * 同期している端末では、同じ同期なら Google の接続を置き直し、別の領域のときだけ移るかを聞く
 */
@Composable
private fun QrScanWindow(enabled: Boolean, space: String?, pending: Long, onDismiss: () -> Unit, onJoin: (String) -> Unit, onRenew: (String) -> Unit, onMove: (String) -> Unit) {
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
        return when (val r = readSyncQr(text, enabled, space)) {
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
            is SyncQrRead.SameSpace -> {
                Haptics.confirm(view)
                taken = "Google の接続を置き直しています"
                onRenew(r.code)
                true
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
                        // コードは鍵そのもの。キーボードの予測・学習に残さない
                        OutlinedTextField(
                            pasted, { pasted = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(drive("join_placeholder")) },
                            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
                        )
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
                    if (pasted.isBlank() && clip?.trim()?.startsWith(drive("join_placeholder")) == true) pasted = clip
                    pasting = true
                }
            }
        }
        moving?.let { m ->
            AlertDialog(
                onDismissRequest = { declined = m.code; moving = null },
                title = { Text("今の同期から移りますか") },
                text = {
                    val unsent = if (pending > 0) "まだ送っていない $pending 件は、今の同期に届きません。" else ""
                    Text("この QR は別の同期のものです。今の同期をやめて、こちらに移ります。この端末のお気に入りは消えず、移った先へ送られます。今の同期の Google ドライブのデータはそのままです。$unsent")
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
