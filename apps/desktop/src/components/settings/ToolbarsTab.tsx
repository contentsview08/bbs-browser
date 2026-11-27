import { isMobile } from '../../utils/platform'
import { ChipDock } from './ChipDock'
import { barActionsFor, orderBy, resolvePlacements, type BarArea, type Placement, PLACEMENTS } from '../../utils/toolbar'
import { type SettingsProps, Section } from './common'

/** スレ表示とスレ一覧の操作ボタンを、ヘッダー・フッター・︙ の中だけ、のどこに置くか(部品を箱に入れる形。ChipDock) */
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
    // 箱(ヘッダーの左・右、フッターの左・右、︙ の中だけ)を縦に並べ、箱の中も縦 1 列。上にあるものほど帯の左に出る
    const actions = orderBy(barActionsFor(areaKey, isMobile), order[areaKey])
    const nameOf = (id: string) => actions.find((a) => a.id === id)!
    const zoneItems = (p: Placement) => actions.filter((a) => placements[a.id] === p).map((a) => a.id)
    /** id を zone の index 番目(id 自身を除いて数える)へ。置き場所と、並び(箱の順に、箱ごとの並びをつなげたもの)を一緒に変える */
    const move = (id: string, zone: Placement, index: number) => {
      const zones = PLACEMENTS.map((p) => ({ key: p.key, ids: actions.filter((a) => placements[a.id] === p.key && a.id !== id).map((a) => a.id) }))
      zones.find((z) => z.key === zone)!.ids.splice(index, 0, id)
      update(orderKey, { ...order, [areaKey]: zones.flatMap((z) => z.ids) })
      if (placements[id] !== zone) set(areaKey, id, zone)
    }
    const between = areaKey === 'thread' ? 'スレタイ' : '板名'
    const item = (id: string) => ({ id, name: nameOf(id).name, icon: nameOf(id).icon })
    // 箱: ヘッダーの左・右、フッターの左・右。箱にないものは ︙ の中だけ(下の「使えるボタン」)
    const docks = (['headerStart', 'header', 'footerStart', 'footer'] as const).map((p) => ({
      key: p,
      label: PLACEMENTS.find((x) => x.key === p)!.name,
      items: zoneItems(p).map(item),
      ...(p === 'headerStart' ? { trailing: between } : p === 'header' ? { leading: between } : {}),
    }))
    return (
      <Section
        title={title}
        note="ボタンをつかんで箱に入れると、帯のその位置に出ます(左から順)。箱にないボタンは ︙ の中だけに出ます(︙ にはいつも全部出ます)。押すとメニューでも動かせます"
      >
        <ChipDock
          docks={docks}
          palette={zoneItems('menu').map(item)}
          paletteTitle="︙ の中だけのボタン"
          onPlace={(dock, id, index) => move(id, dock as Placement, index)}
          onMove={(dock, from, to) => move(zoneItems(dock as Placement)[from], dock as Placement, to)}
          onRemove={(dock, index) => move(zoneItems(dock as Placement)[index], 'menu', zoneItems('menu').length)}
        />
      </Section>
    )
  }
  return (
    <div>
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
    </div>
  )
}
