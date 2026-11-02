// PC の NG の管理表(設定の NG のタブ)。検索・種類の絞り込み・並べ替え・まとめて有効 / 無効 / 削除・期限切れの片づけ・
// 試し(文を入れると、当たる NG を並べる)。1 つずつの追加と直しは NgRuleDialog(中身の欄は NgEditor。スマホと共通)
import { useMemo, useState } from 'react'
import { NG_TARGETS, isActive, matchRanges, pruneExpired, todayDateString, type NgRule, type NgTarget } from '../utils/ng'
import NgRuleDialog, { type NgDraft } from './NgRuleDialog'

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted focus:ring-c-accent focus:border-c-accent'
const BTN = 'px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong disabled:opacity-50'
const ICON_BTN = 'p-1 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2'

type Sort = 'new' | 'pattern' | 'target'
const targetName = (t: NgTarget) => NG_TARGETS.find((x) => x.key === t)?.name ?? t

export default function NgManager(props: { rules: NgRule[]; onChange: (rules: NgRule[]) => void }) {
  const { rules, onChange } = props
  const [filter, setFilter] = useState<NgTarget | 'all'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<NgDraft>()
  const [sample, setSample] = useState('')
  const today = todayDateString()

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rules.filter(
      (r) => (filter === 'all' || r.target === filter) && (!q || r.pattern.toLowerCase().includes(q) || (r.note ?? '').toLowerCase().includes(q) || (r.boardName ?? '').toLowerCase().includes(q)),
    )
    if (sort === 'pattern') return [...list].sort((a, b) => a.pattern.localeCompare(b.pattern, 'ja'))
    if (sort === 'target') return [...list].sort((a, b) => NG_TARGETS.findIndex((t) => t.key === a.target) - NG_TARGETS.findIndex((t) => t.key === b.target))
    // 新しい順(足した時刻がない前からの NG は、並びのまま後ろに)
    return [...list].reverse().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [rules, filter, query, sort])
  const expiredCount = rules.length - pruneExpired(rules).length
  // 試し: 文に当たる(効いている)NG
  const hits = useMemo(() => (sample.trim() ? rules.filter((r) => isActive(r, today) && matchRanges(r, sample).length > 0) : []), [rules, sample, today])

  const setMany = (ids: Set<string>, f: (r: NgRule) => NgRule | null) =>
    onChange(rules.flatMap((r) => (ids.has(r.id) ? (f(r) ? [f(r)!] : []) : [r])))
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.id)))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="space-y-3">
      {/* 種類の絞り込み(件数付き) */}
      <div className="flex flex-wrap gap-1.5">
        {([{ key: 'all' as const, name: 'すべて' }, ...NG_TARGETS] as { key: NgTarget | 'all'; name: string }[]).map((t) => {
          const on = t.key === filter
          const n = t.key === 'all' ? rules.length : rules.filter((r) => r.target === t.key).length
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1 text-sm border rounded-[var(--chip-radius)] ${on ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border text-c-text-body hover:border-c-border-strong'}`}
            >
              {t.name}
              <span className="ml-1.5 text-xs tabular-nums opacity-70">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="文字・メモ・板の名前で探す" className={`${INPUT} flex-1 min-w-48`} />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={INPUT} title="並べ替え">
          <option value="new">新しい順</option>
          <option value="pattern">文字の順</option>
          <option value="target">種類の順</option>
        </select>
        <button
          type="button"
          onClick={() => setDraft({ target: filter === 'all' ? 'content' : filter, pattern: '' })}
          className="px-3 py-1.5 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover"
        >
          ＋ NG を追加
        </button>
      </div>

      {/* 選んだものをまとめて */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-[var(--card-radius)] bg-[var(--c-accent-wash)] text-sm">
          <span className="font-bold text-c-text-strong">{selected.size} 件を選択中</span>
          <button type="button" className={BTN} onClick={() => setMany(selected, (r) => ({ ...r, enabled: true }))}>
            有効にする
          </button>
          <button type="button" className={BTN} onClick={() => setMany(selected, (r) => ({ ...r, enabled: false }))}>
            無効にする
          </button>
          <button
            type="button"
            className={`${BTN} !text-c-heat-very-hot`}
            onClick={() => {
              setMany(selected, () => null)
              setSelected(new Set())
            }}
          >
            削除
          </button>
          <button type="button" className="ml-auto text-c-text-muted hover:text-c-text-strong" onClick={() => setSelected(new Set())}>
            選択を外す
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-c-text-muted">{rules.length === 0 ? 'NG はまだありません。レスの ⋯・スレの NG ボタン・「＋ NG を追加」から足せます' : '当てはまる NG はありません'}</p>
      ) : (
        <div className="border border-c-border rounded-[var(--card-radius)] overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-c-surface2 text-xs text-c-text-muted">
              <tr>
                <th className="w-8 py-1.5">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAll} className="rounded" title="見えているものを全部選ぶ" />
                </th>
                <th className="w-12 text-left font-normal">有効</th>
                <th className="w-16 text-left font-normal">種類</th>
                <th className="text-left font-normal">文字</th>
                <th className="w-28 text-left font-normal">効く板</th>
                <th className="w-24 text-left font-normal">期限</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-c-border">
              {shown.map((r) => {
                const expired = !!r.expiresOnDate && r.expiresOnDate < today
                return (
                  <tr key={r.id} className={`${selected.has(r.id) ? 'bg-[var(--c-accent-wash)]' : ''} ${!isActive(r, today) ? 'opacity-60' : ''}`}>
                    <td className="text-center py-1.5">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="rounded" />
                    </td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.enabled}
                        onClick={() => onChange(rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))}
                        className="relative w-8 h-[18px] rounded-full transition-colors"
                        style={{ background: r.enabled ? 'var(--c-accent)' : 'var(--c-border-strong)' }}
                        title={r.enabled ? '有効(押すと無効)' : '無効(押すと有効)'}
                      >
                        <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all" style={{ left: r.enabled ? 16 : 2 }} />
                      </button>
                    </td>
                    <td className="text-xs text-c-text-muted">{targetName(r.target)}</td>
                    <td className="min-w-0 py-1.5 pr-2">
                      <span className={`block truncate ${r.isRegex ? 'font-mono' : ''} text-c-text-body`} title={r.pattern}>
                        {r.pattern}
                      </span>
                      {(r.isRegex || r.note) && (
                        <span className="block truncate text-[10px] text-c-text-muted">
                          {r.isRegex && <span className="mr-1.5 px-1 rounded bg-c-surface2">正規表現</span>}
                          {r.note}
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-c-text-muted truncate" title={r.boardUrl}>
                      {r.boardUrl ? (r.boardName ?? r.boardUrl) : 'すべて'}
                    </td>
                    <td className={`text-xs ${expired ? 'text-c-heat-very-hot' : 'text-c-text-muted'}`}>{r.expiresOnDate ? `${r.expiresOnDate}${expired ? '(切れ)' : 'まで'}` : 'ずっと'}</td>
                    <td className="text-right pr-1 whitespace-nowrap">
                      <button type="button" className={ICON_BTN} title="直す" onClick={() => setDraft({ target: r.target, pattern: r.pattern, rule: r })}>
                        <span className="material-symbols-outlined text-base">edit</span>
                      </button>
                      <button type="button" className={ICON_BTN} title="削除" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-c-text-muted">
        <span>
          全部で {rules.length} 件(効いているもの {rules.filter((r) => isActive(r, today)).length} 件)
        </span>
        {expiredCount > 0 && (
          <button type="button" className="text-c-link hover:underline" onClick={() => onChange(pruneExpired(rules))}>
            期限の切れた {expiredCount} 件を片づける
          </button>
        )}
      </div>

      {/* 試し: 文を入れると、当たる NG を並べる */}
      <div className="pt-2 border-t border-c-border">
        <p className="text-sm text-c-text-body mb-1.5">試す</p>
        <textarea
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="レスの本文・名前・ID・スレタイを入れると、当たる NG を並べます"
          className={`${INPUT} w-full resize-y text-xs`}
        />
        {sample.trim() && (
          <p className="mt-1 text-xs text-c-text-muted">
            {hits.length === 0 ? (
              '当たる NG はありません'
            ) : (
              <>
                {hits.length} 件に当たる:{' '}
                {hits.map((r) => (
                  <button key={r.id} type="button" className="mr-2 text-c-link hover:underline" onClick={() => setDraft({ target: r.target, pattern: r.pattern, rule: r })}>
                    {targetName(r.target)}「{r.pattern.length > 24 ? `${r.pattern.slice(0, 24)}…` : r.pattern}」
                  </button>
                ))}
              </>
            )}
          </p>
        )}
      </div>

      {draft && (
        <NgRuleDialog
          draft={draft}
          onSubmit={(rule) => onChange(rules.some((r) => r.id === rule.id) ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule])}
          onClose={() => setDraft(undefined)}
        />
      )}
    </div>
  )
}
