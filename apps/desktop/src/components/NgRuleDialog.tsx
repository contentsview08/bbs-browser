// NG を登録する画面。元の文字(スレタイや本文)を入れた状態で開くので、要らない部分を削ってそのまま登録できる

import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { createPortal } from 'react-dom'
import { NG_TARGETS, isValidPattern, newRule, todayDateString, type NgRule, type NgTarget } from '../utils/ng'

const INPUT =
  'w-full bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted focus:ring-c-accent focus:border-c-accent'

export interface NgDraft {
  target: NgTarget
  pattern: string
}

export default function NgRuleDialog(props: { draft: NgDraft; onSubmit: (rule: NgRule) => void; onClose: () => void }) {
  const [target, setTarget] = useState<NgTarget>(props.draft.target)
  const [pattern, setPattern] = useState(props.draft.pattern)
  const [isRegex, setIsRegex] = useState(false)
  const [todayOnly, setTodayOnly] = useState(false)
  const valid = isValidPattern(pattern.trim(), isRegex)

  const submit = () => {
    if (!valid) return
    props.onSubmit(newRule(target, pattern.trim(), { isRegex, expiresOnDate: todayOnly ? todayDateString() : undefined }))
    props.onClose()
  }

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める

  const boxRef = useRef<HTMLDivElement>(null)

  useFocusTrap(boxRef, props.onClose)

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div
        ref={boxRef}
        className="w-full max-w-lg bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-5 pr-2 py-2.5 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong">NG に追加</h2>
          <button type="button" onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {NG_TARGETS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTarget(t.key)}
                className={`px-3 py-1 text-sm border rounded-[var(--chip-radius)] transition-colors ${
                  t.key === target ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border text-c-text-body hover:border-c-border-strong'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-c-text-muted">要らない部分を削って、NG にしたい言葉だけを残してください{target === 'posterId' ? '(ID は完全一致)' : '(部分一致)'}</p>
          <textarea
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
            autoFocus
            rows={Math.min(6, Math.max(2, pattern.split('\n').length))}
            className={`${INPUT} resize-y ${pattern.trim() && !valid ? 'border-c-heat-very-hot' : ''}`}
          />
          <div className="flex items-center gap-4 text-sm text-c-text-body">
            <label className="flex items-center gap-1.5 select-none">
              <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} className="rounded" />
              正規表現
            </label>
            <label className="flex items-center gap-1.5 select-none">
              <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} className="rounded" />
              今日だけ
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-c-border">
          <span className="text-[10px] text-c-text-muted">Ctrl+Enter で追加</span>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="px-4 py-1.5 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover disabled:opacity-50"
          >
            NG に追加
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
