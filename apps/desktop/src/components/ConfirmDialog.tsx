// 確かめるダイアログ(取り消せない操作の前に出す)。「次回から表示しない」を付けられる

import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { Button } from './DialogParts'
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
  const backdrop = useBackdropClose(cancel)
  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-md bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
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
            <Button autoFocus onClick={() => props.onClose(false, false)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-accent">
              やめる
            </Button>
            <Button variant="danger" onClick={() => props.onClose(true, skip)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-accent">
              {props.okLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
