// クールダウンの残り時間。readyAt(この時刻になったら使える)までの残りを、少しずつ数え直して返す。
// 残りがないあいだは時計を回さない

import { useEffect, useState } from 'react'

/** 残り(ms)。0 なら使える。total は残りの割合(輪や帯の長さ)に使うクールダウン全体の長さ */
export function useCountdown(readyAt: number | undefined, total: number): { left: number; ratio: number } {
  const [now, setNow] = useState(() => Date.now())
  const left = Math.max(0, (readyAt ?? 0) - now)
  useEffect(() => {
    if (!readyAt || readyAt <= Date.now()) return
    setNow(Date.now())
    const timer = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= readyAt) clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [readyAt])
  return { left, ratio: total > 0 ? Math.min(1, left / total) : 0 }
}
