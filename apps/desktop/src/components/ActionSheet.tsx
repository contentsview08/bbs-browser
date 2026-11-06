// スマホ: 下からせり上がる操作の一覧(長押し・︙ で出す)。PC の右上の操作バー・︙ のメニューの代わり。
// 外を押す・戻る(Esc として届く)で閉じる。項目を押したら閉じてから実行する。
// 中に一覧を持つ項目(表示スタイルなど)は、同じシートの中で「← 題」付きの画面に切り替える(戻るで元の一覧へ)。
// 消すなどの危ない項目は、ほかと線で分けて最後に置く
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { uiLabel } from '../utils/platform'
import { openSub } from '../utils/toolbar'

export interface SheetItem {
  label: string
  icon: string
  onClick?: () => void
  danger?: boolean
  /** アイコンの色(お気に入りは金 など) */
  tint?: string
  /** 押した状態(お気に入りに入っている など)。アイコンを塗る */
  active?: boolean
  /** 押すと、シートの中にこの小項目を出す(閉じない) */
  children?: SheetItem[]
  /** 押すと、シートの中にこの中身を出す(閉じない) */
  submenu?: ReactNode
  disabled?: boolean
  /** まとまりの名前。まとまりが変わる所に線を引く */
  group?: string
}

export default function ActionSheet(props: {
  title?: string
  items: SheetItem[]
  onClose: () => void
  /** 重なりの高さ(画像ビューアーの上に出すときなど) */
  zIndex?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  /**
   * 中を開いている項目までの道。名前だけを覚えて、描くたびに今の項目から引き直す
   * (項目ごと覚えると、開いた時点の中身のままになり、選んだ印(✓)などが変わらない)
   */
  const [path, setPath] = useState<string[]>([])
  const sub = openSub(props.items, path)
  /** 小項目から戻ったところか(入ってくる向きを逆にする) */
  const [back, setBack] = useState(false)
  const goBack = () => {
    setBack(true)
    setPath((p) => p.slice(0, -1))
  }
  // 戻る: 中を開いていれば一段上へ、そうでなければ閉じる
  useFocusTrap(boxRef, () => (sub ? goBack() : props.onClose()))
  const backdrop = useBackdropClose(props.onClose)
  const safe = props.items.filter((it) => !it.danger)
  const danger = props.items.filter((it) => it.danger)
  const row = (it: SheetItem, i: number) => (
    <button
      key={`${it.label}:${i}`}
      type="button"
      disabled={it.disabled}
      onClick={() => {
        if (it.submenu || it.children) {
          setBack(false)
          return setPath((p) => [...p, it.label])
        }
        props.onClose()
        it.onClick?.()
      }}
      className={`w-full flex items-center gap-4 px-6 py-3.5 min-h-[52px] text-left text-[15px] active:bg-c-surface2 disabled:opacity-40 ${it.danger ? 'text-c-heat-very-hot' : 'text-c-text-strong'}`}
    >
      <span
        className={`material-symbols-outlined text-[22px] ${it.active ? 'fill' : ''}`}
        style={{ color: it.danger ? undefined : it.active ? (it.tint ?? 'var(--c-accent)') : (it.tint ?? 'var(--c-text-muted)') }}
      >
        {it.icon}
      </span>
      <span className="flex-1 min-w-0 truncate">{uiLabel(it.label)}</span>
      {(it.submenu || it.children) && <span className="material-symbols-outlined text-xl text-c-text-muted">chevron_right</span>}
    </button>
  )
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end drawer-fade" style={{ zIndex: props.zIndex ?? 9600 }} {...backdrop}
      // portal でも React のイベントは親へ届くので、外を押したクリックを後ろの部品(カードなど)へ渡さない
      onClick={(e) => {
        e.stopPropagation()
        backdrop.onClick(e)
      }}
    >
      <div
        ref={boxRef}
        className="w-full max-h-[80vh] flex flex-col bg-c-surface rounded-t-3xl shadow-xl sheet-rise"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-c-border-strong" />
        </div>
        {sub ? (
          <>
            <button type="button" onClick={goBack} className="flex items-center gap-2 px-4 pt-1 pb-2 text-[15px] font-bold text-c-text-strong">
              <span className="material-symbols-outlined text-[22px] text-c-text-muted">arrow_back</span>
              {uiLabel(sub.label)}
            </button>
            <div key={sub.label} className={`flex-1 min-h-0 overflow-y-auto pb-2 ${sub.children ? '' : 'sheet-sub'} ${back ? 'page-back' : 'page-in'}`}>
              {sub.children ? sub.children.map(row) : sub.submenu}
            </div>
          </>
        ) : (
          <>
            {props.title && <p className="px-6 pt-1 pb-2.5 text-[13px] leading-snug text-c-text-muted whitespace-pre-line break-all line-clamp-3">{props.title}</p>}
            <div className={`flex-1 min-h-0 overflow-y-auto pb-1 ${back ? 'page-back' : ''}`}>
              {safe.map((it, i) => (
                <div key={`${it.label}:${i}`}>
                  {i > 0 && it.group !== safe[i - 1].group && <div className="mx-6 my-1 border-t border-c-border" />}
                  {row(it, i)}
                </div>
              ))}
              {danger.length > 0 && safe.length > 0 && <div className="mx-6 my-1 border-t border-c-border" />}
              {danger.map(row)}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
