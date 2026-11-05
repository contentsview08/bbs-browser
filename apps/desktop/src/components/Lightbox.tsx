// 画像ビューワー。web 版の ImageLightbox.tsx の簡易版。
// - 小さい画像も画面いっぱいの枠に収まるまで引き伸ばして見せ、ワンクリックで保存できる
// - そのレスの中の画像を、ホイール・←→・左右のボタンで切り替える(最後まで行ったら最初に戻る)
// - 画像の下側に本文のパネルを重ねる(web 版のスマホ表示と同じ)。画像を押すとパネルを隠す。絵の外を押したら閉じる
// - Ctrl+ホイールでマウスの位置を中心に拡大・縮小し、拡大中はつかんで動かせる。ダブルクリックで等倍と 2.5 倍を切り替える
// - 動画のファイル(mp4 など)は、その場で再生する(拡大はしない)。再生できない形式なら、ブラウザで開くボタンを出す
// - YouTube は埋め込みのプレーヤーで再生する
// - 2 枚以上なら、下に小さい絵を並べる(何枚あって今どれか。押すとその絵へ飛ぶ)
// - スマホの指の操作は、元の Web アプリ(hono-bbs の ImageLightbox)と同じ:
//   2 本指で拡大(指の真ん中を中心に)、拡大中は 1 本指で動かす(離すと勢いで少し流れ、端からはみ出したら戻る)、
//   2 回たたいて拡大・等倍、上下になぞって閉じる、左右になぞって前後の絵へ。絵をたたくと本文のパネルとボタンを隠す

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { saveImage } from '../host/saveImage'
import { isVideoFileUrl, youtubeEmbedUrl } from '../utils/postBody'
import { isAutoLoadable } from '../utils/safeUrl'
import { isMobile } from '../utils/platform'
import MobileImageViewer from './mobile/MobileImageViewer'
import { mediaSrc } from '../utils/httpsFirst'

interface Props {
  urls: string[]
  index: number
  /** 画像の載っていたレス(本文のパネルに出す)。書き込み欄の画像など、レスでないときは undefined */
  post?: Post
  /** 画像ごとのレス(画像一覧から開いたとき、urls と同じ順)。あれば post より優先する */
  posts?: Post[]
  /** 保存先フォルダ(空ならダウンロードフォルダ) */
  saveDir: string
  onIndex: (i: number) => void
  onClose: () => void
  onOpenExternal: (url: string) => void
}

/** 下に並べる小さい絵の帯の高さ(本文のパネルはこの上に置く) */
const STRIP_H = 72

/** 下の帯に並べる小さい絵 1 つ。動画のファイルは絵がないので印だけ、YouTube は YouTube の小さい絵 */
function StripThumb(props: { url: string; current: boolean; onClick: () => void; label: string }) {
  const { url } = props
  const ref = useRef<HTMLButtonElement>(null)
  // 今の絵が帯の外にあれば、見える所へ送る
  useEffect(() => {
    if (props.current) ref.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [props.current])
  const yt = youtubeEmbedUrl(url) && /(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{6,})/.exec(url)?.[1]
  const video = isVideoFileUrl(url)
  return (
    <button
      ref={ref}
      type="button"
      onClick={props.onClick}
      title={props.label}
      className={`relative flex-shrink-0 w-14 h-14 rounded-md overflow-hidden bg-white/10 transition-all ${
        props.current ? 'ring-2 ring-white opacity-100' : 'opacity-55 hover:opacity-90'
      }`}
    >
      {video ? (
        <span className="absolute inset-0 flex items-center justify-center text-white/80">
          <span className="material-symbols-outlined text-2xl">movie</span>
        </span>
      ) : !isAutoLoadable(url) ? (
        <span className="absolute inset-0 flex items-center justify-center text-white/80">
          <span className="material-symbols-outlined text-xl">lan</span>
        </span>
      ) : (
        <img
          src={yt ? `https://img.youtube.com/vi/${yt}/default.jpg` : mediaSrc(url)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          className="w-full h-full object-cover"
        />
      )}
      {yt && (
        <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">
          <span className="material-symbols-outlined text-xl">play_circle</span>
        </span>
      )}
    </button>
  )
}

const NAV = 'absolute top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white bg-black/40 rounded-full'
const TOOL = 'p-2 text-white/80 hover:text-white rounded-full hover:bg-white/10'

/**
 * object-contain で描いた画像の、実際に絵がある範囲に入っているか。
 * 画像の要素は画面いっぱいの枠なので、絵の周りの余白を押したときは閉じたい
 */
function hitsImage(img: HTMLImageElement, x: number, y: number): boolean {
  const box = img.getBoundingClientRect()
  if (!img.naturalWidth || !img.naturalHeight) return true
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const left = box.left + (box.width - w) / 2
  const top = box.top + (box.height - h) / 2
  return x >= left && x <= left + w && y >= top && y <= top + h
}

type SaveState = { status: 'saving' } | { status: 'saved'; path: string } | { status: 'error'; message: string }

/** ホイール 1 回の操作で何枚も飛ばないよう、切り替えたあとこの間は次を受け付けない */
const WHEEL_COOLDOWN_MS = 250
const MAX_SCALE = 8
/** これだけ動いたらドラッグとみなす(押しただけのときは本文パネルの出し入れ) */
const DRAG_PX = 4

interface Zoom {
  scale: number
  x: number
  y: number
}
const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 }

// ── スマホの指の操作の決まり(元の Web アプリと同じ値) ──
/** これ未満の動きは、まだ縦・横どちらの操作か決めない */
const AXIS_LOCK_PX = 10
/** 画面の高さ(横なら幅)のこの割合だけ動かせば、速さを問わず閉じる */
const DISMISS_RATIO = 0.22
/** 速さで閉じるときの、いちばん短い距離(px)と速さ(px/ms) */
const DISMISS_MIN_PX = 80
const DISMISS_MIN_VELOCITY = 0.5
const DISMISS_ANIM_MS = 220
const TOUCH_MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const TAP_MAX_MOVE = 10
const TAP_MAX_MS = 300
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 40
/** 端からはみ出した分は、この割合しか動かない(ゴムひも) */
const RUBBER = 0.3
/** 離したあとの流れ: 毎フレームこれを速さに掛けて弱め、この速さ(px/ms)を下回ったら止める */
const FRICTION = 0.95
const STOP_VELOCITY = 0.1
const SNAP_MS = 300
/** この倍率以下で指を離したら、等倍に戻す */
const RESET_SNAP_SCALE = 1.15
/** 左右になぞって次の絵へ移る距離 */
const SWIPE_PX = 40

const rubberBand = (v: number, min: number, max: number) => (v > max ? max + (v - max) * RUBBER : v < min ? min - (min - v) * RUBBER : v)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 画面いっぱいに object-contain で描いた絵を、scale 倍にしたときに動かせる幅(真ん中から片側) */
function panBounds(img: HTMLImageElement | null, scale: number): { maxX: number; maxY: number } {
  if (!img?.naturalWidth || !img.naturalHeight) return { maxX: 0, maxY: 0 }
  const w = window.innerWidth
  const h = window.innerHeight
  const fit = Math.min(w / img.naturalWidth, h / img.naturalHeight)
  return { maxX: Math.max(0, (img.naturalWidth * fit * scale - w) / 2), maxY: Math.max(0, (img.naturalHeight * fit * scale - h) / 2) }
}

/**
 * (cx, cy) を中心に、倍率を next にする。画像は画面の真ん中に置いて transform で動かしているので、
 * 指している点が拡大の前後で同じ場所に留まるよう、ずらし量を計算し直す
 */
function zoomAt(z: Zoom, next: number, cx: number, cy: number): Zoom {
  const scale = Math.min(MAX_SCALE, Math.max(1, next))
  if (scale === 1) return NO_ZOOM
  const px = cx - window.innerWidth / 2
  const py = cy - window.innerHeight / 2
  const k = scale / z.scale
  return { scale, x: px - (px - z.x) * k, y: py - (py - z.y) * k }
}

/** スマホは、スマホ用に別に作ったビューアー(components/mobile/MobileImageViewer)を使う */
export default function Lightbox(props: Props) {
  if (isMobile) return <MobileImageViewer {...props} />
  return <DesktopLightbox {...props} />
}

function DesktopLightbox({ urls, index, post: onlyPost, posts, saveDir, onIndex, onClose, onOpenExternal }: Props) {
  const url = urls[index]
  const post = posts?.[index] ?? onlyPost
  const video = isVideoFileUrl(url)
  // 家の中のアドレスは、ビューアーでも「読み込む」を押すまで読みに行かない(ホイールで切り替えて来たときも)
  const [allowLocal, setAllowLocal] = useState<string>()
  const blocked = !isAutoLoadable(url) && allowLocal !== url
  const youtube = youtubeEmbedUrl(url)
  /** 動画を再生できなかった(HEVC の .mov など、WebView が扱えない形式) */
  const [videoError, setVideoError] = useState(false)
  const [save, setSave] = useState<SaveState>()
  const [panelOpen, setPanelOpen] = useState(true)
  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM)
  // 指の操作の途中は、描き直しを待たずに今の値を読みたいので、控えも同時に書き換える
  const zoomRef = useRef(zoom)
  const setZoom = (z: Zoom | ((z: Zoom) => Zoom)) => {
    const next = typeof z === 'function' ? z(zoomRef.current) : z
    zoomRef.current = next
    setZoomState(next)
  }
  const imgRef = useRef<HTMLImageElement>(null)
  // 切り替えた向きにすべり込ませる(開いたときは奥から浮かせる)
  const [shown, setShown] = useState({ index, anim: 'lightbox-open-rise' })
  if (shown.index !== index)
    setShown({ index, anim: index === (shown.index + 1) % urls.length ? 'lightbox-slide-in-right' : 'lightbox-slide-in-left' })
  const dragged = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastWheel = useRef(0)
  const many = urls.length > 1
  // 最後まで行ったら最初に、最初より前は最後に戻る
  const step = (d: number) => onIndex((index + d + urls.length) % urls.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight' && many) onIndex((index + 1) % urls.length)
      else if (e.key === 'ArrowLeft' && many) onIndex((index - 1 + urls.length) % urls.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, urls.length, many, onIndex, onClose])

  // ── スマホ: 指の操作 ──
  /** 'interacting'(指で動かしている)・'momentum'(離したあとの流れ)の間は、CSS のなめらかさを挟まず指に合わせる */
  const [phase, setPhase] = useState<'idle' | 'interacting' | 'momentum' | 'snapping'>('idle')
  /** 閉じるために上下(先頭・最後で左右)になぞっている量 */
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [dragAnimating, setDragAnimating] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const touch = useRef<{
    start: { x: number; y: number; time: number } | null
    axis: 'h' | 'v' | null
    pinch: { dist: number; scale: number } | null
    pan: { x: number; y: number; ox: number; oy: number } | null
    samples: { x: number; y: number; t: number }[]
    lastTap: { time: number; x: number; y: number } | null
    raf: number | null
    snap: number | null
  }>({ start: null, axis: null, pinch: null, pan: null, samples: [], lastTap: null, raf: null, snap: null })
  const gestures = isMobile && !video && !youtube && !blocked

  const cancelAnimations = () => {
    const t = touch.current
    if (t.raf !== null) cancelAnimationFrame(t.raf)
    if (t.snap !== null) clearTimeout(t.snap)
    t.raf = t.snap = null
  }
  /** 指を離した(流れが止まった)あと、はみ出していれば戻す。小さすぎる拡大は等倍に戻す */
  const settle = () => {
    const z = zoomRef.current
    const s0 = clamp(z.scale, 1, TOUCH_MAX_SCALE)
    const scale = s0 <= RESET_SNAP_SCALE ? 1 : s0
    const { maxX, maxY } = panBounds(imgRef.current, scale)
    const next = scale === 1 ? NO_ZOOM : { scale, x: clamp(z.x, -maxX, maxX), y: clamp(z.y, -maxY, maxY) }
    if (next.scale === z.scale && next.x === z.x && next.y === z.y) return setPhase('idle')
    setPhase('snapping')
    setZoom(next)
    touch.current.snap = window.setTimeout(() => {
      touch.current.snap = null
      setPhase('idle')
    }, SNAP_MS)
  }
  /** 離したときの速さで少し流し、弱まったら settle */
  const momentum = (vx: number, vy: number) => {
    if (Math.hypot(vx, vy) < STOP_VELOCITY) return settle()
    setPhase('momentum')
    let v = { x: vx, y: vy }
    let last: number | null = null
    const tick = (ts: number) => {
      const dt = last === null ? 16 : Math.min(48, ts - last)
      last = ts
      v = { x: v.x * FRICTION, y: v.y * FRICTION }
      if (Math.hypot(v.x, v.y) < STOP_VELOCITY) {
        touch.current.raf = null
        return settle()
      }
      const z = zoomRef.current
      const { maxX, maxY } = panBounds(imgRef.current, z.scale)
      setZoom({ scale: z.scale, x: rubberBand(z.x + v.x * dt, -maxX, maxX), y: rubberBand(z.y + v.y * dt, -maxY, maxY) })
      touch.current.raf = requestAnimationFrame(tick)
    }
    touch.current.raf = requestAnimationFrame(tick)
  }
  const dismissFar = (dist: number, ms: number, screen: number) =>
    dist > screen * DISMISS_RATIO || (dist > DISMISS_MIN_PX && dist / Math.max(1, ms) > DISMISS_MIN_VELOCITY)

  const inPanel = (target: EventTarget) => !!panelRef.current?.contains(target as Node)
  const onTouchStart = (e: React.TouchEvent) => {
    // スレ表示のスワイプ(戻るなど)に届かないようにする(ポータルの中の出来事も React では親へ伝わる)
    e.stopPropagation()
    if (!gestures || inPanel(e.target)) return
    cancelAnimations()
    const t = touch.current
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      t.pinch = { dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), scale: zoomRef.current.scale }
      t.start = null
      t.axis = null
      t.pan = null
      setPhase('interacting')
      return
    }
    const p = e.touches[0]
    t.start = { x: p.clientX, y: p.clientY, time: Date.now() }
    t.axis = null
    setDragAnimating(false)
    // 拡大しているときの 1 本指は、いつも絵を動かす(閉じる・切り替えより先)
    const panning = zoomRef.current.scale > 1
    t.pan = panning ? { x: p.clientX, y: p.clientY, ox: zoomRef.current.x, oy: zoomRef.current.y } : null
    t.samples = panning ? [{ x: p.clientX, y: p.clientY, t: performance.now() }] : []
    setPhase(panning ? 'interacting' : 'idle')
  }
  const onTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation()
    if (!gestures || inPanel(e.target)) return
    const t = touch.current
    if (e.touches.length === 2 && t.pinch) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const scale = rubberBand(t.pinch.scale * (Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) / t.pinch.dist), 1, TOUCH_MAX_SCALE)
      // 2 本の指の真ん中が、拡大の前後で同じ場所に留まるようにずらす
      const z = zoomRef.current
      const mx = (a.clientX + b.clientX) / 2 - window.innerWidth / 2
      const my = (a.clientY + b.clientY) / 2 - window.innerHeight / 2
      const { maxX, maxY } = panBounds(imgRef.current, scale)
      setZoom({
        scale,
        x: rubberBand(mx - (scale / z.scale) * (mx - z.x), -maxX, maxX),
        y: rubberBand(my - (scale / z.scale) * (my - z.y), -maxY, maxY),
      })
      return
    }
    const p = e.touches[0]
    if (t.pan) {
      const { maxX, maxY } = panBounds(imgRef.current, zoomRef.current.scale)
      setZoom({
        scale: zoomRef.current.scale,
        x: rubberBand(t.pan.ox + p.clientX - t.pan.x, -maxX, maxX),
        y: rubberBand(t.pan.oy + p.clientY - t.pan.y, -maxY, maxY),
      })
      t.samples.push({ x: p.clientX, y: p.clientY, t: performance.now() })
      if (t.samples.length > 3) t.samples.shift()
      return
    }
    if (!t.start) return
    const dx = p.clientX - t.start.x
    const dy = p.clientY - t.start.y
    if (!t.axis) {
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return
      t.axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h'
    }
    if (t.axis === 'v') setDrag({ x: 0, y: dy })
    // 絵が 1 枚なら、左右になぞっても閉じる(切り替える先がないので)
    else if (!many) setDrag({ x: dx, y: 0 })
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation()
    if (!gestures || inPanel(e.target)) return
    const t = touch.current
    const p = e.changedTouches[0]
    if (t.pinch) {
      t.pinch = null
      t.start = null
      t.axis = null
      t.pan = null
      return settle()
    }
    const wasPanning = !!t.pan
    t.pan = null
    const samples = t.samples
    t.samples = []
    const releasePan = () => {
      const a = samples[0]
      const b = samples[samples.length - 1]
      const dt = a && b ? Math.max(1, b.t - a.t) : 1
      momentum(a && b ? (b.x - a.x) / dt : 0, a && b ? (b.y - a.y) / dt : 0)
    }
    const start = t.start
    const axis = t.axis
    t.start = null
    t.axis = null
    if (!start) return wasPanning ? releasePan() : undefined
    const moved = Math.hypot(p.clientX - start.x, p.clientY - start.y)
    const ms = Date.now() - start.time
    if (moved < TAP_MAX_MOVE && ms < TAP_MAX_MS) {
      const now = Date.now()
      const last = t.lastTap
      // 2 回たたいた: 等倍なら、たたいた所を中心に拡大する。拡大していれば戻す
      if (last && now - last.time < DOUBLE_TAP_MS && Math.hypot(p.clientX - last.x, p.clientY - last.y) < DOUBLE_TAP_PX) {
        e.preventDefault() // 続けて起きる click(本文パネルの出し入れ)を止める
        t.lastTap = null
        setPhase('idle')
        if (zoomRef.current.scale > 1) return setZoom(NO_ZOOM)
        const z = zoomAt(NO_ZOOM, DOUBLE_TAP_SCALE, p.clientX, p.clientY)
        const { maxX, maxY } = panBounds(imgRef.current, z.scale)
        return setZoom({ scale: z.scale, x: clamp(z.x, -maxX, maxX), y: clamp(z.y, -maxY, maxY) })
      }
      t.lastTap = { time: now, x: p.clientX, y: p.clientY }
      if (wasPanning) releasePan()
      return
    }
    if (wasPanning) return releasePan()
    if (axis === 'v' || (axis === 'h' && !many)) {
      const d = axis === 'v' ? p.clientY - start.y : p.clientX - start.x
      setDragAnimating(true)
      if (dismissFar(Math.abs(d), ms, axis === 'v' ? window.innerHeight : window.innerWidth)) {
        setDismissing(true)
        const far = (d > 0 ? 1 : -1) * (axis === 'v' ? window.innerHeight : window.innerWidth)
        setDrag(axis === 'v' ? { x: 0, y: far } : { x: far, y: 0 })
        window.setTimeout(onClose, DISMISS_ANIM_MS)
      } else setDrag({ x: 0, y: 0 })
      return
    }
    const dx = p.clientX - start.x
    if (axis === 'h' && Math.abs(dx) >= SWIPE_PX) step(dx > 0 ? -1 : 1)
  }
  useEffect(() => cancelAnimations, [])

  // 画像を切り替えたら、保存の結果表示と拡大を戻す
  useEffect(() => {
    setSave(undefined)
    cancelAnimations()
    setZoom(NO_ZOOM)
    setPhase('idle')
    setDrag({ x: 0, y: 0 })
    setDragAnimating(false)
    setDismissing(false)
    setVideoError(false)
  }, [url])

  /** スマホ: 絵をたたいて本文のパネルを隠したら、ボタン類も隠して絵だけにする */
  const chromeHidden = isMobile && !panelOpen
  const hideClass = chromeHidden ? 'opacity-0 pointer-events-none transition-opacity duration-200' : ''
  /** 閉じる途中は、遠ざかるほど薄く小さく */
  const dismissProgress = dismissing ? Math.min(1, Math.max(Math.abs(drag.y) / window.innerHeight, Math.abs(drag.x) / window.innerWidth)) : 0

  // ホイール: Ctrl つきなら拡大・縮小、なしなら画像の切り替え。
  // Ctrl+ホイールは WebView の画面の拡大と取り合いにならないよう、既定の動きを止める(passive: false が要る)
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return // 本文パネルの中は、パネルのスクロール
      if (e.ctrlKey) {
        e.preventDefault()
        if (videoRef.current) return // 動画は拡大しない
        const z = zoomRef.current
        setZoom(zoomAt(z, z.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY))
        return
      }
      if (!many || e.deltaY === 0) return
      const now = Date.now()
      if (now - lastWheel.current < WHEEL_COOLDOWN_MS) return
      lastWheel.current = now
      stepRef.current(e.deltaY > 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [many])

  /** 拡大しているときは、つかんで動かす */
  const onImageMouseDown = (e: React.MouseEvent) => {
    dragged.current = false
    if (zoomRef.current.scale === 1 || e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const start = zoomRef.current
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (Math.abs(dx) + Math.abs(dy) > DRAG_PX) dragged.current = true
      setZoom({ ...start, x: start.x + dx, y: start.y + dy })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const doSave = async () => {
    setSave({ status: 'saving' })
    try {
      setSave({ status: 'saved', path: await saveImage(url, saveDir) })
    } catch (e) {
      setSave({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  // body の直下に出す。アプリの枠は背景画像のために重なりの基準を独立させている(isolate)ので、
  // 枠の中に置くと、最前面に出しているレスのポップアップより下に描かれてしまう
  return createPortal(
    <div
      ref={overlayRef}
      data-lightbox
      className="fixed inset-0 bg-black/90 z-[10000] flex items-center justify-center overflow-hidden"
      // スマホ: ブラウザの拡大・スクロールと取り合わないよう、指の操作はすべてここで受ける
      style={isMobile ? { touchAction: 'none', opacity: 1 - dismissProgress * 0.6 } : undefined}
      onClick={() => {
        // 絵をドラッグして絵の外で離したときは閉じない(click が背景で起きる)
        if (dragged.current) return
        onClose()
      }}
      onTouchStart={isMobile ? onTouchStart : undefined}
      onTouchMove={isMobile ? onTouchMove : undefined}
      onTouchEnd={isMobile ? onTouchEnd : undefined}
    >
      {blocked ? (
        <div className="flex flex-col items-center gap-3 text-white/80 text-sm text-center" onClick={(e) => e.stopPropagation()}>
          <span className="material-symbols-outlined text-5xl">lan</span>
          家の中のネットワーク(または自分の PC)のアドレスです
          <span className="text-xs text-white/60 break-all max-w-[80vw]">{url}</span>
          <button type="button" onClick={() => setAllowLocal(url)} className="px-3 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white">
            読み込む
          </button>
        </div>
      ) : youtube ? (
        // YouTube は埋め込みのプレーヤーで再生する。16:9 で、枠に収まる大きさにする。
        // 埋め込みを断っている動画は、プレーヤーの中に YouTube の案内が出る(右上の「ブラウザで開く」で見られる)
        <iframe
          key={url}
          src={youtube}
          title="YouTube"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="lightbox-open-rise bg-black border-0"
          style={{ width: 'min(92vw, calc(86vh * 16 / 9))', aspectRatio: '16 / 9' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : video ? (
        videoError ? (
          // 再生できない形式。ブラウザ(ふつうは再生できる)で開けるようにする
          <div className="flex flex-col items-center gap-3 text-white/80 text-sm" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-5xl">videocam_off</span>
            この動画を再生できませんでした
            <span className="text-xs text-white/60 text-center">
              配信元がアプリからの再生を断っているか、アプリでは再生できない形式(iPhone の .mov など)です
            </span>
            <button type="button" onClick={() => onOpenExternal(url)} className="px-3 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white">
              ブラウザで開く
            </button>
          </div>
        ) : (
          // 動画は拡大しない。枠に収まる大きさで出し、すぐ再生する(操作は動画の下のバー)
          <video
            ref={videoRef}
            key={url}
            src={mediaSrc(url)}
            controls
            autoPlay
            playsInline
            className="max-w-[92vw] max-h-[86vh] lightbox-open-rise bg-black"
            onClick={(e) => e.stopPropagation()}
            onError={() => setVideoError(true)}
          />
        )
      ) : (
      /* 枠いっぱいに収める(小さい画像は引き伸ばす)。スマホは画面いっぱい */
      <div
        className={isMobile ? 'absolute inset-0' : 'contents'}
        style={
          isMobile
            ? {
                transform: `translate(${drag.x}px, ${drag.y}px) scale(${1 - dismissProgress * 0.3})`,
                transition: dragAnimating ? `transform ${DISMISS_ANIM_MS}ms ease-out` : 'none',
                pointerEvents: dismissing ? 'none' : undefined,
              }
            : undefined
        }
      >
      <img
        ref={imgRef}
        key={url}
        src={mediaSrc(url)}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        className={`${isMobile ? 'w-full h-full' : 'w-[92vw] h-[86vh]'} object-contain ${shown.anim} select-none ${zoom.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{
          // ずらしてから拡大する(指の動きと絵の動きが、倍率によらず同じになる)
          transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
          willChange: isMobile ? 'transform' : undefined,
          transition: !isMobile ? undefined : phase === 'snapping' ? `transform ${SNAP_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)` : phase === 'idle' ? 'transform 200ms ease-out' : 'none',
        }}
        onMouseDown={onImageMouseDown}
        onClick={(e) => {
          // 動かしたあとは何もしない。絵の上なら本文のパネルを出し入れし、絵の周りの余白なら背景と同じく閉じる
          if (dragged.current) {
            e.stopPropagation()
            return
          }
          if (!hitsImage(e.currentTarget, e.clientX, e.clientY)) return
          e.stopPropagation()
          setPanelOpen((v) => !v)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (isMobile) return // スマホは指の操作(2 回たたく)で拡大する
          setZoom((z) => (z.scale > 1 ? NO_ZOOM : zoomAt(z, 2.5, e.clientX, e.clientY)))
        }}
      />
      </div>
      )}

      {/* 本文のパネル。画像の下側に半透明で重ねる(動画と YouTube は、操作バーに重なるので出さない) */}
      {/* スマホ: 元の Web アプリと同じく、下の端にぴったり付けた黒いパネル。本文は 6 行ほどで止め、その中でスクロールする */}
      {isMobile && post && !video && !youtube && (
        <div
          ref={panelRef}
          className={`absolute inset-x-0 max-h-[60%] flex flex-col bg-black/80 backdrop-blur-sm px-4 pt-3 pb-4 text-white ${hideClass}`}
          style={{ bottom: many ? STRIP_H : 0, paddingBottom: many ? undefined : 'calc(env(safe-area-inset-bottom) + 16px)', touchAction: 'pan-y' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1.5 text-xs">
            <span className="font-bold text-white/70">{post.no}</span>
            <span className="font-bold" style={{ color: '#a9bbff' }}>
              {post.name}
            </span>
            <span className="text-white/60">{post.date}</span>
            {post.id && <span className="font-mono text-white/60">ID:{post.id}</span>}
          </div>
          <p className="pl-3 border-l-2 border-white/25 text-sm leading-relaxed whitespace-pre-wrap break-words max-h-[9.75em] overflow-y-auto">{post.body}</p>
        </div>
      )}
      {!isMobile && panelOpen && post && !video && !youtube && (
        <div
          ref={panelRef}
          className="absolute left-1/2 -translate-x-1/2 w-[min(92vw,900px)] max-h-[34vh] overflow-y-auto custom-scrollbar rounded-xl px-5 py-3 text-white backdrop-blur-md"
          style={{ background: 'rgba(0, 0, 0, 0.62)', bottom: many ? STRIP_H + 8 : 16 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 text-xs text-white/70 mb-1.5">
            <span className="font-bold text-white">{post.no}</span>
            <span className="font-bold text-white/90 truncate">{post.name}</span>
            <span className="whitespace-nowrap">{post.date}</span>
            {post.id && <span className="font-mono">ID:{post.id}</span>}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{post.body}</p>
        </div>
      )}
      <div
        className={`absolute top-3 right-3 flex items-center gap-1 ${hideClass}`}
        style={isMobile ? { top: 'calc(env(safe-area-inset-top) + 8px)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {zoom.scale > 1 && (
          <button type="button" className="text-white/70 hover:text-white text-sm tabular-nums mr-1" title="等倍に戻す" onClick={() => setZoom(NO_ZOOM)}>
            {Math.round(zoom.scale * 100)}%
          </button>
        )}
        <span className="text-white/70 text-sm tabular-nums mr-2">
          {index + 1} / {urls.length}
        </span>
        {!youtube && (
        <button
          type="button"
          className={TOOL}
          title={saveDir ? `保存 (${saveDir})` : '保存 (ダウンロードフォルダ)'}
          onClick={() => void doSave()}
          disabled={save?.status === 'saving'}
        >
          <span className={`material-symbols-outlined text-2xl ${save?.status === 'saving' ? 'animate-spin' : ''}`}>
            {save?.status === 'saving' ? 'progress_activity' : 'download'}
          </span>
        </button>
        )}
        <button type="button" className={TOOL} title="ブラウザで開く" onClick={() => onOpenExternal(url)}>
          <span className="material-symbols-outlined text-2xl">open_in_new</span>
        </button>
        <button type="button" className={TOOL} title="閉じる (Esc)" onClick={onClose}>
          <span className="material-symbols-outlined text-3xl">close</span>
        </button>
      </div>

      {save && save.status !== 'saving' && (
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-black/70 text-sm text-white"
          onClick={(e) => e.stopPropagation()}
        >
          {save.status === 'saved' ? (
            <>
              <span className="material-symbols-outlined text-lg text-green-400">check_circle</span>
              <span className="max-w-[50vw] truncate">保存しました: {save.path}</span>
              <button type="button" className="underline text-white/80 hover:text-white" onClick={() => void revealItemInDir(save.path)}>
                フォルダで表示
              </button>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-lg text-red-400">error</span>
              <span className="max-w-[60vw] truncate">保存できませんでした: {save.message}</span>
            </>
          )}
        </div>
      )}

      {/* 下の帯: 何枚あって今どれか。押すとその絵へ飛ぶ */}
      {many && (
        <div
          className={`absolute bottom-0 inset-x-0 flex items-center justify-center gap-3 px-4 ${hideClass}`}
          style={
            isMobile
              ? { height: `calc(${STRIP_H}px + env(safe-area-inset-bottom))`, paddingBottom: 'env(safe-area-inset-bottom)', background: 'rgba(0,0,0,0.8)' }
              : { height: STRIP_H, background: 'linear-gradient(transparent, rgba(0,0,0,0.55))' }
          }
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex-shrink-0 text-white/80 text-sm tabular-nums">
            {index + 1} / {urls.length}
          </span>
          <div className="min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1">
            {urls.map((u, i) => (
              <StripThumb key={`${i}:${u}`} url={u} current={i === index} onClick={() => onIndex(i)} label={`${i + 1} 枚目`} />
            ))}
          </div>
        </div>
      )}
      {many && (
        <button
          type="button"
          className={`${NAV} left-4 ${hideClass}`}
          onClick={(e) => {
            e.stopPropagation()
            step(-1)
          }}
        >
          <span className="material-symbols-outlined text-3xl">chevron_left</span>
        </button>
      )}
      {many && (
        <button
          type="button"
          className={`${NAV} right-4 ${hideClass}`}
          onClick={(e) => {
            e.stopPropagation()
            step(1)
          }}
        >
          <span className="material-symbols-outlined text-3xl">chevron_right</span>
        </button>
      )}
    </div>,
    document.body,
  )
}
