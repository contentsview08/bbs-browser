// 「履歴」の切り替え(未読・閲覧・お気に入り・書き込み・画像)。スマホのアプリの過去のスレの画面と同じ並び。
// スレ一覧のヘッダーの下かフッターの上に置き(設定の pastTabsPosition)、スマホではその帯と一緒にスクロールで隠れる

import { isMobile } from '../utils/platform'

export type PastTab = 'unread' | 'history' | 'fav' | 'posts' | 'uploads'

export const PAST_TAB_LABEL: Record<PastTab, string> = { unread: '未読', history: '閲覧', fav: 'お気に入り', posts: '書き込み', uploads: '画像' }

/** 設定の並び順の部品に渡す定義 */
export const PAST_TABS: { key: PastTab; name: string; icon: string }[] = [
  { key: 'unread', name: PAST_TAB_LABEL.unread, icon: 'mark_email_unread' },
  { key: 'history', name: PAST_TAB_LABEL.history, icon: 'history' },
  { key: 'fav', name: PAST_TAB_LABEL.fav, icon: 'star' },
  { key: 'posts', name: PAST_TAB_LABEL.posts, icon: 'edit_note' },
  { key: 'uploads', name: PAST_TAB_LABEL.uploads, icon: 'image' },
]

/** 保存した並びのうち、いま出せるタブ。1 つも残らなければ全部を出す(履歴の画面からタブが消えないように) */
export function shownPastTabs(saved: readonly string[] | undefined): PastTab[] {
  const known = PAST_TABS.map((t) => t.key)
  const list = [...new Set(saved ?? [])].filter((k): k is PastTab => (known as string[]).includes(k))
  return list.length ? list : known
}

export default function PastTabs(props: { current: PastTab; unreadCount: number; favCount: number; onPick: (k: PastTab) => void; order?: readonly string[]; footer?: boolean }) {
  const countOf = (k: PastTab) => (k === 'unread' ? props.unreadCount : k === 'fav' ? props.favCount : undefined)
  const tabs = shownPastTabs(props.order).map((key) => ({ key, count: countOf(key), unread: key === 'unread' }))
  return (
    <div className={`flex items-stretch overflow-x-auto font-medium ${isMobile ? 'text-[14px]' : 'px-4 border-b border-c-border text-sm'}`}>
      {tabs.map((t) => {
        const on = t.key === props.current
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => !on && props.onPick(t.key)}
            className={`relative flex-1 flex-shrink-0 flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${isMobile ? 'min-h-[44px] px-2.5' : 'py-2'} ${on ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
            style={on && isMobile ? { background: 'var(--c-accent-wash)' } : undefined}
          >
            {PAST_TAB_LABEL[t.key]}
            {!!t.count && (
              <span className="text-[11px] font-bold tabular-nums" style={{ color: t.unread ? 'var(--c-unread)' : 'var(--c-text-muted)' }}>
                {t.count > 999 ? '999+' : t.count}
              </span>
            )}
            {/* 選んでいる印の線は本文の側に引く */}
            {on && <span className={`absolute left-0 right-0 h-[2px] bg-c-accent ${props.footer ? 'top-0' : 'bottom-0'}`} />}
          </button>
        )
      })}
    </div>
  )
}
