// ダイアログの中だけでフォーカスを回す。開いている間は、後ろの画面のキー操作を止める(utils/keymap.ts の modalOpen)。
// Tab・Shift+Tab と矢印キーで、ダイアログの中のボタンやチェックを順に(端まで行ったら反対の端へ)移り、Esc で閉じる。
// Enter・Space は、フォーカスのあるボタンをそのまま押す(ブラウザの動き)。
// キーは画面の一番外(window)で、ほかが受け取ったあとに見る。ダイアログの中のメニューや、キーの割り当てを待っている間が
// 先に使ったキー(preventDefault・stopPropagation したもの)には手を出さない

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/** 矢印キーをそのまま使う欄(文字のカーソル・選択肢・つまみを動かす) */
function usesArrows(el: HTMLElement): boolean {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true
  if (el.tagName !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit'
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  useEffect(() => {
    // 開いている間の目印(後ろの画面のキー操作が見る)
    ref.current?.setAttribute('data-modal', '')
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current
      // 上に画像のビューアーが開いていれば、キー(Esc・矢印)はビューアーのもの
      if (!box || e.defaultPrevented || e.isComposing || document.querySelector('[data-lightbox]')) return
      if (e.key === 'Escape') {
        // 画面が重なっているとき(ページの上に下からのメニューなど)は、いちばん上(あとから開いたもの)だけが閉じる
        const modals = document.querySelectorAll('[data-modal]')
        if (modals[modals.length - 1] !== box) return
        e.preventDefault()
        onEscape()
        return
      }
      const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)
      const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)
      if (!forward && !backward) return
      const t = e.target as HTMLElement
      if (e.key.startsWith('Arrow') && box.contains(t) && usesArrows(t)) return
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
      if (items.length === 0) return
      e.preventDefault()
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = i < 0 ? (forward ? 0 : items.length - 1) : (i + (forward ? 1 : -1) + items.length) % items.length
      items[next].focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ref, onEscape])
}
