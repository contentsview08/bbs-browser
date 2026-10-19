// スマホ: 板やスレの URL を入れて開く小さな画面(PC の URL 欄の帯の代わり。引き出しの「URL を開く」から)
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'

export default function UrlPrompt(props: { onOpen: (url: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const boxRef = useRef<HTMLFormElement>(null)
  useFocusTrap(boxRef, props.onClose)
  return createPortal(
    <div className="fixed inset-0 z-[9500] bg-black/40 flex items-start justify-center pt-[15vh] px-4" onClick={props.onClose}>
      <form
        ref={boxRef}
        className="w-full max-w-lg flex flex-col gap-3 p-4 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) props.onOpen(url.trim())
        }}
      >
        <p className="text-sm font-bold text-c-text-strong">URL を開く</p>
        <input
          autoFocus
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="板やスレの URL"
          spellCheck={false}
          className="w-full bg-c-surface2 border border-c-border rounded-[var(--btn-radius)] px-3 py-2 text-base text-c-text-body placeholder-c-text-muted focus:border-c-accent focus:ring-0"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="px-4 py-2 text-sm rounded-[var(--btn-radius)] border border-c-border">
            やめる
          </button>
          <button type="submit" disabled={!url.trim()} className="px-4 py-2 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] disabled:opacity-50">
            開く
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
