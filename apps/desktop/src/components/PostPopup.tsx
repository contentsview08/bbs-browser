// アンカー・返信・ID のポップアップ。
// ポップアップの中のアンカーを辿ると、上に積み重なっていく。

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isMobile } from '../utils/platform'

export interface PopupEntry {
  id: number
  title: string
  /** 開くきっかけになった要素の上端(画面座標)。これより上に出せるなら上に出す */
  triggerY: number
  /** 何段目から開いたか(0 は本文から)。ホバーで開いたものは、別の場所に乗せ替えると閉じる */
  level: number
  content: ReactNode
  /** 開いたときに見せたいレス(アンカーツリーの起点、ID のレスを開いたレス)。そこまで中をスクロールし、選んだ状態にする */
  focusNo?: number
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

  // ポップアップの上のホイールは、ポップアップの中だけで使う。中がスクロールできない(短い)ときや、端まで来たときに、
  // 後ろのスレ表示までスクロールしてしまわないよう止める(React のホイールは止められない受け取り方なので、直接受ける)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      const canScroll = box.scrollHeight > box.clientHeight + 1
      const atTop = box.scrollTop <= 0
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1
      if (!canScroll || (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) e.preventDefault()
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  // 見せたいレスがあれば、出したあとに 1 回だけ、そのレスが真ん中あたりに来るよう中をスクロールし、選んだ状態にする
  // (長いアンカーツリーで、起点のレスが下に隠れないように。選んだ状態にしておくと、J・K がそこから続く)
  const focused = useRef(false)
  useLayoutEffect(() => {
    const box = ref.current
    if (focused.current || !box || style.visibility !== 'visible' || entry.focusNo === undefined) return
    focused.current = true
    const post = box.querySelector<HTMLElement>(`article[data-no="${entry.focusNo}"]`)
    if (!post) return
    post.classList.add('popup-cursor')
    const r = post.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    box.scrollTop += r.top - b.top - Math.max(0, (b.height - r.height) / 2)
  }, [style, entry.focusNo])

  return (
    <div
      ref={ref}
      data-popup-top={props.isTop || undefined}
      data-index={props.stackIndex}
      // 一番上(操作が届く)だけ太い枠。背景が本文と同じ色なので、枠がないとどこまでがポップアップか分からない。
      // 色は差し色にしない(元のレスの下線が差し色なので、同じ色だと見分けにくい)。下に重なっているものは細い枠のまま。影は本文の上で浮いて見えるよう濃くする
      className={`post-popup ${props.isTop ? 'border-[3px]' : 'border'} rounded-lg custom-scrollbar ${style.visibility === 'visible' ? 'rise-in' : ''}`}
      style={{ ...style, borderColor: props.isTop ? 'var(--c-text-strong)' : 'var(--c-border-strong)', boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)' }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onMouseEnter={props.onEnter}
    >
      {/* 見出し(「n 件の返信」と閉じるボタン)。スマホは出さない(外を押すか、戻るボタンで閉じる。狭い画面では中身を広く) */}
      {!isMobile && (
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
      )}
      <div className="p-3">{entry.content}</div>
    </div>
  )
}

/** 点がどれかのポップアップの上か(下の段のポップアップは pointer-events: none なので、イベントの的では分からない) */
function overPopup(x: number, y: number): boolean {
  return popupIndexAt(x, y) !== undefined
}

/** 点の下にあるポップアップのうち、いちばん上の段(data-index)。どのポップアップの上でもなければ undefined */
function popupIndexAt(x: number, y: number): number | undefined {
  let found: number | undefined
  for (const el of document.querySelectorAll<HTMLElement>('.post-popup')) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const i = Number(el.dataset.index)
      if (found === undefined || i > found) found = i
    }
  }
  return found
}

export default function PostPopup(props: Props) {
  const down = useRef(false)
  if (props.popups.length === 0) return null
  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: 9000 }}
      // 一番上の外を押したら閉じる。ただし、中で押し始めて外で離した・文字を選んでいるときは閉じない。
      // 下の段のポップアップの上を押したときは、その段より上をまとめて閉じる(その段が一番上になる)。
      onMouseDown={(e) => (down.current = e.target === e.currentTarget)}
      onClick={(e) => {
        const wasDown = down.current
        down.current = false
        if (e.target !== e.currentTarget || !wasDown) return
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) return
        const under = popupIndexAt(e.clientX, e.clientY)
        if (under !== undefined && under < props.popups.length - 1) props.onCloseAt(under + 1)
        else props.onCloseTop()
      }}
      // 外でホイールを回したら全部閉じる(後ろのスレを読みに戻る)。ポップアップの上(下の段も)では閉じない
      onWheel={(e) => {
        if (!overPopup(e.clientX, e.clientY)) props.onCloseAll()
      }}
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
