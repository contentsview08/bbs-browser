// ヘッダーとフッターに並べる操作ボタンと、右端の ︙ のメニュー(スレ表示とスレ一覧で共通)。
// どこに置くかは設定(utils/toolbar.ts)で決まる。︙ の中には、置き場所に関係なくすべての操作を並べる

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Placement } from '../utils/toolbar'

export interface BarAction {
  id: string
  /** ︙ の中の名前と、ボタンの説明 */
  label: string
  icon: string
  onClick?: () => void
  /** 押した状態(検索を開いている、お気に入りに入っている など) */
  active?: boolean
  /** 押した状態のときの色(なければ強調色) */
  activeColor?: string
  /** 押した状態のとき、アイコンを塗る */
  fillWhenActive?: boolean
  disabled?: boolean
  /** 帯に置くときの見た目を自分で描く(更新ボタンの残り秒数、テーマのメニューなど) */
  render?: (where: 'header' | 'footer') => ReactNode
  /** ︙ の中で押したときに、メニューの中に出す中身(テーマの選び方など)。なければ onClick を呼んで閉じる */
  submenu?: ReactNode
}

/** 置き場所が where の操作を、帯のボタンとして並べる */
export function ActionButtons(props: {
  actions: BarAction[]
  placements: Record<string, Placement>
  where: 'header' | 'footer'
  btnClass: string
  iconClass: string
}) {
  return (
    <>
      {props.actions
        .filter((a) => props.placements[a.id] === props.where)
        .map((a) =>
          a.render ? (
            <span key={a.id} className="contents">
              {a.render(props.where)}
            </span>
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled}
              className={`${props.btnClass} disabled:opacity-40`}
              style={a.active ? { color: a.activeColor ?? 'var(--c-accent)' } : undefined}
              title={a.label}
            >
              <span className={`material-symbols-outlined ${props.iconClass} ${a.active && a.fillWhenActive ? 'fill' : ''}`}>{a.icon}</span>
            </button>
          ),
        )}
    </>
  )
}

/** 右端の ︙。押すとすべての操作をメニューで出す。up ならメニューを上に開く(フッターに置いたとき) */
export function MoreMenu(props: { actions: BarAction[]; btnClass: string; iconClass: string; up?: boolean }) {
  const [open, setOpen] = useState(false)
  // ︙ の中で開いている、操作の中身(テーマの選び方など)
  const [sub, setSub] = useState<BarAction>()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setSub(undefined)
          setOpen((v) => !v)
        }}
        className={props.btnClass}
        style={open ? { color: 'var(--c-accent)' } : undefined}
        title="すべての操作"
      >
        <span className={`material-symbols-outlined ${props.iconClass}`}>more_vert</span>
      </button>
      {open && (
        <div
          className={`absolute right-0 ${props.up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} w-64 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-40 text-sm max-h-[70vh] overflow-y-auto`}
        >
          {sub ? (
            <>
              <button
                type="button"
                onClick={() => setSub(undefined)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-c-text-muted hover:text-c-text-strong"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                {sub.label}
              </button>
              {sub.submenu}
            </>
          ) : (
            props.actions.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={a.disabled}
                onClick={() => {
                  if (a.submenu) return setSub(a)
                  setOpen(false)
                  a.onClick?.()
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-left text-c-text-body hover:bg-c-surface2 disabled:opacity-40 transition-colors"
              >
                <span
                  className={`material-symbols-outlined text-lg ${a.active && a.fillWhenActive ? 'fill' : ''}`}
                  style={{ color: a.active ? (a.activeColor ?? 'var(--c-accent)') : 'var(--c-text-muted)' }}
                >
                  {a.icon}
                </span>
                <span className="flex-1">{a.label}</span>
                {a.submenu && <span className="material-symbols-outlined text-base text-c-text-muted">chevron_right</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
