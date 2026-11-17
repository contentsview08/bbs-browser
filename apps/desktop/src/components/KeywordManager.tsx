// 設定「スレ一覧」のキーワードの表。種類・名前(別名)・言葉・効く板・有効。足す・直す・消す(スマホ版の KeywordListScreen に当たる)
import { useState } from 'react'
import { keywordLabel, newKeywordRule, type KeywordRule } from '../utils/keywords'
import KeywordEditDialog from './KeywordEditDialog'
import { BTN_SECONDARY } from './DialogParts'

const ICON_BTN = 'p-1 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2'

export default function KeywordManager(props: { rules: KeywordRule[]; favorites: { url: string; name: string }[]; onChange: (rules: KeywordRule[]) => void }) {
  const { rules, onChange } = props
  const [editing, setEditing] = useState<{ rule: KeywordRule; isNew: boolean }>()
  const save = (r: KeywordRule) => onChange(rules.some((x) => x.id === r.id) ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r])
  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="py-3 text-sm text-c-text-muted">キーワードはまだありません。スレの右クリック →「キーワードに登録」でも足せます</p>
      ) : (
        <div className="border border-c-border rounded-[var(--card-radius)] overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-c-surface2 text-xs text-c-text-muted">
              <tr>
                <th className="w-12 text-left font-normal pl-2 py-1.5">有効</th>
                <th className="w-16 text-left font-normal">種類</th>
                <th className="text-left font-normal">帯の名前・言葉</th>
                <th className="w-28 text-left font-normal">効く板</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-c-border">
              {rules.map((r) => (
                <tr key={r.id} className={r.enabled ? '' : 'opacity-60'}>
                  <td className="pl-2 py-1.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.enabled}
                      onClick={() => save({ ...r, enabled: !r.enabled })}
                      className="relative w-8 h-[18px] rounded-full transition-colors"
                      style={{ background: r.enabled ? 'var(--c-accent)' : 'var(--c-border-strong)' }}
                      title={r.enabled ? '有効(押すと無効)' : '無効(押すと有効)'}
                    >
                      <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all" style={{ left: r.enabled ? 16 : 2 }} />
                    </button>
                  </td>
                  <td className="text-xs text-c-text-muted">{r.kind === 'author' ? '立てた人' : 'スレタイ'}</td>
                  <td className="min-w-0 py-1.5 pr-2">
                    <span className="block truncate text-c-text-body" title={keywordLabel(r)}>
                      {keywordLabel(r)}
                    </span>
                    {(r.label.trim() !== '' || r.isRegex) && (
                      <span className="block truncate text-[10px] text-c-text-muted">
                        {r.isRegex && <span className="mr-1.5 px-1 rounded bg-c-surface2">正規表現</span>}
                        <span className={r.isRegex ? 'font-mono' : ''}>{r.pattern}</span>
                      </span>
                    )}
                  </td>
                  <td className="text-xs text-c-text-muted truncate" title={r.boardUrl}>
                    {r.boardUrl ? (r.boardName ?? r.boardUrl) : 'すべて'}
                  </td>
                  <td className="text-right pr-1 whitespace-nowrap">
                    <button type="button" className={ICON_BTN} title="直す" onClick={() => setEditing({ rule: r, isNew: false })}>
                      <span className="material-symbols-outlined text-base">edit</span>
                    </button>
                    <button type="button" className={ICON_BTN} title="削除" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className={BTN_SECONDARY} onClick={() => setEditing({ rule: newKeywordRule({ pattern: '' }), isNew: true })}>
        ＋ キーワードを足す
      </button>
      {editing && (
        <KeywordEditDialog
          rule={editing.rule}
          isNew={editing.isNew}
          favorites={props.favorites}
          others={rules.filter((x) => x.id !== editing.rule.id)}
          onSubmit={save}
          onDelete={editing.isNew ? undefined : () => onChange(rules.filter((x) => x.id !== editing.rule.id))}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
