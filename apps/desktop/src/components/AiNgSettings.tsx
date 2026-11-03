// 設定 → NG の「AI NG」。モデルの取得と状態、条件(本人が書く文)の一覧と編集、試す欄、手の印の数。
// 判定(条件ごとの当たり具合)と見せ方(隠す・畳む・印だけ)を分けて決める。決め方は utils/aiNg.ts
import { useState } from 'react'
import { AI_MODEL, AI_NG_SHOWS, DEFAULT_THRESHOLD, MIN_EXAMPLES, hypothesisOf, type AiNgRule } from '../utils/aiNg'
import { deleteAiModelFiles, testScore, useAiModelStatus } from '../hooks/useAiNg'
import type { AppSettings, UpdateSetting } from '../ui/settings'
import { ManagerDialog, Switch, Toggle } from './SettingParts'
import { BTN_PRIMARY, BTN_SECONDARY } from './DialogParts'
import FontSizeSlider from './FontSizeSlider'
import { isMobile } from '../utils/platform'

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
const BTN = BTN_PRIMARY
const SUB_BTN = BTN_SECONDARY

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)}MB`

export default function AiNgSettings({ settings: s, update }: { settings: AppSettings; update: UpdateSetting }) {
  const status = useAiModelStatus()
  const [editing, setEditing] = useState<AiNgRule>()
  const rules = s.aiNgRules
  const save = (r: AiNgRule) => update('aiNgRules', rules.some((x) => x.id === r.id) ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r])
  const remove = (id: string) => {
    update('aiNgRules', rules.filter((x) => x.id !== id))
    const { [id]: _, ...rest } = s.aiNgOverrides
    update('aiNgOverrides', rest)
  }
  const marks = (id: string) => (s.aiNgOverrides[id]?.hit.length ?? 0) + (s.aiNgOverrides[id]?.miss.length ?? 0)
  /** 学ぶための印の数(当たる・当たらない) */
  const learnt = (id: string) => {
    const ex = s.aiNgOverrides[id]?.examples ?? []
    const hit = ex.filter((e) => e.hit).length
    return { hit, miss: ex.length - hit }
  }

  return (
    <div className="space-y-3">
      <Toggle
        checked={s.aiNgEnabled}
        onChange={(v) => update('aiNgEnabled', v)}
        label="AI NG を使う"
        note={`はじめてオンにしたとき、判定モデル(${AI_MODEL.size}・${AI_MODEL.license} ライセンス)を一度だけ取ります。判定はこの端末の中だけで行い、レスをどこにも送りません。判定が済んだものから畳みます`}
      />
      {s.aiNgEnabled && (
        <div className="px-3 py-2 rounded-lg border border-c-border bg-c-surface2 text-xs text-c-text-body flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-c-accent">psychology</span>
          <span className="flex-1">
            {status.kind === 'ready' && '判定モデルを使えます'}
            {status.kind === 'loading' &&
              (status.total > 0 ? (
                <>
                  判定モデルを取っています {Math.floor((status.loaded / status.total) * 100)}%({mb(status.loaded)} / {mb(status.total)})
                  <span className="block mt-1.5 h-1.5 rounded-full bg-c-surface3 overflow-hidden">
                    <span className="block h-full bg-c-accent transition-[width]" style={{ width: `${Math.min(100, (status.loaded / status.total) * 100)}%` }} />
                  </span>
                </>
              ) : (
                '判定モデルを用意しています…'
              ))}
            {status.kind === 'error' && `判定モデルを使えませんでした: ${status.message}`}
            {status.kind === 'off' && '止まっています'}
          </span>
          <button
            type="button"
            className="text-c-text-muted hover:text-c-heat-very-hot underline"
            onClick={() => {
              if (!confirm('取った判定モデルを消しますか(AI NG はオフになります。もう一度オンにすると取り直します)')) return
              update('aiNgEnabled', false)
              void deleteAiModelFiles()
            }}
          >
            モデルを消す
          </button>
        </div>
      )}
      <p className="text-xs text-c-text-muted leading-relaxed">
        当てる順: 手で足した NG(ワード・ID など)→ 手の印(レスのメニューの「AI NG『〜』に当たる・当たらない」)→ モデルの判定。
        畳んだ AI NG は「AI NG・条件の名前 87%」と出るので、ふつうの NG・自動 NG とは見分けられます
      </p>
      <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2">
            <Switch checked={r.enabled} onChange={(v) => save({ ...r, enabled: v })} title="この条件を使う" />
            <button type="button" onClick={() => setEditing(r)} className="flex-1 min-w-0 text-left">
              <span className={`block text-sm ${r.enabled ? 'text-c-text-strong' : 'text-c-text-muted'}`}>
                {r.name || '(名前なし)'}
                <span className="ml-2 text-[11px] text-c-text-muted">
                  {AI_NG_SHOWS.find((x) => x.key === r.show)?.name}・{Math.round(r.threshold * 100)}% から{r.boardUrl ? `・${r.boardName ?? r.boardUrl} だけ` : ''}
                  {marks(r.id) > 0 && `・手の印 ${marks(r.id)} 件`}
                </span>
              </span>
              <span className="block text-xs text-c-text-muted truncate">{hypothesisOf(r.prompt)}</span>
            </button>
            <span className="material-symbols-outlined text-lg text-c-text-muted">chevron_right</span>
          </div>
        ))}
        {rules.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
      </div>
      <button
        type="button"
        className={SUB_BTN}
        onClick={() => setEditing({ id: crypto.randomUUID(), name: '', prompt: '', threshold: DEFAULT_THRESHOLD, show: 'fold', enabled: true })}
      >
        条件を足す
      </button>
      {editing && (
        <RuleEditor
          rule={editing}
          isNew={!rules.some((r) => r.id === editing.id)}
          marks={marks(editing.id)}
          learnt={learnt(editing.id)}
          ready={status.kind === 'ready'}
          onClose={() => setEditing(undefined)}
          onSave={(r) => {
            save(r)
            setEditing(undefined)
          }}
          onDelete={() => {
            remove(editing.id)
            setEditing(undefined)
          }}
          onClearMarks={() => {
            const { [editing.id]: _, ...rest } = s.aiNgOverrides
            update('aiNgOverrides', rest)
          }}
        />
      )}
    </div>
  )
}

function RuleEditor(props: {
  rule: AiNgRule
  isNew: boolean
  marks: number
  learnt: { hit: number; miss: number }
  ready: boolean
  onClose: () => void
  onSave: (r: AiNgRule) => void
  onDelete: () => void
  onClearMarks: () => void
}) {
  const [r, setR] = useState(props.rule)
  const [sample, setSample] = useState('')
  const [result, setResult] = useState<{ p?: number; error?: string; busy?: boolean }>()
  const valid = r.prompt.trim() !== ''
  return (
    <ManagerDialog title={props.isNew ? 'AI NG の条件を足す' : 'AI NG の条件'} onClose={props.onClose} dirty={JSON.stringify(r) !== JSON.stringify(props.rule)}>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-c-text-muted mb-1">名前(畳んだレスと、メニューに出す短い名前)</span>
          <input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="例: 煽り" className={`${INPUT} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs text-c-text-muted mb-1">条件(当てたい書き込みの様子を、短く、はっきりと)</span>
          <textarea
            value={r.prompt}
            onChange={(e) => setR({ ...r, prompt: e.target.value })}
            rows={2}
            placeholder="例: 他人を煽ったり、見下したりしている"
            className={`${INPUT} w-full`}
          />
          {valid && <span className="block text-[11px] text-c-text-muted mt-1">モデルに渡す形: {hypothesisOf(r.prompt)}</span>}
        </label>
        <div>
          <FontSizeSlider
            label="当てる当たり具合(高いほど、はっきり当たるものだけ。当たるものは 60〜80% ほどに出ます)"
            value={r.threshold}
            base={DEFAULT_THRESHOLD}
            unset={-1}
            min={0.5}
            max={0.98}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}% から`}
            icons={['filter_alt_off', 'filter_alt']}
            preview={() => {}}
            onCommit={(v) => setR({ ...r, threshold: v })}
          />
        </div>
        <div>
          <span className="block text-xs text-c-text-muted mb-1.5">当たったレスの見せ方</span>
          <div className={`flex ${isMobile ? 'flex-col' : 'flex-wrap'} gap-2`}>
            {AI_NG_SHOWS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setR({ ...r, show: o.key })}
                className={`px-3 py-1.5 text-sm border rounded-[var(--chip-radius)] text-left ${r.show === o.key ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border text-c-text-body'}`}
                title={o.note}
              >
                {o.name}
                <span className="block text-[10px] text-c-text-muted">{o.note}</span>
              </button>
            ))}
          </div>
        </div>
        <Toggle
          checked={!!r.withContext}
          onChange={(v) => setR({ ...r, withContext: v })}
          label="スレの話題を踏まえて判定する"
          note="スレタイと 1 レス目の頭を添えて判定します。「スレの話題と関係ない」のように、文脈で決まる条件に"
        />
        <Toggle
          checked={!!r.sameId}
          onChange={(v) => setR({ ...r, sameId: v })}
          label="同じ ID が 2 回以上当たったら、その ID の書き込みをすべて当てる"
          note="煽りを続けている人をまとめて畳むとき。手で「当たらない」を付けた書き込みは除きます"
        />
        <label className="block">
          <span className="block text-xs text-c-text-muted mb-1">効く板(空ならすべての板)</span>
          <input
            value={r.boardUrl ?? ''}
            onChange={(e) => setR({ ...r, boardUrl: e.target.value.trim() || undefined, boardName: undefined })}
            placeholder="板の URL(例: https://eagle.5ch.net/livejupiter/)"
            className={`${INPUT} w-full`}
          />
        </label>
        <div className="p-3 rounded-lg bg-c-surface2">
          <p className="text-xs font-bold text-c-text-strong mb-1.5">試す</p>
          <div className="flex gap-2">
            <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="試したい書き込みの文" className={`${INPUT} flex-1 min-w-0`} />
            <button
              type="button"
              className={BTN}
              disabled={!props.ready || !valid || !sample.trim() || result?.busy}
              onClick={() => {
                setResult({ busy: true })
                testScore(sample, r.prompt).then(
                  (p) => setResult({ p }),
                  (e: unknown) => setResult({ error: e instanceof Error ? e.message : String(e) }),
                )
              }}
            >
              試す
            </button>
          </div>
          <p className="mt-1.5 text-xs text-c-text-body">
            {!props.ready && 'AI NG を使う(モデルが使える)ときに試せます'}
            {result?.busy && '判定しています…'}
            {result?.error && `うまくいきませんでした: ${result.error}`}
            {result?.p !== undefined && (
              <>
                当たり具合 <b>{Math.round(result.p * 100)}%</b>({result.p >= r.threshold ? 'この条件に当たります' : '当たりません'})
              </>
            )}
          </p>
        </div>
        <p className="text-xs text-c-text-muted leading-relaxed">
          条件の文だけでは外れることがあります。レスのメニューで「当たる・当たらない」を付けると、その本文を覚えて、
          それぞれ {MIN_EXAMPLES} 件ずつそろうと印から学んだ判定もいっしょに使います(いま 当たる {props.learnt.hit}・当たらない {props.learnt.miss}
          {props.learnt.hit >= MIN_EXAMPLES && props.learnt.miss >= MIN_EXAMPLES ? '・学んでいます' : ''})
        </p>
        {props.marks > 0 && (
          <p className="text-xs text-c-text-muted flex items-center gap-2">
            手の印(当たる・当たらない)が {props.marks} 件あります
            <button type="button" className="underline hover:text-c-heat-very-hot" onClick={props.onClearMarks}>
              手の印を消す
            </button>
          </p>
        )}
        <div className="flex items-center gap-2 pt-2">
          {!props.isNew && (
            <button type="button" className="text-sm text-c-text-muted hover:text-c-heat-very-hot underline" onClick={props.onDelete}>
              この条件を消す
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={SUB_BTN} onClick={props.onClose}>
            やめる
          </button>
          <button type="button" className={BTN} disabled={!valid} onClick={() => props.onSave({ ...r, name: r.name.trim() || r.prompt.trim().slice(0, 12) })}>
            {props.isNew ? '足す' : '決める'}
          </button>
        </div>
      </div>
    </ManagerDialog>
  )
}
