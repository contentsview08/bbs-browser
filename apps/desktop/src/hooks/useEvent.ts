// いつも最新の処理を呼ぶが、関数そのものは変わらない(描き直しても同じもの)を返す。
// 部品に渡す関数が描き直しのたびに作り直されると、memo で「変わっていないから描き直さない」が効かなくなるため

import { useCallback, useLayoutEffect, useRef } from 'react'

export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
