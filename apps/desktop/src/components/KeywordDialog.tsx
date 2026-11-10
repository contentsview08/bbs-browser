// キーワードに登録する画面。スレの右クリック・長押しのメニューから開く(スマホ版の ThreadPeek.kt の KeywordDraftDialog と同じ言葉)。
// スレタイは全体で登録することはまずなく、ある言葉まで削って登録するので、全体を選んだ状態で開く。立てた人は ID のまま、見て確かめてから登録する

import { legacyAuthorId } from '../utils/authorId'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { BTN_PRIMARY, DialogHeader, INPUT } from './DialogParts'

export type KeywordKind = 'title' | 'author'

export interface KeywordDraft {
  kind: KeywordKind
  /** スレタイ(「スレタイで登録」の欄に入れる) */
  title: string
  /** 立てた人(分からないスレは「立てた人で登録」を出さない) */
  authorId?: string
}

export default function KeywordDialog(props: {
  draft: KeywordDraft
  /** 登録済みのキーワード(同じものは足さない) */
  keywords: string[]
  keywordAuthors: string[]
  onSubmit: (kind: KeywordKind, word: string) => void
  onClose: () => void
}) {
  const d = props.draft
  const [kind, setKind] = useState<KeywordKind>(d.kind === 'author' && d.authorId ? 'author' : 'title')
  const [word, setWord] = useState(kind === 'author' ? d.authorId! : d.title)
  const inputRef = useRef<HTMLInputElement>(null)
  // 種類を選び直したら、その元の文字を入れて全体を選ぶ(すぐ削れるように)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [kind])
  const w = word.trim()
  const dup = kind === 'author' ? props.keywordAuthors.some((a) => legacyAuthorId(a.trim()) === w) : props.keywords.some((k) => k.trim() === w)
  const ok = w !== '' && !dup
  const submit = () => {
    if (!ok) return
    props.onSubmit(kind, w)
    props.onClose()
  }
  const pick = (k: KeywordKind) => {
    setKind(k)
    setWord(k === 'author' ? (d.authorId ?? '') : d.title)
  }

  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose, { escBlursInputs: true })
  const backdrop = useBackdropClose(props.onClose)
  const chip = (on: boolean) =>
    `px-3 py-1 text-sm border rounded-[var(--chip-radius)] transition-colors ${on ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border text-c-text-body hover:border-c-border-strong'}`

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-4" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-lg max-h-full flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="キーワードに登録" onClose={props.onClose} />
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {d.authorId && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(kind === 'title')} onClick={() => pick('title')}>
                スレタイで登録
              </button>
              <button type="button" className={chip(kind === 'author')} onClick={() => pick('author')}>
                立てた人で登録
              </button>
            </div>
          )}
          <div>
            <input
              ref={inputRef}
              value={word}
              onChange={(e) => setWord(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              spellCheck={false}
              placeholder={kind === 'author' ? '立てた人の ID' : 'キーワード'}
              className={`w-full ${INPUT}`}
            />
            <p className="mt-1 text-xs text-c-text-muted">
              {dup
                ? 'もう登録してあります'
                : kind === 'author'
                  ? 'この人が立てたスレを、スレ一覧の上にまとめます(ID が同じときだけ)'
                  : 'この言葉をスレタイに含むスレを、スレ一覧の上にまとめます。要らない所を削って登録してください'}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-c-border">
          <button type="button" onClick={submit} disabled={!ok} className={BTN_PRIMARY}>
            登録
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
