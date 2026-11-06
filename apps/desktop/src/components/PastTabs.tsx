// 「履歴」の切り替え(未読・閲覧・お気に入り・書き込み・画像)。スマホのアプリの過去のスレの画面と同じ並び。
// スレ一覧のヘッダーの下に置き、スマホではヘッダーと一緒にスクロールで隠れる

import { isMobile } from '../utils/platform'

export type PastTab = 'unread' | 'history' | 'fav' | 'posts' | 'uploads'

export const PAST_TAB_LABEL: Record<PastTab, string> = { unread: '未読', history: '閲覧', fav: 'お気に入り', posts: '書き込み', uploads: '画像' }

export default function PastTabs(props: { current: PastTab; unreadCount: number; favCount: number; onPick: (k: PastTab) => void }) {
  const tabs: { key: PastTab; count?: number; unread?: boolean }[] = [
    { key: 'unread', count: props.unreadCount, unread: true },
    { key: 'history' },
    { key: 'fav', count: props.favCount },
    { key: 'posts' },
    { key: 'uploads' },
  ]
  // PC: 文字と下線のタブ
  if (!isMobile)
    return (
      <div className="flex items-stretch px-4 border-b border-c-border text-sm font-medium">
        {tabs.map((t) => {
          const on = t.key === props.current
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => !on && props.onPick(t.key)}
              className={`relative flex-1 flex items-center justify-center gap-1 py-2 whitespace-nowrap transition-colors ${on ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
            >
              {PAST_TAB_LABEL[t.key]}
              {!!t.count && (
                <span className="text-[11px] font-bold tabular-nums" style={{ color: t.unread ? 'var(--c-unread)' : 'var(--c-text-muted)' }}>
                  {t.count > 999 ? '999+' : t.count}
                </span>
              )}
              {on && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent" />}
            </button>
          )
        })}
      </div>
    )
  return (
    <div className="flex gap-1.5 px-2.5 pb-2 pt-0.5">
      {tabs.map((t) => {
        const on = t.key === props.current
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => !on && props.onPick(t.key)}
            className="flex-1 min-w-0 flex items-center justify-center gap-0.5 py-1.5 rounded-full text-[13px] whitespace-nowrap"
            style={{
              background: on ? 'var(--c-accent-wash)' : 'var(--c-surface2)',
              border: `1px solid ${on ? 'var(--c-accent)' : 'transparent'}`,
              color: on ? 'var(--c-accent)' : 'var(--c-text-body)',
              fontWeight: on ? 700 : 400,
            }}
          >
            {PAST_TAB_LABEL[t.key]}
            {!!t.count && (
              <span className="text-[11px] font-bold" style={{ color: t.unread ? 'var(--c-unread)' : 'var(--c-text-muted)' }}>
                {t.count > 999 ? '999+' : t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
