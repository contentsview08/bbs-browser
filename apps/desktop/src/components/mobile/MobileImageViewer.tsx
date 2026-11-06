// スマホの画像ビューアー(PC の Lightbox とは別に作ったもの)。スマホの写真ビューアー(Google フォトなど)と同じ操作:
// - 左右になぞると前後の絵へ(隣の絵は前もって読んでおき、指に付いてすべってくる)
// - 2 本指で拡大、拡大中は 1 本指で動かす(離すと勢いで流れ、端からはみ出したら戻る)。2 回たたくと、たたいた所を拡大・等倍
// - 上か下へなぞると閉じる(なぞった分だけ背景が透ける)。左上の ×・戻るでも閉じる。背景をたたいても閉じない
// - 1 回たたくと、上下の帯(閉じる・何枚目か・本文)を出し入れする
// - 長押しで、保存・URL のコピー・ブラウザで開く
// 指の動きのあいだは React の描き直しをせず、位置(transform)を直接書き換える(描き直すと重く、カクつく)
import { buzz } from '../../utils/haptics'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { isVideoFileUrl, youtubeEmbedUrl } from '../../utils/postBody'
import { isAutoLoadable } from '../../utils/safeUrl'
import { saveMediaMobile } from '../../utils/saveMediaMobile'
import ActionSheet from '../ActionSheet'
import { mediaSrc } from '../../utils/httpsFirst'

/** 動き方。どの動きも、同じ曲線(すっと動いて、やわらかく止まる)と時間でそろえる */
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const MOVE_MS = 260
const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 280
const LONG_PRESS_MS = 450
const SLOP = 8
/** 端からはみ出した分は、この割合しか動かない(ゴムひも) */
const RUBBER = 0.35
const FRICTION = 0.94

const rubber = (v: number, min: number, max: number) => (v > max ? max + (v - max) * RUBBER : v < min ? min - (min - v) * RUBBER : v)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

interface Props {
  urls: string[]
  index: number
  post?: Post
  posts?: Post[]
  onIndex: (i: number) => void
  onClose: () => void
  onOpenExternal: (url: string) => void
}

export default function MobileImageViewer(props: Props) {
  const { urls, index } = props
  const n = urls.length
  const at = (d: number) => (index + d + n) % n
  const boxRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const [chrome, setChrome] = useState(true)
  const [sheet, setSheet] = useState(false)
  const [toast, setToast] = useState<string>()
  const [allowLocal, setAllowLocal] = useState(new Set<string>())
  useFocusTrap(boxRef, props.onClose)

  // ── 位置(描き直さずに書き換える) ──
  const z = useRef({ s: 1, x: 0, y: 0 })
  const applyZoom = (animate = false) => {
    const el = zoomRef.current
    if (!el) return
    el.style.transition = animate ? `transform ${MOVE_MS}ms ${EASE}` : 'none'
    el.style.transform = `translate3d(${z.current.x}px, ${z.current.y}px, 0) scale(${z.current.s})`
  }
  const setTrack = (dx: number, dy: number, animate = false) => {
    const el = trackRef.current
    if (!el) return
    el.style.transition = animate ? `transform ${MOVE_MS}ms ${EASE}` : 'none'
    el.style.transform = `translate3d(calc(-100vw + ${dx}px), ${dy}px, 0)`
    const bg = bgRef.current
    if (bg) {
      bg.style.transition = animate ? `opacity ${MOVE_MS}ms ${EASE}` : 'none'
      bg.style.opacity = String(1 - Math.min(1, Math.abs(dy) / (window.innerHeight * 0.6)))
    }
  }
  /** 拡大した絵を動かせる幅(真ん中から片側) */
  const bounds = (s: number) => {
    const img = zoomRef.current?.querySelector('img')
    const W = window.innerWidth
    const H = window.innerHeight
    if (!img?.naturalWidth) return { mx: 0, my: 0 }
    const fit = Math.min(W / img.naturalWidth, H / img.naturalHeight)
    return { mx: Math.max(0, (img.naturalWidth * fit * s - W) / 2), my: Math.max(0, (img.naturalHeight * fit * s - H) / 2) }
  }
  const settle = () => {
    const s = clamp(z.current.s, 1, MAX_SCALE)
    const { mx, my } = bounds(s)
    z.current = s <= 1.05 ? { s: 1, x: 0, y: 0 } : { s, x: clamp(z.current.x, -mx, mx), y: clamp(z.current.y, -my, my) }
    applyZoom(true)
  }

  // 絵が変わったら、並びを真ん中に戻し、拡大も戻す(描き直したあと、目に見える前に)
  useLayoutEffect(() => {
    z.current = { s: 1, x: 0, y: 0 }
    applyZoom()
    setTrack(0, 0)
  }, [index])

  // ── 指の操作 ──
  const g = useRef<{
    mode: 'none' | 'undecided' | 'swipe' | 'dismiss' | 'pan' | 'pinch'
    sx: number
    sy: number
    t: number
    ox: number
    oy: number
    pinch?: { d: number; s: number; mx: number; my: number; x: number; y: number }
    samples: { x: number; y: number; t: number }[]
    moved: boolean
    longTimer?: ReturnType<typeof setTimeout>
    raf?: number
    lastTap?: { t: number; x: number; y: number }
    tapTimer?: ReturnType<typeof setTimeout>
  }>({ mode: 'none', sx: 0, sy: 0, t: 0, ox: 0, oy: 0, samples: [], moved: false })
  useEffect(
    () => () => {
      clearTimeout(g.current.longTimer)
      clearTimeout(g.current.tapTimer)
      if (g.current.raf) cancelAnimationFrame(g.current.raf)
    },
    [],
  )

  const onTouchStart = (e: React.TouchEvent) => {
    // 操作シートは portal でも、タッチは React の木を通ってここへ届く。シートの上の操作を絵の操作にしない
    if (sheet) return
    // 動画の操作バー・YouTube は、その部品の操作に任せる
    if ((e.target as HTMLElement).closest('video, iframe, [data-viewer-ui]')) return
    const s = g.current
    if (s.raf) cancelAnimationFrame(s.raf)
    clearTimeout(s.longTimer)
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      s.mode = 'pinch'
      s.pinch = {
        d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        s: z.current.s,
        mx: (a.clientX + b.clientX) / 2 - window.innerWidth / 2,
        my: (a.clientY + b.clientY) / 2 - window.innerHeight / 2,
        x: z.current.x,
        y: z.current.y,
      }
      return
    }
    const t = e.touches[0]
    s.sx = t.clientX
    s.sy = t.clientY
    s.t = performance.now()
    s.ox = z.current.x
    s.oy = z.current.y
    s.moved = false
    s.samples = [{ x: t.clientX, y: t.clientY, t: s.t }]
    s.mode = z.current.s > 1.01 ? 'pan' : 'undecided'
    // 長押し: 動かさずに置いたままなら、操作のメニュー
    s.longTimer = setTimeout(() => {
      if (!s.moved && s.mode !== 'pinch') {
        s.mode = 'none'
        buzz(15)
        setSheet(true)
      }
    }, LONG_PRESS_MS)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const s = g.current
    if (s.mode === 'none') return
    if (s.mode === 'pinch' && e.touches.length === 2 && s.pinch) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const p = s.pinch
      const scale = rubber(p.s * (Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) / p.d), 1, MAX_SCALE)
      const mx = (a.clientX + b.clientX) / 2 - window.innerWidth / 2
      const my = (a.clientY + b.clientY) / 2 - window.innerHeight / 2
      // 2 本の指の真ん中が、絵の同じ所を指し続けるように(指ごと動かせば、絵も動く)
      z.current = { s: scale, x: mx - (scale / p.s) * (p.mx - p.x), y: my - (scale / p.s) * (p.my - p.y) }
      applyZoom()
      return
    }
    const t = e.touches[0]
    const dx = t.clientX - s.sx
    const dy = t.clientY - s.sy
    if (!s.moved && Math.hypot(dx, dy) > SLOP) {
      s.moved = true
      clearTimeout(s.longTimer)
    }
    if (!s.moved) return
    if (s.mode === 'pan') {
      const { mx, my } = bounds(z.current.s)
      z.current = { s: z.current.s, x: rubber(s.ox + dx, -mx, mx), y: rubber(s.oy + dy, -my, my) }
      applyZoom()
      s.samples.push({ x: t.clientX, y: t.clientY, t: performance.now() })
      if (s.samples.length > 4) s.samples.shift()
      return
    }
    if (s.mode === 'undecided') s.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss'
    if (s.mode === 'swipe') setTrack(n > 1 ? dx : dx * RUBBER, 0)
    else if (s.mode === 'dismiss') setTrack(0, dy)
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = g.current
    clearTimeout(s.longTimer)
    const mode = s.mode
    if (mode === 'pinch') {
      // 指が 1 本残っていれば、そのまま動かすに移る
      if (e.touches.length === 1) {
        const t = e.touches[0]
        s.mode = z.current.s > 1.01 ? 'pan' : 'none'
        s.sx = t.clientX
        s.sy = t.clientY
        s.ox = z.current.x
        s.oy = z.current.y
        s.moved = true
        s.samples = []
        if (s.mode === 'none') settle()
        return
      }
      s.mode = 'none'
      return settle()
    }
    s.mode = 'none'
    if (mode === 'none') return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.sx
    const dy = t.clientY - s.sy
    const ms = Math.max(1, performance.now() - s.t)
    // たたいた: 2 回なら拡大・等倍、1 回なら(2 回目を少し待ってから)帯の出し入れ
    if (!s.moved) {
      const now = performance.now()
      const last = s.lastTap
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 40) {
        clearTimeout(s.tapTimer)
        s.lastTap = undefined
        if (z.current.s > 1.01) z.current = { s: 1, x: 0, y: 0 }
        else {
          const sc = DOUBLE_TAP_SCALE
          const px = t.clientX - window.innerWidth / 2
          const py = t.clientY - window.innerHeight / 2
          const { mx, my } = bounds(sc)
          z.current = { s: sc, x: clamp(-px * (sc - 1), -mx, mx), y: clamp(-py * (sc - 1), -my, my) }
        }
        applyZoom(true)
        return
      }
      s.lastTap = { t: now, x: t.clientX, y: t.clientY }
      s.tapTimer = setTimeout(() => setChrome((v) => !v), DOUBLE_TAP_MS)
      return
    }
    if (mode === 'pan') {
      // 離したときの速さで少し流す
      const a = s.samples[0]
      const b = s.samples[s.samples.length - 1]
      let vx = a && b ? (b.x - a.x) / Math.max(1, b.t - a.t) : 0
      let vy = a && b ? (b.y - a.y) / Math.max(1, b.t - a.t) : 0
      let last = performance.now()
      const tick = (now: number) => {
        const dt = Math.min(32, now - last)
        last = now
        vx *= FRICTION
        vy *= FRICTION
        if (Math.hypot(vx, vy) < 0.05) return settle()
        const { mx, my } = bounds(z.current.s)
        z.current = { s: z.current.s, x: rubber(z.current.x + vx * dt, -mx, mx), y: rubber(z.current.y + vy * dt, -my, my) }
        applyZoom()
        s.raf = requestAnimationFrame(tick)
      }
      s.raf = requestAnimationFrame(tick)
      return
    }
    const W = window.innerWidth
    if (mode === 'swipe') {
      const go = n > 1 && (Math.abs(dx) > W * 0.2 || Math.abs(dx) / ms > 0.4) ? (dx < 0 ? 1 : -1) : 0
      setTrack(go ? -go * W : 0, 0, true)
      if (go) setTimeout(() => props.onIndex(at(go)), MOVE_MS)
      return
    }
    if (mode === 'dismiss') {
      const H = window.innerHeight
      if (Math.abs(dy) > H * 0.15 || Math.abs(dy) / ms > 0.5) {
        setTrack(0, dy > 0 ? H : -H, true)
        setTimeout(props.onClose, MOVE_MS)
      } else setTrack(0, 0, true)
    }
  }

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showToast = (text: string) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(undefined), 2500)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const save = async () => {
    showToast('保存しています…')
    try {
      showToast(`${await saveMediaMobile(urls[index])} に保存しました`)
    } catch (e) {
      showToast(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const post = props.posts?.[index] ?? props.post
  const slot = (d: number) => {
    const i = at(d)
    const url = urls[i]
    const current = d === 0
    const blocked = !isAutoLoadable(url) && !allowLocal.has(url)
    let content
    if (blocked)
      content = (
        <div data-viewer-ui className="flex flex-col items-center gap-3 text-white/80 text-sm text-center px-6">
          <span className="material-symbols-outlined text-5xl">lan</span>
          家の中のネットワークのアドレスです
          <button type="button" onClick={() => setAllowLocal((s) => new Set(s).add(url))} className="px-4 py-2 rounded-xl bg-white/15 text-white">
            読み込む
          </button>
        </div>
      )
    else if (youtubeEmbedUrl(url))
      content = current ? (
        <iframe
          src={youtubeEmbedUrl(url)}
          title="YouTube"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="w-full border-0"
          style={{ aspectRatio: '16 / 9' }}
        />
      ) : null
    else if (isVideoFileUrl(url)) content = current ? <video src={mediaSrc(url)} controls autoPlay playsInline className="max-w-full max-h-full" /> : null
    else
      content = (
        <div ref={current ? zoomRef : undefined} className="relative w-full h-full flex items-center justify-center will-change-transform">
          {/* 読み込んでいる間の印(読み込めたら外す) */}
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="material-symbols-outlined text-4xl text-white/70 animate-spin">progress_activity</span>
          </span>
          <img
            src={mediaSrc(url)}
            alt=""
            draggable={false}
            decoding="async"
            referrerPolicy="no-referrer"
            className="relative max-w-full max-h-full object-contain select-none"
            onLoad={(e) => hideSpinner(e.currentTarget)}
            onError={(e) => {
              hideSpinner(e.currentTarget)
              e.currentTarget.style.display = 'none'
              const note = e.currentTarget.nextElementSibling as HTMLElement | null
              if (note) note.hidden = false
            }}
          />
          <div hidden className="relative text-center text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-5xl block">broken_image</span>
            画像を取得できませんでした
            <a href={url} target="_blank" rel="noreferrer" className="block mt-3 underline">
              ブラウザで開く
            </a>
          </div>
        </div>
      )
    return (
      // 2 枚のときは前と次が同じ絵になるので、key を分ける(重なると古い要素が残る)
      <div key={n === 2 && d === 1 ? `${i}:${url}:next` : `${i}:${url}`} className="w-screen h-full flex-shrink-0 flex items-center justify-center overflow-hidden">
        {content}
      </div>
    )
  }

  return createPortal(
    <div
      ref={boxRef}
      data-lightbox
      className="fixed inset-0 z-[10000] overflow-hidden lightbox-open-rise"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div ref={bgRef} className="absolute inset-0 bg-black" />
      {/* 前・今・次の 3 枚を横に並べ、真ん中を見せる。なぞると並びごと動く */}
      <div ref={trackRef} className="absolute inset-0 flex will-change-transform" style={{ width: '300vw', transform: 'translate3d(-100vw, 0, 0)' }}>
        {n > 1 ? [slot(-1), slot(0), slot(1)] : [<div key="a" className="w-screen flex-shrink-0" />, slot(0), <div key="b" className="w-screen flex-shrink-0" />]}
      </div>

      {/* 上の帯: 閉じる・何枚目か・操作 */}
      <div
        data-viewer-ui
        className={`absolute top-0 inset-x-0 flex items-center gap-1 px-1 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-200 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(env(safe-area-inset-top) + 56px)' }}
      >
        <button type="button" onClick={props.onClose} className="w-11 h-11 flex items-center justify-center rounded-full text-white active:bg-white/15" title="閉じる">
          <span className="material-symbols-outlined text-[26px]">close</span>
        </button>
        <span className="flex-1 text-center text-white/90 text-sm tabular-nums">{n > 1 ? `${index + 1} / ${n}` : ''}</span>
        <button type="button" onClick={() => setSheet(true)} className="w-11 h-11 flex items-center justify-center rounded-full text-white active:bg-white/15" title="操作">
          <span className="material-symbols-outlined text-[26px]">more_vert</span>
        </button>
      </div>

      {/* 下の帯: 画像の載っていたレス */}
      {post && (
        <div
          data-viewer-ui
          className={`absolute bottom-0 inset-x-0 max-h-[40%] overflow-y-auto px-4 pt-6 text-white bg-gradient-to-t from-black/80 via-black/60 to-transparent transition-opacity duration-200 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)', touchAction: 'pan-y' }}
        >
          <div className="flex items-center gap-2 mb-1 text-xs text-white/70">
            <span className="font-bold text-white/85">{post.no}</span>
            <span className="font-bold" style={{ color: '#a9bbff' }}>
              {post.name}
            </span>
            {post.id && <span className="font-mono">ID:{post.id}</span>}
          </div>
          <p className="selectable text-sm leading-relaxed whitespace-pre-wrap break-words line-clamp-6">{post.body}</p>
        </div>
      )}

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/80 text-white text-sm toast-in" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
          {toast}
        </div>
      )}

      {sheet && (
        <ActionSheet
          zIndex={10010}
          onClose={() => setSheet(false)}
          items={[
            { label: '保存', icon: 'download', onClick: () => void save() },
            { label: 'URL をコピー', icon: 'link', onClick: () => void navigator.clipboard.writeText(urls[index]).then(() => showToast('URL をコピーしました')) },
            { label: 'ブラウザで開く', icon: 'open_in_new', onClick: () => props.onOpenExternal(urls[index]) },
          ]}
        />
      )}
    </div>,
    document.body,
  )
}

/** 読み込んでいる間の印(画像のすぐ前の要素)を隠す。React が持っている要素なので、消さずに隠すだけにする */
function hideSpinner(img: HTMLImageElement) {
  const spinner = img.previousElementSibling
  if (spinner instanceof HTMLElement) spinner.style.display = 'none'
}
