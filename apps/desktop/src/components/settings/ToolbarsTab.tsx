// 設定の「ボタンの配置」。

import { isMobile } from '../../utils/platform'
import { DragZones } from '../DragSort'
import { barActionsFor, orderBy, resolvePlacements, type BarArea, type Placement, PLACEMENTS } from '../../utils/toolbar'
import { type SettingsProps, Section } from './common'

/** スレ表示とスレ一覧の操作ボタンを、ヘッダー・フッター・︙ の中だけ、のどこに置くか */
export function ToolbarsTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  // スマホでは、スマホの配置(PC とは別に持つ)を変える
  const key = isMobile ? 'mobileBarLayout' : 'barLayout'
  const layout = s[key]
  const orderKey = isMobile ? 'mobileBarOrder' : 'barOrder'
  const order = s[orderKey]
  const set = (area: BarArea, id: string, placement: Placement) => {
    const cur = layout[area] ?? {}
    update(key, { ...layout, [area]: { ...cur, [id]: placement } })
  }
  const area = (areaKey: BarArea, title: string) => {
    const placements = resolvePlacements(areaKey, layout, isMobile)
    // ボタンをつまんで、ヘッダー・フッターの左右・︙ の箱のあいだで動かす(同じ箱の中で動かすと並び順が変わる)。
    // 箱は実際の画面と同じ向き(帯は横)に並べる
    const actions = orderBy(barActionsFor(areaKey, isMobile), order[areaKey])
    const nameOf = (id: string) => actions.find((a) => a.id === id)!
    const zoneItems = (p: Placement) => actions.filter((a) => placements[a.id] === p).map((a) => a.id)
    return (
      <Section title={title} note="ボタンをつかんで、置きたい帯の、置きたい位置へ動かします(左右の箱の中で動かすと並び順が変わります)。どのボタンも ︙ の中には出ます">
        <DragZones
          zones={PLACEMENTS.map((p) => ({ key: p.key, title: p.name, items: zoneItems(p.key) }))}
          bars={[
            { title: 'ヘッダー', zones: ['headerStart', 'header'], between: areaKey === 'thread' ? 'スレタイ' : '板名' },
            { title: 'フッター', zones: ['footerStart', 'footer'], between: '' },
          ]}
          onMove={(id, zone, index) => {
            // 置き場所と、並び(箱の順に、箱ごとの並びをつなげたもの)を一緒に変える
            const zones = PLACEMENTS.map((p) => ({ key: p.key, ids: actions.filter((a) => placements[a.id] === p.key && a.id !== id).map((a) => a.id) }))
            zones.find((z) => z.key === zone)!.ids.splice(index, 0, id)
            update(orderKey, { ...order, [areaKey]: zones.flatMap((z) => z.ids) })
            if (placements[id] !== zone) set(areaKey, id, zone)
          }}
          render={(id, handle, dragging) => (
            <div
              className={`flex items-center gap-1.5 pl-2 pr-0.5 py-1 rounded-lg border border-c-border ${dragging ? 'bg-c-surface2' : 'bg-c-surface'}`}
              title={nameOf(id).name}
            >
              <span className="material-symbols-outlined text-xl text-c-text-muted">{nameOf(id).icon}</span>
              <span className="text-xs text-c-text-body whitespace-nowrap">{nameOf(id).name}</span>
              <span {...handle} data-drag-handle className="w-6 h-7 -my-1 flex items-center justify-center text-c-text-muted cursor-grab" style={{ touchAction: 'none' }} title="つまんで動かす">
                <span className="material-symbols-outlined text-base">drag_indicator</span>
              </span>
            </div>
          )}
        />
      </Section>
    )
  }
  return (
    <>
      {area('thread', 'スレ表示')}
      {area('list', 'スレ一覧')}
      <button
        type="button"
        onClick={() => {
          update(key, {})
          update(orderKey, {})
        }}
        className="text-xs text-c-text-muted hover:text-c-accent underline"
      >
        すべて既定に戻す
      </button>
    </>
  )
}
