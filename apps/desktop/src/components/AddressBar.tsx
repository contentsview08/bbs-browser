// 画面のいちばん上の、ブラウザのようなアドレスバー。
// ふだんは開いているスレ(なければ板)の URL を出し、書き換えて Enter を押すとその板やスレを開く。

import { useState } from 'react'

interface Props {
  currentUrl: string
  onOpen: (url: string) => void
}

export default function AddressBar({ currentUrl, onOpen }: Props) {
  // 書き換えている間だけ自分で値を持つ。確定するか、外へ出たら現在の URL に戻す
  const [draft, setDraft] = useState<string>()

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-c-surface border-b border-c-border">
      <form
        className="flex-1 min-w-0 flex items-center gap-2 px-3 bg-c-surface2 border border-c-border rounded-full focus-within:border-c-accent transition-colors"
        onSubmit={(e) => {
          e.preventDefault()
          const url = (draft ?? '').trim()
          setDraft(undefined)
          ;(document.activeElement as HTMLElement | null)?.blur()
          if (url && url !== currentUrl) onOpen(url)
        }}
      >
        <span className="material-symbols-outlined text-base text-c-text-muted">link</span>
        <input
          type="text"
          value={draft ?? currentUrl}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setDraft(currentUrl)
            e.currentTarget.select()
          }}
          onBlur={() => setDraft(undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(undefined)
              e.currentTarget.blur()
            }
          }}
          placeholder="板やスレの URL を入れて Enter"
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent border-0 p-0 py-1 text-sm text-c-text-body placeholder-c-text-muted focus:ring-0"
        />
      </form>
    </div>
  )
}
