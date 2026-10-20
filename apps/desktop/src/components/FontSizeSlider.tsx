// 文字の大きさを 1px ずつ変えるスライダー(︙ の「文字の大きさ」と、設定の「文字サイズ」)。
// 動かしている間は、画面の変数(CSS)だけを書き換えて、その場で大きさを変える。設定に保存するのは指(マウス)を離したとき
// (動かすたびに保存すると、そのたびに DB へ書いて重い)
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { FONT_PX_MAX, FONT_PX_MIN, baseFontPx, type AppSettings, type UpdateSetting } from '../ui/settings'
import { isMobile } from '../utils/platform'

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
  /** 刻み(既定は 1px)と、値の見せ方(既定は「12px」) */
  step?: number
  format?: (v: number) => string
}) {
  const unset = props.unset ?? 0
  const isSet = props.value !== unset
  const shown = isSet ? props.value : props.base
  const [px, setPx] = useState(shown)
  useEffect(() => {
    setPx(shown)
  }, [shown])
  const commit = () => {
    if (px !== shown) props.onCommit(px)
  }
  const min = props.min ?? FONT_PX_MIN
  const max = props.max ?? FONT_PX_MAX
  const step = props.step ?? 1
  /** − ・ ＋ のボタン: 1 刻みずつ動かして、すぐ保存する(細かく合わせるとき) */
  const nudge = (d: number) => {
    const v = Math.round(Math.min(max, Math.max(min, px + d * step)) * 100) / 100
    setPx(v)
    props.preview(v)
    if (v !== shown) props.onCommit(v)
  }
  const label = props.format ? props.format(px) : `${px}px`
  // スマホ: 指で扱いやすいよう、字・つまみ・線を大きくし、左右に − ・ ＋ を置く
  if (isMobile)
    return (
      <div className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <span className="flex-1 min-w-0 text-[16px] text-c-text-strong">{props.label}</span>
          <span className="tabular-nums text-[18px] font-bold text-c-accent">{label}</span>
          {props.resettable && isSet && (
            <button
              type="button"
              onClick={() => {
                props.preview(props.base)
                props.onCommit(unset)
              }}
              className="ml-1 px-2.5 py-1 rounded-full border border-c-border text-[13px] text-c-text-muted active:bg-c-surface3"
            >
              元に戻す
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => nudge(-1)} className="w-11 h-11 flex-shrink-0 rounded-full bg-c-surface3 text-c-text-strong flex items-center justify-center active:brightness-110" title="小さく">
            <span className="material-symbols-outlined text-2xl">remove</span>
          </button>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={px}
            onChange={(e) => {
              const v = Number(e.target.value)
              setPx(v)
              props.preview(v)
            }}
            onPointerUp={commit}
            onTouchEnd={commit}
            onBlur={commit}
            className="big-range flex-1 min-w-0"
            style={{ touchAction: 'pan-y' }}
          />
          <button type="button" onClick={() => nudge(1)} className="w-11 h-11 flex-shrink-0 rounded-full bg-c-surface3 text-c-text-strong flex items-center justify-center active:brightness-110" title="大きく">
            <span className="material-symbols-outlined text-2xl">add</span>
          </button>
        </div>
      </div>
    )
  return (
    <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-1 text-xs text-c-text-muted">
        <span className="flex-1">{props.label}</span>
        <span className="tabular-nums font-bold text-c-text-strong">{label}</span>
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
          min={min}
          max={max}
          step={step}
          value={px}
          onChange={(e) => {
            const v = Number(e.target.value)
            setPx(v)
            props.preview(v)
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="flex-1 accent-[var(--c-accent)] h-8"
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

/**
 * 文字の大きさ・余白のスライダーを、画面の真ん中に出す小さな画面。
 * ︙ のメニューの中だと、動かすたびに後ろの画面の大きさが変わって、メニューごとスライダーの位置がずれてしまうので、
 * 後ろの画面に影響されない手前に出す。後ろはうっすら暗くするだけにして、変わっていく様子は見えるようにする
 */
export function SliderDialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  return createPortal(
    // スマホは、画面の横いっぱいに下から出す(上には、変わっていく画面が見える)
    <div
      className={`fixed inset-0 z-[9800] bg-black/25 flex ${isMobile ? 'items-end' : 'items-center justify-center p-4'}`}
      onClick={props.onClose}
    >
      <div
        ref={boxRef}
        className={`w-full overflow-y-auto bg-c-surface shadow-2xl ${isMobile ? 'max-h-[70vh] rounded-t-3xl sheet-rise pt-2' : 'max-w-sm max-h-[85vh] border border-c-border rounded-2xl rise-in py-2'}`}
        style={isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {isMobile && (
          <div className="flex justify-center pt-0.5 pb-1">
            <span className="w-10 h-1 rounded-full bg-c-border-strong" />
          </div>
        )}
        <div className="flex items-center justify-between pl-4 pr-2 pb-1">
          <h2 className={`${isMobile ? 'text-[17px]' : 'text-sm'} font-bold text-c-text-strong`}>{props.title}</h2>
          <button type="button" onClick={props.onClose} className="p-1.5 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        {props.children}
      </div>
    </div>,
    document.body,
  )
}

/** スマホ: ヘッダー・フッターの高さと文字の大きさのスライダー(スレ一覧・スレ表示のどちらの「文字の大きさ・余白」にも出す) */
export function BarSliders(props: { settings: AppSettings; update: UpdateSetting }) {
  const { settings: s, update } = props
  if (!isMobile) return null
  const base = baseFontPx(s)
  return (
    <>
      <FontSizeSlider
        label="ヘッダーの高さ"
        value={s.headerPx}
        base={72}
        min={44}
        max={120}
        icons={['vertical_align_center', 'height']}
        preview={(px) => setCssVar('--header-height', `${px}px`)}
        onCommit={(px) => update('headerPx', px)}
        resettable
      />
      <FontSizeSlider
        label="フッターの高さ"
        value={s.footerPx}
        base={64}
        min={44}
        max={110}
        icons={['vertical_align_center', 'height']}
        preview={(px) => setCssVar('--footer-bar-h', `${px}px`)}
        onCommit={(px) => update('footerPx', px)}
        resettable
      />
      <FontSizeSlider
        label="ヘッダー・フッターの文字"
        value={s.barFontPx}
        base={base}
        preview={(px) => setCssVar('--bar-zoom', String(px / base))}
        onCommit={(px) => update('barFontPx', px)}
        resettable
      />
    </>
  )
}
