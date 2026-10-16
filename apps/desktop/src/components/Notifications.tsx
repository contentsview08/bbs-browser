// アプリ内の通知。画面の右下に、右からすべり込んで出し、しばらくしたら消す(マウスを乗せている間は消さない)

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface AppNotification {
  id: number
  icon: string
  title: string
  body?: string
  onClick?: () => void
}

/** 出しておく時間 */
const SHOW_MS = 6000

function Toast({ n, onClose }: { n: AppNotification; onClose: () => void }) {
  const [hover, setHover] = useState(false)
  // 親が描き直されるたびに onClose は作り直されるので、控えを通して呼ぶ(タイマーを数え直さないように)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (hover) return
    const timer = setTimeout(() => close.current(), SHOW_MS)
    return () => clearTimeout(timer)
  }, [hover])

  return (
    <div
      className="toast-in pointer-events-auto w-80 flex items-start gap-3 px-4 py-3 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl cursor-pointer hover:border-c-accent transition-colors"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        n.onClick?.()
        onClose()
      }}
    >
      <span className="material-symbols-outlined text-xl" style={{ color: 'var(--c-accent-self)' }}>
        {n.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-c-text-strong truncate">{n.title}</p>
        {n.body && <p className="mt-0.5 text-xs text-c-text-body line-clamp-3 whitespace-pre-wrap break-words">{n.body}</p>}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="flex-shrink-0 p-0.5 rounded-full text-c-text-muted hover:text-c-text-strong"
        title="閉じる"
      >
        <span className="material-symbols-outlined text-base leading-none">close</span>
      </button>
    </div>
  )
}

export default function Notifications({ items, onClose }: { items: AppNotification[]; onClose: (id: number) => void }) {
  if (items.length === 0) return null
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[9950] flex flex-col items-end gap-2 pointer-events-none">
      {items.map((n) => (
        <Toast key={n.id} n={n} onClose={() => onClose(n.id)} />
      ))}
    </div>,
    document.body,
  )
}
