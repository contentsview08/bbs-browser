// 文字の大きさを 1px ずつ変えるスライダー(︙ の「文字の大きさ」と、設定の「文字サイズ」)。
// 動かしている間は、画面の変数(CSS)だけを書き換えて、その場で大きさを変える。設定に保存するのは指(マウス)を離したとき
// (動かすたびに保存すると、そのたびに DB へ書いて重い)
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { FONT_PX_KEY, FONT_PX_MAX, FONT_PX_MIN, ROOT_FONT_SIZE, applyCssVar, baseFontPx, contentFontPx, type AppSettings, type UpdateSetting } from '../ui/settings'
import { isMobile } from '../utils/platform'
import { broadcast, toolKindOfThisWindow } from '../host/crossWindow'

/**
 * 小さな画面(SliderDialog)の中で、いまつかんで動かしているスライダーの行。動かしている間は、その行だけを残して
 * 画面のほかの所(題・ほかのスライダー)を消し、後ろの画面が変わっていく様子を見られるようにする(スマホのアプリと同じ)
 */
const SliderDrag = createContext<{ active: HTMLElement | null; set: (el: HTMLElement | null) => void } | null>(null)

/** つかんでいる間だけ行を残す(SliderDialog の中のときだけ効く) */
function useSliderDrag() {
  const drag = useContext(SliderDrag)
  const rowRef = useRef<HTMLDivElement>(null)
  const on = drag !== null && drag.active !== null && drag.active === rowRef.current
  return {
    rowRef,
    rowStyle: on ? ({ visibility: 'visible', background: 'var(--c-surface)', borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,.35)' } as const) : undefined,
    start: () => drag?.set(rowRef.current),
    end: () => drag?.set(null),
  }
}

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
  /** 基本の文字を変えても、この行の大きさを変えない(SliderDialog の外に置くとき) */
  fixedSize?: boolean
}) {
  const unset = props.unset ?? 0
  const isSet = props.value !== unset
  const shown = isSet ? props.value : props.base
  const [px, setPx] = useState(shown)
  useEffect(() => {
    setPx(shown)
  }, [shown])
  const drag = useSliderDrag()
  // 値を保存する(つかんでいる印は、離した(pointerup)ときに SliderDialog 側が外す。blur で外すと、つかんだ直後に焦点が動いたときに
  // 幕が透けないことがあった)
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
      <div ref={drag.rowRef} style={drag.rowStyle} className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
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
            onPointerDown={drag.start}
            onPointerUp={commit}
            onTouchEnd={commit}
            onBlur={commit}
            onLostPointerCapture={commit}
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
    <div ref={drag.rowRef} style={props.fixedSize ? { ...drag.rowStyle, zoom: 'var(--dialog-zoom, 1)' } : drag.rowStyle} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
            title="標準の大きさに戻す"
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
          onPointerDown={drag.start}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onLostPointerCapture={commit}
          className="flex-1 accent-[var(--c-accent)] h-8"
        />
        <span className="material-symbols-outlined text-lg text-c-text-muted">{props.icons?.[1] ?? 'text_increase'}</span>
      </div>
    </div>
  )
}

/** 画面の変数(CSS)の、いまの値(px)。決めていない余白の既定を、スライダーの初めの位置にする */
export function cssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const v = parseFloat(raw)
  // rem で決めた余白もある(スレ一覧)。16px を 1rem として読む
  return Number.isFinite(v) ? Math.round(raw.endsWith('rem') ? v * 16 : v) : fallback
}

export { ROOT_FONT_SIZE }

/**
 * 画面の変数(CSS)をすぐ書き換える(スライダーを動かしている間の見た目)。
 * 設定のウィンドウ(PC)からは、自分ではなくメインのウィンドウへ送る(設定画面の字まで変わると、つまみの位置がずれて合わせにくい)。
 * 受けるのはメインの useSettings(css-preview)
 */
export const setCssVar = (name: string, value: string) => {
  if (toolKindOfThisWindow()) void broadcast('css-preview', { name, value })
  else applyCssVar(name, value)
}

/**
 * PC: 基本の文字(メニュー・ボタン・タブ・ポップアップなどの部品の字とアイコン)。レスの本文・頭、スレ一覧の字は動かない。
 * 動かしている間は、切り離してある本文・頭・一覧がつられないよう、倍率も一緒に書き換える
 */
export function BaseFontSlider(props: { settings: AppSettings; update: UpdateSetting; fixedSize?: boolean }) {
  const { settings: s, update } = props
  const content = contentFontPx(s)
  return (
    <FontSizeSlider
      label="基本の文字(メニュー・ボタン・ポップアップ)"
      value={baseFontPx(s)}
      base={baseFontPx(s)}
      fixedSize={props.fixedSize}
      preview={(px) => {
        setCssVar(ROOT_FONT_SIZE, `${px}px`)
        setCssVar('--list-zoom', String((s.listFontPx || content) / px))
        setCssVar('--post-head-zoom', String((s.postHeadPx || content) / px))
        setCssVar('--list-unzoom', String(px / 16))
        setCssVar('--dialog-zoom', String(16 / px))
      }}
      onCommit={(px) => update(FONT_PX_KEY, px)}
    />
  )
}

/** スレ一覧の文字の大きさ・余白(スレ一覧の ︙ と、設定の「スレ一覧」の両方に出す) */
export function ListFontSliders(props: { settings: AppSettings; update: UpdateSetting }) {
  const { settings: s, update } = props
  return (
    <>
      <FontSizeSlider
        label="スレ一覧の文字"
        value={s.listFontPx}
        base={contentFontPx(s)}
        preview={(px) => setCssVar('--list-zoom', String(px / baseFontPx(s)))}
        onCommit={(px) => update('listFontPx', px)}
        resettable
      />
      <FontSizeSlider
        label="スレの上下の余白"
        value={s.listPadPx}
        unset={-1}
        base={cssPx('--thread-card-padding-y', 8)}
        min={0}
        max={24}
        icons={['density_small', 'density_large']}
        preview={(px) => {
          setCssVar('--list-row-pad', `${px / 16}rem`)
          setCssVar('data-list-pad', '')
        }}
        onCommit={(px) => update('listPadPx', px)}
        resettable
      />
      <BarSliders settings={s} update={update} />
    </>
  )
}

/** レスの文字の大きさ・行間・余白(スレ表示の ︙ と、設定の「レス表示」の両方に出す) */
export function PostFontSliders(props: { settings: AppSettings; update: UpdateSetting }) {
  const { settings: s, update } = props
  return (
    <>
      <FontSizeSlider
        label="レスの本文"
        value={s.postBodyPx}
        base={contentFontPx(s)}
        preview={(px) => setCssVar('--post-body-size', `${px}px`)}
        onCommit={(px) => update('postBodyPx', px)}
        resettable
      />
      <FontSizeSlider
        label="レスの頭(名前・日付・ID)"
        value={s.postHeadPx}
        base={contentFontPx(s)}
        preview={(px) => setCssVar('--post-head-zoom', String(px / baseFontPx(s)))}
        onCommit={(px) => update('postHeadPx', px)}
        resettable
      />
      <FontSizeSlider
        label="レスの本文の行間"
        value={s.postLineHeight}
        base={1.625}
        min={1}
        max={2.4}
        step={0.05}
        format={(v) => `${v.toFixed(2)} 倍`}
        icons={['format_line_spacing', 'format_line_spacing']}
        preview={(v) => setCssVar('--post-line-height', String(v))}
        onCommit={(v) => update('postLineHeight', v)}
        resettable
      />
      <FontSizeSlider
        label="レスの上下の余白"
        value={s.postPadPx}
        unset={-1}
        base={cssPx('--post-padding-y', 6)}
        min={0}
        max={24}
        icons={['density_small', 'density_large']}
        preview={(px) => setCssVar('--post-padding-y', `${px}px`)}
        onCommit={(px) => update('postPadPx', px)}
        resettable
      />
      <BarSliders settings={s} update={update} />
    </>
  )
}

/**
 * 文字の大きさ・余白のスライダーを、画面の真ん中に出す小さな画面。
 * ︙ のメニューの中だと、動かすたびに後ろの画面の大きさが変わって、メニューごとスライダーの位置がずれてしまうので、
 * 後ろの画面に影響されない手前に出す。後ろは暗くしない(変わっていく様子をそのまま見るための画面。暗くすると比べられない)
 */
export function SliderDialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)
  // つかんでいるスライダーの行。あるときは、その行のほか(題・ほかの行・暗い背景)を見えなくする
  const [active, setActive] = useState<HTMLElement | null>(null)
  // 指(マウス)を画面の外で離したときも戻す
  useEffect(() => {
    if (!active) return
    const up = () => setActive(null)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [active])
  return createPortal(
    <SliderDrag.Provider value={{ active, set: setActive }}>
    {/* スマホは、画面の横いっぱいに下から出す(上には、変わっていく画面が見える)。幕は透明(外を押すと閉じる受け皿としてだけ置く) */}
    <div className={`fixed inset-0 z-[9800] flex ${isMobile ? 'items-end' : 'items-center justify-center p-4'}`} {...backdrop}>
      <div
        ref={boxRef}
        // つかんでいる間は、入れ物ごと見えなくし、つかんでいる行だけを visibility: visible で残す
        style={!isMobile ? { zoom: 'var(--dialog-zoom, 1)', ...(active ? { visibility: 'hidden' as const } : {}) } : active ? { visibility: 'hidden', ...(isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' } : {}) } : isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' } : undefined}
        className={`w-full overflow-y-auto bg-c-surface shadow-xl ${isMobile ? 'max-h-[70vh] rounded-t-3xl sheet-rise pt-2' : 'max-w-sm max-h-[85vh] border border-c-border rounded-2xl rise-in py-2'}`}
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
    </div>
    </SliderDrag.Provider>,
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
