// ヘッダーとフッターに並べる操作ボタンと、右端の ︙ のメニュー(スレ表示とスレ一覧で共通)。
// どこに置くかは設定(utils/toolbar.ts)で決まる。︙ の中には、置き場所に関係なくすべての操作を並べる

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Placement } from '../utils/toolbar'
import { isMobile, uiLabel } from '../utils/platform'
import ActionSheet from './ActionSheet'

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
  /** 意味の色(乗せたとき・︙ の中のアイコン)。お気に入りは金、削除は赤 など */
  tint?: string
  disabled?: boolean
  /** 帯に置くときの見た目を自分で描く(更新ボタンの残り秒数、テーマのメニューなど) */
  render?: (where: 'header' | 'footer') => ReactNode
  /** ︙ の中で押したときに、メニューの中に出す中身(テーマの選び方など)。なければ onClick を呼んで閉じる */
  submenu?: ReactNode
}

/** スマホのヘッダーのボタン(メニュー・検索・︙)。押しやすいよう、縦と横を同じにした 44px の正方形 */
export const MOBILE_HEAD_BTN = 'flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-c-text-muted active:bg-c-surface2 transition-colors'
export const MOBILE_HEAD_ICON = 'text-[26px]'

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
              className={`${props.btnClass} ${a.tint ? 'tint-hover' : ''} disabled:opacity-40`}
              style={{ ...(a.tint && ({ '--tint': a.tint } as CSSProperties)), ...(a.active && { color: a.activeColor ?? 'var(--c-accent)' }) }}
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
  // スマホは、下からせり上がるシート(長押しのメニューと同じ)。中に一覧を持つ項目は、シートの中で開く
  if (isMobile) return <MobileMoreMenu {...props} />
  return <DesktopMoreMenu {...props} />
}

/** スマホの ︙ のまとまり(まとまりが変わる所に線を引く) */
const MENU_GROUP: Record<string, string> = {
  favorite: 'スレ',
  newThread: 'スレ',
  findNext: 'スレ',
  gallery: 'スレ',
  search: 'スレ',
  refresh: 'スレ',
  top: '移動',
  bottom: '移動',
  openBoard: '移動',
  style: '見た目',
  fontSize: '見た目',
  copyUrl: '共有',
  openBrowser: '共有',
  delete: '削除',
}
const GROUP_ORDER = ['スレ', '移動', '見た目', '共有', 'その他', '削除']
/** スマホでの名前(PC の名前は、キー操作や画面の分け方を前提にしたものがあるので) */
const MOBILE_LABELS: Record<string, (a: BarAction) => string> = {
  openBoard: () => '板を開く',
  search: (a) => (a.label.includes('スレッド') ? 'スレを検索' : 'スレの中を検索'),
  top: () => 'いちばん上へ',
  bottom: () => 'いちばん下へ',
  gallery: () => 'このスレの画像一覧',
  refresh: (a) => (a.label.includes('一覧') ? 'スレ一覧を更新' : '更新'),
  delete: () => 'ログを削除して閉じる',
}

function MobileMoreMenu(props: { actions: BarAction[]; btnClass: string; iconClass: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={props.btnClass} style={open ? { color: 'var(--c-accent)' } : undefined} title="操作">
        <span className={`material-symbols-outlined ${props.iconClass}`}>more_vert</span>
      </button>
      {open && (
        <ActionSheet
          onClose={() => setOpen(false)}
          items={props.actions
            .map((a) => ({
              label: MOBILE_LABELS[a.id]?.(a) ?? a.label,
              icon: a.icon,
              onClick: a.onClick,
              submenu: a.submenu,
              disabled: a.disabled,
              active: a.active && a.fillWhenActive,
              // 色は、選んでいる状態(お気に入りの金色など)のときだけ。ほかは落ち着いた色にそろえる
              tint: a.active && a.fillWhenActive ? a.activeColor : undefined,
              danger: a.tint === 'var(--c-mark-danger)',
              group: MENU_GROUP[a.id] ?? 'その他',
            }))
            // まとまりの順に並べる(まとまりの中は、設定で決めた並びのまま)
            .sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group))}
        />
      )}
    </>
  )
}

function DesktopMoreMenu(props: { actions: BarAction[]; btnClass: string; iconClass: string; up?: boolean }) {
  const [open, setOpen] = useState(false)
  // ︙ の中で開いている、操作の中身(テーマの選び方など)。
  // 操作そのものを控えると、押した時点の中身(選ばれている印など)のまま変わらなくなるので、id だけ控えて毎回いまの操作から引く
  const [subId, setSubId] = useState<string>()
  const sub = subId === undefined ? undefined : props.actions.find((a) => a.id === subId)
  const setSub = (a: BarAction | undefined) => setSubId(a?.id)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
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
          // スマホは、ほかの画面(下から出るメニューなど)に合わせて、字と行を大きく
          className={`absolute right-0 ${props.up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${isMobile ? 'w-72 rounded-2xl py-2 text-[15px]' : 'w-64 rounded-[var(--card-radius)] py-1 text-sm'} bg-c-surface border border-c-border shadow-xl z-40 max-h-[70vh] overflow-y-auto`}
        >
          {sub ? (
            <>
              <button
                type="button"
                onClick={() => setSub(undefined)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-c-text-muted hover:text-c-text-strong"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                {uiLabel(sub.label)}
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
                className={`w-full flex items-center gap-3 ${isMobile ? 'px-4 py-3' : 'px-3 py-2'} text-left text-c-text-body hover:bg-c-surface2 active:bg-c-surface2 disabled:opacity-40 transition-colors`}
              >
                <span
                  className={`material-symbols-outlined text-lg ${a.active && a.fillWhenActive ? 'fill' : ''}`}
                  style={{ color: a.active ? (a.activeColor ?? 'var(--c-accent)') : (a.tint ?? 'var(--c-text-muted)') }}
                >
                  {a.icon}
                </span>
                <span className="flex-1">{uiLabel(a.label)}</span>
                {a.submenu && <span className="material-symbols-outlined text-base text-c-text-muted">chevron_right</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
