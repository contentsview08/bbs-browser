import { useContext, useState } from 'react'
import { isMobile } from '../../utils/platform'
import { ChipDock, type DockItem } from './ChipDock'
import { barActionsFor, orderBy, resolvePlacements, type BarArea, type Placement, PLACEMENTS } from '../../utils/toolbar'
import { type SettingsProps, Section, OrderEditor, SearchContext } from './common'
import { postToolbarAll } from './WriteTab'
import { THREAD_TOOLBAR_ITEMS } from './ThreadsTab'
import { LIST_TABS, type ListTabKey } from '../../ui/settings'

type Screen = 'thread' | 'list' | 'post' | 'card'

/**
 * ボタンの配置(スマホ版の「ボタンの配置」と同じ作り)。はじめに画面の見本の札を並べ、押すとその画面のページ。
 * ページでは、実際の画面・札の形の見本の帯に、ボタンをつかんで入れる(ChipDock)。設定を探しているときは全部の段を出す
 */
export function ToolbarsTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const [screen, setScreen] = useState<Screen>()
  const searching = useContext(SearchContext).trim() !== ''
  // スマホ(Web のスマホ表示)では、スマホの配置(PC とは別に持つ)を変える
  const key = isMobile ? 'mobileBarLayout' : 'barLayout'
  const layout = s[key]
  const orderKey = isMobile ? 'mobileBarOrder' : 'barOrder'
  const order = s[orderKey]
  const set = (area: BarArea, id: string, placement: Placement) => {
    const cur = layout[area] ?? {}
    update(key, { ...layout, [area]: { ...cur, [id]: placement } })
  }
  const areaModel = (areaKey: BarArea) => {
    const placements = resolvePlacements(areaKey, layout, isMobile)
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
    const item = (id: string): DockItem => ({ id, name: nameOf(id).name, icon: nameOf(id).icon })
    return { zoneItems, move, item }
  }

  /** スレッド表示画面・スレッド一覧画面: 上の帯・(一覧はタブ)・中身・下の帯の見本 */
  const screenEditor = (areaKey: BarArea) => {
    const { zoneItems, move, item } = areaModel(areaKey)
    const between = areaKey === 'thread' ? 'スレタイ' : '板名'
    const docks = (['headerStart', 'header', 'footerStart', 'footer'] as const).map((p) => ({
      key: p as string,
      label: PLACEMENTS.find((x) => x.key === p)!.name,
      items: zoneItems(p).map(item),
    }))
    // スレッド一覧画面は、タブの帯(PC はヘッダーの下、スマホはフッターの左)も同じ見本の中で
    const tabs = s.listTabs.filter((k) => LIST_TABS.some((t) => t.key === k))
    const tabItem = (k: ListTabKey): DockItem => {
      const t = LIST_TABS.find((x) => x.key === k)!
      return { id: `tab:${k}`, name: t.name, icon: t.icon, showName: true }
    }
    if (areaKey === 'list') docks.push({ key: 'tabs', label: 'タブ', items: tabs.map(tabItem) })
    const isTab = (id: string) => id.startsWith('tab:')
    const setTabs = (next: ListTabKey[]) => update('listTabs', next)
    return (
      <ChipDock
        docks={docks}
        palette={[...zoneItems('menu').map(item), ...(areaKey === 'list' ? LIST_TABS.filter((t) => !tabs.includes(t.key)).map((t) => tabItem(t.key)) : [])]}
        paletteTitle={areaKey === 'list' ? '︙ の中だけのボタン・出していないタブ' : '︙ の中だけのボタン'}
        bars={[
          { key: 'headerBar', label: 'ヘッダー', left: 'headerStart', right: 'header', middle: between },
          { key: 'footerBar', label: 'フッター', left: 'footerStart', right: 'footer', middle: '空き' },
        ]}
        iconOnly
        mock={{ kind: 'screen', content: areaKey === 'list' ? 'ここにスレが並びます' : 'ここにレスが並びます' }}
        allowIn={(it, dock) => (dock === 'tabs') === isTab(it.id)}
        onPlace={(dock, id, index) => {
          if (dock === 'tabs') {
            const next = [...tabs]
            next.splice(Math.min(index, next.length), 0, id.slice(4) as ListTabKey)
            return setTabs(next)
          }
          move(id, dock as Placement, index)
        }}
        onMove={(dock, from, to) => {
          if (dock === 'tabs') {
            const next = [...tabs]
            const [m] = next.splice(from, 1)
            next.splice(to, 0, m)
            return setTabs(next)
          }
          move(zoneItems(dock as Placement)[from], dock as Placement, to)
        }}
        onRemove={(dock, index) => {
          if (dock === 'tabs') return setTabs(tabs.filter((_, i) => i !== index))
          move(zoneItems(dock as Placement)[index], 'menu', zoneItems('menu').length)
        }}
      />
    )
  }

  const pages: { id: Screen; name: string; note: string; desktop?: boolean }[] = [
    { id: 'thread', name: 'スレッド表示画面', note: 'ボタンをつかんで帯に入れると、その位置に出ます。真ん中(スレタイ・空き)より左に落とせば左に、右なら右に付きます。帯にないボタンは ︙ の中だけに出ます(︙ にはいつも全部出ます)。押すとメニューでも動かせます' },
    { id: 'list', name: 'スレッド一覧画面', note: `ボタンとタブをつかんで帯に入れると、その位置に出ます。タブ(並べ方・絞り込み)はタブの帯にだけ入ります${isMobile ? '' : '(数字キーの 1・2・3… は左から順に当たります)'}。帯にないボタンは ︙ の中だけに出ます` },
    { id: 'post', name: 'レスの操作バー', note: 'レスにマウスを乗せたとき、右上に出すボタンです。⋯ のメニューにある操作はどれも並べられます。⋯ も外せ、全部外すとバーは出ません', desktop: true },
    { id: 'card', name: 'スレッドの操作バー', note: 'スレにマウスを乗せたとき、右上に出すボタンです。右クリックのメニューにある操作はどれも並べられます。⋯ も外せ、全部外すとバーは出ません', desktop: true },
  ]
  const shown = pages.filter((p) => !(p.desktop && isMobile))
  const editorOf = (id: Screen) =>
    id === 'thread' ? screenEditor('thread')
    : id === 'list' ? screenEditor('list')
    : id === 'post' ? (
      <OrderEditor all={postToolbarAll(s.quickPhrases)} value={s.postToolbar2} onChange={(v) => update('postToolbar2', v)} restTitle="出していないボタン" dockLabel="レスの右上" iconOnly mock={{ kind: 'card', content: 'レスの本文' }} />
    ) : (
      <OrderEditor all={THREAD_TOOLBAR_ITEMS} value={s.threadToolbar} onChange={(v) => update('threadToolbar', v)} restTitle="出していないボタン" dockLabel="スレの右上" iconOnly mock={{ kind: 'card', content: 'スレタイ・レス数・勢い' }} />
    )
  const page = (p: (typeof pages)[number]) => (
    <Section key={p.id} title={p.name} note={p.note} desktopOnly={p.desktop}>
      {editorOf(p.id)}
    </Section>
  )

  // 探しているときは全部の段(見出し・説明で当たるように)
  if (searching) return <div>{shown.map(page)}</div>
  if (screen) {
    const p = pages.find((x) => x.id === screen)!
    return (
      <div>
        <button type="button" onClick={() => setScreen(undefined)} className="flex items-center gap-1 mb-4 text-sm text-c-text-muted hover:text-c-accent">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          ボタンの配置
        </button>
        {page(p)}
      </div>
    )
  }
  return (
    <div>
      <p className="text-xs text-c-text-muted mb-4">画面のヘッダー・フッターや操作バーに出すボタンと、その並びを決めます。変えたい画面を選んでください</p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {shown.map((p) => (
          <button key={p.id} type="button" onClick={() => setScreen(p.id)} className="flex flex-col items-center gap-2 p-3 rounded-xl border border-c-border bg-c-surface hover:border-c-accent text-left">
            <ScreenThumb kind={p.id} />
            <span className="text-sm text-c-text-strong">{p.name}</span>
          </button>
        ))}
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

/** 画面を選ぶ札の小さな見本(帯・行・操作バーの形) */
function ScreenThumb({ kind }: { kind: Screen }) {
  const bar = <span className="block h-3 bg-c-bar border-b border-c-border" />
  const lines = (
    <span className="flex flex-col gap-1 p-1.5">
      {[0.9, 0.6, 0.75].map((w) => (
        <span key={w} className="block h-1 rounded-full bg-c-surface2" style={{ width: `${w * 100}%` }} />
      ))}
    </span>
  )
  return (
    <span className="w-full h-20 rounded-lg border border-c-border-strong bg-c-base overflow-hidden flex flex-col">
      {kind === 'thread' || kind === 'list' ? (
        <>
          {bar}
          {kind === 'list' && <span className="block h-2.5 bg-c-bar border-b border-c-border" />}
          <span className="flex-1">{lines}</span>
          <span className="block h-3 bg-c-bar border-t border-c-border" />
        </>
      ) : (
        <span className="relative flex-1 m-2 rounded border border-c-border bg-c-surface">
          <span className="absolute top-1 right-1 w-8 h-2.5 rounded bg-c-bar border border-c-accent" />
          <span className="block pt-4">{lines}</span>
        </span>
      )}
    </span>
  )
}
