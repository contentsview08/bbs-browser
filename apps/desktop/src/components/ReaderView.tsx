// リンクをアプリの中で開く画面(リーダー表示)。スマホの既定。
// - 画像・動画のファイル・YouTube は、そのまま見る(画像は押すとビューアー)
// - ウェブページは、題・サイト名・本文の段落と画像だけを抜き出して出す(utils/reader.ts。埋め込みを断るサイトでも読める)
// - うまく読めないページは「ブラウザで開く」で外のブラウザへ
// 戻るボタン(スマホ)・Esc・左上の ← で閉じる
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { decodeHtml, extractPage, type ReaderPage } from '../utils/reader'
import { isVideoFileUrl, toImageUrl, youtubeEmbedUrl } from '../utils/postBody'
import { isAutoLoadable } from '../utils/safeUrl'
import Lightbox from './Lightbox'
import LoadingCenter from './LoadingCenter'

/** ページを取る(アプリの通信。CORS に縛られない) */
export type FetchPage = (url: string) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>

const BTN = 'p-2.5 rounded-xl text-c-text-muted hover:text-c-text-strong active:bg-c-surface2 transition-colors'

export default function ReaderView(props: { url: string; fetchPage: FetchPage; saveDir: string; onClose: () => void; onOpenExternal: (url: string) => void }) {
  const { url } = props
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  const image = toImageUrl(url)
  const youtube = youtubeEmbedUrl(url)
  const video = isVideoFileUrl(url)
  const media = !!(image || youtube || video)
  const [page, setPage] = useState<ReaderPage>()
  const [error, setError] = useState<string>()
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number }>()

  useEffect(() => {
    if (media) return
    let cancelled = false
    setPage(undefined)
    setError(undefined)
    props
      .fetchPage(url)
      .then((res) => {
        if (cancelled) return
        if (res.status < 200 || res.status >= 300) throw new Error(`ページを読めませんでした(HTTP ${res.status})`)
        const type = res.headers['content-type'] ?? ''
        if (type && !/html|xml/i.test(type)) throw new Error(`ウェブページではありません(${type.split(';')[0]})`)
        setPage(extractPage(decodeHtml(res.body, type), url))
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [url])

  const images = page?.blocks.flatMap((b) => (b.type === 'image' ? [b.src] : [])) ?? []
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })()

  return createPortal(
    <div
      ref={boxRef}
      className="fixed inset-0 z-[9300] flex flex-col bg-panel-view reply-slide"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex-shrink-0 flex items-center gap-1 px-2 border-b border-c-border bg-panel-thread-header" style={{ height: 'var(--header-height, 56px)' }}>
        <button type="button" onClick={props.onClose} className={BTN} title="閉じる">
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-c-text-strong truncate">{page?.title ?? host}</p>
          <p className="text-[11px] text-c-text-muted truncate">{url}</p>
        </div>
        <button type="button" onClick={() => void navigator.clipboard.writeText(url)} className={BTN} title="URL をコピー">
          <span className="material-symbols-outlined text-2xl">content_copy</span>
        </button>
        <button type="button" onClick={() => props.onOpenExternal(url)} className={BTN} title="ブラウザで開く">
          <span className="material-symbols-outlined text-2xl">open_in_new</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {media ? (
          <div className="min-h-full flex items-center justify-center bg-black">
            {youtube ? (
              <iframe
                src={youtube}
                title="YouTube"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="w-full border-0"
                style={{ aspectRatio: '16 / 9' }}
              />
            ) : video ? (
              <video src={url} controls autoPlay playsInline className="max-w-full max-h-full" />
            ) : isAutoLoadable(image!) ? (
              <img src={image} alt="" referrerPolicy="no-referrer" className="max-w-full max-h-full object-contain" onClick={() => setLightbox({ urls: [image!], index: 0 })} />
            ) : (
              <p className="text-white/80 text-sm p-6">家の中のネットワークのアドレスです。ブラウザで開いてください</p>
            )}
          </div>
        ) : error ? (
          <div className="p-6 flex flex-col items-center gap-3 text-center text-sm text-c-text-muted">
            <span className="material-symbols-outlined text-4xl">cloud_off</span>
            {error}
            <button type="button" onClick={() => props.onOpenExternal(url)} className="px-4 py-2 rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)]">
              ブラウザで開く
            </button>
          </div>
        ) : !page ? (
          <LoadingCenter />
        ) : (
          <article className="max-w-2xl mx-auto px-5 py-5 text-c-text-body">
            <p className="text-xs text-c-text-muted mb-1">{page.site}</p>
            <h1 className="text-xl font-bold text-c-text-strong leading-snug mb-4">{page.title}</h1>
            {page.blocks.length === 0 && (
              <p className="text-sm text-c-text-muted">
                本文を取り出せませんでした(中身をあとから組み立てるページかもしれません)。右上の「ブラウザで開く」で読めます
              </p>
            )}
            {page.blocks.map((b, i) => {
              switch (b.type) {
                case 'heading':
                  return (
                    <h2 key={i} className="mt-6 mb-2 text-base font-bold text-c-text-strong">
                      {b.text}
                    </h2>
                  )
                case 'quote':
                  return (
                    <blockquote key={i} className="my-3 pl-3 border-l-2 border-c-border text-c-text-muted leading-relaxed">
                      {b.text}
                    </blockquote>
                  )
                case 'item':
                  return (
                    <p key={i} className="my-1 pl-4 -indent-3 leading-relaxed">
                      ・{b.text}
                    </p>
                  )
                case 'code':
                  return (
                    <pre key={i} className="my-3 p-3 rounded-lg bg-c-surface2 text-xs overflow-x-auto whitespace-pre">
                      {b.text}
                    </pre>
                  )
                case 'image':
                  return isAutoLoadable(b.src) ? (
                    <img
                      key={i}
                      src={b.src}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="my-3 max-w-full h-auto rounded-lg"
                      onClick={() => setLightbox({ urls: images, index: images.indexOf(b.src) })}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : null
                default:
                  return (
                    <p key={i} className="my-3 leading-relaxed whitespace-pre-wrap break-words">
                      {b.text}
                    </p>
                  )
              }
            })}
          </article>
        )}
      </div>
      {lightbox && (
        <Lightbox
          urls={lightbox.urls}
          index={lightbox.index}
          saveDir={props.saveDir}
          onIndex={(index) => setLightbox((l) => l && { ...l, index })}
          onClose={() => setLightbox(undefined)}
          onOpenExternal={props.onOpenExternal}
        />
      )}
    </div>,
    document.body,
  )
}
