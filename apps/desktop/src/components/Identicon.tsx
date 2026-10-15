// hono-bbs-merge packages/web/src/components/ui/Identicon.tsx から複製(import の場所だけ変えた)
import { useMemo } from 'react'
import { generateIdenticon } from '../utils/identicon'

interface IdenticonProps {
  /** アイコンの元になる文字列(投稿者ID等)。同じseedなら常に同じ見た目になる */
  seed: string
  /** 一辺のサイズ(px) */
  size?: number
  /** 円形に切り抜くか(丸いアバター枠にはめる場合はtrue) */
  rounded?: boolean
  className?: string
  /** ホバー時のツールチップ(通常はseedそのものを渡す) */
  title?: string
}

/**
 * GitHub風のIdenticonをCSSグリッドだけで描画する(画像化はしない)。
 * utils/identicon.ts で計算した5x5の対称パターンを、1マスずつdivで塗り分ける。
 */
export default function Identicon({ seed, size = 24, rounded = true, className = '', title }: IdenticonProps) {
  const { pattern, color } = useMemo(() => generateIdenticon(seed), [seed])

  return (
    <div
      className={`grid flex-shrink-0 ${rounded ? 'rounded-full' : ''} overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateRows: 'repeat(5, 1fr)',
        background: 'var(--c-surface2)',
      }}
      title={title}
      aria-hidden="true"
    >
      {pattern.flatMap((row, i) =>
        row.map((filled, j) => (
          <div key={`${i}-${j}`} style={{ background: filled ? color : 'transparent' }} />
        )),
      )}
    </div>
  )
}
