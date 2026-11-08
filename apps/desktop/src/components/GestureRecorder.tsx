// スマホの設定: ジェスチャーを、実際に枠の中でなぞって覚えさせる画面。
// なぞった線を描きながら、向きの並び(→↑ など)を読み取る。読み取り方は、画面のジェスチャー(hooks/useSwipeGesture.ts)と同じ:
// 少し動いたら最初の向きを決め、そのあとは一定以上ほかの向きへ動いたときだけ次の向きを足す。
// 縦(↑・↓)から始まるなぞり方は、ふつうのスクロールとぶつかるので受け付けない
import { useRef, useState } from 'react'
import type { SwipeDirection } from '../hooks/useSwipeGesture'
import { SliderDialog } from './FontSizeSlider'

const LOCK_PX = 12
const SEGMENT_PX = 28
/** 覚えられる向きの数 */
const MAX_SEGMENTS = 3

const ARROW: Record<SwipeDirection, string> = { right: '→', left: '←', up: '↑', down: '↓' }
/** なぞり方(right,up)を矢印(→↑)に */
export const gestureArrows = (seq: string) => seq.split(',').map((d) => ARROW[d as SwipeDirection] ?? d).join('')

const dominant = (dx: number, dy: number): SwipeDirection => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up')

export default function GestureRecorder(props: {
  /** 割り当てる操作の名前 */
  action: string
  /** そのなぞり方を、いまほかの操作で使っていれば、その名前(外れることを知らせる) */
  usedBy: (seq: string) => string | undefined
  onDone: (seq: string) => void
  onClose: () => void
}) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([])
  const [segs, setSegs] = useState<SwipeDirection[]>([])
  const state = useRef<{ segStart: { x: number; y: number }; segs: SwipeDirection[] } | null>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const seq = segs.join(',')
  const bad = segs.length > 0 && (segs[0] === 'up' || segs[0] === 'down')
  const local = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const other = seq && !bad ? props.usedBy(seq) : undefined
  return (
    <SliderDialog title={`「${props.action}」のなぞり方`} onClose={props.onClose}>
      <div className="px-4 pb-3">
        <p className="mb-3 text-[13px] leading-relaxed text-c-text-muted">
          下の枠の中で、割り当てたい形をなぞってください(左右どちらかから始めて、向きは 3 つまで。2 回まで変えられます)。
        </p>
        <div
          ref={padRef}
          data-gesture-pad
          className="relative h-56 rounded-2xl border-2 border-dashed border-c-border bg-c-surface2 overflow-hidden"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = local(e)
            state.current = { segStart: p, segs: [] }
            setPoints([p])
            setSegs([])
          }}
          onPointerMove={(e) => {
            const s = state.current
            if (!s) return
            const p = local(e)
            setPoints((ps) => [...ps, p])
            const dx = p.x - s.segStart.x
            const dy = p.y - s.segStart.y
            const dist = Math.hypot(dx, dy)
            if (s.segs.length === 0) {
              if (dist < LOCK_PX) return
              s.segs = [dominant(dx, dy)]
              s.segStart = p
            } else if (dist >= SEGMENT_PX) {
              const d = dominant(dx, dy)
              if (d !== s.segs[s.segs.length - 1] && s.segs.length < MAX_SEGMENTS) s.segs = [...s.segs, d]
              s.segStart = p
            }
            setSegs(s.segs)
          }}
          onPointerUp={() => {
            state.current = null
          }}
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--c-accent)"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {segs.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-c-text-muted pointer-events-none">ここをなぞる</p>}
        </div>
        <div className="mt-3 min-h-[3rem] flex items-center justify-center text-3xl tracking-widest text-c-text-strong">{seq && gestureArrows(seq)}</div>
        {bad && <p className="text-center text-[13px] text-c-heat-very-hot">上下から始めると、ふつうのスクロールとぶつかります。左右どちらかから始めてください</p>}
        {other && <p className="text-center text-[13px] text-c-text-muted">いまは「{other}」に割り当てています(そちらからは外れます)</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPoints([])
              setSegs([])
            }}
            className="flex-1 py-2.5 rounded-xl border border-c-border text-[15px] text-c-text-body"
          >
            やり直す
          </button>
          <button
            type="button"
            disabled={!seq || bad}
            onClick={() => props.onDone(seq)}
            className="flex-1 py-2.5 rounded-xl bg-c-accent text-[var(--c-accent-text)] text-[15px] font-bold disabled:opacity-40"
          >
            割り当てる
          </button>
        </div>
      </div>
    </SliderDialog>
  )
}
