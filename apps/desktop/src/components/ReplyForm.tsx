// 書き込み欄。スレ表示の下に置く。見た目は web 版の ReplyForm.tsx(下部レイアウト)に寄せている。
// 認証を求められたら(eddist の初回書き込みなど)、コードと認証ページへのボタンを出す。

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { PostInput, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'

export interface ReplyFormHandle {
  /** 本文のカーソル位置に文字を入れる(>>12 の挿入など) */
  insert: (text: string) => void
}

interface Props {
  disabled?: string
  initialName: string
  initialMail: string
  onSubmit: (input: PostInput) => Promise<PostResult>
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

  useImperativeHandle(ref, () => ({
    insert(text) {
      const el = textRef.current
      if (!el) return setBody((b) => b + text)
      const start = el.selectionStart
      const next = body.slice(0, start) + text + body.slice(el.selectionEnd)
      setBody(next)
      requestAnimationFrame(() => {
        el.focus()
        el.selectionStart = el.selectionEnd = start + text.length
      })
    },
  }))

  const sage = mail.trim().toLowerCase() === 'sage'

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

  return (
    <div className="flex-shrink-0 border-t border-c-border bg-c-surface px-4 py-3">
      {result && <PostResultBox result={result} onOpenUrl={props.onOpenUrl} />}

      <div className="flex items-center gap-2 mb-2">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" className={`${INPUT} w-40`} />
        <input type="text" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="メール" className={`${INPUT} w-40`} />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
          <input
            type="checkbox"
            checked={sage}
            onChange={(e) => setMail(e.target.checked ? 'sage' : '')}
            className="rounded"
          />
          sage
        </label>
        <span className="ml-auto text-[10px] text-c-text-muted">Ctrl+Enter で書き込む</span>
      </div>
      <div className="flex items-end gap-2">
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
          placeholder={props.disabled ?? '本文'}
          disabled={!!props.disabled}
          rows={Math.min(8, Math.max(2, body.split('\n').length))}
          className={`${INPUT} flex-1 resize-none leading-relaxed`}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || !body.trim() || !!props.disabled}
          className="btn-thread-create px-4 py-2 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          <span className={`material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
            {sending ? 'progress_activity' : 'send'}
          </span>
          書き込む
        </button>
      </div>
    </div>
  )
})

export default ReplyForm
