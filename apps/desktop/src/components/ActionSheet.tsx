// スマホ: 下からせり上がる操作の一覧(長押しで出す)。PC の右上の操作バー・︙ のメニューの代わり。
// 外を押す・キャンセル・戻るボタン(Esc として届く)で閉じる。項目を押したら閉じてから実行する
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { uiLabel } from '../utils/platform'

export interface SheetItem {
  label: string
  icon: string
  onClick: () => void
  danger?: boolean
}

export default function ActionSheet(props: { title?: string; items: SheetItem[]; onClose: () => void; /** 重なりの高さ(画像ビューアーの上に出すときなど) */ zIndex?: number }) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end drawer-fade" style={{ zIndex: props.zIndex ?? 9600 }} onClick={props.onClose}>
      <div
        ref={boxRef}
        className="w-full max-h-[75vh] flex flex-col bg-c-surface rounded-t-2xl shadow-2xl sheet-rise"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2 pb-1">
          <span className="w-10 h-1 rounded-full bg-c-border-strong" />
        </div>
        {props.title && <p className="px-5 pb-2 text-xs text-c-text-muted whitespace-pre-line break-all line-clamp-3">{props.title}</p>}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {props.items.map((it, i) => (
            <button
              key={`${it.label}:${i}`}
              type="button"
              onClick={() => {
                props.onClose()
                it.onClick()
              }}
              className={`w-full flex items-center gap-4 px-5 py-3.5 text-left text-[15px] active:bg-c-surface2 ${it.danger ? 'text-c-heat-very-hot' : 'text-c-text-body'}`}
            >
              <span className="material-symbols-outlined text-xl text-c-text-muted">{it.icon}</span>
              <span className="flex-1 min-w-0 truncate">{uiLabel(it.label)}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={props.onClose} className="mx-3 my-2 py-3 rounded-xl bg-c-surface2 text-[15px] font-bold text-c-text-strong">
          キャンセル
        </button>
      </div>
    </div>,
    document.body,
  )
}
