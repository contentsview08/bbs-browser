// ダイアログの中だけでフォーカスを回す。開いている間は、キーを後ろの画面に渡さない。
// Tab・Shift+Tab と矢印キーで、ダイアログの中のボタンやチェックを順に(端まで行ったら反対の端へ)移り、Esc で閉じる。
// Enter・Space は、フォーカスのあるボタンをそのまま押す(ブラウザの動き)

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current
      if (!box) return
      // 後ろの画面(スレ表示の J・K など)には渡さない
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscape()
        return
      }
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
      if (items.length === 0) return
      const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)
      const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)
      if (!forward && !backward) return
      // 文字を打つ欄の中の矢印は、カーソルを動かすのに使う
      const t = e.target as HTMLElement
      if (e.key.startsWith('Arrow') && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return
      e.preventDefault()
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = i < 0 ? (forward ? 0 : items.length - 1) : (i + (forward ? 1 : -1) + items.length) % items.length
      items[next].focus()
    }
    // 画面のほかのキー操作より先に受け取る
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ref, onEscape])
}
