// レスの操作のメニュー(︙ のボタンと右クリックで共通)。スレの行(ThreadCard)でも使う
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { openSub } from '../utils/toolbar'

export interface MenuItem {
  label: string
  icon: string
  /** 押すと、すぐ下に children を広げる項目では使わない */
  onClick?: () => void
  /** 押すと小項目を広げる(︙ の「NG」) */
  children?: MenuItem[]
  /** 押すと、小項目の代わりにこの中身を出す(表示スタイルなど) */
  submenu?: ReactNode
  disabled?: boolean
  /** アイコンの色と、塗るか(お気に入りに入っている など) */
  iconColor?: string
  iconFill?: boolean
}

export const TOOL_BTN =
  'h-7 min-w-7 px-1.5 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

/** メニューの置き場所(画面の座標) */
export type MenuPos = { top?: number; bottom?: number; left?: number; right?: number }

/** 右クリックした所に開く位置。画面からはみ出す向きなら、反対へ開く */
export function menuPosAt(x: number, y: number): MenuPos {
  const side = x + 264 > window.innerWidth ? { right: window.innerWidth - x } : { left: x }
  return y > window.innerHeight - 300 ? { ...side, bottom: window.innerHeight - y } : { ...side, top: y }
}

/** OS の標準のメニューに任せる右クリックか(入力欄・リンク・画像の上、文字を選んでいるとき。コピーや保存に使うため) */
export function wantsNativeMenu(e: React.MouseEvent): boolean {
  if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable], a[href], img, video')) return true
  return !!window.getSelection()?.toString().trim()
}

/**
 * 操作の一覧のメニュー(︙ のボタンと右クリックで共通)。レスのヘッダー行などははみ出しを隠す設定なので、body の直下に出す
 * (ポップアップの中のレスでも使えるよう、ポップアップより手前に出す)。外を押す・ホイール・Esc で閉じる
 */
export function FloatingMenu(props: { pos: MenuPos; items: MenuItem[]; onClose: () => void; ignore?: React.RefObject<HTMLElement | null> }) {
  const menuRef = useRef<HTMLDivElement>(null)
  /**
   * 開いている小項目までの道。押すとメニューの中身が切り替わる。
   * 名前だけを覚えて、描くたびに今の項目から引き直す(項目ごと覚えると、選んだ印(✓)などが変わらない)
   */
  const [path, setPath] = useState<string[]>([])
  const sub = openSub(props.items, path)
  /** 小項目から戻ったところか(入ってくる向きを逆にする) */
  const [back, setBack] = useState(false)
  const { onClose, ignore } = props
  const depth = useRef(0)
  depth.current = path.length
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !ignore?.current?.contains(t)) onClose()
    }
    const closeOnKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // 小項目を開いていれば、元のメニューへ
      if (depth.current > 0) {
        setBack(true)
        setPath((p) => p.slice(0, -1))
      } else onClose()
    }
    // メニューの上のホイールは、はみ出したメニューのスクロールなので閉じない
    const closeOnWheel = (e: WheelEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('wheel', closeOnWheel, { passive: true })
    window.addEventListener('keydown', closeOnKey, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('wheel', closeOnWheel)
      window.removeEventListener('keydown', closeOnKey, true)
    }
  }, [onClose, ignore])
  const { pos } = props
  const menuRow = (x: MenuItem) => (
    <button
      key={x.label}
      type="button"
      disabled={x.disabled}
      onClick={() => {
        if (x.children || x.submenu) {
          setBack(false)
          return setPath((p) => [...p, x.label])
        }
        // 閉じてから実行する(実行した先で開く画面が、メニューの外を押した扱いにならないように)
        onClose()
        x.onClick?.()
      }}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-c-text-body hover:bg-c-surface2 disabled:opacity-40 transition-colors"
    >
      <span className={`material-symbols-outlined text-base ${x.iconFill ? 'fill' : ''}`} style={x.iconColor ? { color: x.iconColor } : undefined}>
        {x.icon}
      </span>
      <span className="flex-1 text-left">{x.label}</span>
      {(x.children || x.submenu) && <span className="material-symbols-outlined text-base text-c-text-muted">chevron_right</span>}
    </button>
  )
  return createPortal(
    <div
      ref={menuRef}
      className="fixed w-64 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-[9800] text-sm overflow-y-auto overflow-x-hidden"
      // 小項目を広げても画面からはみ出さないように
      style={{ ...pos, maxHeight: window.innerHeight - (pos.top ?? pos.bottom ?? 0) - 8 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {sub ? (
        <div key={sub.label} className={back ? 'menu-page-back' : 'menu-page-in'}>
          <button
            type="button"
            onClick={() => {
              setBack(true)
              setPath((p) => p.slice(0, -1))
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-c-border font-bold text-c-text-strong hover:bg-c-surface2 transition-colors"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            {sub.label}
          </button>
          {sub.children ? sub.children.map(menuRow) : sub.submenu}
        </div>
      ) : (
        <div key="root" className={back ? 'menu-page-back' : undefined}>
          {props.items.map(menuRow)}
        </div>
      )}
    </div>,
    document.body,
  )
}

/** 押すとメニューを出すボタン。メニューはボタンの位置から場所を決める */
export function MenuButton(props: { icon: string; title: string; items: MenuItem[]; onOpenChange: (open: boolean) => void; hoverClass?: string }) {
  const [pos, setPos] = useState<MenuPos>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { onOpenChange } = props
  useEffect(() => {
    onOpenChange(pos !== undefined)
  }, [pos, onOpenChange])
  const close = useCallback(() => setPos(undefined), [])

  const toggle = () => {
    if (pos) return setPos(undefined)
    const rect = buttonRef.current!.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    // 下に入りきらなければ上に開く
    const below = window.innerHeight - rect.bottom
    setPos(below < 300 ? { bottom: window.innerHeight - rect.top + 4, right } : { top: rect.bottom + 4, right })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className={`${TOOL_BTN} ${props.hoverClass ?? ''} ${pos ? 'text-c-text-strong bg-c-surface3' : ''}`}
        title={props.title}
      >
        <span className="material-symbols-outlined text-lg leading-none">{props.icon}</span>
      </button>
      {pos && <FloatingMenu pos={pos} items={props.items} onClose={close} ignore={buttonRef} />}
    </>
  )
}
