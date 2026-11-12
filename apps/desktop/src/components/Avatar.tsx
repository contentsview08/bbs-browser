// ID から作るキャラクターのアイコン(設定「ID の見せ方」がキャラクターのとき)。
// Identicon と同じく、絵は SVG の data URL にして要素 1 つの背景に敷く(全レスに出すので要素を増やさない)
import { useMemo } from 'react'
import { avatarSvg } from '../utils/avatar'

interface AvatarProps {
  /** 元になる文字列(ID・ワッチョイ)。同じなら同じ絵 */
  seed: string
  /** 一辺(px) */
  size?: number
  /** 暗い配色か(背景の明るさを変える) */
  dark: boolean
  className?: string
  title?: string
}

/** seed と明るさごとの絵。多くなりすぎたら捨てて作り直す */
const cache = new Map<string, string>()

export function avatarImage(seed: string, dark: boolean): string {
  const key = `${dark ? 1 : 0}${seed}`
  let url = cache.get(key)
  if (url !== undefined) return url
  url = `url("data:image/svg+xml,${encodeURIComponent(avatarSvg(seed, dark))}")`
  if (cache.size > 5000) cache.clear()
  cache.set(key, url)
  return url
}

export default function Avatar({ seed, size = 24, dark, className = '', title }: AvatarProps) {
  const image = useMemo(() => avatarImage(seed, dark), [seed, dark])
  return (
    <div
      className={`flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: image,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
      title={title}
      aria-hidden="true"
    />
  )
}
