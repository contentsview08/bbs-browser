// OS のダーク・ライト。切り替わったら描き直す(配色の明るさで変える色を、OS に合わせて決め直すため)
import { useEffect, useState } from 'react'

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

export function useOsDark(): boolean {
  const [dark, setDark] = useState(() => query().matches)
  useEffect(() => {
    const media = query()
    const onChange = () => setDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return dark
}
