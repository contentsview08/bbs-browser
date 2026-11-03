// ダイアログ・ポップアップの「閉じる」を 1 か所に決める。
// - 外を押して閉じるのは、押し始めも離したのも外のときだけ(中で文字を選び始めて外で離したときは閉じない)
// - 閉じる前に、開いている欄のフォーカスを外す(数の欄・行の編集が、離れたときに確定する作りのため)
// - 書きかけがあるときは、捨ててよいか確かめてから閉じる(useGuardedClose)
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createElement } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'

/** 閉じる前に、開いている欄を確定する(フォーカスを外して onBlur を起こす) */
export function closeAfterBlur(onClose: () => void) {
  const el = document.activeElement as HTMLElement | null
  if (el && el !== document.body) el.blur()
  onClose()
}

/**
 * 背景(暗い幕)に付ける onMouseDown・onClick。enabled が false なら外を押しても閉じない(× と Esc だけ)
 */
export function useBackdropClose(onClose: () => void, enabled = true) {
  const down = useRef(false)
  return {
    onMouseDown: (e: ReactMouseEvent) => {
      down.current = e.target === e.currentTarget
    },
    onClick: (e: ReactMouseEvent) => {
      const wasDown = down.current
      down.current = false
      if (!enabled || e.target !== e.currentTarget || !wasDown) return
      // 文字を選んでいる(中で選び始めて外で離した)ときは閉じない
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      closeAfterBlur(onClose)
    },
  }
}

/**
 * 書きかけ(dirty)があるときは、捨ててよいか確かめてから閉じる。
 * requestClose を × ・Esc・背景のすべてから呼ぶ。guard はダイアログの中で描く
 */
export function useGuardedClose(dirty: boolean, onClose: () => void): { requestClose: () => void; guard: ReactNode } {
  const [asking, setAsking] = useState(false)
  const latest = useRef({ dirty, onClose })
  latest.current = { dirty, onClose }
  const requestClose = useCallback(() => {
    if (latest.current.dirty) setAsking(true)
    else closeAfterBlur(latest.current.onClose)
  }, [])
  const guard = asking
    ? createElement(ConfirmDialog, {
        title: '書きかけがあります',
        message: '閉じると、ここで直した内容は捨てられます。',
        okLabel: '捨てて閉じる',
        onClose: (ok: boolean) => {
          setAsking(false)
          if (ok) latest.current.onClose()
        },
      })
    : null
  return { requestClose, guard }
}
