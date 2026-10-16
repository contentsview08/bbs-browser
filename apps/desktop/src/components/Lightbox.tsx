// 画像ビューワー。web 版の ImageLightbox.tsx の簡易版。
// - 小さい画像も画面いっぱいの枠に収まるまで引き伸ばして見せ、ワンクリックで保存できる
// - そのレスの中の画像を、ホイール・←→・左右のボタンで切り替える(最後まで行ったら最初に戻る)
// - 画像の下側に本文のパネルを重ねる(web 版のスマホ表示と同じ)。画像を押すとパネルを隠す。絵の外を押したら閉じる
// - Ctrl+ホイールでマウスの位置を中心に拡大・縮小し、拡大中はつかんで動かせる。ダブルクリックで等倍と 2.5 倍を切り替える

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { saveImage } from '../host/saveImage'

interface Props {
  urls: string[]
  index: number
  /** 画像の載っていたレス(本文のパネルに出す)。書き込み欄の画像など、レスでないときは undefined */
  post?: Post
  /** 保存先フォルダ(空ならダウンロードフォルダ) */
  saveDir: string
  onIndex: (i: number) => void
  onClose: () => void
  onOpenExternal: (url: string) => void
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

export default function Lightbox({ urls, index, post, saveDir, onIndex, onClose, onOpenExternal }: Props) {
  const url = urls[index]
  const [save, setSave] = useState<SaveState>()
  const [panelOpen, setPanelOpen] = useState(true)
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const dragged = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastWheel = useRef(0)
  const many = urls.length > 1
  // 最後まで行ったら最初に、最初より前は最後に戻る
  const step = (d: number) => onIndex((index + d + urls.length) % urls.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && many) onIndex((index + 1) % urls.length)
      else if (e.key === 'ArrowLeft' && many) onIndex((index - 1 + urls.length) % urls.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, urls.length, many, onIndex, onClose])

  // 画像を切り替えたら、保存の結果表示と拡大を戻す
  useEffect(() => {
    setSave(undefined)
    setZoom(NO_ZOOM)
  }, [url])

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
    <div ref={overlayRef} className="fixed inset-0 bg-black/90 z-[10000] flex items-center justify-center overflow-hidden" onClick={onClose}>
      {/* 枠いっぱいに収める(小さい画像は引き伸ばす) */}
      <img
        key={url}
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        className={`w-[92vw] h-[86vh] object-contain lightbox-open-rise select-none ${zoom.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
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
          setZoom((z) => (z.scale > 1 ? NO_ZOOM : zoomAt(z, 2.5, e.clientX, e.clientY)))
        }}
      />

      {/* 本文のパネル。画像の下側に半透明で重ねる */}
      {panelOpen && post && (
        <div
          ref={panelRef}
          className="absolute left-1/2 -translate-x-1/2 bottom-4 w-[min(92vw,900px)] max-h-[34vh] overflow-y-auto custom-scrollbar rounded-xl px-5 py-3 text-white backdrop-blur-md"
          style={{ background: 'rgba(0, 0, 0, 0.62)' }}
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
      <div className="absolute top-3 right-3 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {zoom.scale > 1 && (
          <button type="button" className="text-white/70 hover:text-white text-sm tabular-nums mr-1" title="等倍に戻す" onClick={() => setZoom(NO_ZOOM)}>
            {Math.round(zoom.scale * 100)}%
          </button>
        )}
        <span className="text-white/70 text-sm tabular-nums mr-2">
          {index + 1} / {urls.length}
        </span>
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

      {many && (
        <button
          type="button"
          className={`${NAV} left-4`}
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
          className={`${NAV} right-4`}
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
