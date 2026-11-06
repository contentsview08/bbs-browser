// NG 1 つの中身を決める欄(種類・文字・正規表現・効く板・期限・メモ・試し)。足す画面(NgRuleDialog)・PC の管理表(NgManager)・
// スマホの NG の画面(mobile/NgPage)で共通に使う。スマホのアプリの NG の編集(ui/Settings.kt の NgEditSheet)と同じ項目・同じ言葉
import { useMemo, type ReactNode } from 'react'
import { NG_TARGETS, daysLaterDateString, matchRanges, patternError, todayDateString, type NgRule } from '../utils/ng'

const INPUT =
  'w-full bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted focus:ring-c-accent focus:border-c-accent'

/** 期限の選び方(今の期限が選択肢にない日付なら、その日付のまま「〜まで」と出す) */
type Expiry = 'none' | 'today' | 'week' | 'month' | 'keep'

function expiryOf(r: Pick<NgRule, 'expiresOnDate'>): Expiry {
  if (!r.expiresOnDate) return 'none'
  if (r.expiresOnDate === todayDateString()) return 'today'
  if (r.expiresOnDate === daysLaterDateString(7)) return 'week'
  if (r.expiresOnDate === daysLaterDateString(30)) return 'month'
  return 'keep'
}

export type NgDraftRule = Omit<NgRule, 'id'> & { id?: string }

export default function NgEditor(props: {
  rule: NgDraftRule
  onChange: (r: NgDraftRule) => void
  /** 「この板だけ」にできる板(スレ・スレ一覧から開いたとき)。なければ、もとから決まっている板だけを出す */
  board?: { url: string; name: string }
  /** 種類ごとの元の文字。種類を切り替えたら、その種類の文字を欄に入れる */
  values?: Partial<Record<NgRule['target'], string>>
  /** 試し欄に最初に入れておく文(元のレスの本文など) */
  sample: string
  onSampleChange: (s: string) => void
  /** Ctrl+Enter で決める */
  onSubmit?: () => void
  compact?: boolean
}) {
  const r = props.rule
  const set = (p: Partial<NgDraftRule>) => props.onChange({ ...r, ...p })
  const err = r.pattern.trim() ? patternError(r.pattern.trim(), r.isRegex) : undefined
  const expiry = expiryOf(r)
  const board = r.boardUrl ? { url: r.boardUrl, name: r.boardName ?? r.boardUrl } : props.board
  // 試し: 試し欄の文のうち、いま当たる所に色を付ける
  const ranges = useMemo(() => (err ? [] : matchRanges({ ...r, pattern: r.pattern.trim() }, props.sample)), [r, props.sample, err])
  const highlighted = useMemo(() => {
    const out: ReactNode[] = []
    let at = 0
    ranges.forEach(([a, b], i) => {
      if (a > at) out.push(props.sample.slice(at, a))
      out.push(
        <mark key={i} className="rounded-sm" style={{ background: 'color-mix(in srgb, var(--c-mark-danger) 35%, transparent)', color: 'inherit' }}>
          {props.sample.slice(a, b)}
        </mark>,
      )
      at = b
    })
    out.push(props.sample.slice(at))
    return out
  }, [ranges, props.sample])
  const chip = (on: boolean) =>
    `px-3 py-1 text-sm border rounded-[var(--chip-radius)] transition-colors ${on ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border text-c-text-body hover:border-c-border-strong'}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {NG_TARGETS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              // その種類の元の文字が分かっていれば入れ替える(ID を押したら、そのレスの ID が入る)
              const v = props.values?.[t.key]
              set({ target: t.key, ...(v ? { pattern: v } : {}) })
            }}
            className={chip(t.key === r.target)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div>
        <textarea
          value={r.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              props.onSubmit?.()
            }
          }}
          autoFocus
          rows={props.compact ? 2 : Math.min(6, Math.max(2, r.pattern.split('\n').length))}
          spellCheck={false}
          placeholder={r.isRegex ? '正規表現(例: ^ｷﾀ━+|ｗ{5,})' : 'NG にする言葉'}
          className={`${INPUT} resize-y ${r.isRegex ? 'font-mono' : ''} ${err ? '!border-c-heat-very-hot' : ''}`}
        />
        <p className={`mt-1 text-xs ${err ? 'text-c-heat-very-hot' : 'text-c-text-muted'}`}>
          {err ??
            (r.isRegex
              ? '正規表現で当てます(大文字と小文字は区別します。先頭に (?i) と書くと区別しません)'
              : r.target === 'posterId'
                ? 'ID が同じときだけ当てます(完全一致)'
                : 'この言葉を含めば当てます(部分一致。大文字と小文字は区別しません)')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-c-text-body">
        <label className="flex items-center gap-1.5 select-none">
          <input type="checkbox" checked={r.isRegex} onChange={(e) => set({ isRegex: e.target.checked })} className="rounded" />
          正規表現
        </label>
        <label className="flex items-center gap-1.5 select-none">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="rounded" />
          有効
        </label>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-c-text-muted">効く板</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(!r.boardUrl)} onClick={() => set({ boardUrl: undefined, boardName: undefined })}>
            すべての板
          </button>
          {board && (
            <button type="button" className={chip(!!r.boardUrl)} onClick={() => set({ boardUrl: board.url, boardName: board.name })} title={board.url}>
              この板だけ({board.name})
            </button>
          )}
        </div>
        <span className="text-c-text-muted">期限</span>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['none', 'ずっと', undefined],
              ['today', '今日だけ', todayDateString()],
              ['week', '7 日', daysLaterDateString(7)],
              ['month', '30 日', daysLaterDateString(30)],
            ] as [Expiry, string, string | undefined][]
          ).map(([k, label, date]) => (
            <button key={k} type="button" className={chip(expiry === k)} onClick={() => set({ expiresOnDate: date })}>
              {label}
            </button>
          ))}
          {expiry === 'keep' && <span className={chip(true)}>{r.expiresOnDate} まで</span>}
        </div>
        <span className="text-c-text-muted">メモ</span>
        <input type="text" value={r.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="なぜ NG にしたか(自分だけ見えます)" className={INPUT} />
      </div>
      {/* 試し: 文を入れると、いまの NG が当たる所に色が付く */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-c-text-muted">試す(文を入れると、当たる所に色が付きます)</span>
          <span className={`text-xs ${ranges.length > 0 ? 'text-c-heat-very-hot font-bold' : 'text-c-text-muted'}`}>{ranges.length > 0 ? `${ranges.length} か所に当たる` : '当たらない'}</span>
        </div>
        <textarea value={props.sample} onChange={(e) => props.onSampleChange(e.target.value)} rows={2} spellCheck={false} className={`${INPUT} mt-1 resize-y text-xs`} />
        {props.sample && <p className="mt-1 px-2 py-1.5 rounded bg-c-surface2 text-xs text-c-text-body whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{highlighted}</p>}
      </div>
    </div>
  )
}
