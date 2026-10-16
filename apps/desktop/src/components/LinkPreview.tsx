// リンクの埋め込みのカード。web 版の LinkPreviewCard.tsx の見た目を移植。
// 画面に見えたときに初めてページを取りに行く(スレを開いただけで全部のリンクを取りに行かないように)

import { useEffect, useRef, useState } from 'react'
import { fetchOgp } from '../host/ogp'
import type { Ogp } from '../utils/ogp'
import { isAutoLoadable } from '../utils/safeUrl'

export default function LinkPreview({ url, onOpen, more }: { url: string; onOpen: (url: string) => void; more?: number }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [state, setState] = useState<{ ogp: Ogp | null } | 'loading' | 'idle'>('idle')

  useEffect(() => {
    const el = ref.current
    // 家の中のアドレスは、表示しただけでは読みに行かない
    if (!el || !isAutoLoadable(url)) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      setState('loading')
      void fetchOgp(url).then((ogp) => setState({ ogp }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [url])

  // 何も取れなかったとき・家の中のアドレスのときは出さない(リンクの文字そのものは本文にある)
  if ((typeof state === 'object' && !state.ogp) || !isAutoLoadable(url)) return null
  const ogp = typeof state === 'object' ? state.ogp : undefined
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })()

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(url)
      }}
      className="relative flex w-full max-w-xl h-20 text-left bg-c-surface2 border border-c-border rounded-[var(--card-radius)] overflow-hidden hover:border-c-border-strong transition-colors"
    >
      <div className="flex-1 min-w-0 p-2 flex flex-col justify-center gap-0.5">
        {!ogp ? (
          <span className="text-[10px] text-c-text-muted">読み込み中...</span>
        ) : (
          <>
            <p className="text-xs font-medium text-c-text-strong line-clamp-2 leading-snug break-all">{ogp.title || url}</p>
            {ogp.description && <p className="text-[10px] text-c-text-muted line-clamp-1">{ogp.description}</p>}
            <p className="text-[10px] text-c-text-muted truncate">{ogp.siteName || host}</p>
          </>
        )}
      </div>
      {ogp?.image && isAutoLoadable(ogp.image) && (
        <div className="w-28 h-full flex-shrink-0 bg-c-surface3">
          <img
            src={ogp.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
      )}
      {more !== undefined && more > 0 && (
        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded leading-none pointer-events-none">
          +{more}件のリンク
        </span>
      )}
    </button>
  )
}
