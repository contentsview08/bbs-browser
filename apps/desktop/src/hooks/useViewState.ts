// 画面の状態(utils/viewState.ts)を持つ。値はいつも ref から読むので、非同期の処理の途中や古い描画の関数からでも、いまの状態が見える。
// 変えるのは update(関数) だけ(描き直しはそのたびに頼む)

import { useCallback, useRef, useState } from 'react'
import { initialView, type ViewState } from '../utils/viewState'

export function useViewState<T>() {
  const ref = useRef<ViewState<T>>(initialView<T>())
  const [, setVersion] = useState(0)
  const update = useCallback((fn: (s: ViewState<T>) => ViewState<T>) => {
    const next = fn(ref.current)
    if (next === ref.current) return
    ref.current = next
    setVersion((v) => v + 1)
  }, [])
  return { view: ref, update }
}
