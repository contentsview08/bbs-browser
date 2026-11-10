import { useEffect, useRef } from 'react'
import { isMobile } from '../../utils/platform'
import { DragHandle, DragZones } from '../DragSort'
import { barActionsFor, orderBy, resolvePlacements, type BarArea, type Placement, PLACEMENTS } from '../../utils/toolbar'
import { type SettingsProps, Section } from './common'

/** スレ表示とスレ一覧の操作ボタンを、ヘッダー・フッター・︙ の中だけ、のどこに置くか */
export function ToolbarsTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  // スマホでは、スマホの配置(PC とは別に持つ)を変える
  const key = isMobile ? 'mobileBarLayout' : 'barLayout'
  const layout = s[key]
  const orderKey = isMobile ? 'mobileBarOrder' : 'barOrder'
  const order = s[orderKey]
  const rootRef = useRef<HTMLDivElement>(null)
  // 上へ・下へで動かした行は、箱が変わると作り直されて押した所が消えるので、動かしたあとに同じボタンへ戻す
  const refocus = useRef<string>(undefined)
  useEffect(() => {
    const f = refocus.current
    if (!f) return
    refocus.current = undefined
    // 押した向きが端で押せなくなっていれば、反対の向きへ
    const row = f.slice(0, f.lastIndexOf(':'))
    const btns = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>(`[data-bar-move^="${row}:"]`) ?? [])]
    ;(btns.find((b) => b.dataset.barMove === f && !b.disabled) ?? btns.find((b) => !b.disabled))?.focus()
  })
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
    /** 1 つ上・下へ。箱の端を越えると、となりの箱の端に入る(ドラッグできなくても、どこへでも動かせるように) */
    const step = (id: string, dir: -1 | 1) => {
      const p = placements[id]
      const zi = PLACEMENTS.findIndex((x) => x.key === p)
      const items = zoneItems(p)
      const i = items.indexOf(id)
      refocus.current = `${areaKey}:${id}:${dir}`
      if (dir < 0) {
        if (i > 0) move(id, p, i - 1)
        else if (zi > 0) move(id, PLACEMENTS[zi - 1].key, zoneItems(PLACEMENTS[zi - 1].key).length)
      } else if (i < items.length - 1) move(id, p, i + 1)
      else if (zi < PLACEMENTS.length - 1) move(id, PLACEMENTS[zi + 1].key, 0)
    }
    const between = areaKey === 'thread' ? 'スレタイ' : '板名'
    return (
      <Section
        title={title}
        note="上から順に、帯の左から右へ並びます(上が左)。右端のつまみをつかんで動かすか、↑↓ で 1 つずつ動かします。どのボタンも ︙ の中には出ます"
      >
        <DragZones
          zones={PLACEMENTS.map((p) => ({ key: p.key, title: p.name, items: zoneItems(p.key) }))}
          bars={[
            { title: 'ヘッダー', zones: ['headerStart', 'header'], between },
            { title: 'フッター', zones: ['footerStart', 'footer'], between: '' },
          ]}
          onMove={move}
          render={(id, handle, dragging) => {
            const p = placements[id]
            const zi = PLACEMENTS.findIndex((x) => x.key === p)
            const items = zoneItems(p)
            const i = items.indexOf(id)
            const first = zi === 0 && i === 0
            const last = zi === PLACEMENTS.length - 1 && i === items.length - 1
            const arrow = (dir: -1 | 1, icon: string, label: string, disabled: boolean) => (
              <button
                type="button"
                data-bar-move={`${areaKey}:${id}:${dir}`}
                disabled={disabled}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => step(id, dir)}
                aria-label={`${nameOf(id).name}を${label}`}
                title={label}
                className={`${isMobile ? 'w-9 h-9' : 'w-7 h-7'} flex-shrink-0 flex items-center justify-center rounded text-c-text-muted hover:bg-c-surface2 hover:text-c-text-body disabled:opacity-30 disabled:pointer-events-none`}
              >
                <span className="material-symbols-outlined text-lg">{icon}</span>
              </button>
            )
            return (
              <div className={`flex items-center gap-2 pl-2.5 ${isMobile ? 'pr-2 py-1.5' : 'pr-1 py-0.5'} rounded-lg border border-c-border ${dragging ? 'bg-c-surface2' : 'bg-c-surface'}`}>
                <span className="material-symbols-outlined text-xl text-c-text-muted flex-shrink-0">{nameOf(id).icon}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-c-text-body">{nameOf(id).name}</span>
                {/* 置き場所を直接選ぶ(遠くの箱へも 1 回で。︙ の中だけ = 帯に出さない) */}
                {!isMobile && (
                  <select
                    value={p}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const to = e.target.value as Placement
                      move(id, to, zoneItems(to).length)
                    }}
                    aria-label={`${nameOf(id).name}の置き場所`}
                    className="flex-shrink-0 text-xs bg-transparent text-c-text-muted border border-c-border rounded px-1 py-0.5"
                  >
                    {PLACEMENTS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                )}
                {arrow(-1, 'arrow_upward', '上へ', first)}
                {arrow(1, 'arrow_downward', '下へ', last)}
                {isMobile ? (
                  <DragHandle handle={handle} />
                ) : (
                  <span {...handle} data-drag-handle className="w-7 h-7 flex items-center justify-center text-c-text-muted cursor-grab" style={{ touchAction: 'none' }} title="つまんで動かす">
                    <span className="material-symbols-outlined text-lg">drag_indicator</span>
                  </span>
                )}
              </div>
            )
          }}
        />
      </Section>
    )
  }
  return (
    <div ref={rootRef}>
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
