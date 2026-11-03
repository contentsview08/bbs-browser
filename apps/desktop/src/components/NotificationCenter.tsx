// 通知センター: 溜めた知らせ(あなた宛てのレス・お気に入りの新着など)を見るポップアップ。
// 右下に出てすぐ消える知らせ(Notifications.tsx)のうち、あとで見たいもの(keep)をここに残す。開いたら全部既読にする。
// 見るだけの画面なので、外を押しても閉じる(design.md 2.3)
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { BTN_SECONDARY, DialogHeader } from './DialogParts'
import type { StoredNotification } from '../ui/settings'
import { relativeTime } from '../utils/thread'
import { isMobile } from '../utils/platform'

const ERROR_ICONS = new Set(['error', 'warning', 'report'])

/** 溜めた知らせの一覧(PC はスレ一覧の所に、スマホは下のポップアップの中に) */
export function NotificationList(props: { items: StoredNotification[]; onOpen: (n: StoredNotification) => void; onClear: () => void }) {
  const items = [...props.items].reverse()
  if (items.length === 0) return <p className="p-6 text-sm text-c-text-muted text-center">まだありません</p>
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-c-text-muted border-b border-c-border">
        <span className="flex-1">あなた宛てのレス・お気に入りの新着({items.length} 件)</span>
        <button type="button" className={BTN_SECONDARY} onClick={props.onClear}>
          すべて消す
        </button>
      </div>
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => props.onOpen(n)}
          className="w-full flex items-start gap-3 px-4 py-3 text-left border-b border-c-border hover:bg-c-surface2 transition-colors"
        >
          <span className="relative flex-shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-xl" style={{ color: ERROR_ICONS.has(n.icon) ? 'var(--c-error)' : 'var(--c-unread)' }}>
              {n.icon}
            </span>
            {!n.read && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style={{ background: 'var(--c-unread)' }} />}
          </span>
          <span className="flex-1 min-w-0">
            <span className={`block text-sm truncate ${n.read ? 'text-c-text-body' : 'font-bold text-c-text-strong'}`}>{n.title}</span>
            {n.body && <span className="block mt-0.5 text-xs text-c-text-body line-clamp-2 whitespace-pre-wrap break-words">{n.body}</span>}
          </span>
          <span className="flex-shrink-0 text-[11px] text-c-text-muted tabular-nums">{relativeTime(new Date(n.at))}</span>
        </button>
      ))}
    </div>
  )
}

/** スマホ: 下から出るポップアップ(PC はスレ一覧の所に NotificationList を出す) */
export default function NotificationCenter(props: {
  items: StoredNotification[]
  onOpen: (n: StoredNotification) => void
  /** 全部を既読にする(開いたときに呼ぶ) */
  onReadAll: () => void
  onClear: () => void
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)
  const readAll = useRef(props.onReadAll)
  readAll.current = props.onReadAll
  // 開いたら既読に(閉じるときではなく。開いている間に新しく来たものは、次に開いたとき)
  useEffect(() => {
    if (props.items.some((n) => !n.read)) readAll.current()
    // 開いたとき 1 回
  }, [])
  return createPortal(
    <div className={`fixed inset-0 z-[9900] flex ${isMobile ? 'items-end' : 'items-center justify-center p-6'}`} {...backdrop}>
      <div
        ref={boxRef}
        className={`flex flex-col bg-c-surface shadow-xl ${isMobile ? 'w-full max-h-[85vh] rounded-t-3xl sheet-rise' : 'w-[30rem] max-h-[80vh] border border-c-border rounded-2xl rise-in'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="通知" onClose={props.onClose} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <NotificationList items={props.items} onOpen={props.onOpen} onClear={props.onClear} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
