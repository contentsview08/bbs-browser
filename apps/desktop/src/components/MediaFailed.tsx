// 画像を取得できなかったときの表示。サムネイルとビューアーで言葉をそろえる(スマホ版の ui/Images.kt・Viewer.kt と同じ言葉)
import { useEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { canSelfUpdate } from '../host/update'
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

/** 動画のサムネイル(最初のコマ)。<video> は置いただけで通信を始めるので、見えてから置く */
export function LazyVideoThumb(props: { src: string; className: string }) {
  const [seen, setSeen] = useState(false)
  const holder = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (seen || !holder.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true)
    })
    observer.observe(holder.current)
    return () => observer.disconnect()
  }, [seen])
  if (!seen) return <span ref={holder} className={`block ${props.className}`} />
  return <video src={props.src} preload="metadata" muted playsInline className={props.className} />
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

const VIDEO_PACKAGES_COMMAND = 'sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-good'
const RELEASES_URL = 'https://github.com/contentsview08/bbs-browser/releases/latest'

/**
 * 動画を再生する部品がないときの案内。H.264 の部品はアプリに同梱しないので、.deb は OS の部品を入れてもらい、
 * AppImage は OS の部品を読み込めない(読むと固まる)ので .deb を案内する。どちらもブラウザでは開ける
 */
export function VideoPlaybackHelp(props: { onOpenExternal?: () => void; dark?: boolean }) {
  const [appImage, setAppImage] = useState<boolean>()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void canSelfUpdate().then(setAppImage, () => setAppImage(false))
  }, [])
  const button = props.dark ? 'px-3 py-1.5 rounded bg-white/15 hover:bg-white/25' : 'px-3 py-1.5 rounded bg-c-surface2 hover:bg-c-surface3 text-c-text-body'
  const muted = props.dark ? 'text-white/70' : 'text-c-text-muted'
  return (
    <div className={`flex flex-col gap-3 text-sm ${props.dark ? 'items-center text-center text-white/85 max-w-md' : 'text-c-text-body'}`} onClick={(e) => e.stopPropagation()}>
      {appImage ? (
        <>
          <p>AppImage 版では、動画をアプリの中で再生できません。</p>
          <p className={`text-xs ${muted}`}>.deb 版なら、OS の部品を入れると再生できます。</p>
        </>
      ) : (
        <>
          <p>この動画の再生には、OS の部品が必要です。</p>
          <p className={`text-xs ${muted}`}>端末で次のコマンドを実行して、アプリを起動し直すと再生できます。</p>
          <code className={`text-xs px-2 py-1.5 rounded break-all ${props.dark ? 'bg-white/10' : 'bg-c-surface2'}`}>{VIDEO_PACKAGES_COMMAND}</code>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {appImage === false && (
          <button
            type="button"
            className={button}
            onClick={() => {
              void navigator.clipboard.writeText(VIDEO_PACKAGES_COMMAND).then(() => setCopied(true))
            }}
          >
            {copied ? 'コピーしました' : 'コマンドをコピー'}
          </button>
        )}
        {appImage && (
          <button type="button" className={button} onClick={() => void openUrl(RELEASES_URL)}>
            .deb 版のページを開く
          </button>
        )}
        {props.onOpenExternal && (
          <button type="button" className={button} onClick={props.onOpenExternal}>
            ブラウザで開く
          </button>
        )}
      </div>
    </div>
  )
}
