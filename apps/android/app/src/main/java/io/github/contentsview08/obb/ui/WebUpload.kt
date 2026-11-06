package io.github.contentsview08.obb.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** 画像の置き場の、API を使わないアップロード画面。PC 版・Web の utils/webUpload.ts と同じ表。pattern は上げたあとに出る直リンクの形 */
data class WebUploadSite(val key: String, val name: String, val url: String, val pattern: String)

val WEB_UPLOAD_SITES = listOf(
    WebUploadSite("imgur", "imgur", "https://imgur.com/upload", """https://i\.imgur\.com/[A-Za-z0-9]{5,}\.(?:jpe?g|png|gif|webp|mp4)"""),
    WebUploadSite("imgbox", "imgbox", "https://imgbox.com/", """https://images[0-9]*\.imgbox\.com/[a-f0-9]{2}/[a-f0-9]{2}/[A-Za-z0-9]+_o\.(?:jpe?g|png|gif|webp)"""),
    WebUploadSite("imgbb", "imgbb", "https://imgbb.com/", """https://i\.ibb\.co/[A-Za-z0-9]+/[^\s"'<>]+\.(?:jpe?g|png|gif|webp)"""),
)

fun webUploadSiteFor(host: String): WebUploadSite? = when (host) {
    "imgur-web" -> "imgur"
    "imgbox-web" -> "imgbox"
    "imgbb-web" -> "imgbb"
    else -> null
}?.let { k -> WEB_UPLOAD_SITES.first { it.key == k } }

/**
 * サイトの画面。job に画像があれば読み込みのあとにページへ渡し、上げたあとに出たリンクを onLink に渡す(hash は渡した画像と結びつくときだけ)。
 * 受け付けないサイトでも、ページのファイルの選び口から手で上げられる
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebUploadScreen(job: WebUploadJob, onLink: (url: String, hash: String?) -> Unit, onDismiss: () -> Unit) {
    val site = job.site
    var web by remember { mutableStateOf<WebView?>(null) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val found = remember { mutableStateListOf<String>() }
    val scope = rememberCoroutineScope()
    // 渡しているところ・渡した結果(sending / accepted / refused)・開けなかった(failed)。これから渡すなら null
    var passState by remember { mutableStateOf(if (!job.delivered) null else if (job.accepted) "accepted" else "refused") }
    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }
    var lastFoundAt by remember { mutableStateOf(0L) }
    LaunchedEffect(web) {
        val w = web ?: return@LaunchedEffect
        while (true) {
            delay(1000)
            for (u in parseWebUploadLinks(w.evaluate(WEB_UPLOAD_TAKE_SCRIPT), site.pattern)) {
                if (u !in found) { found += u; onLink(u, job.hashForLink()); lastFoundAt = System.currentTimeMillis() }
            }
            // 手で選んだときは、渡した数に関わらず次のリンクを待ちすぎない
            val passed = if (job.manualPick || !job.accepted) 0 else job.files.size
            if (found.isNotEmpty() && System.currentTimeMillis() - lastFoundAt > webUploadCloseDelayMs(passed, found.size)) { onDismiss(); break }
        }
    }
    FullWindow(onDismiss = onDismiss) {
        Column(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 52.dp).padding(start = 4.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textStrong) }
                Column(Modifier.weight(1f)) {
                    Text("${site.name}で上げる", color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    val status = when {
                        found.isNotEmpty() -> "${found.size} 件のリンクを本文に入れました"
                        job.note != null -> job.note
                        passState == "sending" -> "画像を渡しています…"
                        passState == "accepted" -> "画像を渡しました。上げ終わるとリンクを本文に入れます"
                        passState == "refused" -> "このサイトは画像を受け取りませんでした。この画面から選んでください"
                        passState == "failed" -> "ページを開けませんでした。閉じて、もう一度試してください"
                        else -> "上げたら、出てきたリンクを本文に入れます"
                    }
                    Text(status, color = if (found.isEmpty()) Palette.textMuted else Palette.accent, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = object : WebViewClient() {
                            private var passing: Job? = null
                            private var loadFailed = false
                            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { passing?.cancel(); loadFailed = false }
                            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                                if (!request.isForMainFrame) return
                                loadFailed = true
                                passing?.cancel()
                                if (!job.delivered) passState = "failed"
                            }
                            override fun onPageFinished(view: WebView, url: String?) {
                                view.evaluateJavascript(webUploadWatchScript(site.pattern), null)
                                // エラーの画面は URL が同じままなので、受け取れないと決めつけない
                                if (loadFailed || job.files.isEmpty() || job.delivered || !isWebUploadPage(url, site.url)) return
                                passing?.cancel()
                                passing = scope.launch {
                                    // ページの作りが落ち着くのを待つ(すぐだと受け口がまだない)
                                    delay(1500)
                                    passState = "sending"
                                    job.files.forEachIndexed { i, f -> for (part in webPassParts(f.bytes)) view.evaluate(webPassPartScript(i, part)) }
                                    val result = webPassResult(view.evaluate(webPassFireScript(job.files)))
                                    if (result == "lost") return@launch
                                    job.delivered = true
                                    job.accepted = result != "none"
                                    passState = if (job.accepted) "accepted" else "refused"
                                }
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>, params: FileChooserParams?): Boolean {
                                job.manualPick = true
                                fileCallback?.onReceiveValue(null)
                                fileCallback = callback
                                chooser.launch("image/*")
                                return true
                            }
                        }
                        loadUrl(site.url)
                        web = this
                    }
                },
                modifier = Modifier.fillMaxWidth().weight(1f),
                onRelease = { it.destroy() },
            )
        }
    }
}

/** 次を送る前に前の分を処理させる(大きな画像を一度に積むとメモリが足りなくなる) */
private suspend fun WebView.evaluate(script: String): String? = suspendCancellableCoroutine { c ->
    evaluateJavascript(script) { r -> if (c.isActive) c.resume(r) }
}
