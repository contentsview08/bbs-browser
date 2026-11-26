// リンクのパネルの枠。画像ビューアーと同じく画面全体を暗くし、真ん中に(幅・高さの 3 分の 2 ほど)帯 + ページの枠を出す。
// ページそのものは Rust が置く枠のない小さな窓(host/linkPanel.ts)で、この枠の内側(ref の矩形)に重なる。窓の大きさが変わったら位置を合わせ直す。
// 周りの暗がりを押す・Esc・× で閉じる
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closeLinkPanel, linkPanelUrl, moveLinkPanel, nextPanelId, openLinkPanel, type PanelRect } from '../host/linkPanel'
import { backgroundError } from '../utils/backgroundError'

const ICON_BTN = 'w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10'

export default function LinkPanelFrame(props: { url: string; onClose: () => void; onOpenExternal: (url: string) => void }) {
  const inner = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(props.url)
  /** 窓を作れなかったときの理由(枠の中に出す) */
  const [error, setError] = useState<string>()
  /** 最後に頼んだ「開く」の通し番号(閉じるときに渡す) */
  const opened = useRef(0)
  const rectOf = (): PanelRect | undefined => {
    const el = inner.current
    if (!el) return undefined
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  // 開く(位置は枠を描いてから測る)。URL が変われば同じ窓で開き直す
  useLayoutEffect(() => {
    const rect = rectOf()
    setError(undefined)
    if (rect) {
      const id = nextPanelId()
      opened.current = id
      void openLinkPanel(props.url, rect, id).catch((e) => {
        setError(String(e))
        backgroundError('リンクのパネル')(e)
      })
    }
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
  // ページの中で移った先の URL を帯に(1 秒ごとに聞く。外のページからは知らせが来ない)
  useEffect(() => {
    const t = setInterval(() => void linkPanelUrl().then((u) => u && setCurrent(u), () => undefined), 1000)
    return () => clearInterval(t)
  }, [])
  // 閉じるときは窓も消す
  useEffect(() => () => void closeLinkPanel(opened.current).catch(() => undefined), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="fixed inset-0 z-[9600] bg-black/75 flex items-center justify-center" data-modal onClick={props.onClose}>
      <div className="flex flex-col w-[66vw] min-w-[560px] max-w-[1200px] h-[70vh] min-h-[360px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex-shrink-0 flex items-center gap-2 px-2 h-11">
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
        {/* この内側にページの窓が重なる */}
        <div ref={inner} className="flex-1 min-h-0 rounded-lg bg-c-base flex items-center justify-center p-6">
          {error && <p className="text-sm text-c-mark-danger break-all">ページの窓を作れませんでした: {error}</p>}
        </div>
      </div>
    </div>
  )
}
