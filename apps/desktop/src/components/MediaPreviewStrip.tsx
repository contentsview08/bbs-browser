// 本文に入れた画像・動画のリンクと、上げている途中の画像のサムネイルの帯。書き込み欄(ReplyForm)とスレ立て(NewThreadDialog)で同じものを使う。
// スマホのアプリの UploadStrip と同じ: 本文の画像は押すと画像ビューアー、× で本文から外す。上げ終わった画像は端末の画像をそのまま出す(すぐ見える)。
// 待っている・上げている・上げられなかった画像は、暗くして印を重ねる。上げられなかった画像は押すと上げ直す

import type { useMediaInput } from '../hooks/useMediaInput'
import { imageUrlsIn, youtubeIdsIn } from '../utils/postBody'
import { isAutoLoadable } from '../utils/safeUrl'

type Media = ReturnType<typeof useMediaInput>

/** 帯に出すものがあるか(本文の画像・動画、上げている途中の画像) */
export function hasMediaPreview(body: string, media: Media): boolean {
  return imageUrlsIn(body).length + youtubeIdsIn(body).length + media.items.filter((it) => it.state !== 'done').length > 0
}

export default function MediaPreviewStrip(props: {
  body: string
  media: Media
  /** 本文の画像を押したとき(画像ビューアーを開く)。urls はこの帯の画像すべて、index は押したもの */
  onImage?: (urls: string[], index: number) => void
  /** 本文から画像の URL を外す(サムネイルの ×) */
  onRemoveUrl: (url: string) => void
}) {
  const { body, media } = props
  const previewImages = imageUrlsIn(body)
  // 家の中のアドレスの画像は、書いただけでは読みに行かない
  const loadableImages = previewImages.filter(isAutoLoadable)
  const previewVideos = youtubeIdsIn(body)
  // 上げる前・上げている途中・上げられなかった画像(上げ終わったものは本文の URL の方で出す)
  const pendingItems = media.items.filter((it) => it.state !== 'done')
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {loadableImages.map((url, i) => (
        <div key={url} className="relative h-14 w-14 flex-shrink-0">
          <img
            src={media.localOf(url) ?? url}
            alt=""
            referrerPolicy="no-referrer"
            onClick={() => props.onImage?.(loadableImages, i)}
            className="h-full w-full object-cover rounded border border-c-border bg-c-surface2 cursor-pointer hover:border-c-border-strong"
            title="押すと大きく見る"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onRemoveUrl(url)}
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
            title="本文から外す"
          >
            <span className="material-symbols-outlined text-[13px] leading-none">close</span>
          </button>
        </div>
      ))}
      {pendingItems.map((it) => (
        <div
          key={it.id}
          role={it.state === 'failed' ? 'button' : undefined}
          onClick={it.state === 'failed' ? () => media.retry(it.id) : undefined}
          className={`relative h-14 w-14 flex-shrink-0 rounded overflow-hidden border border-c-border bg-c-surface2 ${it.state === 'failed' ? 'cursor-pointer' : ''}`}
          title={it.error ?? (it.state === 'uploading' ? '上げています' : '待っています')}
        >
          {it.file.type.startsWith('video/') ? <video src={it.preview} muted className="w-full h-full object-cover" /> : <img src={it.preview} alt="" className="w-full h-full object-cover" />}
          <span className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-0.5 text-white">
            {it.state === 'uploading' ? (
              <>
                <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                <span className="text-[9px] leading-none">上げ中</span>
              </>
            ) : it.state === 'failed' ? (
              <>
                <span className="material-symbols-outlined text-lg" style={{ color: 'var(--c-mark-danger)' }}>refresh</span>
                <span className="text-[9px] leading-none">再送</span>
              </>
            ) : (
              <span className="text-[10px] leading-none text-white/85">待ち</span>
            )}
          </span>
          {it.state === 'failed' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                media.dismiss(it.id)
              }}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
              title="外す"
            >
              <span className="material-symbols-outlined text-[13px] leading-none">close</span>
            </button>
          )}
        </div>
      ))}
      {previewVideos.map((id) => (
        <div key={id} className="relative h-14 w-20 flex-shrink-0 rounded overflow-hidden border-2" style={{ borderColor: '#ff0000' }}>
          <img src={`https://img.youtube.com/vi/${id}/default.jpg`} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[8px] px-0.5 rounded leading-none">▶</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 画面のどこに落としても画像を受けるための、外側の要素に付けるハンドラ(本文の欄だけでなく、ダイアログ全体・書き込み欄全体で受ける)。
 * useMediaInput の textareaProps と同じ働き。本文の欄に落としたときは、欄の方が先に受けて止めるので二重にはならない
 */
export function dropProps(media: Media) {
  const onTextarea = (e: React.DragEvent<HTMLElement>) => (e.target as HTMLElement).tagName === 'TEXTAREA'
  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!onTextarea(e)) media.textareaProps.onDragOver(e as unknown as React.DragEvent<HTMLTextAreaElement>)
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      if (!onTextarea(e)) media.textareaProps.onDrop(e as unknown as React.DragEvent<HTMLTextAreaElement>)
    },
  }
}
