// 戻る・進む。見たもの(スレ一覧・スレ)を見た順に覚え、ブラウザのように行き来する。
// 戻る・進むで動いている途中に起きた「見た」は覚えない(履歴が書き換わらないように)

import { useCallback, useRef, useState } from 'react'

export interface NavEntry<T> {
  /** 同じものかどうか(同じものが続けて来たら 1 つにまとめる) */
  key: string
  value: T
}

/** 覚えておく数 */
const MAX = 50

export function useNavHistory<T>(apply: (value: T) => void) {
  const stack = useRef<NavEntry<T>[]>([])
  const index = useRef(-1)
  const moving = useRef(false)
  // ボタンの押せる・押せないを描き直すための数
  const [, setVersion] = useState(0)
  const applyRef = useRef(apply)
  applyRef.current = apply

  /** 見たものを覚える。いまの場所より先(進むで行けた分)は捨てる */
  const push = useCallback((entry: NavEntry<T>) => {
    if (moving.current) return
    if (stack.current[index.current]?.key === entry.key) {
      stack.current[index.current] = entry // 中身(スレの情報など)だけ新しくする
      return
    }
    stack.current = [...stack.current.slice(0, index.current + 1), entry].slice(-MAX)
    index.current = stack.current.length - 1
    setVersion((v) => v + 1)
  }, [])

  const go = useCallback((d: -1 | 1) => {
    const next = index.current + d
    const entry = stack.current[next]
    if (!entry) return
    index.current = next
    moving.current = true
    try {
      applyRef.current(entry.value)
    } finally {
      // apply の中で同期的に起きた「見た」だけを覚えないようにする(非同期の続きは push の key で重ならない)
      moving.current = false
    }
    setVersion((v) => v + 1)
  }, [])

  return {
    push,
    back: useCallback(() => go(-1), [go]),
    forward: useCallback(() => go(1), [go]),
    canBack: index.current > 0,
    canForward: index.current < stack.current.length - 1,
  }
}
