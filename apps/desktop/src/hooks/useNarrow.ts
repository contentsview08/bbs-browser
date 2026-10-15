// ウィンドウが縦長(または狭い)かどうか。縦長ではスレ一覧をしまって、スレ表示だけにする

import { useEffect, useState } from 'react'

/** この幅より狭いときも、縦長と同じ扱いにする */
const MIN_WIDE = 760

function isNarrow(): boolean {
  return window.innerWidth < window.innerHeight || window.innerWidth < MIN_WIDE
}

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    const onResize = () => setNarrow(isNarrow())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}
