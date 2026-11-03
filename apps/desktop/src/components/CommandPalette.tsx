// コマンドパレット(Ctrl+K・:)。板・タブ・お気に入りのスレ・最近見たスレ・操作・見た目の切り替えを、名前の一部で探して開く。
// ↑↓ で選び、Enter で実行、Esc で閉じる。何も打たなければ、よく使うものを上から並べる

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { normalizeForSearch } from '../utils/postBody'

export interface PaletteItem {
  /** 見出し(何の仲間か): 操作・板・タブ など */
  group: string
  label: string
  /** 探すときに名前と一緒に見る言葉(板の URL など) */
  keywords?: string
  icon: string
  run: () => void
}

/** 出す数の上限 */
const MAX_SHOWN = 60

export default function CommandPalette(props: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)

  // 空白で区切った言葉が、全部どこかに入っているものだけ(順番は問わない)
  const shown = useMemo(() => {
    const words = normalizeForSearch(query).split(/\s+/).filter(Boolean)
    const hits = words.length === 0 ? props.items : props.items.filter((it) => {
      const text = normalizeForSearch(`${it.group} ${it.label} ${it.keywords ?? ''}`)
      return words.every((w) => text.includes(w))
    })
    return hits.slice(0, MAX_SHOWN)
  }, [query, props.items])
  const current = Math.min(index, Math.max(0, shown.length - 1))

  const run = (it: PaletteItem | undefined) => {
    if (!it) return
    props.onClose()
    it.run()
  }
  const move = (d: number) => {
    const next = (current + d + shown.length) % Math.max(1, shown.length)
    setIndex(next)
    listRef.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const backdrop = useBackdropClose(props.onClose)
  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/40 flex justify-center pt-[12vh] px-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-xl h-fit max-h-[70vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-c-border">
          <span className="material-symbols-outlined text-xl text-c-text-muted">search</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(e.key === 'ArrowDown' ? 1 : -1)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(shown[current])
              }
            }}
            placeholder="板・スレ・操作を探す(空白で区切って絞り込み)"
            className="flex-1 min-w-0 bg-transparent text-base text-c-text-strong placeholder-c-text-muted focus:outline-none"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-c-border text-c-text-muted">Esc</kbd>
        </div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-c-text-muted">見つかりませんでした</p>
          ) : (
            shown.map((it, i) => (
              <button
                key={`${it.group}:${it.label}:${i}`}
                type="button"
                data-i={i}
                tabIndex={-1}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(it)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  i === current ? 'bg-c-surface3 text-c-text-strong' : 'text-c-text-body'
                }`}
              >
                <span className="material-symbols-outlined text-lg text-c-text-muted">{it.icon}</span>
                <span className="flex-1 min-w-0 truncate">{it.label}</span>
                <span className="flex-shrink-0 text-[11px] text-c-text-muted">{it.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
