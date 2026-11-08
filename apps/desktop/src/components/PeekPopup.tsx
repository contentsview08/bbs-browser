// スレを開かずに中身をのぞく(スレ一覧で P)。スレ一覧を取ったときに一緒に届いた中身(ThreadSummary.preview)だけを出す。
// のぞくために取りに行くことはしない(掲示板の負担にならないように)

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ThreadSummary } from '@bbs-browser/connectors'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'

export default function PeekPopup(props: { thread: ThreadSummary; onOpen: () => void; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)
  const posts = props.thread.preview ?? []
  return createPortal(
    <div className="fixed inset-0 z-[9800] bg-black/30 flex items-center justify-center p-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-2xl max-h-[75vh] flex flex-col bg-c-surface border-2 rounded-xl shadow-xl rise-in"
        style={{ borderColor: 'var(--c-accent)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // P をもう一度押しても閉じる。Enter でスレを開く
          if (e.key === 'p' || e.key === 'P') {
            e.preventDefault()
            props.onClose()
          } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            // ボタンの上の Enter は、そのボタンを押す(× で閉じる)
            e.preventDefault()
            props.onClose()
            props.onOpen()
          }
        }}
      >
        <div className="flex items-center gap-2 pl-4 pr-2 py-2 border-b border-c-border">
          <span className="flex-1 min-w-0 truncate text-sm font-bold text-c-text-strong">{props.thread.title}</span>
          <button
            type="button"
            autoFocus
            onClick={() => {
              props.onClose()
              props.onOpen()
            }}
            className="flex-shrink-0 px-2.5 py-1 text-xs rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover"
            title="スレを開く(Enter)"
          >
            開く
          </button>
          <button type="button" onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる(Esc・P)">
            <span className="material-symbols-outlined text-lg leading-none">close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-3 space-y-3">
          {posts.map((p) => (
            <div key={p.no}>
              <div className="flex items-baseline gap-2 text-xs text-c-text-muted">
                <span className="font-bold">{p.no}</span>
                <span className="font-bold text-c-poster-name">{p.name}</span>
                {p.date && <span>{p.date}</span>}
              </div>
              <p className="mt-0.5 text-sm text-c-text-body whitespace-pre-wrap break-words leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
