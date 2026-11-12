import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary'
import 'material-symbols/outlined.css'
import App from './App'
import { toolKindOfThisWindow } from './host/crossWindow'
import { isMobile } from './utils/platform'
import { installTextInputGuard } from './utils/keymap'
// Web フォントは同梱しない。選んだときだけ host/fonts.ts が CDN から読む
import './index.css'
import './app.css'

// 道具のウィンドウ(設定・NG の管理表。index.html?window=…)は、メインの画面ではなくその道具だけを出す
const ToolWindow = lazy(() => import('./windows/ToolWindow'))

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

// IME の変換中のキーと、入力欄の中の編集のキー(Ctrl+T・F10 など)は、アプリのキー操作に回さない(utils/keymap.ts)
installTextInputGuard()

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
