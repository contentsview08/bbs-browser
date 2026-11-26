package io.github.contentsview08.obb.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.toArgb
import io.github.contentsview08.obb.data.Prefs

/** 画面から設定を読む(MainActivity が渡す) */
val LocalPrefs = staticCompositionLocalOf<Prefs> { error("Prefs が渡されていません") }

/**
 * 外のページを開く。inApp ならアプリの中のブラウザ(Custom Tabs。上の帯は配色の色)で、そうでなければいつものブラウザで。
 * YouTube などアプリのあるリンクは、そのアプリで開く(Custom Tabs でもアプリに渡る)
 */
fun openExternal(context: Context, url: String, inApp: Boolean) {
    val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
    runCatching {
        if (inApp) {
            val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(Palette.bar.toArgb()).build()
            val intent = CustomTabsIntent.Builder().setDefaultColorSchemeParams(colors).setShowTitle(true).build()
            // カスタムタブに対応したブラウザを明示する。指定しないと、既定のブラウザ(Xiaomi の Mi ブラウザなど)が対応していないときに
            // ふつうの ACTION_VIEW として渡り、別のアプリとしてブラウザが開いていた。対応したものがなければブラウザで開く
            val pkg = androidx.browser.customtabs.CustomTabsClient.getPackageName(context, null)
            if (pkg == null) { context.startActivity(Intent(Intent.ACTION_VIEW, uri)); return }
            intent.intent.setPackage(pkg)
            intent.launchUrl(context, uri)
        } else {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }.onFailure { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } }
}
