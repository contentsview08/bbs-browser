// スレの画像一覧。スレの中の画像・動画のファイル・YouTube をタイル状に並べる。
// 押すとビューアーで開き(一覧の順に切り替えられる)、「まとめて保存」で画像と動画のファイルを順に保存する。
// 画像は画面に見えたものから読む(loading="lazy")。動画は最初のコマに要る分だけ読む

import { useRef, useMemo, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { imageUrlsIn, videoFileUrlsIn, youtubeLinksIn } from '../utils/postBody'
import { saveImage } from '../host/saveImage'
import { isAutoLoadable } from '../utils/safeUrl'
import LocalAddressMark from './LocalAddressMark'
import { mediaSrc } from '../utils/httpsFirst'

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
  const [saving, setSaving] = useState<{ done: number; total: number; failed: number; finished?: boolean }>()

  /** 見せている画像と動画のファイルを、1 つずつ順に保存する(YouTube は保存できないので外す) */
  const saveAll = async () => {
    const targets = shown.filter((m) => m.kind !== 'youtube')
    if (targets.length === 0) return
    let failed = 0
    setSaving({ done: 0, total: targets.length, failed })
    for (let i = 0; i < targets.length; i++) {
      try {
        await saveImage(targets[i].url, props.saveDir)
      } catch {
        failed++
      }
      setSaving({ done: i + 1, total: targets.length, failed })
    }
    setSaving({ done: targets.length, total: targets.length, failed, finished: true })
  }

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める

  const boxRef = useRef<HTMLDivElement>(null)

  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)

  return createPortal(
    <div className="fixed inset-0 z-[9600] bg-black/60 flex items-center justify-center p-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-5xl h-[85vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 pl-5 pr-2 py-2.5 border-b border-c-border">
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
          <div className="ml-auto flex items-center gap-2">
            {saving && (
              <span className={`text-xs tabular-nums ${saving.failed > 0 ? 'text-c-heat-very-hot' : 'text-c-text-muted'}`}>
                {saving.finished ? '保存しました' : '保存中'} {saving.done} / {saving.total}
                {saving.failed > 0 && `(${saving.failed} 件失敗)`}
              </span>
            )}
            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={!!saving && !saving.finished}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover disabled:opacity-50"
              title={`見せている画像と動画を ${props.saveDir || 'ダウンロードフォルダ'} に保存します(YouTube は除く)`}
            >
              <span className="material-symbols-outlined text-base">download</span>
              まとめて保存
            </button>
            <button type="button" onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {shown.length === 0 ? (
            <p className="text-sm text-c-text-muted">{props.items.length === 0 ? 'このスレには画像も動画もありません' : '選んだ種類のものはありません'}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
              {shown.map((m, i) => (
                <button
                  key={m.url}
                  type="button"
                  onClick={() => props.onOpen(shown, i)}
                  className={`relative aspect-square bg-c-surface2 border border-c-border rounded overflow-hidden hover:border-c-accent transition-colors ${
                    props.blurNos?.has(m.post.no) ? 'gross-blur' : ''
                  }`}
                  style={m.kind === 'youtube' ? { borderColor: '#ff0000', borderWidth: 2 } : undefined}
                  title={`>>${m.post.no}`}
                >
                  {!isAutoLoadable(m.thumb ?? m.url) ? (
                    <LocalAddressMark />
                  ) : m.kind === 'video' ? (
                    <video src={mediaSrc(`${m.url}#t=0.1`)} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none bg-black" />
                  ) : (
                    <img
                      src={mediaSrc(m.thumb ?? m.url)}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  )}
                  {m.kind !== 'image' && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="material-symbols-outlined fill text-4xl text-white/90 drop-shadow">play_circle</span>
                    </span>
                  )}
                  <span className="absolute left-1 bottom-1 px-1 rounded bg-black/70 text-white text-[10px] font-bold tabular-nums pointer-events-none">
                    &gt;&gt;{m.post.no}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
