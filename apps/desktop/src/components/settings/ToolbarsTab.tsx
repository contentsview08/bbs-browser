import { isMobile } from '../../utils/platform'
import { ChipDock } from './ChipDock'
import { barActionsFor, orderBy, resolvePlacements, type BarArea, type Placement, PLACEMENTS } from '../../utils/toolbar'
import { type SettingsProps, Section, ListTabsEditor, OrderEditor } from './common'
import { postToolbarAll } from './WriteTab'
import { THREAD_TOOLBAR_ITEMS } from './ThreadsTab'

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
  // 画面ごとの段。上の目次から飛ぶ(スマホ版の「ボタンの配置 → スレ表示 / スレ一覧 / 履歴」のページにあたる)
  const screens = [
    { id: 'bars-thread', name: 'スレ表示', icon: 'forum' },
    { id: 'bars-list', name: 'スレ一覧', icon: 'view_list' },
    ...(isMobile ? [] : [{ id: 'bars-post', name: 'レスの操作バー', icon: 'chat' }, { id: 'bars-card', name: 'スレの操作バー', icon: 'list_alt' }]),
  ]
  return (
    <div>
      <nav className="flex flex-wrap gap-1.5 mb-6">
        {screens.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="flex items-center gap-1.5 px-3 h-8 rounded-full border border-c-border text-sm text-c-text-body hover:bg-c-surface2 hover:border-c-accent"
          >
            <span className="material-symbols-outlined text-[18px] text-c-text-muted">{x.icon}</span>
            {x.name}
          </button>
        ))}
      </nav>
      <div id="bars-thread">{area('thread', 'スレ表示')}</div>
      <div id="bars-list">
        {area('list', 'スレ一覧')}
        <Section title="スレ一覧のタブ" note={isMobile ? 'スレ一覧のフッターに出すタブと、その並び(左から)です' : 'スレ一覧の上に出すタブと、その並び(左から)です。数字キーの 1・2・3… は左から順に当たります'}>
          <ListTabsEditor value={s.listTabs} onChange={(v) => update('listTabs', v)} />
        </Section>
      </div>
      <div id="bars-post">
        <Section desktopOnly title="レスの操作バー" note="レスにマウスを乗せたとき、右上に出すボタンです。⋯ のメニューにある操作はどれも並べられます。⋯ も外せ、全部外すとバーは出ません(そのレスで使えない操作は出ません)">
          <OrderEditor all={postToolbarAll(s.quickPhrases)} value={s.postToolbar2} onChange={(v) => update('postToolbar2', v)} restTitle="出していないボタン" dockLabel="レスの右上に出すボタン(左から)" />
        </Section>
      </div>
      <div id="bars-card">
        <Section desktopOnly title="スレの操作バー" note="スレにマウスを乗せたとき、右上に出すボタンです。右クリックのメニューにある操作はどれも並べられます。⋯ も外せ、全部外すとバーは出ません(そのスレで使えない操作は出ません)">
          <OrderEditor all={THREAD_TOOLBAR_ITEMS} value={s.threadToolbar} onChange={(v) => update('threadToolbar', v)} restTitle="出していないボタン" dockLabel="スレの右上に出すボタン(左から)" />
        </Section>
      </div>
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
