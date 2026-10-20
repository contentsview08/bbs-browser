package io.github.yumekui8.bbs_browser

import android.content.ContentValues
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 画面の端まで描く作り(edge-to-edge)では、キーボードが出ても画面(WebView)の大きさが変わらず、
    // ページがキーボードの分だけ上下に動かせてしまう。キーボードの分だけ画面を縮める。
    // 下のジェスチャーの帯の分は、ページ側が safe-area の余白として空けているので、その分は差し引く。
    // キーボードの分はここで使い切り、ページには渡さない(ページ側でも縮めて、二重に持ち上がらないように)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val bars = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      view.setPadding(0, 0, 0, maxOf(0, ime - bars))
      WindowInsetsCompat.Builder(insets).setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE).build()
    }
  }

  // 画面(JavaScript)から、画像を写真の置き場(Pictures/bbs-browser。ギャラリーに出る)へ保存する口(window.BbsAndroid)。
  // Android 10 からは、写真の置き場へは MediaStore を通して書く決まり(許可は要らない)
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(MediaSaver(this), "BbsAndroid")
  }
}

/** 画像・動画を、写真の置き場へ保存する。返すのは保存した場所の説明(失敗したら "error:理由") */
class MediaSaver(private val activity: MainActivity) {
  @JavascriptInterface
  fun saveMedia(base64: String, fileName: String, mime: String): String {
    // 埋め込み(YouTube など)からも呼べてしまうので、受け取るのは画像・動画だけ、大きさにも上限を置く
    if (!mime.startsWith("image/") && !mime.startsWith("video/")) return "error:画像・動画ではありません"
    if (base64.length > 70_000_000) return "error:大きすぎます(50MB まで)"
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "error:Android 10 以降で使えます"
    return try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val video = mime.startsWith("video/")
      val folder = if (video) "Movies/bbs-browser" else "Pictures/bbs-browser"
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val collection = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val resolver = activity.contentResolver
      val uri = resolver.insert(collection, values) ?: return "error:保存先を作れませんでした"
      resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return "error:書き込めませんでした"
      values.clear()
      values.put(MediaStore.MediaColumns.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      folder
    } catch (e: Exception) {
      "error:${e.message}"
    }
  }
}
