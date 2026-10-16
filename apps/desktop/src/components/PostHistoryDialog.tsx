// 書き込み履歴。自分が書き込んだレスを新しい順に並べ、押すとそのスレを開いてそのレスへ飛ぶ。
// スレのログを消しても、書いた内容は残っている(post_history 表)。
// 上の欄で本文・スレタイ・名前を絞り込める

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PostHistoryEntry } from '@bbs-browser/logstore'
import { normalizeForSearch } from '../utils/postBody'

const TOOL = 'p-1.5 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

/** 板の URL を、見分けのつく短い形にする(https://eagle.5ch.io/livejupiter/ → livejupiter) */
function boardLabel(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }
}

export default function PostHistoryDialog(props: {
  entries: PostHistoryEntry[]
  /** そのスレを開き、番号が分かっていればそのレスへ飛ぶ */
  onOpen: (e: PostHistoryEntry) => void
  onDelete: (id: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<number>()
  const shown = useMemo(() => {
    const q = normalizeForSearch(query.trim())
    if (!q) return props.entries
    return props.entries.filter((e) => normalizeForSearch(`${e.thread.title} ${e.name} ${e.body}`).includes(q))
  }, [props.entries, query])

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div
        className="w-full max-w-3xl h-[80vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose()
        }}
      >
        <div className="flex items-center gap-3 pl-5 pr-2 py-2.5 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong whitespace-nowrap">
            書き込み履歴 <span className="ml-1 text-sm font-normal text-c-text-muted">{props.entries.length}</span>
          </h2>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="本文・スレタイ・名前で絞り込む"
            autoFocus
            className="flex-1 min-w-0 bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1 focus:ring-c-accent focus:border-c-accent"
          />
          <button type="button" onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {shown.length === 0 ? (
            <p className="p-5 text-sm text-c-text-muted">{props.entries.length === 0 ? 'まだありません' : '見つかりません'}</p>
          ) : (
            <ul className="divide-y divide-c-border">
              {shown.map((e) => (
                <li key={e.id} className="group relative hover:bg-c-surface2 transition-colors">
                  <button type="button" onClick={() => props.onOpen(e)} className="w-full text-left px-5 py-3 pr-24" title="スレを開いて、このレスへ飛ぶ">
                    <div className="flex items-baseline gap-2 text-xs text-c-text-muted">
                      <span className="whitespace-nowrap tabular-nums">
                        {new Date(e.postedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                      <span className="whitespace-nowrap">{boardLabel(e.thread.boardUrl)}</span>
                      {e.no !== undefined && <span className="font-bold text-c-accent">&gt;&gt;{e.no}</span>}
                      {(e.name || e.mail) && (
                        <span className="truncate">
                          {e.name}
                          {e.mail && <span className="ml-1">[{e.mail}]</span>}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-bold text-c-text-strong truncate">{e.thread.title || '(スレタイ不明)'}</p>
                    <p className="mt-1 text-sm text-c-text-body whitespace-pre-wrap break-words line-clamp-3">{e.body || '(本文なし)'}</p>
                  </button>
                  <div className="absolute top-2 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className={TOOL}
                      title="本文をコピー"
                      onClick={() => {
                        void navigator.clipboard.writeText(e.body)
                        setCopied(e.id)
                      }}
                    >
                      <span className="material-symbols-outlined text-base leading-none">{copied === e.id ? 'check' : 'content_copy'}</span>
                    </button>
                    <button
                      type="button"
                      className={`${TOOL} hover:text-c-heat-very-hot`}
                      title="履歴から消す(掲示板の書き込みは消えません)"
                      onClick={() => props.onDelete(e.id)}
                    >
                      <span className="material-symbols-outlined text-base leading-none">delete</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
