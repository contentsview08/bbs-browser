package io.github.contentsview08.obb.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.contentsview08.obb.AppViewModel

/**
 * 埋め込みのブラウザ(設定 → スレ表示 → 「埋め込みのブラウザで開く」)。画像ビューアーのように今の画面の上に重ね、
 * 本文のリンクをアプリの中の WebView でそのまま開く。戻るは WebView の履歴を先にたどり、なくなったら閉じる。
 * http(s) でないリンク(アプリを開くものなど)はそのアプリに渡す。右上から外のブラウザでも開ける
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebLinkScreen(vm: AppViewModel) {
    val url = vm.webLink
    OverlayPanel(visible = url != null, onClose = { vm.closeWebLink() }) {
        // 別の URL を開いたら WebView を作り直す(前のページの履歴を引き継がない)。
        // inline の key の中から return@key で抜けると R8 が通らない(非ローカルの return)ので、if で囲む
        if (url != null) key(url) {
            val start = url
            val context = LocalContext.current
            var web by remember { mutableStateOf<WebView?>(null) }
            var title by remember { mutableStateOf("") }
            var current by remember { mutableStateOf(start) }
            var progress by remember { mutableIntStateOf(0) }
            var canBack by remember { mutableStateOf(false) }
            BackHandler(enabled = canBack) { web?.goBack() }
            Column(Modifier.fillMaxSize().background(Palette.base)) {
                HeaderBar(
                    title.ifEmpty { current }, onNav = { vm.closeWebLink() }, navIsBack = true,
                    actions = {
                        BarIcon(Icons.AutoMirrored.Filled.OpenInNew, "ブラウザで開く") { openExternal(context, web?.url ?: current, false) }
                        BarIcon(Icons.Filled.Close, "閉じる") { vm.closeWebLink() }
                    },
                )
                if (progress in 1..99) LinearProgressIndicator(progress = { progress / 100f }, Modifier.fillMaxWidth().height(2.dp), color = Palette.accent, trackColor = Palette.border)
                else HorizontalDivider(color = Palette.border)
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.loadWithOverviewMode = true
                            settings.useWideViewPort = true
                            settings.setSupportZoom(true)
                            settings.builtInZoomControls = true
                            settings.displayZoomControls = false
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                    val u = request.url
                                    if (u.scheme == "http" || u.scheme == "https") return false
                                    // アプリを開くリンク(intent:・市販のアプリの scheme)はそのアプリへ
                                    runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, u)) }
                                    return true
                                }
                                override fun onPageFinished(view: WebView, u: String?) {
                                    current = u ?: current
                                    canBack = view.canGoBack()
                                }
                            }
                            webChromeClient = object : WebChromeClient() {
                                override fun onProgressChanged(view: WebView, newProgress: Int) { progress = newProgress }
                                override fun onReceivedTitle(view: WebView, t: String?) { title = t.orEmpty() }
                            }
                            loadUrl(start)
                            web = this
                        }
                    },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    onRelease = { it.stopLoading(); it.destroy() },
                )
            }
        }
    }
}
