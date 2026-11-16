// 帯のキーワードを直す・外す窓(スレ一覧のキーワードの帯の右クリック。スマホ版の KeywordEditDialog と同じ言葉)。
// kind が author なら keywordAuthors の元の行(ID)を直す
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { legacyAuthorId } from '../utils/authorId'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { BTN_PRIMARY, BTN_SECONDARY, DialogHeader, INPUT } from './DialogParts'

export default function KeywordEditDialog(props: {
  kind: 'title' | 'author'
  /** 設定にある元の文字(そのまま直す・外す) */
  original: string
  /** ほかのキーワード(同じものにはしない) */
  others: string[]
  /** next が null なら外す */
  onSubmit: (next: string | null) => void
  onClose: () => void
}) {
  const [word, setWord] = useState(props.original)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const w = word.trim()
  const norm = (s: string) => (props.kind === 'author' ? legacyAuthorId(s.trim()) : s.trim())
  const dup = props.others.some((k) => norm(k) === norm(w))
  const ok = w !== '' && w !== props.original && !dup
  const submit = () => {
    if (!ok) return
    props.onSubmit(w)
    props.onClose()
  }
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose, { escBlursInputs: true })
  const backdrop = useBackdropClose(props.onClose)

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-4" {...backdrop}>
      <div ref={boxRef} className="w-full max-w-md max-h-full flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in" onClick={(e) => e.stopPropagation()}>
        <DialogHeader title={props.kind === 'author' ? '立てた人のキーワードを直す' : 'キーワードを直す'} onClose={props.onClose} />
        <div className="px-5 py-4 space-y-3">
          <input
            ref={inputRef}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder={props.kind === 'author' ? '立てた人の ID' : 'キーワード'}
            className={`${INPUT} w-full`}
          />
          {dup && <p className="text-xs text-c-text-muted">同じキーワードがもうあります</p>}
        </div>
        <div className="flex items-center gap-2 px-5 pb-4">
          <button
            type="button"
            className={`${BTN_SECONDARY} !text-c-heat-very-hot`}
            onClick={() => {
              props.onSubmit(null)
              props.onClose()
            }}
          >
            外す
          </button>
          <span className="flex-1" />
          <button type="button" className={BTN_SECONDARY} onClick={props.onClose}>
            やめる
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={!ok} onClick={submit}>
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
