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

/** 文字を打つ欄か(Esc で 1 回目は欄を抜けるだけにする対象) */
function isTextField(el: HTMLElement): boolean {
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  if (el.tagName !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return type === 'text' || type === 'search' || type === 'url' || type === 'email' || type === 'password' || type === 'number'
}

/** box のあとに開いた画像のビューアーがあるか(portal は開いた順に body の後ろへ付く。ビューアー自身と、その上に開いたものは当たらない) */
function lightboxAbove(box: HTMLElement): boolean {
  return [...document.querySelectorAll('[data-lightbox]')].some((lb) => lb !== box && !(lb.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING))
}

/**
 * opts.escBlursInputs: 文字を打っている欄(中身あり)で Esc を押したら、閉じずに欄を抜けるだけにする(2 回目で閉じる)。
 * 入力をやめるつもりで押した Esc で、ダイアログごと消えて書きかけがなくなるのを防ぐ。直す画面(設定・NG・スレ立て)で使う
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void, opts?: { escBlursInputs?: boolean }) {
  const escBlursInputs = opts?.escBlursInputs ?? false
  useEffect(() => {
    // 開いている間の目印(後ろの画面のキー操作が見る)
    ref.current?.setAttribute('data-modal', '')
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current
      // 上に画像のビューアーが開いていれば、キー(Esc・矢印)はビューアーのもの
      if (!box || e.defaultPrevented || e.isComposing || lightboxAbove(box)) return
      if (e.key === 'Escape') {
        // 画面が重なっているとき(ページの上に下からのメニューなど)は、いちばん上(あとから開いたもの)だけが閉じる
        const modals = document.querySelectorAll('[data-modal]')
        if (modals[modals.length - 1] !== box) return
        e.preventDefault()
        const t = e.target as HTMLElement
        if (escBlursInputs && box.contains(t) && isTextField(t) && (t as HTMLInputElement).value !== '') {
          t.blur()
          return
        }
        // 閉じる前に、開いている欄を確定する(離れたときに保存する欄のため)
        if (box.contains(t) && t !== box) t.blur()
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
  }, [ref, onEscape, escBlursInputs])
}
