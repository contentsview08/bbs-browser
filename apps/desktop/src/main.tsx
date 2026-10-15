import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// フォントは通信なしでも同じ見た目になるよう npm パッケージから同梱する(web 版は Google Fonts)
import '@fontsource-variable/noto-sans-jp'
import '@fontsource/dotgothic16'
import 'material-symbols/outlined.css'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
