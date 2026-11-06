// スレの画像一覧。スレの中の画像・動画のファイル・YouTube をタイル状に並べる。
// 押すとビューアーで開き(一覧の順に切り替えられる)、「まとめて保存」か、選んだものを保存する。
// 選び方: 空いている所からドラッグ・Ctrl+クリック・Shift+クリック。スマホ幅は長押しで選び始め、そのあとは押すたびに足し引きする。
// 画像は画面に見えたものから読む(loading="lazy")。動画は最初のコマに要る分だけ読む

import { useEffect, useRef, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { imageUrlsIn, videoFileUrlsIn, youtubeLinksIn } from '../utils/postBody'
import { cachedImages, cancelImageFetch, saveImage } from '../host/saveImage'
import { COPY_LIMITS, hostKey, runLimited, SAVE_LIMITS } from '../utils/limitedRun'
import { edgeScrollSpeed, rectFrom, selectByRect, selectRange, toggled, type Point, type Rect } from '../utils/rectSelect'
import { isMobile } from '../utils/platform'
import { useLongPress } from '../hooks/useLongPress'
import { isAutoLoadable } from '../utils/safeUrl'
import LocalAddressMark from './LocalAddressMark'
import { videoSrc } from '../utils/httpsFirst'
import { LazyVideoThumb, ThumbImage } from './MediaFailed'
import { canPlayVideo } from '../utils/videoSupport'

export type MediaKind = 'image' | 'video' | 'youtube'

export interface MediaItem {
  url: string
  kind: MediaKind
  post: Post
  /** YouTube のサムネイル */
  thumb?: string
}

/** スレのレスから、画像・動画・YouTube を出てくる順に集める(同じ URL は 1 つに) */
export function collectMedia(posts: Post[]): MediaItem[] {
  const seen = new Set<string>()
  const out: MediaItem[] = []
  const add = (item: MediaItem) => {
    if (seen.has(item.url)) return
    seen.add(item.url)
    out.push(item)
  }
  for (const p of posts) {
    for (const url of imageUrlsIn(p.body)) add({ url, kind: 'image', post: p })
    for (const url of videoFileUrlsIn(p.body)) add({ url, kind: 'video', post: p })
    for (const v of youtubeLinksIn(p.body)) add({ url: v.url, kind: 'youtube', post: p, thumb: `https://img.youtube.com/vi/${v.id}/mqdefault.jpg` })
  }
  return out
}

const KINDS: { key: MediaKind; name: string }[] = [
  { key: 'image', name: '画像' },
  { key: 'video', name: '動画' },
  { key: 'youtube', name: 'YouTube' },
]

interface SaveProgress {
  done: number
  total: number
  failed: number
  skipped: number
  fromCache: number
  finished?: boolean
  stopped?: boolean
}

/** ドラッグと見なす動きの大きさ */
const DRAG_PX = 4

export default function MediaGallery(props: {
  items: MediaItem[]
  /** 画像をぼかすレス(グロ注意)の番号 */
  blurNos?: Set<number>
  saveDir: string
  /** 押したものをビューアーで開く(見せている順のまま渡す) */
  onOpen: (items: MediaItem[], index: number) => void
  onClose: () => void
}) {
  const [kinds, setKinds] = useState<Set<MediaKind>>(new Set(['image', 'video', 'youtube']))
  const shown = useMemo(() => props.items.filter((m) => kinds.has(m.kind)), [props.items, kinds])
  const counts = useMemo(() => {
    const c: Record<MediaKind, number> = { image: 0, video: 0, youtube: 0 }
    for (const m of props.items) c[m.kind]++
    return c
  }, [props.items])
  const [saving, setSaving] = useState<SaveProgress>()
  const busy = !!saving && !saving.finished
  const stopSaving = useRef<() => void>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef<string>(undefined)
  /** 種類で隠したものは選択に数えない。YouTube は保存できないので選べない */
  const selectable = useMemo(() => shown.filter((m) => m.kind !== 'youtube'), [shown])
  const selectedFiles = useMemo(() => selectable.filter((m) => picked.has(m.url)), [selectable, picked])

  /** 画像と動画のファイルを保存する(家の中のアドレスは一度に読みに行かない)。キャッシュにあるものを先に写し、ないものだけ控えめに取る */
  const saveFiles = async (files: MediaItem[], clearAfter: boolean) => {
    if (files.length === 0) return
    const urls = files.filter((m) => isAutoLoadable(m.url)).map((m) => m.url)
    const progress: SaveProgress = { done: 0, total: urls.length, failed: 0, skipped: files.length - urls.length, fromCache: 0, finished: urls.length === 0 }
    setSaving({ ...progress })
    if (urls.length === 0) return
    const stop = new AbortController()
    const running = new Set<string>()
    stopSaving.current = () => {
      stop.abort()
      running.forEach(cancelImageFetch)
      setSaving({ ...progress, finished: true, stopped: true })
    }
    const work = async (url: string) => {
      running.add(url)
      try {
        const saved = await saveImage(url, props.saveDir)
        if (saved.fromCache) progress.fromCache++
      } catch {
        progress.failed++
      }
      running.delete(url)
      progress.done++
      if (!stop.signal.aborted) setSaving({ ...progress })
    }
    const cached = await cachedImages(urls).catch(() => [] as boolean[])
    await runLimited(urls.filter((_, i) => cached[i]), { limits: COPY_LIMITS, keyOf: hostKey, work, signal: stop.signal })
    await runLimited(urls.filter((_, i) => !cached[i]), { limits: SAVE_LIMITS, keyOf: hostKey, work, signal: stop.signal })
    if (stop.signal.aborted) return
    setSaving({ ...progress, finished: true })
    if (clearAfter && progress.failed === 0) setPicked(new Set())
  }

  const clickTile = (m: MediaItem, index: number, e: React.MouseEvent) => {
    const canSelect = m.kind !== 'youtube'
    if (e.shiftKey) {
      if (canSelect) setPicked((p) => selectRange(selectable.map((x) => x.url), anchor.current, m.url, p, e.ctrlKey || e.metaKey))
      return
    }
    if (e.ctrlKey || e.metaKey || (isMobile && picked.size > 0)) {
      if (!canSelect) return
      anchor.current = m.url
      setPicked((p) => toggled(p, m.url))
      return
    }
    props.onOpen(shown, index)
  }

  const scrollerRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ start: Point; pointer: Point; moved: boolean; additive: boolean; base: ReadonlySet<string>; tiles: { key: string; rect: Rect }[]; frame: number }>(undefined)
  useEffect(() => () => cancelAnimationFrame(drag.current?.frame ?? 0), [])

  const contentPoint = (el: HTMLElement, x: number, y: number): Point => {
    const box = el.getBoundingClientRect()
    return { x: x - box.left + el.scrollLeft, y: y - box.top + el.scrollTop }
  }
  const applyDrag = () => {
    const d = drag.current
    const el = scrollerRef.current
    const band = bandRef.current
    if (!d || !el || !band || !d.moved) return
    const rect = rectFrom(d.start, contentPoint(el, d.pointer.x, d.pointer.y))
    // 動かすたびに一覧を描き直さないよう、帯は直接動かす
    band.style.display = 'block'
    band.style.left = `${rect.left}px`
    band.style.top = `${rect.top}px`
    band.style.width = `${rect.right - rect.left}px`
    band.style.height = `${rect.bottom - rect.top}px`
    const next = selectByRect(rect, d.tiles, d.base, d.additive)
    setPicked((p) => (p.size === next.size && [...next].every((k) => p.has(k)) ? p : next))
  }
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (isMobile || e.pointerType !== 'mouse' || e.button !== 0 || (e.target as Element).closest('[data-tile]')) return
    const box = el.getBoundingClientRect()
    // スクロールバーをつかんだとき
    if (e.clientX >= box.left + el.clientWidth || e.clientY >= box.top + el.clientHeight) return
    const additive = e.ctrlKey || e.metaKey
    const tiles = [...el.querySelectorAll<HTMLElement>('[data-tile][data-selectable]')].map((tile) => {
      const r = tile.getBoundingClientRect()
      const a = contentPoint(el, r.left, r.top)
      return { key: tile.dataset.tile!, rect: { left: a.x, top: a.y, right: a.x + r.width, bottom: a.y + r.height } }
    })
    el.setPointerCapture(e.pointerId)
    const d = { start: contentPoint(el, e.clientX, e.clientY), pointer: { x: e.clientX, y: e.clientY }, moved: false, additive, base: picked, tiles, frame: 0 }
    drag.current = d
    const tick = () => {
      const speed = d.moved ? edgeScrollSpeed(d.pointer.y, box.top, box.bottom) : 0
      if (speed !== 0) {
        el.scrollTop += speed
        applyDrag()
      }
      d.frame = requestAnimationFrame(tick)
    }
    d.frame = requestAnimationFrame(tick)
  }
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.pointer = { x: e.clientX, y: e.clientY }
    const at = contentPoint(e.currentTarget, e.clientX, e.clientY)
    if (Math.hypot(at.x - d.start.x, at.y - d.start.y) >= DRAG_PX) d.moved = true
    applyDrag()
  }
  const endDrag = () => {
    const d = drag.current
    if (!d) return
    cancelAnimationFrame(d.frame)
    drag.current = undefined
    if (bandRef.current) bandRef.current.style.display = 'none'
    // 空いている所を押しただけなら、選択を外す
    if (!d.moved && !d.additive) setPicked(new Set())
  }

  const boxRef = useRef<HTMLDivElement>(null)

  useFocusTrap(boxRef, () => (picked.size > 0 ? setPicked(new Set()) : props.onClose()))
  const backdrop = useBackdropClose(props.onClose)

  return createPortal(
    <div className="fixed inset-0 z-[9600] bg-black/60 flex items-center justify-center p-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-5xl h-[85vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-5 pr-2 py-2.5 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong whitespace-nowrap">
            画像一覧 <span className="ml-1 text-sm font-normal text-c-text-muted">{shown.length}</span>
          </h2>
          <div className="flex items-center gap-1.5">
            {KINDS.filter((k) => counts[k.key] > 0).map((k) => {
              const on = kinds.has(k.key)
              return (
                <button
                  key={k.key}
                  type="button"
                  onClick={() =>
                    setKinds((s) => {
                      const next = new Set(s)
                      if (next.has(k.key)) next.delete(k.key)
                      else next.add(k.key)
                      return next
                    })
                  }
                  className={`px-2.5 py-1 text-xs border rounded-full transition-colors ${
                    on ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border text-c-text-muted hover:border-c-border-strong'
                  }`}
                >
                  {k.name} {counts[k.key]}
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {saving && (
              <span className={`text-xs tabular-nums ${saving.failed > 0 ? 'text-c-heat-very-hot' : 'text-c-text-muted'}`}>
                {saving.stopped ? 'やめました' : saving.finished ? '保存しました' : '保存中'} {saving.done} / {saving.total}
                {saving.fromCache > 0 && `(キャッシュから ${saving.fromCache} 枚)`}
                {saving.failed > 0 && `(${saving.failed} 件失敗)`}
                {saving.skipped > 0 && `(家の中のアドレス ${saving.skipped} 件は除外)`}
              </span>
            )}
            {selectedFiles.length > 0 && !busy && (
              <button type="button" onClick={() => setPicked(new Set())} className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] text-c-text-muted hover:bg-c-surface2" title="選ぶのをやめます(Esc)">
                解除
              </button>
            )}
            {busy ? (
              <button type="button" onClick={() => stopSaving.current?.()} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:bg-c-surface2">
                <span className="material-symbols-outlined text-base">stop</span>
                やめる
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void (selectedFiles.length > 0 ? saveFiles(selectedFiles, true) : saveFiles(selectable, false))}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover disabled:opacity-50"
                title={`${selectedFiles.length > 0 ? '選んだもの' : '見せている画像と動画'}を ${props.saveDir || 'ダウンロードフォルダ'} に保存します(YouTube と家の中のアドレスは除く)`}
              >
                <span className="material-symbols-outlined text-base">download</span>
                {selectedFiles.length > 0 ? `選んだものを保存(${selectedFiles.length})` : 'まとめて保存'}
              </button>
            )}
            <button type="button" onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>
        <div
          ref={scrollerRef}
          className="relative flex-1 overflow-y-auto custom-scrollbar p-4 select-none"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {shown.length === 0 ? (
            <p className="text-sm text-c-text-muted">{props.items.length === 0 ? 'このスレには画像も動画もありません' : '選んだ種類のものはありません'}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
              {shown.map((m, i) => (
                <GalleryTile
                  key={m.url}
                  item={m}
                  blur={!!props.blurNos?.has(m.post.no)}
                  picked={picked.has(m.url)}
                  onClick={(e) => clickTile(m, i, e)}
                  onLongPress={
                    isMobile && m.kind !== 'youtube'
                      ? () => {
                          anchor.current = m.url
                          setPicked((p) => toggled(p, m.url))
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          <div ref={bandRef} className="absolute hidden pointer-events-none border border-c-accent bg-[var(--c-accent-wash)] rounded-sm z-10" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function GalleryTile(props: { item: MediaItem; blur: boolean; picked: boolean; onClick: (e: React.MouseEvent) => void; onLongPress?: () => void }) {
  const m = props.item
  const longPress = useLongPress(props.onLongPress)
  return (
    <button
      type="button"
      data-tile={m.url}
      data-selectable={m.kind !== 'youtube' ? '' : undefined}
      aria-pressed={props.picked}
      {...longPress}
      onClick={props.onClick}
      className={`relative aspect-square bg-c-surface2 border rounded overflow-hidden hover:border-c-accent transition-colors ${
        props.picked ? 'border-c-accent ring-2 ring-[var(--c-accent)]' : 'border-c-border'
      } ${props.blur ? 'gross-blur' : ''}`}
      style={m.kind === 'youtube' ? { borderColor: '#ff0000', borderWidth: 2 } : undefined}
      title={`>>${m.post.no}`}
    >
      {!isAutoLoadable(m.thumb ?? m.url) ? (
        <LocalAddressMark />
      ) : m.kind === 'video' && !canPlayVideo(m.url) ? null : m.kind === 'video' ? (
        <LazyVideoThumb src={videoSrc(`${m.url}#t=0.1`)} className="w-full h-full object-cover pointer-events-none bg-black" />
      ) : (
        <ThumbImage src={m.thumb ?? m.url} className="w-full h-full object-cover" />
      )}
      {m.kind !== 'image' && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined fill text-4xl text-white/90 drop-shadow">play_circle</span>
        </span>
      )}
      <span className="absolute left-1 bottom-1 px-1 rounded bg-black/70 text-white text-[10px] font-bold tabular-nums pointer-events-none">
        &gt;&gt;{m.post.no}
      </span>
      {props.picked && (
        <span className="absolute right-1 top-1 w-5 h-5 flex items-center justify-center rounded-full bg-c-accent text-[var(--c-accent-text)] pointer-events-none">
          <span className="material-symbols-outlined text-sm leading-none">check</span>
        </span>
      )}
    </button>
  )
}
