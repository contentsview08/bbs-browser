// 文字の大きさを 1px ずつ変えるスライダー(︙ の「文字の大きさ」と、設定の「文字サイズ」)。
// 動かしている間は、画面の変数(CSS)だけを書き換えて、その場で大きさを変える。設定に保存するのは指(マウス)を離したとき
// (動かすたびに保存すると、そのたびに DB へ書いて重い)
import { useEffect, useState } from 'react'
import { FONT_PX_MAX, FONT_PX_MIN } from '../ui/settings'

export default function FontSizeSlider(props: {
  label: string
  /** 保存してある大きさ(px)。0 なら base のまま */
  value: number
  /** 決めていないときの大きさ(画面全体の大きさ) */
  base: number
  /** 動かしている間に、画面へすぐ映す */
  preview: (px: number) => void
  /** 決めた大きさを保存する(0 なら元に戻す) */
  onCommit: (px: number) => void
  /** 元に戻すボタンを出すか(画面全体の大きさには「元」がないので出さない) */
  resettable?: boolean
  /** 決めていないことを表す値(文字の大きさは 0。余白は 0px も選べるので -1) */
  unset?: number
  /** 選べる幅と、両端のアイコン(既定は文字の大きさ) */
  min?: number
  max?: number
  icons?: [string, string]
}) {
  const unset = props.unset ?? 0
  const isSet = props.value !== unset
  const shown = isSet ? props.value : props.base
  const [px, setPx] = useState(shown)
  useEffect(() => setPx(shown), [shown])
  const commit = () => {
    if (px !== shown) props.onCommit(px)
  }
  return (
    <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-1 text-xs text-c-text-muted">
        <span className="flex-1">{props.label}</span>
        <span className="tabular-nums font-bold text-c-text-strong">{px}px</span>
        {props.resettable && isSet && (
          <button
            type="button"
            onClick={() => {
              props.preview(props.base)
              props.onCommit(unset)
            }}
            className="px-1.5 py-0.5 rounded border border-c-border hover:border-c-border-strong"
            title="画面全体の大きさに戻す"
          >
            元に戻す
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-c-text-muted">{props.icons?.[0] ?? 'text_decrease'}</span>
        <input
          type="range"
          min={props.min ?? FONT_PX_MIN}
          max={props.max ?? FONT_PX_MAX}
          step={1}
          value={px}
          onChange={(e) => {
            const v = Number(e.target.value)
            setPx(v)
            props.preview(v)
          }}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
          // touch-action: 指で横になぞってつまみを動かす(スクロールに取られないように)
          className="flex-1 accent-[var(--c-accent)] h-8"
          style={{ touchAction: 'pan-y' }}
        />
        <span className="material-symbols-outlined text-lg text-c-text-muted">{props.icons?.[1] ?? 'text_increase'}</span>
      </div>
    </div>
  )
}

/** 画面の変数(CSS)の、いまの値(px)。決めていない余白の既定を、スライダーの初めの位置にする */
export function cssPx(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(v) ? Math.round(v) : fallback
}

/** 画面の変数(CSS)をすぐ書き換える(スライダーを動かしている間の見た目) */
export const setCssVar = (name: string, value: string) => document.documentElement.style.setProperty(name, value)
