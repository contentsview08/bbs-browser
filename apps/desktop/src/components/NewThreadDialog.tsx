// スレ立ての画面。web 版の NewThreadPage の入力項目(スレタイ・名前・メール・本文)に合わせている。
// 成功したら親がスレ一覧を取り直し、新しいスレをタブで開く。
// 書き込み欄と同じく、画像のアップロード(ボタン・貼り付け・ドラッグ)と絵文字が使える。

import { useRef, useState } from 'react'
import type { NewThreadInput, PostConfirm, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'
import { useCountdown } from '../hooks/useCountdown'
import { useMediaInput } from '../hooks/useMediaInput'
import type { UploadOptions } from '../host/uploader'

interface Props {
  boardName: string
  initialName: string
  initialMail: string
  onSubmit: (input: NewThreadInput) => Promise<PostResult>
  onConfirm: (confirm: PostConfirm, input: NewThreadInput) => Promise<PostResult>
  onOpenUrl: (url: string) => void
  onClose: () => void
  /** 書き込んだあとのクールダウンが明ける時刻と、その長さ */
  readyAt?: number
  cooldownMs: number
  /** 画像のアップロード(catbox.moe)を使うとき。使わないなら undefined(絵文字だけ) */
  uploader?: UploadOptions
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded?: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
}

const INPUT =
  'w-full bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted focus:ring-c-accent focus:border-c-accent'

export default function NewThreadDialog(props: Props) {
  const [title, setTitle] = useState('')
  const [name, setName] = useState(props.initialName)
  const [mail, setMail] = useState(props.initialMail)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<PostResult>()
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  /** 本文のカーソルの位置に文字を入れる(上げた画像の URL・絵文字) */
  const insert = (text: string) => {
    const el = bodyRef.current
    if (!el) return setBody((b) => b + text)
    const start = el.selectionStart
    setBody((b) => b.slice(0, start) + text + b.slice(el.selectionEnd))
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + text.length
    })
  }
  const media = useMediaInput({ uploader: props.uploader, insert, onUploaded: props.onUploaded })
  const cooldown = useCountdown(props.readyAt, props.cooldownMs)
  const cooling = cooldown.left > 0
  const ready = title.trim() !== '' && body.trim() !== '' && !sending && !cooling

  const submit = async () => {
    if (!ready) return
    setSending(true)
    setResult(undefined)
    try {
      setResult(await props.onSubmit({ title: title.trim(), name, mail, body }))
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9500] bg-black/50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div
        className="w-full max-w-2xl flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose()
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong">
            スレを立てる <span className="ml-2 text-sm font-normal text-c-text-muted">{props.boardName}</span>
          </h2>
          <button type="button" onClick={props.onClose} className="p-1 text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {result && (
            <PostResultBox
              result={result}
              onOpenUrl={props.onOpenUrl}
              onConfirm={async (c) => {
                setSending(true)
                setResult(undefined)
                try {
                  setResult(await props.onConfirm(c, { title: title.trim(), name, mail, body }))
                } catch (e) {
                  setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
                } finally {
                  setSending(false)
                }
              }}
            />
          )}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="スレタイ"
            autoFocus
            className={`${INPUT} text-base font-bold`}
          />
          <div className="flex items-center gap-2">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" className={INPUT} />
            <input type="text" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="メール" className={INPUT} />
            {/* 画像と絵文字のボタン。本文の欄の右端にそろえる */}
            <div className="flex-shrink-0 flex items-center gap-0.5">{media.buttons}</div>
          </div>
          {media.error && (
            <p className="flex items-center gap-1 text-xs text-c-heat-very-hot">
              <span className="material-symbols-outlined text-sm">error</span>
              {media.error}
            </p>
          )}
          <textarea
            ref={bodyRef}
            {...media.textareaProps}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder="本文(>>1)"
            rows={10}
            className={`${INPUT} resize-y leading-relaxed`}
          />
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-c-border">
          <span className="text-[10px] text-c-text-muted">
            {cooling ? `続けて書き込まないよう、あと ${Math.ceil(cooldown.left / 1000)} 秒あけています` : 'Ctrl+Enter で立てる'}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            className="btn-thread-create px-4 py-2 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <span className={`material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
              {sending ? 'progress_activity' : cooling ? 'hourglass_top' : 'edit_square'}
            </span>
            <span className="tabular-nums">{cooling ? `あと ${Math.ceil(cooldown.left / 1000)} 秒` : 'スレを立てる'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
