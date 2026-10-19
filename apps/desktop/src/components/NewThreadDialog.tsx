// スレ立ての画面。web 版の NewThreadPage の入力項目(スレタイ・名前・メール・本文)に合わせている。
// 成功したら親がスレ一覧を取り直し、新しいスレをタブで開く。
// 書き込み欄と同じく、画像のアップロード(ボタン・貼り付け・ドラッグ)と絵文字が使える。

import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { AttachmentRules, NewThreadInput, PostConfirm, PostLimits, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'
import { useCountdown } from '../hooks/useCountdown'
import { useMediaInput } from '../hooks/useMediaInput'
import { measurePost } from '../utils/postLimit'
import PostAccountMenu, { type PostAccountOption } from './PostAccountMenu'
import type { UploadOptions } from '../host/uploader'
import { isMobile } from '../utils/platform'

interface Props {
  /** 書き込みにファイルを付けられる掲示板の決まり(ふたば)。あれば画像のボタンはアップロードではなく添付になる */
  attach?: AttachmentRules
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
  /** 板の書き込みの上限と、その掲示板での数え方 */
  limits?: PostLimits
  byteLength?: (text: string) => number
  /** この板で使えるアカウント(BE など)と、使うかどうか */
  accounts: PostAccountOption[]
  onToggleAccount: (id: string, on: boolean) => void
  onOpenAccountSettings: () => void
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
  const media = useMediaInput({ uploader: props.uploader, attach: props.attach, insert, onUploaded: props.onUploaded })
  const cooldown = useCountdown(props.readyAt, props.cooldownMs)
  const cooling = cooldown.left > 0
  // ファイルを付けていれば、本文が空でも立てられる(画像だけのスレ)
  const ready = title.trim() !== '' && (body.trim() !== '' || !!media.attachedView) && !sending && !cooling

  // 書き込みの長さ。板の上限を超えていたら、送る前に止める
  const measure = props.byteLength ? measurePost({ body, name, mail, subject: title }, props.limits, props.byteLength) : undefined
  const submit = async () => {
    if (!ready) return
    if (measure && measure.over.length > 0) return setResult({ status: 'error', message: measure.over.join(' / ') })
    setSending(true)
    setResult(undefined)
    try {
      const files = await media.takeFiles()
      const r = await props.onSubmit({ title: title.trim(), name, mail, body, ...(files.length > 0 && { files }) })
      setResult(r)
      if (r.status === 'ok') media.clearAttached()
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める

  const boxRef = useRef<HTMLDivElement>(null)

  useFocusTrap(boxRef, props.onClose)
  /** スマホ: 画像のアップロードが無効のときに画像のボタンを押したら、設定のことを知らせる */
  const [imageHint, setImageHint] = useState(false)

  const submitIcon = (
    <span className={`material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
      {sending ? 'progress_activity' : cooling ? 'hourglass_top' : 'edit_square'}
    </span>
  )
  const submitLabel = <span className="tabular-nums">{cooling ? `あと ${Math.ceil(cooldown.left / 1000)} 秒` : 'スレを立てる'}</span>

  return (
    <div
      className={isMobile ? 'fixed inset-0 z-[9500] flex flex-col bg-c-surface reply-slide' : 'fixed inset-0 z-[9500] bg-black/50 flex items-center justify-center p-6'}
      style={isMobile ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(env(safe-area-inset-bottom) + var(--kb-inset, 0px))' } : undefined}
      onClick={isMobile ? undefined : props.onClose}
    >
      <div
        ref={boxRef}
        className={
          isMobile ? 'flex-1 min-h-0 flex flex-col' : 'w-full max-w-2xl flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in'
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* スマホ: 全画面。左上の ← で閉じ、右上で立てる(顔文字のボタン・Ctrl+Enter の案内は出さない) */}
        {isMobile ? (
          <div className="flex-shrink-0 flex items-center gap-1 px-2 border-b border-c-border bg-panel-thread-header" style={{ height: 'var(--header-height, 56px)' }}>
            <button type="button" onClick={props.onClose} className="p-2.5 rounded-xl text-c-text-muted active:bg-c-surface2" title="閉じる">
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-c-text-strong">スレを立てる</p>
              <p className="text-[11px] text-c-text-muted truncate">{props.boardName}</p>
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!ready}
              className="btn-thread-create px-4 py-2 text-sm font-bold rounded-full bg-c-accent text-[var(--c-accent-text)] disabled:opacity-50 flex items-center gap-1"
            >
              {submitIcon}
              {submitLabel}
            </button>
          </div>
        ) : (
        <div className="flex items-center justify-between px-5 py-3 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong">
            スレを立てる <span className="ml-2 text-sm font-normal text-c-text-muted">{props.boardName}</span>
          </h2>
          <button type="button" onClick={props.onClose} className="p-1 text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        )}

        <div className={isMobile ? 'flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3' : 'px-5 py-4 space-y-3'}>
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
            <PostAccountMenu options={props.accounts} onToggle={props.onToggleAccount} onOpenSettings={props.onOpenAccountSettings} />
            {/* 画像と絵文字のボタン。本文の欄の右端にそろえる(スマホは本文の下の画像のボタンだけ) */}
            {!isMobile && <div className="flex-shrink-0 flex items-center gap-0.5">{media.buttons}</div>}
          </div>
          {/* 書き込みに付けたファイル(ふたば) */}
          {media.attachedView}
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
            className={`${INPUT} ${isMobile ? 'flex-1 min-h-[10rem] resize-none text-[15px]' : 'resize-y'} leading-relaxed`}
          />
          {isMobile && (
            <div className="flex-shrink-0 flex items-center gap-2">
              {media.fileInput}
              <button
                type="button"
                onClick={() => (media.pick ? media.pick() : setImageHint(true))}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-c-border text-sm text-c-text-body active:bg-c-surface2"
              >
                <span className={`material-symbols-outlined text-xl text-c-text-muted ${media.uploading > 0 ? 'animate-spin' : ''}`}>
                  {media.uploading > 0 ? 'progress_activity' : 'image'}
                </span>
                {media.uploading > 0 ? `アップロード中${media.progress && media.progress.total > 1 ? ` ${media.progress.current} / ${media.progress.total}` : '…'}` : '画像'}
              </button>
              {imageHint && (
                <span className="flex-1 text-xs text-c-text-muted">画像を付けるには、設定の「画像のアップロードを使う」をオンにしてください</span>
              )}
            </div>
          )}
          {measure && (
            <p
              className={`-mt-2 text-right text-[10px] tabular-nums ${measure.over.length > 0 ? 'text-c-heat-very-hot font-bold' : 'text-c-text-muted'}`}
              title={measure.over.join('\n') || '書き込みの長さ(目安)'}
            >
              {measure.messageBytes}
              {props.limits?.messageBytes !== undefined && ` / ${props.limits.messageBytes}`} バイト
              {props.limits?.lines !== undefined && ` ・ ${measure.lines} / ${props.limits.lines} 行`}
            </p>
          )}
        </div>

        {!isMobile && (
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
            {submitIcon}
            {submitLabel}
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
