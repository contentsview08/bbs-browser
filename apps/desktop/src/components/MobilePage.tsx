// スマホ: 一覧を出す全画面のページ(書き込み履歴・アップロード履歴)。
// 上の帯に ←・題・件数・虫めがね(押すと題の所が検索の欄になる)。戻る(ボタン・ジェスチャー)で、検索中なら検索を、そうでなければページを閉じる
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { MOBILE_HEAD_BTN, MOBILE_HEAD_ICON } from './ActionBar'

export { dayLabel } from '../utils/thread'

export default function MobilePage(props: {
  title: string
  count?: number
  onClose: () => void
  /** 検索できるページなら、言葉が変わったときに呼ぶ */
  onQuery?: (q: string) => void
  placeholder?: string
  /** 題の下に出す説明(1〜2 行) */
  note?: ReactNode
  children: ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const setQ = (q: string) => {
    setQuery(q)
    props.onQuery?.(q)
  }
  // 戻る: 検索中なら検索を閉じる(言葉も消す)。そうでなければページを閉じる
  useFocusTrap(boxRef, () => {
    if (searching) {
      setSearching(false)
      setQ('')
    } else props.onClose()
  })
  return createPortal(
    <div
      ref={boxRef}
      className="fixed inset-0 z-[9300] flex flex-col bg-panel-view reply-slide"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex-shrink-0 flex items-center gap-1 px-1 border-b border-c-border bg-panel-thread-header" style={{ height: 'var(--header-height, 72px)' }}>
        <button type="button" onClick={props.onClose} className={MOBILE_HEAD_BTN} title="戻る">
          <span className={`material-symbols-outlined ${MOBILE_HEAD_ICON}`}>arrow_back</span>
        </button>
        {searching ? (
          <input
            data-search
            type="text"
            value={query}
            onChange={(e) => setQ(e.target.value)}
            placeholder={props.placeholder ?? '絞り込む'}
            autoFocus
            className="flex-1 min-w-0 h-10 bg-c-surface border border-c-border rounded-xl px-3 text-[15px] text-c-text-body placeholder-c-text-muted focus:outline-none focus:ring-0"
          />
        ) : (
          <h2 className="flex-1 min-w-0 truncate text-base font-bold text-c-text-strong">
            {props.title}
            {props.count !== undefined && <span className="ml-2 text-sm font-normal text-c-text-muted tabular-nums">{props.count}</span>}
          </h2>
        )}
        {props.onQuery && (
          <button
            type="button"
            onClick={() => {
              if (searching) setQ('')
              setSearching((v) => !v)
            }}
            className={MOBILE_HEAD_BTN}
            title={searching ? '絞り込みをやめる' : '絞り込む'}
          >
            <span className={`material-symbols-outlined ${MOBILE_HEAD_ICON}`}>{searching ? 'close' : 'search'}</span>
          </button>
        )}
      </div>
      {props.note && <p className="flex-shrink-0 px-4 py-2.5 text-xs leading-relaxed text-c-text-muted border-b border-c-border">{props.note}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">{props.children}</div>
    </div>,
    document.body,
  )
}
