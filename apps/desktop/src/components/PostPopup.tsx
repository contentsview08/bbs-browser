// アンカー・返信・ID のポップアップ。web 版の PostPopup.tsx の見た目と位置決めを移植。
// ポップアップの中のアンカーを辿ると、上に積み重なっていく。

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopupEntry {
  id: number
  title: string
  /** 開くきっかけになった要素の上端(画面座標)。これより上に出せるなら上に出す */
  triggerY: number
  /** 何段目から開いたか(0 は本文から)。ホバーで開いたものは、別の場所に乗せ替えると閉じる */
  level: number
  content: ReactNode
}

interface Props {
  popups: PopupEntry[]
  /** スレ表示の領域。ポップアップの幅と上下の限界に使う */
  containerRect?: DOMRect
  /** スレ表示のヘッダーの下端。これより上には出さない */
  headerBottom: number
  onCloseTop: () => void
  onCloseAll: () => void
  /** 見出しの × を押した。そのポップアップ(と、その上に重なっているもの)を閉じる */
  onCloseAt: (index: number) => void
  /** ポップアップの外(背面の幕の上)でマウスが動いた。ホバーで開いたものを閉じる判断に使う */
  onOverlayMove?: (x: number, y: number) => void
  onPopupEnter?: () => void
}

function PopupWindow(props: {
  entry: PopupEntry
  stackIndex: number
  isTop: boolean
  containerRect?: DOMRect
  headerBottom: number
  onEnter?: () => void
  onClose: () => void
}) {
  const { entry, containerRect } = props
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // スレ表示の領域とぴったり同じ幅にする
    const left = containerRect ? containerRect.left : 32
    const width = containerRect ? containerRect.width : Math.min(640, window.innerWidth - 64)
    const minTop = Math.max(props.headerBottom, containerRect?.top ?? 0) + 4
    const maxBottom = containerRect?.bottom ?? window.innerHeight
    const spaceAbove = entry.triggerY - minTop - 4
    // 重なっても外側を押して閉じられるよう、スレ表示の高さの 8 割までにする
    const limit = (maxBottom - minTop) * 0.8
    const height = Math.min(el.scrollHeight, limit)
    // 上に収まるなら開いた場所の真上に、収まらなければヘッダーのすぐ下から出す
    const fitsAbove = height <= spaceAbove
    setStyle({
      position: 'fixed',
      visibility: 'visible',
      left,
      width,
      top: fitsAbove ? entry.triggerY - height - 4 : minTop,
      maxHeight: fitsAbove ? Math.min(spaceAbove, limit) : limit,
      overflowY: 'auto',
      zIndex: 9001 + props.stackIndex,
      opacity: props.isTop ? 1 : 0.97,
      // 一番上以外は押せないようにする。下のポップアップの上を押しても、背面の幕に届いて一番上だけが閉じる
      // (押せるままだと、下のポップアップの中のアンカーなどが反応して、新しいポップアップが開いてしまう)
      pointerEvents: props.isTop ? 'auto' : 'none',
    })
  }, [entry, containerRect, props.headerBottom, props.stackIndex, props.isTop])

  return (
    <div
      ref={ref}
      data-popup-top={props.isTop || undefined}
      className={`bg-c-surface border-2 rounded-xl shadow-2xl custom-scrollbar ${style.visibility === 'visible' ? 'rise-in' : ''}`}
      style={{ ...style, borderColor: 'var(--c-accent)' }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onMouseEnter={props.onEnter}
    >
      <div className="flex items-center gap-2 pl-4 pr-2 py-1.5 border-b border-c-border sticky top-0 bg-c-surface z-10">
        <span className="flex-1 min-w-0 truncate text-sm font-bold text-c-text-strong">{entry.title}</span>
        <button
          type="button"
          onClick={props.onClose}
          className="flex-shrink-0 p-1 rounded-full text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2"
          title="このポップアップを閉じる"
        >
          <span className="material-symbols-outlined text-lg leading-none">close</span>
        </button>
      </div>
      <div className="p-3">{entry.content}</div>
    </div>
  )
}

export default function PostPopup(props: Props) {
  if (props.popups.length === 0) return null
  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: 9000 }}
      onClick={props.onCloseTop}
      onWheel={props.onCloseAll}
      onMouseMove={(e) => {
        if (e.target === e.currentTarget) props.onOverlayMove?.(e.clientX, e.clientY)
      }}
    >
      {props.popups.map((entry, i) => (
        <PopupWindow
          key={entry.id}
          entry={entry}
          stackIndex={i}
          isTop={i === props.popups.length - 1}
          containerRect={props.containerRect}
          headerBottom={props.headerBottom}
          onEnter={props.onPopupEnter}
          onClose={() => props.onCloseAt(i)}
        />
      ))}
    </div>,
    document.body,
  )
}
