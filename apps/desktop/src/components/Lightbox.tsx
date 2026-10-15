// 画像ビューワー。web 版の ImageLightbox.tsx の簡易版(←→で切り替え、Esc で閉じる)

import { useEffect } from 'react'

interface Props {
  urls: string[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onOpenExternal: (url: string) => void
}

const NAV = 'absolute top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white bg-black/40 rounded-full'

export default function Lightbox({ urls, index, onIndex, onClose, onOpenExternal }: Props) {
  const url = urls[index]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && index < urls.length - 1) onIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, urls.length, onIndex, onClose])

  return (
    <div className="fixed inset-0 bg-black/90 z-[10000] flex items-center justify-center" onClick={onClose}>
      <img
        key={url}
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="max-w-[92vw] max-h-[88vh] object-contain lightbox-open-rise"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <span className="text-white/70 text-sm tabular-nums">
          {index + 1} / {urls.length}
        </span>
        <button type="button" className="p-2 text-white/80 hover:text-white" title="ブラウザで開く" onClick={() => onOpenExternal(url)}>
          <span className="material-symbols-outlined text-2xl">open_in_new</span>
        </button>
        <button type="button" className="p-2 text-white/80 hover:text-white" title="閉じる (Esc)" onClick={onClose}>
          <span className="material-symbols-outlined text-3xl">close</span>
        </button>
      </div>
      {index > 0 && (
        <button
          type="button"
          className={`${NAV} left-4`}
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
        >
          <span className="material-symbols-outlined text-3xl">chevron_left</span>
        </button>
      )}
      {index < urls.length - 1 && (
        <button
          type="button"
          className={`${NAV} right-4`}
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index + 1)
          }}
        >
          <span className="material-symbols-outlined text-3xl">chevron_right</span>
        </button>
      )}
    </div>
  )
}
