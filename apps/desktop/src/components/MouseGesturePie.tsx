// PC: マウスジェスチャーの円盤(パイメニュー)。中心から 8 方向の区画に操作の名前を書き、向いている区画を差し色で光らせる。
// 画面に出すとき(useMouseGesture の pie)と、設定で割り当てを見せる・選ぶとき(interactive)の両方で使う
import { PIE_DIRS, type PieDir } from '../hooks/useMouseGesture'

/** 区画の内側と外側の半径(px) */
const R_IN = 30
const R_OUT = 116
/** 区画のすき間(度) */
const GAP = 2
const SIZE = R_OUT * 2 + 8

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
const pt = (r: number, deg: number) => [SIZE / 2 + r * Math.cos(rad(deg)), SIZE / 2 + r * Math.sin(rad(deg))] as const

/** 区画の形(上を 0° として、i 番目は i*45° を真ん中にした 45° の扇) */
function wedgePath(i: number): string {
  const a0 = i * 45 - 22.5 + GAP / 2
  const a1 = i * 45 + 22.5 - GAP / 2
  const [x0, y0] = pt(R_OUT, a0)
  const [x1, y1] = pt(R_OUT, a1)
  const [x2, y2] = pt(R_IN, a1)
  const [x3, y3] = pt(R_IN, a0)
  return `M${x0},${y0} A${R_OUT},${R_OUT} 0 0 1 ${x1},${y1} L${x2},${y2} A${R_IN},${R_IN} 0 0 0 ${x3},${y3} Z`
}

/** 文字の幅(全角は 2) */
const widthOf = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0)

/** 区画に入る長さに切る(全角は 2 として max まで) */
function shorten(s: string, max = 10): string {
  let n = 0
  let out = ''
  for (const ch of s) {
    n += ch.charCodeAt(0) > 0xff ? 2 : 1
    if (n > max) return `${out}…`
    out += ch
  }
  return out
}

/** 区画の名前を 2 行までに分ける(1 行 10(全角 5 文字)まで。長ければ 2 行目の後ろを … に) */
function lines(s: string): string[] {
  if (widthOf(s) <= 10) return [s]
  let n = 0
  let i = 0
  const chars = [...s]
  for (; i < chars.length; i++) {
    n += chars[i].charCodeAt(0) > 0xff ? 2 : 1
    if (n > 10) break
  }
  return [chars.slice(0, i).join(''), shorten(chars.slice(i).join(''), 10)]
}

export default function MouseGesturePie(props: {
  /** 方向 → 区画に出す名前(割り当てがなければ undefined) */
  labels: Partial<Record<PieDir, string | undefined>>
  /** 光らせる区画 */
  active: PieDir | null
  /** 中心に出す文字(画面に出すときは、向いている操作の名前) */
  center?: string
  /** 設定で: 区画を押したとき */
  onPick?: (dir: PieDir) => void
  className?: string
}) {
  const interactive = !!props.onPick
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={props.className}
      style={{ filter: interactive ? undefined : 'drop-shadow(0 4px 16px rgba(0,0,0,0.45))' }}
    >
      {PIE_DIRS.map((d, i) => {
        const on = props.active === d
        const label = props.labels[d]
        const [lx, ly] = pt((R_IN + R_OUT) / 2 + 2, i * 45)
        return (
          <g
            key={d}
            onClick={props.onPick ? () => props.onPick!(d) : undefined}
            style={interactive ? { cursor: 'pointer' } : undefined}
            className={interactive ? 'pie-wedge' : undefined}
          >
            <path
              d={wedgePath(i)}
              fill={on ? 'var(--c-accent)' : 'var(--c-surface)'}
              stroke={on ? 'var(--c-accent)' : 'var(--c-border-strong)'}
              strokeWidth={1}
              opacity={interactive ? 1 : 0.96}
            />
            {(label ? lines(label) : ['－']).map((line, li, all) => (
              <text
                key={li}
                x={lx}
                y={ly + (li - (all.length - 1) / 2) * 13}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={on ? 700 : 500}
                fill={on ? 'var(--c-accent-text)' : label ? 'var(--c-text-strong)' : 'var(--c-text-muted)'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {line}
              </text>
            ))}
          </g>
        )
      })}
      {/* 中心: 何もしない所。向いている操作の名前(画面に出すとき)か「なし」 */}
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R_IN - 4} fill="var(--c-surface2)" stroke="var(--c-border)" />
      {props.center !== undefined && (
        <text x={SIZE / 2} y={SIZE / 2} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="var(--c-text-muted)" style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {shorten(props.center)}
        </text>
      )}
    </svg>
  )
}

/** 画面に出す(useMouseGesture の pie)。中心を動かし始めた所に合わせ、下に向いている操作の名前を出す */
export function MouseGesturePieOverlay(props: { x: number; y: number; dir: PieDir | null; labels: Partial<Record<PieDir, string | undefined>> }) {
  const name = props.dir ? props.labels[props.dir] : undefined
  return (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      <div className="absolute" style={{ left: props.x - SIZE / 2, top: props.y - SIZE / 2, width: SIZE }}>
        <MouseGesturePie labels={props.labels} active={props.dir} center={props.dir ? (name ? '' : 'なし') : 'なし'} />
        <div className="mt-1 flex justify-center">
          <span className="px-3 py-1 rounded-full bg-black/70 text-white text-xs font-bold whitespace-nowrap">{name ?? (props.dir ? '割り当てなし' : '離すと何もしない')}</span>
        </div>
      </div>
    </div>
  )
}
