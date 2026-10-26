package io.github.yumekui8.bbsnative.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.toArgb
import io.github.yumekui8.bbsnative.data.Prefs

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
            CustomTabsIntent.Builder().setDefaultColorSchemeParams(colors).setShowTitle(true).build().launchUrl(context, uri)
        } else {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }.onFailure { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } }
}
