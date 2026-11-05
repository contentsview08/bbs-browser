// 画像を取得できなかったときの表示。サムネイルとビューアーで言葉をそろえる(スマホ版の ui/Images.kt・Viewer.kt と同じ言葉)
import { useState } from 'react'
import { mediaSrc } from '../utils/httpsFirst'

/** サムネイルの中の画像。読めなければ理由の代わりに印を出し、押すと取り直す(ビューアーは開かない) */
export function ThumbImage(props: { src: string; className: string }) {
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  if (state === 'failed')
    return (
      <span
        role="button"
        tabIndex={0}
        className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-c-surface2 text-c-text-muted text-center leading-tight"
        title="画像を取得できませんでした。押すと取り直します"
        onClick={(e) => {
          e.stopPropagation()
          setState('loading')
          setAttempt((n) => n + 1)
        }}
      >
        <span className="material-symbols-outlined text-xl leading-none">broken_image</span>
        <span className="text-[10px]">取得できません</span>
        <span className="text-[10px]">押して再試行</span>
      </span>
    )
  return (
    <>
      {state === 'loading' && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined text-xl text-c-text-muted animate-spin">progress_activity</span>
        </span>
      )}
      <img
        key={attempt}
        src={mediaSrc(props.src)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={props.className}
        onLoad={() => setState('done')}
        onError={() => setState('failed')}
      />
    </>
  )
}

/** ビューアーの中で、画像を取得できなかったとき */
export function ViewerImageFailed(props: { onRetry: () => void; onOpenExternal: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-white/80 text-sm" onClick={(e) => e.stopPropagation()}>
      <span className="material-symbols-outlined text-5xl">broken_image</span>
      画像を取得できませんでした
      <span className="text-xs text-white/60 text-center">消えたか、配信元がアプリからの読み込みを断っています</span>
      <div className="flex gap-2">
        <button type="button" onClick={props.onRetry} className="px-3 py-1.5 rounded bg-white/15 hover:bg-white/25">
          もう一度
        </button>
        <button type="button" onClick={props.onOpenExternal} className="px-3 py-1.5 rounded bg-white/15 hover:bg-white/25">
          ブラウザで開く
        </button>
      </div>
    </div>
  )
}
