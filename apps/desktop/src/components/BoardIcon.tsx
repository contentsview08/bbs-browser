// 板のファビコン。上書き(設定)があればそれ、なければ板のページから探す。読めなければ汎用のアイコン。
// 画像は DB にキャッシュしてある(host/favicon.ts)

import { useEffect, useState } from 'react'
import { faviconFor } from '../host/favicon'

export default function BoardIcon({ boardUrl, override, size = 16 }: { boardUrl: string; override?: string; size?: number }) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    let alive = true
    setSrc(undefined)
    void faviconFor(boardUrl, override).then((data) => {
      if (!alive) return
      if (data) setSrc(data)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [boardUrl, override])

  if (!src || failed) {
    return (
      <span className="material-symbols-outlined flex-shrink-0 text-c-text-muted leading-none" style={{ fontSize: size, width: size }}>
        forum
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="flex-shrink-0 rounded-sm object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}
