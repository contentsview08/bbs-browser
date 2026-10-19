// スマホ: 下へスクロールするとヘッダーとフッターを隠し、上へスクロールすると(どこにいても)すぐ戻す(Twitter などと同じ)。
// 元の Web アプリ(hono-bbs の packages/web/src/hooks/useHideOnScroll.ts)をそのまま持ってきた。
// - ヘッダー・フッターは、本文の上に重ねた帯(sticky・absolute)である前提。transform で動かすだけなので、本文にすき間はできない
// - 出し入れは ref の style を直接書き換える(スクロールのたびに React の描き直しを起こさないため)。CSS の transition で滑らかに動く
// - 開いた直後の、プログラムによるスクロール(未読への飛び・位置の戻し)では隠さない。指で触った(arm)あとだけ隠す
// - 一番下まで来たら、フッターだけは出す(書き込み・更新を押したいはずなので)
// - しきい値は、向きが変わった所からの合計の移動量で見る(1 回のスクロールの差分は数 px しかなく、ゆっくり動かすと発火しないため)
import { useCallback, useRef } from 'react'

export function useHideOnScroll(
  headerRef: React.RefObject<HTMLElement | null>,
  footerRef: React.RefObject<HTMLElement | null>,
  /** フッターを出した・隠したとき(フッターの上に浮かせたボタンを、一緒に動かすため) */
  onFooterVisible?: (visible: boolean) => void,
  /** true を返すあいだは、下へスクロールしてもフッターを隠さない(フッターの入力欄で書いているときなど) */
  keepFooter?: () => boolean,
  threshold = 8,
) {
  const lastTop = useRef(0)
  const direction = useRef<'up' | 'down' | null>(null)
  const anchor = useRef(0)
  const headerHidden = useRef(false)
  const footerHidden = useRef(false)
  const armed = useRef(false)

  const setHeader = useCallback(
    (visible: boolean) => {
      if (headerHidden.current === !visible) return
      headerHidden.current = !visible
      const el = headerRef.current
      if (el) el.style.transform = visible ? '' : 'translateY(-100%)'
    },
    [headerRef],
  )
  const setFooter = useCallback(
    (visible: boolean) => {
      if (footerHidden.current === !visible) return
      footerHidden.current = !visible
      const el = footerRef.current
      if (el) el.style.transform = visible ? '' : 'translateY(100%)'
      onFooterVisible?.(visible)
    },
    [footerRef, onFooterVisible],
  )

  /** 指で触り始めたときに呼ぶ。呼ばれるまでは、スクロールは基準の位置を覚えるだけ */
  const arm = useCallback(() => {
    armed.current = true
  }, [])

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const el = e.currentTarget
      const top = el.scrollTop
      const delta = top - lastTop.current
      lastTop.current = top
      if (!armed.current) {
        anchor.current = top
        return
      }
      const atBottom = top + el.clientHeight >= el.scrollHeight - 2
      if (top <= 0) {
        setHeader(true)
        setFooter(true)
        direction.current = null
        anchor.current = top
        return
      }
      if (atBottom) setFooter(true)
      if (delta === 0) return
      const dir = delta > 0 ? 'down' : 'up'
      if (dir !== direction.current) {
        direction.current = dir
        anchor.current = top
        return
      }
      const moved = top - anchor.current
      if (dir === 'down' && moved > threshold) {
        if (!atBottom) {
          setHeader(false)
          if (!keepFooter?.()) setFooter(false)
        }
      } else if (dir === 'up' && moved < -threshold) {
        setHeader(true)
        setFooter(true)
      }
    },
    [setHeader, setFooter, keepFooter, threshold],
  )
  /** 隠していたヘッダーとフッターを出す(書き込みを始めたときなど) */
  const reveal = useCallback(() => {
    setHeader(true)
    setFooter(true)
  }, [setHeader, setFooter])

  return { onScroll, arm, reveal }
}
