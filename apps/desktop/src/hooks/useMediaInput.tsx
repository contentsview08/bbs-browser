// 本文の欄に、画像をアップロードして URL を入れる(ボタン・貼り付け・ドラッグ)ことと、絵文字を入れること。
// 書き込み欄とスレ立ての画面で共通に使う。
// - アップローダー(catbox.moe)に負担をかけないよう、まとめて貼られても 1 枚ずつ順番に上げ、一度に 10 枚まで
// - 上げ終わったら本文のカーソルの位置に URL を入れ、アップロード履歴に残す

import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import EmojiPicker from '../components/EmojiPicker'
import { uploadToCatbox, type UploadOptions } from '../host/uploader'

/** 一度に上げられる数 */
const MAX_FILES = 10

/** 貼り付け・ドラッグされたもののうち、画像と動画のファイルだけ */
function mediaFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => /^(image|video)\//.test(f.type))
}

export function useMediaInput(o: {
  /** 画像のアップロードを使うとき。使わないなら undefined(絵文字だけ出す) */
  uploader?: UploadOptions
  /** 本文のカーソルの位置に文字を入れる */
  insert: (text: string) => void
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded?: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  disabled?: boolean
}): {
  /** 画像と絵文字のボタン(右端が絵文字) */
  buttons: ReactNode
  /** 本文の欄に付ける。画像を貼り付け・ドロップしたら上げる */
  textareaProps: {
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => void
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => void
  }
  /** 上げられなかったときの理由 */
  error?: string
} {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string>()

  const upload = async (all: File[]) => {
    const uploader = o.uploader
    if (!uploader || all.length === 0) return
    setError(all.length > MAX_FILES ? `一度に上げられるのは ${MAX_FILES} 枚までです(先頭の ${MAX_FILES} 枚だけ上げます)` : undefined)
    for (const file of all.slice(0, MAX_FILES)) {
      setUploading((n) => n + 1)
      try {
        const url = await uploadToCatbox(file, uploader)
        o.insert(`${url}\n`)
        o.onUploaded?.({ url, name: file.name || 'image', size: file.size, withAccount: !!uploader.userhash })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const buttons = (
    <>
      {o.uploader && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={o.disabled}
            className="flex-shrink-0 p-1 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 disabled:opacity-40"
            title="画像をアップロード(catbox.moe)。本文の欄に貼り付け・ドラッグしても上げられます"
          >
            <span className={`material-symbols-outlined text-lg leading-none ${uploading > 0 ? 'animate-spin' : ''}`}>
              {uploading > 0 ? 'progress_activity' : 'add_photo_alternate'}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              void upload(mediaFiles(e.target.files))
              e.target.value = ''
            }}
          />
        </>
      )}
      <EmojiPicker onPick={o.insert} disabled={o.disabled} />
    </>
  )

  const textareaProps = {
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = o.uploader ? mediaFiles(e.clipboardData.files) : []
      if (files.length === 0) return
      e.preventDefault()
      void upload(files)
    },
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => {
      if (o.uploader && [...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault()
    },
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => {
      const files = o.uploader ? mediaFiles(e.dataTransfer.files) : []
      if (files.length === 0) return
      e.preventDefault()
      void upload(files)
    },
  }

  return { buttons, textareaProps, error }
}
