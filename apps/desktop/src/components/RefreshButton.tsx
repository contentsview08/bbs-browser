// 更新ボタン。クールダウン中は押せなくし、アイコンの代わりに残りの秒数を出して、周りの輪を減らしていく
// (続けて押しても取りに行かないことが、見て分かるように)

import { useCountdown } from '../hooks/useCountdown'

export default function RefreshButton(props: {
  onClick: () => void
  loading: boolean
  /** この時刻になったら押せる */
  readyAt?: number
  /** クールダウン全体の長さ(ms) */
  cooldownMs: number
  className?: string
  /** アイコンの大きさ(px) */
  size?: number
  /** クールダウン中も押せる(押したときにすることを、呼ぶ側が決める。スレ表示では既読の位置だけ引き直す) */
  coolingAction?: string
}) {
  const { left, ratio } = useCountdown(props.readyAt, props.cooldownMs)
  const size = props.size ?? 20
  const cooling = left > 0 && !props.loading
  const r = size / 2 + 2
  const c = 2 * Math.PI * r
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.loading || (cooling && !props.coolingAction)}
      className={`relative ${props.className ?? ''} disabled:cursor-not-allowed`}
      title={
        cooling
          ? `あと ${Math.ceil(left / 1000)} 秒で更新できます(続けて取りに行かないよう、少しあけています)${props.coolingAction ? `。いま押すと${props.coolingAction}` : ''}`
          : '更新'
      }
    >
      {cooling ? (
        <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
          <svg className="absolute -rotate-90" width={size + 8} height={size + 8} viewBox={`0 0 ${size + 8} ${size + 8}`} aria-hidden>
            <circle cx={size / 2 + 4} cy={size / 2 + 4} r={r} fill="none" stroke="var(--c-border)" strokeWidth={2} />
            <circle
              cx={size / 2 + 4}
              cy={size / 2 + 4}
              r={r}
              fill="none"
              stroke="var(--c-accent)"
              strokeWidth={2}
              strokeDasharray={c}
              strokeDashoffset={c * (1 - ratio)}
              strokeLinecap="round"
            />
          </svg>
          <span className="text-[11px] font-bold tabular-nums text-c-text-muted">{Math.ceil(left / 1000)}</span>
        </span>
      ) : (
        <span className={`material-symbols-outlined ${props.loading ? 'animate-spin' : ''}`} style={{ fontSize: size }}>
          refresh
        </span>
      )}
    </button>
  )
}
