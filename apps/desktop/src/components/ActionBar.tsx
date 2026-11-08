// ヘッダーとフッターに並べる操作ボタンと、右端の ︙ のメニュー(スレ表示とスレ一覧で共通)。
// どこに置くかは設定(utils/toolbar.ts)で決まる。︙ の中には、置き場所に関係なくすべての操作を並べる

import { useCallback, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { foldMenuActions, type BarArea, type Placement } from '../utils/toolbar'
import { isMobile, uiLabel } from '../utils/platform'
import ActionSheet, { type SheetItem } from './ActionSheet'
import { FloatingMenu, menuPosAt, wantsNativeMenu, type MenuItem, type MenuPos } from './PostMenu'

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
  render?: (where: Placement) => ReactNode
  /** ︙ の中で押したときに、メニューの中に出す中身(テーマの選び方など)。なければ onClick を呼んで閉じる */
  submenu?: ReactNode
  /** 押すと、メニューの中にこの小項目を出す */
  children?: BarAction[]
}

/** ︙ の一覧を大項目と小項目に分ける */
const foldActions = (area: BarArea, actions: BarAction[]) =>
  foldMenuActions(area, actions, (f, members): BarAction => ({ id: f.id, label: f.label, icon: f.icon, children: members }))

/** スマホのヘッダーのボタン(メニュー・検索・︙)。押しやすいよう、縦と横を同じにした 44px の正方形 */
export const MOBILE_HEAD_BTN = 'flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-c-text-muted active:bg-c-surface2 transition-colors'
export const MOBILE_HEAD_ICON = 'text-[26px]'

/** 置き場所が where の操作を、帯のボタンとして並べる */
export function ActionButtons(props: {
  actions: BarAction[]
  placements: Record<string, Placement>
  where: Placement
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
export function MoreMenu(props: { area: BarArea; actions: BarAction[]; btnClass: string; iconClass: string; up?: boolean }) {
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
  autoScroll: '移動',
  top: '移動',
  bottom: '移動',
  openBoard: '移動',
  style: '見た目',
  fontSize: '見た目',
  copyMenu: '共有',
  copyUrl: '共有',
  share: '共有',
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

function sheetItemOf(a: BarAction): SheetItem {
  return {
    label: MOBILE_LABELS[a.id]?.(a) ?? a.label,
    icon: a.icon,
    onClick: a.onClick,
    submenu: a.submenu,
    children: a.children?.map(sheetItemOf),
    disabled: a.disabled,
    active: a.active && a.fillWhenActive,
    // 色は、選んでいる状態(お気に入りの金色など)のときだけ。ほかは落ち着いた色にそろえる
    tint: a.active && a.fillWhenActive ? a.activeColor : undefined,
    danger: a.tint === 'var(--c-mark-danger)',
    group: MENU_GROUP[a.id] ?? 'その他',
  }
}

function MobileMoreMenu(props: { area: BarArea; actions: BarAction[]; btnClass: string; iconClass: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={props.btnClass} style={open ? { color: 'var(--c-accent)' } : undefined} title="操作">
        <span className={`material-symbols-outlined ${props.iconClass}`}>more_vert</span>
      </button>
      {open && (
        <ActionSheet
          onClose={() => setOpen(false)}
          items={foldActions(props.area, props.actions)
            .map(sheetItemOf)
            // まとまりの順に並べる(まとまりの中は、設定で決めた並びのまま)
            .sort((x, y) => GROUP_ORDER.indexOf(x.group!) - GROUP_ORDER.indexOf(y.group!))}
        />
      )}
    </>
  )
}

/** PC の ︙ と右クリックに出す項目 */
function menuItemOf(a: BarAction): MenuItem {
  const danger = a.tint === 'var(--c-mark-danger)'
  return {
    label: uiLabel(a.label),
    icon: a.icon,
    onClick: a.onClick,
    submenu: a.submenu,
    children: a.children?.map(menuItemOf),
    disabled: a.disabled,
    iconColor: a.active ? (a.activeColor ?? 'var(--c-accent)') : danger ? a.tint : 'var(--c-text-muted)',
    iconFill: a.active && a.fillWhenActive,
  }
}

function DesktopMoreMenu(props: { area: BarArea; actions: BarAction[]; btnClass: string; iconClass: string; up?: boolean }) {
  const [pos, setPos] = useState<MenuPos>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setPos(undefined), [])
  const toggle = () => {
    if (pos) return setPos(undefined)
    const rect = buttonRef.current!.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    // 下に入りきらなければ上に開く
    setPos(props.up || window.innerHeight - rect.bottom < 300 ? { bottom: window.innerHeight - rect.top + 6, right } : { top: rect.bottom + 6, right })
  }
  return (
    <div className="relative flex-shrink-0">
      <button ref={buttonRef} type="button" onClick={toggle} className={props.btnClass} style={pos ? { color: 'var(--c-accent)' } : undefined} title="すべての操作">
        <span className={`material-symbols-outlined ${props.iconClass}`}>more_vert</span>
      </button>
      {pos && <FloatingMenu pos={pos} items={foldActions(props.area, props.actions).map(menuItemOf)} onClose={close} ignore={buttonRef} />}
    </div>
  )
}

/** ヘッダーの右クリックで ︙ と同じメニューを出す。onContextMenu をヘッダーに付け、menu をその中に描く */
export function useBarContextMenu(area: BarArea, actions: BarAction[]) {
  const [pos, setPos] = useState<MenuPos>()
  const close = useCallback(() => setPos(undefined), [])
  return {
    onContextMenu: isMobile
      ? undefined
      : (e: MouseEvent) => {
          if (wantsNativeMenu(e)) return
          e.preventDefault()
          setPos(menuPosAt(e.clientX, e.clientY))
        },
    menu: pos && <FloatingMenu pos={pos} items={foldActions(area, actions).map(menuItemOf)} onClose={close} />,
  }
}
