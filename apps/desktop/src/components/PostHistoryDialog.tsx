// 書き込み履歴。自分が書き込んだレスを新しい順に並べ、押すとそのスレを開いてそのレスへ飛ぶ。
// スレのログを消しても、書いた内容は残っている(post_history 表)。
// 上の欄で本文・スレタイ・名前を絞り込める

import { useRef, useMemo, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { createPortal } from 'react-dom'
import type { PostHistoryEntry } from '@bbs-browser/logstore'
import { normalizeForSearch } from '../utils/postBody'
import { isMobile } from '../utils/platform'
import { useLongPress } from '../hooks/useLongPress'
import MobilePage, { dayLabel } from './MobilePage'
import { relativeTime } from '../utils/thread'
import ActionSheet from './ActionSheet'

const TOOL = 'p-1.5 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

/** 板の URL を、見分けのつく短い形にする(https://eagle.5ch.io/livejupiter/ → livejupiter) */
function boardLabel(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }
}

interface Props {
  entries: PostHistoryEntry[]
  /** そのスレを開き、番号が分かっていればそのレスへ飛ぶ */
  onOpen: (e: PostHistoryEntry) => void
  onDelete: (id: number) => void
  onClose: () => void
}

export default function PostHistoryDialog(props: Props) {
  // スマホは全画面の一覧(書いた日ごとに区切る。たたくと開き、長押しで操作)
  if (isMobile) return <MobilePostHistory {...props} />
  return <DesktopPostHistory {...props} />
}

function DesktopPostHistory(props: Props) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<number>()
  const shown = useMemo(() => {
    const q = normalizeForSearch(query.trim())
    if (!q) return props.entries
    return props.entries.filter((e) => normalizeForSearch(`${e.thread.title} ${e.name} ${e.body}`).includes(q))
  }, [props.entries, query])

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める

  const boxRef = useRef<HTMLDivElement>(null)

  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-3xl h-[80vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
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

/** スマホ: 書き込み履歴のページ */
function MobilePostHistory(props: Props) {
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState<PostHistoryEntry>()
  const shown = useMemo(() => {
    const q = normalizeForSearch(query.trim())
    if (!q) return props.entries
    return props.entries.filter((e) => normalizeForSearch(`${e.thread.title} ${e.name} ${e.body}`).includes(q))
  }, [props.entries, query])
  return (
    <MobilePage title="書き込み履歴" count={props.entries.length} onClose={props.onClose} onQuery={setQuery} placeholder="本文・スレタイ・名前で絞り込む">
      {shown.length === 0 ? (
        <p className="p-6 text-sm text-c-text-muted text-center">{props.entries.length === 0 ? 'まだ書き込んでいません' : '見つかりません'}</p>
      ) : (
        shown.map((e, i) => {
          const day = dayLabel(e.postedAt)
          return (
            <div key={e.id}>
              {/* 日が変わる所に見出し */}
              {(i === 0 || dayLabel(shown[i - 1].postedAt) !== day) && (
                <p className="sticky top-0 z-[1] px-4 py-2 text-[14px] font-bold text-c-accent bg-c-surface2 border-b border-c-border">{day}</p>
              )}
              <HistoryRow entry={e} onOpen={() => props.onOpen(e)} onMenu={() => setSheet(e)} />
            </div>
          )
        })
      )}
      {sheet && (
        <ActionSheet
          title={sheet.thread.title}
          onClose={() => setSheet(undefined)}
          items={[
            { label: 'スレを開いて、このレスへ', icon: 'open_in_new', onClick: () => props.onOpen(sheet) },
            { label: '本文をコピー', icon: 'content_copy', onClick: () => void navigator.clipboard.writeText(sheet.body) },
            { label: '履歴から消す(掲示板の書き込みは消えません)', icon: 'delete', danger: true, onClick: () => props.onDelete(sheet.id) },
          ]}
        />
      )}
    </MobilePage>
  )
}

/** スマホ: 書き込み履歴の 1 行。たたくと開き、長押しで操作のメニュー */
function HistoryRow(props: { entry: PostHistoryEntry; onOpen: () => void; onMenu: () => void }) {
  const e = props.entry
  const longPress = useLongPress(props.onMenu)
  return (
    <button type="button" {...longPress} onClick={props.onOpen} className="w-full text-left px-4 py-4 border-b border-c-border active:bg-c-surface2">
      {/* 板・レス番号の札と、書いた時間 */}
      <div className="flex items-center gap-2 text-[13px] text-c-text-muted">
        <span className="px-2 py-0.5 rounded-full bg-c-surface2 border border-c-border text-c-text-body">{boardLabel(e.thread.boardUrl)}</span>
        {e.no !== undefined && <span className="px-2 py-0.5 rounded-full bg-[var(--c-accent-wash)] font-bold text-c-accent tabular-nums">&gt;&gt;{e.no}</span>}
        <span className="ml-auto flex-shrink-0 tabular-nums">{relativeTime(new Date(e.postedAt))}</span>
      </div>
      <p className="mt-2 text-[16px] font-bold leading-snug text-c-text-strong break-words line-clamp-2">{e.thread.title || '(スレタイ不明)'}</p>
      {/* 書いた本文は、引用の形で */}
      <p className="mt-2 pl-3 border-l-[3px] text-[15px] leading-relaxed text-c-text-body whitespace-pre-wrap break-words line-clamp-3" style={{ borderColor: 'var(--c-own)' }}>
        {e.body || '(本文なし)'}
      </p>
      {(e.name || e.mail) && (
        <p className="mt-1.5 text-[12.5px] text-c-text-muted truncate">
          {e.name}
          {e.mail && <span className="ml-1">[{e.mail}]</span>}
        </p>
      )}
    </button>
  )
}
