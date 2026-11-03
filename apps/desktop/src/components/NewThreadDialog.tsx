// スレ立ての画面。web 版の NewThreadPage の入力項目(スレタイ・名前・メール・本文)に合わせている。
// 成功したら親がスレ一覧を取り直し、新しいスレをタブで開く。
// 書き込み欄と同じく、画像のアップロード(ボタン・貼り付け・画面のどこかへドラッグ)と絵文字が使え、上げた画像はサムネイルで出て押すと大きく見られる。
// PC は「置いたまま使える窓」: 上の帯をつかんで動かし、右下の角で大きさを変えられる(覚えておく)

import { useEffect, useRef, useState } from 'react'
import { stashGet, stashSet } from '../utils/draftStash'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { DialogHeader } from './DialogParts'
import type { AttachmentRules, NewThreadInput, PostConfirm, PostLimits, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'
import { useMediaInput } from '../hooks/useMediaInput'
import { measurePost } from '../utils/postLimit'
import PostAccountMenu, { type PostAccountOption } from './PostAccountMenu'
import type { UploadOptions } from '../host/uploader'
import { isMobile } from '../utils/platform'
import MediaPreviewStrip, { dropProps, hasMediaPreview } from './MediaPreviewStrip'
import { useDialogRect } from '../hooks/useDialogRect'
import Lightbox from './Lightbox'

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
  /** 書きかけを覚えておく名前(板ごと)。閉じても・ページを離れても(Turnstile の確認)消えないように */
  draftKey?: string
  /** 画像ビューアーの保存先(設定の imageSaveDir。空ならダウンロードフォルダ) */
  imageSaveDir?: string
}

interface NewThreadDraft {
  title: string
  name: string
  mail: string
  body: string
}

// スマホは指で押すので、欄を大きく(高さ 48px・字 16px)
const INPUT = `w-full bg-c-surface2 border-c-border text-c-text-body placeholder-c-text-muted focus:ring-c-accent focus:border-c-accent ${
  isMobile ? 'rounded-xl text-base px-3.5 py-3' : 'rounded-[var(--btn-radius)] text-sm'
}`

export default function NewThreadDialog(props: Props) {
  // 書きかけがあれば戻す
  const saved = (() => {
    const raw = props.draftKey ? stashGet(props.draftKey) : undefined
    try {
      return raw ? (JSON.parse(raw) as NewThreadDraft) : undefined
    } catch {
      return undefined
    }
  })()
  const [title, setTitle] = useState(saved?.title ?? '')
  const [name, setName] = useState(saved?.name ?? props.initialName)
  const [mail, setMail] = useState(saved?.mail ?? props.initialMail)
  const [body, setBody] = useState(saved?.body ?? '')
  // 打つたびに覚える(スレタイも本文も空なら消す)
  useEffect(() => {
    if (!props.draftKey) return
    stashSet(props.draftKey, title || body ? JSON.stringify({ title, name, mail, body } satisfies NewThreadDraft) : '')
  }, [props.draftKey, title, name, mail, body])
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
  // ファイルを付けていれば、本文が空でも立てられる(画像だけのスレ)
  const ready = title.trim() !== '' && (body.trim() !== '' || !!media.attachedView) && !sending

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
      if (r.status === 'ok') {
        // 立てられたら、書いたものを消す(閉じて開き直しても残らないように)
        media.clearAttached()
        setTitle('')
        setBody('')
      }
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める

  // PC: 置き場所と大きさ(つかんで動かす・角で広げる)。スマホは全画面
  const win = useDialogRect('bbs:new-thread-rect', { w: 720, h: 560, minW: 480, minH: 360 })
  const boxRef = win.boxRef
  /** サムネイルを押したときの画像ビューアー */
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number }>()
  /** 本文から画像の URL を外す(サムネイルの ×)。その URL だけの行は行ごと消す */
  const removeUrl = (url: string) => {
    const lines = body.split('\n')
    setBody(lines.some((l) => l.trim() === url) ? lines.filter((l) => l.trim() !== url).join('\n') : body.replace(url, ''))
  }

  useFocusTrap(boxRef, () => (lightbox ? setLightbox(undefined) : props.onClose()), { escBlursInputs: true })
  /** スマホ: 画像のアップロードが無効のときに画像のボタンを押したら、設定のことを知らせる */
  const [imageHint, setImageHint] = useState(false)

  const submitIcon = (
    <span className={`material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
      {sending ? 'progress_activity' : 'edit_square'}
    </span>
  )
  const submitLabel = <span className="tabular-nums">スレを立てる</span>

  return (
    <div
      // PC は後ろを暗くせず、置いたまま使える窓(後ろのスレ一覧も見られる)。外を押しても閉じない(長い本文を書く画面なので、うっかり消さない。× と Esc で閉じる)
      className={isMobile ? 'fixed inset-0 z-[9500] flex flex-col bg-c-surface reply-slide' : 'fixed inset-0 z-[9500] pointer-events-none'}
      style={isMobile ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(env(safe-area-inset-bottom) + var(--kb-inset, 0px))' } : undefined}
    >
      <div
        ref={boxRef}
        className={
          isMobile ? 'flex-1 min-h-0 flex flex-col' : 'absolute flex flex-col pointer-events-auto bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl overflow-hidden rise-in'
        }
        style={isMobile ? undefined : win.style}
        onMouseUp={isMobile ? undefined : win.saveSize}
        onClick={(e) => e.stopPropagation()}
        {...dropProps(media)}
      >
        {media.confirmView}
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
              className="btn-thread-create px-5 py-2.5 text-base font-bold rounded-full bg-c-accent text-[var(--c-accent-text)] disabled:opacity-50 flex items-center gap-1.5"
            >
              {submitIcon}
              {submitLabel}
            </button>
          </div>
        ) : (
        <div className="cursor-move select-none" onMouseDown={win.startMove} title="つかんで動かす">
          <DialogHeader title="スレを立てる" sub={props.boardName} onClose={props.onClose} />
        </div>
        )}

        <div className={isMobile ? 'flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3' : 'flex-1 min-h-0 px-5 py-4 flex flex-col gap-3'}>
          {result && (
            <PostResultBox
              result={result}
              onOpenUrl={props.onOpenUrl}
              onConfirm={async (c) => {
                setSending(true)
                setResult(undefined)
                try {
                  const r = await props.onConfirm(c, { title: title.trim(), name, mail, body })
                  setResult(r)
                  if (r.status === 'ok') {
                    setTitle('')
                    setBody('')
                  }
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
            className={`${INPUT} ${isMobile ? 'text-lg' : 'text-base'} font-bold`}
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
          {/* 画像を上げている間は、何枚中の何枚目かを出す(書き込み欄と同じ) */}
          {media.uploading > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-c-text-muted">
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              画像をアップロード中…{media.progress && media.progress.total > 1 && ` ${media.progress.current} / ${media.progress.total} 枚目`}
            </p>
          )}
          {/* 上げた画像・上げている途中の画像のサムネイル(押すと大きく見る・× で本文から外す) */}
          {hasMediaPreview(body, media) && <MediaPreviewStrip body={body} media={media} onImage={(urls, index) => setLightbox({ urls, index })} onRemoveUrl={removeUrl} />}
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
            rows={isMobile ? 10 : 6}
            // PC は窓の残りをぜんぶ本文の欄に(窓を広げると欄も広がる)
            className={`${INPUT} ${isMobile ? 'flex-1 min-h-[10rem] resize-none text-[15px]' : 'flex-1 min-h-[6rem] resize-none'} leading-relaxed`}
          />
          {isMobile && (
            <div className="flex-shrink-0 flex items-center gap-2">
              {media.fileInput}
              <button
                type="button"
                onClick={() => (media.pick ? media.pick() : setImageHint(true))}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border border-c-border text-base text-c-text-body active:bg-c-surface2"
              >
                <span className={`material-symbols-outlined text-2xl text-c-text-muted ${media.uploading > 0 ? 'animate-spin' : ''}`}>
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

        {/* スマホ: 親指の届く下にも、大きな「スレを立てる」(上の帯のボタンは指が届きにくい) */}
        {isMobile && (
          <div className="flex-shrink-0 px-3 pt-2 pb-3 border-t border-c-border">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!ready}
              className="btn-thread-create w-full h-12 text-base font-bold rounded-xl bg-c-accent text-[var(--c-accent-text)] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitIcon}
              {submitLabel}
            </button>
          </div>
        )}

        {!isMobile && (
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-5 py-3 border-t border-c-border">
          <span className="text-[10px] text-c-text-muted">
            Ctrl+Enter で立てる ・ 画像はここへドラッグでも
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
      {lightbox && (
        <Lightbox
          urls={lightbox.urls}
          index={lightbox.index}
          saveDir={props.imageSaveDir ?? ''}
          onIndex={(index) => setLightbox((l) => l && { ...l, index })}
          onClose={() => setLightbox(undefined)}
          onOpenExternal={props.onOpenUrl}
        />
      )}
    </div>
  )
}
