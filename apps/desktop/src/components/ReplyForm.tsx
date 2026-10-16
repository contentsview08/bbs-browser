// 書き込み欄。スレ表示の下か右に置く(web 版の ReplyForm.tsx と同じ 2 通り)。
// 大きさは親が決め、本文の欄が残りいっぱいに広がる。
// 認証を求められたら(eddist の初回書き込みなど)、コードと認証ページへのボタンを出す。

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { PostConfirm, PostInput, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'
import { imageUrlsIn, youtubeIdsIn } from '../utils/postBody'
import { useCountdown } from '../hooks/useCountdown'
import type { UploadOptions } from '../host/uploader'
import { useMediaInput } from '../hooks/useMediaInput'
import PostAccountMenu, { type PostAccountOption } from './PostAccountMenu'
import type { ReplyLayout } from '../ui/settings'

export interface ReplyFormHandle {
  /** 本文のカーソル位置に文字を入れる(>>12 の挿入など) */
  insert: (text: string) => void
  /** 本文の欄にカーソルを置く */
  focus: () => void
}

interface Props {
  layout: ReplyLayout
  disabled?: string
  initialName: string
  initialMail: string
  onSubmit: (input: PostInput) => Promise<PostResult>
  /** 書き込み確認で承諾した。元の書き込みの内容も渡す(自分の書き込みを見分けるため) */
  onConfirm: (confirm: PostConfirm, input: PostInput) => Promise<PostResult>
  onOpenUrl: (url: string) => void
  /** 画像のアップロード(catbox.moe)を使うとき。使わないなら undefined */
  uploader?: UploadOptions
  /** 書き込んだあとのクールダウンが明ける時刻と、その長さ。明けるまで書き込むボタンを押せなくし、残りを出す */
  readyAt?: number
  cooldownMs?: number
  /** 下のサムネイルを押した(画像ビューアーで開く) */
  onImage?: (urls: string[], index: number) => void
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded?: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  /** この板で使えるアカウント(BE など)と、使うかどうか。sage の右の ︙ で選ぶ */
  accounts?: PostAccountOption[]
  onToggleAccount?: (id: string, on: boolean) => void
  onOpenAccountSettings?: () => void
}

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1 focus:ring-c-accent focus:border-c-accent'

const ReplyForm = forwardRef<ReplyFormHandle, Props>(function ReplyForm(props, ref) {
  const [name, setName] = useState(props.initialName)
  const [mail, setMail] = useState(props.initialMail)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<PostResult>()
  const textRef = useRef<HTMLTextAreaElement>(null)

  /** 本文のカーソルの位置に文字を入れる */
  const insert = (text: string) => {
    const el = textRef.current
    if (!el) return setBody((b) => b + text)
    const start = el.selectionStart
    const next = body.slice(0, start) + text + body.slice(el.selectionEnd)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + text.length
    })
  }
  useImperativeHandle(ref, () => ({ insert, focus: () => textRef.current?.focus() }))

  // 画像のアップロード(ボタン・貼り付け・ドラッグ)と絵文字
  const media = useMediaInput({ uploader: props.uploader, insert, onUploaded: props.onUploaded, disabled: !!props.disabled })

  const sage = mail.trim().toLowerCase() === 'sage'

  /** 書き込み確認で承諾したときも、ふつうの書き込みと同じく結果を出し、成功したら本文を空にする */
  const confirm = async (c: PostConfirm) => {
    setSending(true)
    setResult(undefined)
    try {
      const r = await props.onConfirm(c, { name, mail, body })
      setResult(r)
      if (r.status === 'ok') setBody('')
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  const cooldown = useCountdown(props.readyAt, props.cooldownMs ?? 0)
  const cooling = cooldown.left > 0
  const submit = async () => {
    if (!body.trim() || sending || props.disabled || cooling) return
    setSending(true)
    setResult(undefined)
    try {
      const r = await props.onSubmit({ name, mail, body })
      setResult(r)
      if (r.status === 'ok') setBody('')
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  const right = props.layout === 'right'
  // 本文に入れた画像・動画のリンクは、下にサムネイルを出す(web 版と同じ)
  const previewImages = imageUrlsIn(body)
  const previewVideos = youtubeIdsIn(body)
  const hasPreview = previewImages.length + previewVideos.length > 0
  // クールダウン中は押せなくし、残りの秒数と、減っていく帯を出す(続けて書き込めないことが分かるように)
  const sendButton = (
    <button
      type="button"
      onClick={() => void submit()}
      disabled={sending || !body.trim() || !!props.disabled || cooling}
      title={cooling ? `続けて書き込まないよう、あと ${Math.ceil(cooldown.left / 1000)} 秒あけています(設定 → 書き込み で変えられます)` : 'Ctrl+Enter でも書き込めます'}
      className={`btn-thread-create relative overflow-hidden px-4 py-2 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 ${right ? 'w-full' : 'self-end'}`}
    >
      {cooling && (
        <span
          className="absolute inset-y-0 left-0 bg-black/25 pointer-events-none"
          style={{ width: `${cooldown.ratio * 100}%` }}
        />
      )}
      <span className={`relative material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
        {sending ? 'progress_activity' : cooling ? 'hourglass_top' : 'send'}
      </span>
      <span className="relative tabular-nums">{cooling ? `あと ${Math.ceil(cooldown.left / 1000)} 秒` : '書き込む'}</span>
    </button>
  )

  /** 画像と絵文字のボタン(右端が絵文字)。本文の欄の上(名前とメールの行の右端＝本文の欄の右端)に置く */

  return (
    <div className="h-full w-full flex flex-col bg-panel-reply px-4 py-3 overflow-hidden">
      {media.error && (
        <p className="mb-2 flex items-center gap-1 text-xs text-c-heat-very-hot">
          <span className="material-symbols-outlined text-sm">error</span>
          {media.error}
        </p>
      )}
      {result && <PostResultBox result={result} onOpenUrl={props.onOpenUrl} onConfirm={(c) => void confirm(c)} />}

      {/* 名前・メールの行と本文の欄を一つの列にまとめ、書き込むボタンはその右(右レイアウトでは下)に置く。
          こうすると絵文字・画像のボタンの右端が本文の欄の右端とそろう */}
      <div className={`flex-1 min-h-0 flex gap-2 ${right ? 'flex-col' : ''}`}>
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className={`flex items-center gap-2 mb-2 ${right ? 'flex-wrap' : ''}`}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前"
          className={`${INPUT} ${right ? 'flex-1 min-w-0' : 'w-40'}`}
        />
        <input
          type="text"
          value={mail}
          onChange={(e) => setMail(e.target.value)}
          placeholder="メール"
          className={`${INPUT} ${right ? 'flex-1 min-w-0' : 'w-40'}`}
        />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
          <input type="checkbox" checked={sage} onChange={(e) => setMail(e.target.checked ? 'sage' : '')} className="rounded" />
          sage
        </label>
        {props.accounts && props.onToggleAccount && (
          <PostAccountMenu options={props.accounts} onToggle={props.onToggleAccount} onOpenSettings={() => props.onOpenAccountSettings?.()} />
        )}
        <div className="ml-auto flex items-center gap-0.5">{media.buttons}</div>
      </div>
        <div className="relative flex-1 min-h-0 flex">
        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          {...media.textareaProps}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={props.disabled ?? '本文(Ctrl+Enter で書き込む)'}
          disabled={!!props.disabled}
          className={`${INPUT} flex-1 min-h-0 resize-none leading-relaxed`}
        />
        </div>
      </div>
        {sendButton}
      </div>
      {hasPreview && (
        <div className="flex-shrink-0 mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {previewImages.map((url, i) => (
            <img
              key={url}
              src={url}
              alt=""
              referrerPolicy="no-referrer"
              onClick={() => props.onImage?.(previewImages, i)}
              className="h-14 w-14 flex-shrink-0 object-cover rounded border border-c-border bg-c-surface2 cursor-pointer hover:border-c-border-strong"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ))}
          {previewVideos.map((id) => (
            <div key={id} className="relative h-14 w-20 flex-shrink-0 rounded overflow-hidden border-2" style={{ borderColor: '#ff0000' }}>
              <img src={`https://img.youtube.com/vi/${id}/default.jpg`} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[8px] px-0.5 rounded leading-none">▶</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default ReplyForm
