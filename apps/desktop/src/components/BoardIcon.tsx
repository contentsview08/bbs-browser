// 板のファビコン。上書き(設定)があればそれ、なければ板のページから探す。読めなければ汎用のアイコン

import { useEffect, useState } from 'react'
import { detectFavicon } from '../host/favicon'

export default function BoardIcon({ boardUrl, override, size = 16 }: { boardUrl: string; override?: string; size?: number }) {
  const [src, setSrc] = useState(override)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (override) {
      setSrc(override)
      return
    }
    let alive = true
    setSrc(undefined)
    void detectFavicon(boardUrl).then((url) => {
      if (alive) setSrc(url)
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
