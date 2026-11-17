// キーワード 1 つを足す・直す窓(スレ一覧の帯の右クリック、設定のキーワード、スレの右クリック「キーワードに登録」)。
// 有効・種類(スレタイの言葉 / 立てた人の ID)・言葉(正規表現も)・別名(帯に出す名前)・効く板。スマホ版の KeywordEditSheet と同じ項目・同じ言葉
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { patternError } from '../utils/ng'
import { sameKeyword, type KeywordRule } from '../utils/keywords'
import { BTN_PRIMARY, BTN_SECONDARY, DialogHeader, INPUT } from './DialogParts'

export default function KeywordEditDialog(props: {
  rule: KeywordRule
  isNew: boolean
  /** 開いている板(「この板だけ」の候補の先頭) */
  board?: { url: string; name: string }
  /** お気に入り板(「この板だけ」の候補) */
  favorites: { url: string; name: string }[]
  /** ほかのキーワード(同じものにはしない) */
  others: KeywordRule[]
  onSubmit: (rule: KeywordRule) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [r, setR] = useState(props.rule)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const isAuthor = r.kind === 'author'
  const err = !isAuthor && r.isRegex && r.pattern.trim() ? patternError(r.pattern.trim(), true) : undefined
  const dup = props.others.some((o) => sameKeyword(o, r))
  const ok = r.pattern.trim() !== '' && !err && !dup
  const submit = () => {
    if (!ok) return
    props.onSubmit({ ...r, pattern: r.pattern.trim(), label: r.label.trim(), isRegex: r.isRegex && !isAuthor })
    props.onClose()
  }
  // 効く板の候補: すべての板・開いている板・お気に入り板(・今選んでいる板がそのどれでもなければそれも)
  const boards: { url: string; name: string }[] = []
  if (props.board) boards.push(props.board)
  for (const b of props.favorites) if (!boards.some((x) => x.url === b.url)) boards.push(b)
  if (r.boardUrl && !boards.some((x) => x.url === r.boardUrl)) boards.push({ url: r.boardUrl, name: r.boardName ?? r.boardUrl })
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose, { escBlursInputs: true })
  const backdrop = useBackdropClose(props.onClose)
  const label = 'text-xs text-c-text-muted'

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-4" {...backdrop}>
      <div ref={boxRef} className="w-full max-w-lg max-h-full flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in" onClick={(e) => e.stopPropagation()}>
        <DialogHeader
          title={props.isNew ? 'キーワードを足す' : 'キーワードを直す'}
          extra={
            <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
              <input type="checkbox" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} className="rounded" />
              有効
            </label>
          }
          onClose={props.onClose}
        />
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
            <span className={label}>種類</span>
            <select value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value as KeywordRule['kind'] })} className={`${INPUT} text-sm`}>
              <option value="title">スレタイの言葉</option>
              <option value="author">立てた人の ID</option>
            </select>
            <span className={label}>{isAuthor ? '立てた人の ID' : r.isRegex ? '正規表現' : '言葉'}</span>
            <input
              ref={inputRef}
              value={r.pattern}
              onChange={(e) => setR({ ...r, pattern: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              spellCheck={false}
              placeholder={isAuthor ? 'ID の文字' : r.isRegex ? '例: 絵|絵画|イラスト' : '例: 実況'}
              className={`${INPUT} w-full text-sm ${r.isRegex && !isAuthor ? 'font-mono' : ''}`}
            />
            {!isAuthor && (
              <>
                <span />
                <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
                  <input type="checkbox" checked={r.isRegex} onChange={(e) => setR({ ...r, isRegex: e.target.checked })} className="rounded" />
                  正規表現で当てる(NG と同じ書き方)
                </label>
              </>
            )}
            <span className={label}>別名</span>
            <input
              value={r.label}
              onChange={(e) => setR({ ...r, label: e.target.value })}
              placeholder={r.isRegex ? '帯に出す名前(長い正規表現の代わりに。例: お絵描き)' : '帯に出す名前(空なら言葉そのもの)'}
              className={`${INPUT} w-full text-sm`}
            />
            <span className={label}>効く板</span>
            <select value={r.boardUrl ?? ''} onChange={(e) => setR({ ...r, boardUrl: e.target.value || undefined, boardName: boards.find((b) => b.url === e.target.value)?.name })} className={`${INPUT} text-sm`}>
              <option value="">すべての板</option>
              {boards.map((b) => (
                <option key={b.url} value={b.url}>
                  {b.name}
                  {props.board && b.url === props.board.url ? '(開いている板)' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-c-text-muted">
            {err ??
              (dup
                ? '同じキーワードがもうあります'
                : isAuthor
                  ? 'この人が立てたスレを帯にまとめ、お気に入り板に立ったら知らせます'
                  : r.isRegex
                    ? '正規表現で当てます(大文字と小文字は区別します。先頭に (?i) と書くと区別しません)'
                    : 'スレタイにこの言葉を含むスレを帯にまとめます(全角半角・大文字小文字・カナかなは同じ扱い)')}
          </p>
        </div>
        <div className="flex items-center gap-2 px-5 pb-4">
          {props.onDelete && (
            <button
              type="button"
              className={`${BTN_SECONDARY} !text-c-heat-very-hot`}
              onClick={() => {
                props.onDelete?.()
                props.onClose()
              }}
            >
              削除
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={BTN_SECONDARY} onClick={props.onClose}>
            やめる
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={!ok} onClick={submit}>
            {props.isNew ? '足す' : '直す'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
