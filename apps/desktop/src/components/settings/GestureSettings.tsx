import { useState } from 'react'
import GestureRecorder, { gestureArrows } from '../GestureRecorder'
import ActionSheet from '../ActionSheet'
import { GESTURE_ACTIONS } from '../../utils/gestures'
import { type SettingsProps, Section, Choice } from './common'

/** スマホ: 画面ごとに、スワイプに割り当てる操作と、感度 */
export function GestureSettings({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  /** なぞり方を覚えさせている操作(と画面) */
  const [recording, setRecording] = useState<{ screen: 'list' | 'thread'; action: string }>()
  /** 足す操作を選んでいる画面 */
  const [picking, setPicking] = useState<'list' | 'thread'>()
  const nameOf = (action: string) => GESTURE_ACTIONS.find((a) => a.key === action)?.name.replace(/\(.*\)$/, '') ?? action
  const setMap = (key: 'list' | 'thread', map: Record<string, string>) => update('swipeGestures', { ...s.swipeGestures, [key]: map })
  // 操作ごとに、割り当てたなぞり方を並べる。＋ を押して、枠の中で実際になぞって覚えさせる
  const screen = (key: 'list' | 'thread', title: string) => {
    const map = s.swipeGestures[key]
    const assigned = [...new Set(Object.values(map).filter(Boolean))]
    return (
      <Section title={title} note="操作の行の ＋ を押して、実際になぞった形を割り当てます。左の端から右へなぞると、いつもメニュー(引き出し)が開きます">
        <div className="flex flex-col">
          {assigned.map((action) => (
            <div key={action} className="settings-row flex items-center gap-3 py-3">
              <span className="flex-1 min-w-0 text-[15px] text-c-text-strong">{nameOf(action)}</span>
              {Object.entries(map)
                .filter(([, a]) => a === action)
                .map(([seq]) => (
                  <button
                    key={seq}
                    type="button"
                    onClick={() => setMap(key, Object.fromEntries(Object.entries(map).filter(([k]) => k !== seq)))}
                    className="flex items-center gap-0.5 pl-2 pr-1 py-1 rounded-lg bg-c-surface2 border border-c-border text-base text-c-text-strong"
                    title="このなぞり方を外す"
                  >
                    {gestureArrows(seq)}
                    <span className="material-symbols-outlined text-base text-c-text-muted">close</span>
                  </button>
                ))}
              <button type="button" onClick={() => setRecording({ screen: key, action })} className="p-1.5 text-c-accent" title="なぞり方を足す">
                <span className="material-symbols-outlined text-2xl">add_circle</span>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setPicking(key)} className="mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-c-border text-[15px] text-c-accent">
            <span className="material-symbols-outlined text-xl">add</span>
            操作を足す
          </button>
        </div>
      </Section>
    )
  }
  return (
    <>
      {screen('list', 'スレ一覧のジェスチャー')}
      {screen('thread', 'スレ表示のジェスチャー')}
      <Section title="ジェスチャーの感度">
        <Choice
          value={s.gestureSensitivity}
          options={[
            { key: 1, name: '鈍い' },
            { key: 2, name: '少し鈍い' },
            { key: 3, name: '標準' },
            { key: 4, name: '少し敏感' },
            { key: 5, name: '敏感' },
          ]}
          onChange={(v) => update('gestureSensitivity', v)}
        />
      </Section>
      {picking && (
        <ActionSheet
          title="どの操作に割り当てますか"
          onClose={() => setPicking(undefined)}
          items={GESTURE_ACTIONS.filter((a) => !Object.values(s.swipeGestures[picking]).includes(a.key)).map((a) => ({
            label: nameOf(a.key),
            icon: 'swipe',
            onClick: () => setRecording({ screen: picking, action: a.key }),
          }))}
        />
      )}
      {recording && (
        <GestureRecorder
          action={nameOf(recording.action)}
          usedBy={(seq) => {
            const a = s.swipeGestures[recording.screen][seq]
            return a && a !== recording.action ? nameOf(a) : undefined
          }}
          onClose={() => setRecording(undefined)}
          onDone={(seq) => {
            setMap(recording.screen, { ...s.swipeGestures[recording.screen], [seq]: recording.action })
            setRecording(undefined)
          }}
        />
      )}
    </>
  )
}
