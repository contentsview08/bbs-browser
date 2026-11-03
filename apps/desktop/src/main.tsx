import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary'
// フォントは通信なしでも同じ見た目になるよう npm パッケージから同梱する(web 版は Google Fonts)
// 同梱のフォント(設定 → フォント)。どれも文字の範囲ごとに分かれたファイルで、選んだフォントの使う範囲だけを読む(選ばなければ読まない)
import '@fontsource-variable/noto-sans-jp'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import '@fontsource/m-plus-1p/400.css'
import '@fontsource/m-plus-1p/700.css'
import '@fontsource-variable/m-plus-2'
import '@fontsource/m-plus-rounded-1c/400.css'
import '@fontsource/m-plus-rounded-1c/700.css'
import '@fontsource/zen-kaku-gothic-new/400.css'
import '@fontsource/zen-kaku-gothic-new/700.css'
import '@fontsource/zen-maru-gothic/400.css'
import '@fontsource/zen-maru-gothic/700.css'
import '@fontsource/ibm-plex-sans-jp/400.css'
import '@fontsource/ibm-plex-sans-jp/700.css'
import '@fontsource-variable/murecho'
import '@fontsource/sawarabi-gothic/400.css'
import '@fontsource/kosugi-maru/400.css'
import '@fontsource-variable/noto-serif-jp'
import '@fontsource/biz-udpmincho/400.css'
import '@fontsource/biz-udpmincho/700.css'
import '@fontsource/shippori-mincho/400.css'
import '@fontsource/shippori-mincho/700.css'
import '@fontsource/zen-old-mincho/400.css'
import '@fontsource/zen-old-mincho/700.css'
import 'material-symbols/outlined.css'
import App from './App'
import { lazy, Suspense } from 'react'
import { toolKindOfThisWindow } from './host/crossWindow'

// 道具のウィンドウ(設定・NG の管理表。index.html?window=…)は、メインの画面ではなくその道具だけを出す
const ToolWindow = lazy(() => import('./windows/ToolWindow'))
import { isMobile } from './utils/platform'
import './index.css'
import './app.css'

// スマホでは、CSS(app.css の [data-platform='mobile'])で押しやすい大きさ・画面の端の余白(切り欠き)に合わせる
document.documentElement.dataset.platform = isMobile ? 'mobile' : 'desktop'
// スマホ: キーボードの高さを --kb-inset に入れる(画面の下に置く入力欄を、キーボードの上に持ち上げるため)。
// 画面いっぱいに描く作り(edge-to-edge)では、キーボードが出ても WebView の大きさが変わらないことがあるので、見えている範囲から測る
if (isMobile && window.visualViewport) {
  const vv = window.visualViewport
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    document.documentElement.style.setProperty('--kb-inset', `${Math.round(inset)}px`)
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  update()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {toolKindOfThisWindow() ? (
        <Suspense fallback={null}>
          <ToolWindow />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
)
