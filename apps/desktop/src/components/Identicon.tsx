// 模様を SVG の data URL にして要素 1 つの背景に敷く(全レスに出すので要素を増やさない)。絵は seed ごとに控える
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

/** seed ごとの模様の絵(背景に敷く url(...))。多くなりすぎたら捨てて作り直す */
const cache = new Map<string, string>()

function patternImage(seed: string): string {
  let url = cache.get(seed)
  if (url !== undefined) return url
  const { pattern, color } = generateIdenticon(seed)
  const rects = pattern.flatMap((row, i) => row.map((filled, j) => (filled ? `<rect x="${j}" y="${i}" width="1" height="1"/>` : ''))).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" shape-rendering="crispEdges"><g fill="${color}">${rects}</g></svg>`
  url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  if (cache.size > 5000) cache.clear()
  cache.set(seed, url)
  return url
}

/** GitHub 風の Identicon。utils/identicon.ts で計算した 5x5 の対称パターンを、1 枚の絵として描く */
export default function Identicon({ seed, size = 24, rounded = true, className = '', title }: IdenticonProps) {
  const image = useMemo(() => patternImage(seed), [seed])
  return (
    <div
      className={`flex-shrink-0 ${rounded ? 'rounded-full' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: 'var(--c-surface2)',
        backgroundImage: image,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
      title={title}
      aria-hidden="true"
    />
  )
}
