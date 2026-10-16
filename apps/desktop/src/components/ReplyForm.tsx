// 書き込み欄。スレ表示の下か右に置く(web 版の ReplyForm.tsx と同じ 2 通り)。
// 大きさは親が決め、本文の欄が残りいっぱいに広がる。
// 認証を求められたら(eddist の初回書き込みなど)、コードと認証ページへのボタンを出す。

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { PostConfirm, PostInput, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'
import EmojiPicker from './EmojiPicker'
import { imageUrlsIn, youtubeIdsIn } from '../utils/postBody'
import type { ReplyLayout } from '../ui/settings'

export interface ReplyFormHandle {
  /** 本文のカーソル位置に文字を入れる(>>12 の挿入など) */
  insert: (text: string) => void
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
  useImperativeHandle(ref, () => ({ insert }))

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

  const submit = async () => {
    if (!body.trim() || sending || props.disabled) return
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
  const sendButton = (
    <button
      type="button"
      onClick={() => void submit()}
      disabled={sending || !body.trim() || !!props.disabled}
      className={`btn-thread-create px-4 py-2 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-1 ${right ? 'w-full' : 'self-end'}`}
    >
      <span className={`material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
        {sending ? 'progress_activity' : 'send'}
      </span>
      書き込む
    </button>
  )

  return (
    <div className="h-full w-full flex flex-col bg-panel-reply px-4 py-3 overflow-hidden">
      {result && <PostResultBox result={result} onOpenUrl={props.onOpenUrl} onConfirm={(c) => void confirm(c)} />}

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
        <EmojiPicker onPick={insert} disabled={!!props.disabled} />
        {!right && <span className="ml-auto text-[10px] text-c-text-muted">Ctrl+Enter で書き込む</span>}
      </div>
      <div className={`flex-1 min-h-0 flex gap-2 ${right ? 'flex-col' : ''}`}>
        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
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
        {sendButton}
      </div>
      {hasPreview && (
        <div className="flex-shrink-0 mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {previewImages.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              referrerPolicy="no-referrer"
              className="h-14 w-14 flex-shrink-0 object-cover rounded border border-c-border bg-c-surface2"
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
