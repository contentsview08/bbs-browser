import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// フォントは通信なしでも同じ見た目になるよう npm パッケージから同梱する(web 版は Google Fonts)
import '@fontsource-variable/noto-sans-jp'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import 'material-symbols/outlined.css'
import App from './App'
import './index.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
