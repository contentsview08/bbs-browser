// 確かめるダイアログ(取り消せない操作の前に出す)。「次回から表示しない」を付けられる

import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { createPortal } from 'react-dom'

export default function ConfirmDialog(props: {
  title: string
  message: string
  okLabel: string
  /** 「次回から表示しない」のチェックを出す */
  canSkipNext?: boolean
  onClose: (ok: boolean, skipNext: boolean) => void
}) {
  const [skip, setSkip] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // Tab・矢印はダイアログの中だけで回し、Esc でやめる
  const latestClose = useRef(props.onClose)
  latestClose.current = props.onClose
  const cancel = useRef(() => latestClose.current(false, false)).current
  useFocusTrap(boxRef, cancel)
  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" onClick={() => props.onClose(false, false)}>
      <div
        ref={boxRef}
        className="w-full max-w-md bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-c-border">
          <span className="material-symbols-outlined text-xl" style={{ color: 'var(--c-error)' }}>
            warning
          </span>
          <h2 className="text-base font-bold text-c-text-strong">{props.title}</h2>
        </div>
        <p className="px-5 py-4 text-sm text-c-text-body whitespace-pre-wrap">{props.message}</p>
        <div className="flex items-center gap-2 px-5 pb-4">
          {props.canSkipNext && (
            <label className="flex items-center gap-2 text-xs text-c-text-muted cursor-pointer select-none">
              <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} className="rounded" />
              次回から表示しない
            </label>
          )}
          <div className="ml-auto flex gap-2">
            {/* 開いたら「やめる」に入る(Enter をうっかり押しても消さない) */}
            <button
              type="button"
              autoFocus
              onClick={() => props.onClose(false, false)}
              className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:bg-c-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-accent"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => props.onClose(true, skip)}
              className="px-3 py-1.5 text-sm font-bold rounded-[var(--btn-radius)] text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-accent"
              style={{ background: 'var(--c-error)' }}
            >
              {props.okLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
