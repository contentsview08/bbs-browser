package io.github.yumekui8.bbsnative.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import org.json.JSONArray

/**
 * 画像の置き場の、ふつうのアップロードの画面(API を使わない)。PC 版・Web の utils/webUpload.ts と同じ表。
 * pattern は、上げたあとに出るリンク(直接の画像の URL)の形
 */
data class WebUploadSite(val key: String, val name: String, val url: String, val pattern: String, val note: String)

val WEB_UPLOAD_SITES = listOf(
    WebUploadSite("imgur", "imgur", "https://imgur.com/upload", """https://i\.imgur\.com/[A-Za-z0-9]{5,}\.(?:jpe?g|png|gif|webp|mp4)""", "消えない。ログインしなくても上げられます"),
    WebUploadSite("imgbox", "imgbox", "https://imgbox.com/", """https://images\d*\.imgbox\.com/[a-f0-9]{2}/[a-f0-9]{2}/[A-Za-z0-9]+_o\.(?:jpe?g|png|gif|webp)""", "消えない。ログインしなくても上げられます"),
    WebUploadSite("imgbb", "imgbb", "https://imgbb.com/", """https://i\.ibb\.co/[A-Za-z0-9]+/[^\s"'<>]+\.(?:jpe?g|png|gif|webp)""", "消えない。ログインしなくても上げられます"),
)

/** 設定の上げ先(imgur-web など)が「サイトの画面」なら、そのサイト */
fun webUploadSiteFor(host: String): WebUploadSite? = when (host) {
    "imgur-web" -> "imgur"
    "imgbox-web" -> "imgbox"
    "imgbb-web" -> "imgbb"
    else -> null
}?.let { k -> WEB_UPLOAD_SITES.first { it.key == k } }

/**
 * ページに差し込む見張り(PC 版の src-tauri/src/web_upload.rs と同じ考え)。読み込んで 3 秒の間にあったリンクは数えず、
 * そのあとに出たものを window.__bbsFound に貯める。アプリは 1 秒ごとに取り出す
 */
private fun watchScript(pattern: String) = """
(() => {
  if (window.__bbsWatch) return
  window.__bbsWatch = true
  window.__bbsFound = []
  const re = new RegExp(${org.json.JSONObject.quote(pattern)}, 'g')
  const seen = new Set()
  let ready = false
  const scan = () => {
    const texts = []
    document.querySelectorAll('a[href]').forEach((a) => texts.push(a.href))
    document.querySelectorAll('img[src]').forEach((i) => texts.push(i.src))
    document.querySelectorAll('input, textarea').forEach((i) => texts.push(i.value))
    if (document.body) texts.push(document.body.innerText)
    for (const t of texts) for (const m of String(t || '').matchAll(re)) {
      if (seen.has(m[0])) continue
      seen.add(m[0])
      if (ready) window.__bbsFound.push(m[0])
    }
  }
  setTimeout(() => { scan(); ready = true }, 3000)
  setInterval(() => { if (ready) scan() }, 700)
})()
"""

/** 置き場の画面を画面いっぱいに開き、本人が手で上げたあとに出たリンクを onLink に渡す */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebUploadScreen(site: WebUploadSite, onLink: (String) -> Unit, onDismiss: () -> Unit) {
    var web by remember { mutableStateOf<WebView?>(null) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val found = remember { mutableStateListOf<String>() }
    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }
    // 1 秒ごとに、見つかったリンクを取り出す
    LaunchedEffect(web) {
        val w = web ?: return@LaunchedEffect
        while (true) {
            delay(1000)
            w.evaluateJavascript("(() => { const f = window.__bbsFound || []; window.__bbsFound = []; return JSON.stringify(f) })()") { r ->
                val arr = runCatching { JSONArray(JSONArray("[$r]").getString(0)) }.getOrNull() ?: return@evaluateJavascript
                for (i in 0 until arr.length()) {
                    val u = arr.getString(i)
                    if (u !in found) { found += u; onLink(u) }
                }
            }
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = 52.dp).padding(start = 4.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, "閉じる", tint = Palette.textStrong) }
                Column(Modifier.weight(1f)) {
                    Text("${site.name}で上げる", color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Text(
                        if (found.isEmpty()) "上げたら、出てきたリンクを本文に入れます" else "${found.size} 件のリンクを本文に入れました",
                        color = if (found.isEmpty()) Palette.textMuted else Palette.accent, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView, url: String?) { view.evaluateJavascript(watchScript(site.pattern), null) }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>, params: FileChooserParams?): Boolean {
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
