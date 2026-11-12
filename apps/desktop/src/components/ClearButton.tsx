// 検索・絞り込みの欄の中の右に出す、文字を消す × ボタン。PC・Web・スマホ版で同じ形・色・動き
// (スマホ版の SearchBar の「消す」: 塗りの cancel・18px・薄い文字の色。押せる所は PC 28px・スマホ 32px)
import type { InputHTMLAttributes, RefObject } from 'react'
import { isMobile } from '../utils/platform'

/** × を重ねる欄の右の余白(× の押せる所と同じ幅。打った文字が × の下に入らないように) */
export const CLEAR_PAD = isMobile ? 34 : 30

/**
 * 文字が入っているときだけ出す。押すと文字を消し、欄にフォーカスを残す(続けて打てる)。
 * inline: 欄と横に並べる(欄が枠のない透明のとき。上下にはみ出させて、出たときに行の高さを変えない)。ふだんは欄を包む relative の箱の右端に重ねる
 */
export function ClearButton(props: { value: string; onClear: () => void; inputRef?: RefObject<HTMLInputElement | null>; inline?: boolean; className?: string }) {
  if (!props.value) return null
  return (
    <button
      type="button"
      // Tab で寄らない(キーボードでは今までどおり Esc などで消す)
      tabIndex={-1}
      // 押してもフォーカスを欄から動かさない(スマホはキーボードを出したまま)
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const input = props.inputRef?.current ?? e.currentTarget.parentElement?.querySelector('input')
        props.onClear()
        input?.focus()
      }}
      className={`${props.inline ? 'flex-shrink-0 -my-2' : 'absolute right-0.5 top-1/2 -translate-y-1/2 z-20'} ${
        isMobile ? 'w-8 h-8 active:bg-c-surface2' : 'w-7 h-7 hover:text-c-text-body'
      } flex items-center justify-center rounded-full text-c-text-muted transition-colors ${props.className ?? ''}`}
      title="消す"
      aria-label="消す"
    >
      <span className="material-symbols-outlined fill text-[18px] leading-none">cancel</span>
    </button>
  )
}

/** × の付いた検索・絞り込みの欄。className は欄に、wrapClassName は包む箱(並べ方・幅)に付ける */
export function SearchInput({
  value,
  onValue,
  wrapClassName,
  style,
  inputRef,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onValue: (v: string) => void; wrapClassName?: string; inputRef?: RefObject<HTMLInputElement | null> }) {
  return (
    <div className={`relative ${wrapClassName ?? ''}`}>
      <input type="text" {...rest} ref={inputRef} value={value} onChange={(e) => onValue(e.target.value)} style={value ? { ...style, paddingRight: CLEAR_PAD } : style} />
      <ClearButton value={value} onClear={() => onValue('')} inputRef={inputRef} />
    </div>
  )
}
