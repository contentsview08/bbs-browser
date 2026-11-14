// PC の画像ビューアー(スマホは mobile/MobileImageViewer)。小さい画像も枠いっぱいまで引き伸ばす。
// ホイール・←→ で切り替え、Ctrl+ホイールとダブルクリックで拡大する。画像の下側に本文のパネルを重ね、絵の外を押したら閉じる。
// 動画のファイルと YouTube はその場で再生する(拡大はしない)

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { saveImage, type SaveTo } from '../host/saveImage'
import { isVideoFileUrl, youtubeEmbedUrl } from '../utils/postBody'
import { isAutoLoadable } from '../utils/safeUrl'
import { isMobile } from '../utils/platform'
import MobileImageViewer from './mobile/MobileImageViewer'
import { mediaSrc, videoSrc } from '../utils/httpsFirst'
import { VideoPlaybackHelp, ViewerImageFailed } from './MediaFailed'
import { canPlayVideo } from '../utils/videoSupport'

interface Props {
  urls: string[]
  index: number
  /** 画像の載っていたレス(本文のパネルに出す)。書き込み欄の画像など、レスでないときは undefined */
  post?: Post
  /** 画像ごとのレス(画像一覧から開いたとき、urls と同じ順)。あれば post より優先する */
  posts?: Post[]
  /** 保存先(土台のフォルダが空ならダウンロードフォルダ) */
  saveTo: SaveTo
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

export default function Lightbox(props: Props) {
  if (isMobile) return <MobileImageViewer {...props} />
  return <DesktopLightbox {...props} />
}

function DesktopLightbox({ urls, index, post: onlyPost, posts, saveTo, onIndex, onClose, onOpenExternal }: Props) {
  const url = urls[index]
  const post = posts?.[index] ?? onlyPost
  const video = isVideoFileUrl(url)
  // 家の中のアドレスは、ビューアーでも「読み込む」を押すまで読みに行かない(ホイールで切り替えて来たときも)
  const [allowLocal, setAllowLocal] = useState<string>()
  const blocked = !isAutoLoadable(url) && allowLocal !== url
  const youtube = youtubeEmbedUrl(url)
  /** 動画を再生できなかった(HEVC の .mov など、WebView が扱えない形式) */
  const [videoError, setVideoError] = useState(false)
  /** 画像を取得できなかった。数を変えると取り直す */
  const [imageError, setImageError] = useState(false)
  const [imageAttempt, setImageAttempt] = useState(0)
  const [save, setSave] = useState<SaveState>()
  // 開いた直後は画像を広く見せるため、本文のパネルは出さない(絵をクリックすると出る)
  const [panelOpen, setPanelOpen] = useState(false)
  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM)
  // ホイール・ドラッグの途中は、描き直しを待たずに今の値を読みたいので、控えも同時に書き換える
  const zoomRef = useRef(zoom)
  const setZoom = (z: Zoom | ((z: Zoom) => Zoom)) => {
    const next = typeof z === 'function' ? z(zoomRef.current) : z
    zoomRef.current = next
    setZoomState(next)
  }
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

  // 画像を切り替えたら、保存の結果表示と拡大を戻す
  useEffect(() => {
    setSave(undefined)
    setZoom(NO_ZOOM)
    setVideoError(false)
    setImageError(false)
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
      setSave({ status: 'saved', path: (await saveImage(url, saveTo, post?.no)).path })
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
      onMouseDown={() => {
        dragged.current = false
      }}
      onClick={() => {
        // 絵をドラッグして絵の外で離したときは閉じない(click が背景で起きる)
        if (dragged.current) return
        onClose()
      }}
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
        !canPlayVideo(url) ? (
          <div className="flex flex-col items-center gap-3 text-white/80">
            <span className="material-symbols-outlined text-5xl">videocam_off</span>
            <VideoPlaybackHelp dark onOpenExternal={() => onOpenExternal(url)} />
          </div>
        ) : videoError ? (
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
            src={videoSrc(url)}
            controls
            autoPlay
            playsInline
            className="max-w-[92vw] max-h-[86vh] lightbox-open-rise bg-black"
            onClick={(e) => e.stopPropagation()}
            onError={() => setVideoError(true)}
          />
        )
      ) : imageError ? (
        <ViewerImageFailed
          onRetry={() => {
            setImageError(false)
            setImageAttempt((n) => n + 1)
          }}
          onOpenExternal={() => onOpenExternal(url)}
        />
      ) : (
      /* 枠いっぱいに収める(小さい画像は引き伸ばす) */
      <img
        key={`${url}:${imageAttempt}`}
        src={mediaSrc(url)}
        onError={() => setImageError(true)}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        className={`w-[92vw] h-[86vh] object-contain ${shown.anim} select-none ${zoom.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{
          // ずらしてから拡大する(マウスの動きと絵の動きが、倍率によらず同じになる)
          transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
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
          setZoom((z) => (z.scale > 1 ? NO_ZOOM : zoomAt(z, 2.5, e.clientX, e.clientY)))
        }}
      />
      )}

      {/* 本文のパネル。画像の下側に半透明で重ねる(動画と YouTube は、操作バーに重なるので出さない) */}
      {panelOpen && post && !video && !youtube && (
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
        className="absolute top-3 right-3 flex items-center gap-1"
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
          title={saveTo.dir ? `保存 (${saveTo.dir})` : '保存 (ダウンロードフォルダ)'}
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
          className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-3 px-4"
          style={{ height: STRIP_H, background: 'linear-gradient(transparent, rgba(0,0,0,0.55))' }}
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
