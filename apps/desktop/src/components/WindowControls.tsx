// ウィンドウの最小化・最大化・閉じるボタン。OS の枠を外している(tauri.conf.json の decorations: false)ので、
// アプリで描く。見た目は Windows の標準に合わせ、閉じるだけマウスを乗せると赤くする。

import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

const BTN = 'w-12 h-full flex items-center justify-center text-c-text-muted transition-colors'

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    void win.isMaximized().then(setMaximized)
    // 最大化はダブルクリックやスナップでも変わるので、大きさが変わるたびに見直す
    const unlisten = win.onResized(() => void win.isMaximized().then(setMaximized))
    return () => void unlisten.then((f) => f())
  }, [])

  const win = getCurrentWindow()
  return (
    <div className="flex items-stretch h-full flex-shrink-0">
      <button type="button" className={`${BTN} hover:bg-c-surface3 hover:text-c-text-strong`} title="最小化" onClick={() => void win.minimize()}>
        <span className="material-symbols-outlined text-lg">remove</span>
      </button>
      <button
        type="button"
        className={`${BTN} hover:bg-c-surface3 hover:text-c-text-strong`}
        title={maximized ? '元のサイズに戻す' : '最大化'}
        onClick={() => void win.toggleMaximize()}
      >
        <span className="material-symbols-outlined text-base">{maximized ? 'filter_none' : 'crop_square'}</span>
      </button>
      <button type="button" className={`${BTN} hover:bg-[#e81123] hover:text-white`} title="閉じる" onClick={() => void win.close()}>
        <span className="material-symbols-outlined text-lg">close</span>
      </button>
    </div>
  )
}
