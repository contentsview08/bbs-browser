// 画像ビューワー。web 版の ImageLightbox.tsx の簡易版(←→で切り替え、Esc で閉じる)。
// 小さい画像も画面いっぱいの枠に収まるまで引き伸ばして見せ、ワンクリックで保存できる。

import { useEffect, useState } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { saveImage } from '../host/saveImage'

interface Props {
  urls: string[]
  index: number
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

export default function Lightbox({ urls, index, saveDir, onIndex, onClose, onOpenExternal }: Props) {
  const url = urls[index]
  const [save, setSave] = useState<SaveState>()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && index < urls.length - 1) onIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, urls.length, onIndex, onClose])

  // 画像を切り替えたら、保存の結果表示は消す
  useEffect(() => setSave(undefined), [url])

  const doSave = async () => {
    setSave({ status: 'saving' })
    try {
      setSave({ status: 'saved', path: await saveImage(url, saveDir) })
    } catch (e) {
      setSave({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="fixed inset-0 bg-black/90 z-[10000] flex items-center justify-center" onClick={onClose}>
      {/* 枠いっぱいに収める(小さい画像は引き伸ばす) */}
      <img
        key={url}
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="w-[92vw] h-[86vh] object-contain lightbox-open-rise"
        onClick={(e) => {
          // 絵の上なら閉じない。絵の周りの余白なら、背景と同じく閉じる
          if (hitsImage(e.currentTarget, e.clientX, e.clientY)) e.stopPropagation()
        }}
      />
      <div className="absolute top-3 right-3 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-black/70 text-sm text-white"
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
