// 本文の欄に、画像をアップロードして URL を入れる(ボタン・貼り付け・ドラッグ)ことと、絵文字を入れること。
// 書き込みにファイルを付けられる掲示板(コネクタの attachments。ふたば)では、アップロードの代わりに、書き込みに付ける
// (付けたファイルは小さく並べて × で外せる。書き込むときに takeFiles で中身を渡す)。
// 書き込み欄とスレ立ての画面で共通に使う。
// - アップローダー(catbox.moe)に負担をかけないよう、まとめて貼られても 1 枚ずつ順番に上げ、一度に 10 枚まで
// - 上げ終わったら本文のカーソルの位置に URL を入れ、アップロード履歴に残す

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import type { AttachmentRules, PostFile } from '@bbs-browser/connectors'
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
  /** 本文のカーソルの位置に文字を入れる(ownLine: 行の途中なら改行してから入れる。画像の URL) */
  insert: (text: string, opts?: { ownLine?: boolean }) => void
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded?: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  /** 書き込みにファイルを付けられる掲示板の決まり。あれば、アップロードの代わりに書き込みに付ける */
  attach?: AttachmentRules
  disabled?: boolean
}): {
  /** 書き込みに付けたファイルの並び(小さい見本と ×)。付けていなければ null */
  attachedView: ReactNode
  /** 付けたファイルの中身(書き込むときに PostInput.files に渡す) */
  takeFiles: () => Promise<PostFile[]>
  /** 付けたファイルを外す(書き込めたあと) */
  clearAttached: () => void
  /** 画像と絵文字のボタン(右端が絵文字) */
  buttons: ReactNode
  /**
   * スマホの入力欄(chat)用: 画像を選ぶ画面を開く。付けられない・上げられない掲示板なら undefined。
   * 使うときは fileInput(隠したファイルの選び口)も一緒に置く(buttons とは一緒に置かない)
   */
  pick?: () => void
  fileInput: ReactNode
  /** アップロードしている数 */
  uploading: number
  /** まとめて上げているとき、いま何枚目か(1 始まり)と全部で何枚か */
  progress?: { current: number; total: number }
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
  const [progress, setProgress] = useState<{ current: number; total: number }>()
  const [error, setError] = useState<string>()

  // ── 書き込みに付けるファイル(attach のとき) ──
  const [attached, setAttached] = useState<File[]>([])
  const previews = useMemo(() => attached.map((f) => URL.createObjectURL(f)), [attached])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  const attach = (files: File[]) => {
    const rules = o.attach
    if (!rules || files.length === 0) return
    const ok: File[] = []
    for (const f of files) {
      if (!rules.types.includes(f.type)) {
        setError(`付けられない種類のファイルです(${f.name || f.type})。付けられるのは ${rules.types.map((t) => t.split('/')[1]).join('・')}`)
        continue
      }
      if (f.size > rules.maxBytes) {
        setError(`ファイルが大きすぎます(${Math.ceil(f.size / 1024)}KB。${Math.floor(rules.maxBytes / 1024)}KB まで)`)
        continue
      }
      ok.push(f)
    }
    if (ok.length === 0) return
    setError(undefined)
    // 上限を超えたら、新しく付けたものを残す(1 つまでの掲示板では、付け直しになる)
    setAttached((cur) => [...cur, ...ok].slice(-rules.maxFiles))
  }
  const takeFiles = async (): Promise<PostFile[]> =>
    Promise.all(attached.map(async (f) => ({ name: f.name || 'image', type: f.type, data: new Uint8Array(await f.arrayBuffer()) })))
  const attachedView =
    attached.length === 0 ? null : (
      <div className="flex flex-wrap gap-2">
        {attached.map((f, i) => (
          <div key={previews[i]} className="relative w-16 h-16 rounded overflow-hidden border border-c-border bg-c-surface2 flex-shrink-0" title={`${f.name}(${Math.ceil(f.size / 1024)}KB)`}>
            {f.type.startsWith('video/') ? (
              <video src={previews[i]} muted className="w-full h-full object-cover" />
            ) : (
              <img src={previews[i]} alt="" className="w-full h-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => setAttached((cur) => cur.filter((_, j) => j !== i))}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
              title="外す"
            >
              <span className="material-symbols-outlined text-sm leading-none">close</span>
            </button>
          </div>
        ))}
      </div>
    )

  const upload = async (all: File[]) => {
    const uploader = o.uploader
    if (!uploader || all.length === 0) return
    setError(all.length > MAX_FILES ? `一度に上げられるのは ${MAX_FILES} 枚までです(先頭の ${MAX_FILES} 枚だけ上げます)` : undefined)
    const files = all.slice(0, MAX_FILES)
    for (const [i, file] of files.entries()) {
      setProgress({ current: i + 1, total: files.length })
      setUploading((n) => n + 1)
      try {
        const url = await uploadToCatbox(file, uploader)
        o.insert(`${url}\n`, { ownLine: true })
        o.onUploaded?.({ url, name: file.name || 'image', size: file.size, withAccount: !!uploader.userhash })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setUploading((n) => n - 1)
      }
    }
    setProgress(undefined)
  }

  /** ボタン・貼り付け・ドラッグで選んだファイル: 付けられる掲示板なら付け、そうでなければアップロードする */
  const take = (files: File[]) => (o.attach ? attach(files) : void upload(files))
  const buttons = (
    <>
      {o.attach && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={o.disabled}
            className="flex-shrink-0 p-1 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 disabled:opacity-40"
            title={`画像・動画を書き込みに付ける(${o.attach.maxFiles} つまで、${Math.floor(o.attach.maxBytes / 1024)}KB まで)。本文の欄に貼り付け・ドラッグしても付けられます`}
          >
            <span className="material-symbols-outlined text-lg leading-none">attach_file</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={o.attach.types.join(',')}
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </>
      )}
      {!o.attach && o.uploader && (
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
      const files = o.attach || o.uploader ? mediaFiles(e.clipboardData.files) : []
      if (files.length === 0) return
      e.preventDefault()
      take(files)
    },
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => {
      if ((o.attach || o.uploader) && [...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault()
    },
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => {
      const files = o.attach || o.uploader ? mediaFiles(e.dataTransfer.files) : []
      if (files.length === 0) return
      e.preventDefault()
      take(files)
    },
  }

  // スマホの入力欄(chat)用の、隠したファイルの選び口(buttons の中のものと同じ働き)
  const fileInput = o.attach ? (
    <input
      ref={fileRef}
      type="file"
      accept={o.attach.types.join(',')}
      hidden
      onChange={(e) => {
        attach([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  ) : o.uploader ? (
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
  ) : null
  const pick = o.attach || o.uploader ? () => fileRef.current?.click() : undefined

  return { buttons, pick, fileInput, uploading, progress, textareaProps, error, attachedView, takeFiles, clearAttached: () => setAttached([]) }
}
