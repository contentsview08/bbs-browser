// 実況モードの流す速さのつまみ。目盛りは対数(utils/autoScroll.ts)なので、遅い側を細かく選べる
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isMobile } from '../utils/platform'
import { formatLiveSpeed, LIVE_SPEED_STEPS, liveSpeedOfStep, liveStepOfSpeed } from '../utils/autoScroll'

/** 速さのつまみだけ(設定の画面)。動かすたびに値を渡す */
export default function LiveSpeedSlider(props: { value: number; onChange: (v: number) => void; className?: string; style?: CSSProperties; title?: string }) {
  const [step, setStep] = useState(() => liveStepOfSpeed(props.value))
  // ほかの所で値が変わったら合わせる(丸めた値で戻ってきても、つまみは動かさない)
  useEffect(() => {
    setStep((s) => (liveSpeedOfStep(s) === props.value ? s : liveStepOfSpeed(props.value)))
  }, [props.value])
  return (
    <input
      type="range"
      min={0}
      max={LIVE_SPEED_STEPS}
      step={1}
      value={step}
      title={props.title ?? formatLiveSpeed(props.value)}
      aria-label="流す速さ"
      onChange={(e) => {
        const s = Number(e.target.value)
        setStep(s)
        const v = liveSpeedOfStep(s)
        if (v !== props.value) props.onChange(v)
      }}
      className={props.className ?? 'w-full h-8 accent-[var(--c-accent)]'}
      style={{ touchAction: 'pan-y', ...props.style }}
    />
  )
}

/** 触り終えてから薄く戻すまで(指で触るスマホは、乗せたままにできないので少し残す) */
const FADE_MS = isMobile ? 1500 : 600

/**
 * スレ表示の右上に重ねる、半透明の小さな速さのつまみ(実況モードの間だけ)。
 * 本文の邪魔にならないよう、触っていない間は薄くしておき、乗せる・触ると濃くする
 */
export function LiveSpeedOverlay(props: { value: number; onChange: (v: number) => void; style?: CSSProperties }) {
  const [hot, setHot] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const warm = () => {
    clearTimeout(timer.current)
    setHot(true)
  }
  const cool = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHot(false), FADE_MS)
  }
  return (
    <div
      className="absolute z-20 flex items-center gap-1.5 pl-2 pr-2.5 h-8 rounded-full border border-c-border shadow-md transition-opacity duration-200"
      style={{ background: 'var(--c-surface)', opacity: hot ? 0.95 : 0.4, ...props.style }}
      onPointerEnter={warm}
      onPointerDown={warm}
      onPointerLeave={cool}
      onPointerUp={cool}
      onPointerCancel={cool}
      onFocus={warm}
      onBlur={cool}
      title="流す速さ(実況モード)"
    >
      <span className="material-symbols-outlined text-[18px] text-c-text-muted">speed</span>
      <LiveSpeedSlider value={props.value} onChange={props.onChange} className="w-24 h-6 accent-[var(--c-accent)]" />
      <span className="min-w-[3.2em] text-right text-[11px] tabular-nums text-c-text-muted">{props.value} 行/秒</span>
    </div>
  )
}
