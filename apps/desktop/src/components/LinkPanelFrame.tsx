// リンクのパネルの枠。画像ビューアーと同じく画面全体を暗くし、上に帯(URL・ブラウザで開く・閉じる)を出す。
// ページそのものは Rust が置く子の webview(host/linkPanel.ts)で、この枠の内側(ref の矩形)に重なる。窓の大きさが変わったら位置を合わせ直す
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closeLinkPanel, linkPanelUrl, moveLinkPanel, openLinkPanel, type PanelRect } from '../host/linkPanel'
import { backgroundError } from '../utils/backgroundError'

const ICON_BTN = 'w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10'

export default function LinkPanelFrame(props: { url: string; onClose: () => void; onOpenExternal: (url: string) => void }) {
  const inner = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(props.url)
  const rectOf = (): PanelRect | undefined => {
    const el = inner.current
    if (!el) return undefined
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  // 開く(位置は枠を描いてから測る)。URL が変われば同じ webview で開き直す
  useLayoutEffect(() => {
    const rect = rectOf()
    if (rect) void openLinkPanel(props.url, rect).catch(backgroundError('リンクのパネル'))
    setCurrent(props.url)
  }, [props.url])
  // 窓の大きさに合わせる
  useEffect(() => {
    const on = () => {
      const rect = rectOf()
      if (rect) void moveLinkPanel(rect).catch(() => undefined)
    }
    window.addEventListener('resize', on)
    const ro = new ResizeObserver(on)
    if (inner.current) ro.observe(inner.current)
    return () => {
      window.removeEventListener('resize', on)
      ro.disconnect()
    }
  }, [])
  // ページの中で移った先の URL を帯に(1 秒ごとに聞く。子の webview からは知らせが来ない)
  useEffect(() => {
    const t = setInterval(() => void linkPanelUrl().then((u) => u && setCurrent(u), () => undefined), 1000)
    return () => clearInterval(t)
  }, [])
  // 閉じるときは子の webview も消す
  useEffect(() => () => void closeLinkPanel().catch(() => undefined), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="fixed inset-0 z-[9600] bg-black/75 flex flex-col" data-modal onClick={props.onClose}>
      <div className="flex-shrink-0 flex items-center gap-2 px-4 h-12" onClick={(e) => e.stopPropagation()}>
        <span className="material-symbols-outlined text-white/70">public</span>
        <span className="flex-1 min-w-0 truncate text-sm text-white/90" title={current}>
          {current}
        </span>
        <button type="button" className={ICON_BTN} title="ブラウザで開く" onClick={() => props.onOpenExternal(current)}>
          <span className="material-symbols-outlined">open_in_new</span>
        </button>
        <button type="button" className={ICON_BTN} title="閉じる (Esc)" onClick={props.onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      {/* この内側に子の webview が重なる(左右と下に暗がりを残す) */}
      <div className="flex-1 min-h-0 px-6 pb-6" onClick={(e) => e.stopPropagation()}>
        <div ref={inner} className="w-full h-full rounded-lg bg-c-base" />
      </div>
    </div>
  )
}
