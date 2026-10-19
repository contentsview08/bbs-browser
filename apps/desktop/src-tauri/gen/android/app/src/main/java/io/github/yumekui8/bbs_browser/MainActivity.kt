package io.github.yumekui8.bbs_browser

import android.os.Bundle
import android.view.View
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
}
