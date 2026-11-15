// スレのタブ。× か中クリックで閉じ、右クリックでまとめて閉じる・固定・グループのメニューを出す。
// 上に横に並べる(既定)か、スレ表示の左に縦に並べる(設定「タブの置き場」)。
// 幅は Chrome と同じ考え方: すべて同じ幅にし、× で閉じたあとはマウスがタブ列にある間だけ幅を固定する
// (右のタブが 1 つぶん詰まって、次のタブの × がマウスの下に来るので、× を続けて押せる)。
// Ctrl+クリックで選択に足し外し、Shift+クリックで範囲を選ぶ。つかんで動かすと並べ替える(グループの中に落とすとそのグループに入る)。
// 固定したタブは左(縦なら上)に小さく並び、まとめて閉じる操作では閉じない。グループは Edge と同じく、色の付いた見出しの右にタブが続き、
// 見出しを押すと折りたたむ。並びの決まりは utils/tabs.ts

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import BoardIcon from './BoardIcon'
import { INPUT } from './DialogParts'
import { TAB_GROUP_COLORS, TAB_GROUP_COLOR_KEYS, closable, segmentTabs, visibleTabs, type TabGroup, type TabGroupColor } from '../utils/tabs'

export interface TabItem {
  id: string
  title: string
  /** 未読のレス数 */
  unread: number
  /** ログを読み込んだか(まだなら未読の数は分からないので、「未読のないタブを閉じる」で閉じない) */
  loaded: boolean
  loading: boolean
  /** 終わったスレ。archived: dat 落ち / full: 1000 まで行って書き込めない */
  ended?: 'archived' | 'full'
  boardUrl: string
  /** ファビコンの上書き(板の設定) */
  icon?: string
  pinned?: boolean
  groupId?: string
}

/** 終わったスレの印 */
const ENDED = {
  archived: { mark: '落', name: 'dat 落ちしたスレ(もう書き込めません)', color: 'var(--c-heat-very-hot)' },
  full: { mark: '満', name: '1000 まで埋まったスレ(もう書き込めません)', color: 'var(--c-heat-hot)' },
} as const

interface Props {
  /** 状態の並びのまま(固定したタブが先頭、グループのタブは隣り合う) */
  tabs: TabItem[]
  groups: TabGroup[]
  activeId?: string
  onSelect: (id: string) => void
  onClose: (ids: string[]) => void
  onRefreshAll: () => void
  /** タブをダブルクリックしたとき(開いて、そのスレを更新する) */
  onRefresh?: (id: string) => void
  refreshingAll: boolean
  onDeleteLogs: (ids: string[]) => void
  /** Ctrl/Shift+クリックで選んだタブ(開いているタブも入ることがある) */
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  /** つかんで動かしたタブを、index(状態の並びの位置)へ移す */
  onReorder: (id: string, index: number) => void
  /** タブの帯の上でホイールを回すと、タブを切り替える(下へ回すと右のタブ) */
  wheelSwitch?: boolean
  /** スレ表示の左に縦に並べる */
  vertical?: boolean
  onPin: (ids: string[], on: boolean) => void
  /** グループに入れる。groupId がなければ新しいグループを作って、その id を返す */
  onGroup: (ids: string[], groupId?: string) => string
  onUngroup: (ids: string[]) => void
  /** 名前・色・折りたたみを変える */
  onGroupChange: (group: TabGroup) => void
  /** グループを解く(タブは残る) */
  onDissolveGroup: (groupId: string) => void
}

/** タッチパッドのように細かく来るときは、これだけたまったら 1 つ動かす(ホイールの 1 目盛りはおよそ 100) */
const WHEEL_STEP = 50
/** これだけ動かしたらドラッグとみなす(px) */
const DRAG_PX = 4

const MAX_WIDTH = 220
const MIN_WIDTH = 72
/** 固定したタブの幅(横に並べるとき。アイコンだけ) */
const PIN_WIDTH = 40
/** 縦に並べるときの 1 行の高さ(h-8) */
const ROW_HEIGHT = 32
/** 縦に並べるときの帯の幅 */
const SIDE_WIDTH = 240

type Menu = { kind: 'tab'; id: string; x: number; y: number } | { kind: 'group'; groupId: string; x: number; y: number }
interface MenuItem {
  label: string
  /** 押したときの処理。次に出すもの(新しいグループの名前の窓など)を返せる */
  run: () => Menu | void
  disabled?: boolean
  /** この項目の上に区切り線 */
  sep?: boolean
  /** 左に出す色の点(グループ) */
  dot?: string
}

/** 右クリックの位置に出すものが、画面の右・下からはみ出ないように寄せる */
const clampPos = (x: number, y: number, w: number, h: number) => ({ left: Math.max(0, Math.min(x, window.innerWidth - w)), top: Math.max(0, Math.min(y, window.innerHeight - h)) })

const groupHex = (g: TabGroup) => TAB_GROUP_COLORS[g.color]?.hex ?? TAB_GROUP_COLORS.grey.hex
const groupLabel = (g: TabGroup) => g.name || 'グループ'

export default function TabBar(props: Props) {
  const [menu, setMenu] = useState<Menu>()
  const menuRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  /** ホイールの受け手は 1 度だけ付けるので、今のタブ・開いているタブはここから読む */
  const latest = useRef(props)
  latest.current = props
  const [stripWidth, setStripWidth] = useState(0)
  /** 見出しや固定したタブなど、幅が決まっているものの合計(横に並べるとき。残りをふつうのタブで分ける) */
  const [fixedWidth, setFixedWidth] = useState(0)
  /** × で閉じている間の固定幅。マウスがタブ列から出たら undefined に戻して整え直す */
  const [frozenWidth, setFrozenWidth] = useState<number>()
  const hasTabs = props.tabs.length > 0
  /** Shift+クリックの起点(最後に押したタブ) */
  const anchorRef = useRef<string>(undefined)
  const vertical = !!props.vertical

  const segments = segmentTabs(props.tabs, props.groups)
  const visible = visibleTabs(props.tabs, props.groups)
  const normalCount = visible.filter((t) => !t.pinned).length

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setStripWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasTabs, vertical])

  // 幅が決まっているもの(グループの見出し・固定したタブ)を測る。描いたあとに測るので、ふつうのタブの幅が決まるまで 1 コマかかる。
  // タブ・グループが変わったときだけ測り、値が変わったときだけ状態に書く(描くたびに書くと、描き直しが止まらなくなる)
  const fixedRef = useRef(0)
  useLayoutEffect(() => {
    if (vertical) return
    const el = stripRef.current
    if (!el) return
    let w = 0
    el.querySelectorAll<HTMLElement>('[data-fixed]').forEach((x) => (w += x.offsetWidth))
    if (w === fixedRef.current) return
    fixedRef.current = w
    setFixedWidth(w)
  }, [props.tabs, props.groups, vertical])

  const fitWidth =
    stripWidth > 0 && normalCount > 0 ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor((stripWidth - fixedWidth) / normalCount))) : MAX_WIDTH
  const tabWidth = frozenWidth ?? fitWidth

  // ── つかんで動かす ──
  // 見えているタブの位置(rect)を押したときに測り、マウスの位置にいちばん近いタブの場所へ落とす
  // (固定したタブ・グループの見出しが混ざるので、同じ幅で割る計算では合わない)
  const [drag, setDrag] = useState<{ id: string; from: number; over: number; delta: number; size: number }>()
  /** ドラッグの直後の click を無視するための印 */
  const justDragged = useRef(false)
  const onDragMouseDown = (e: React.MouseEvent, id: string) => {
    justDragged.current = false
    if (e.button !== 0) return
    const strip = stripRef.current
    if (!strip) return
    const els = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')]
    const order = els.map((x) => x.dataset.tabId!)
    const from = order.indexOf(id)
    if (from < 0) return
    const tab = props.tabs.find((t) => t.id === id)
    // 縦に並べていても、固定したタブは上の格子に横に並ぶので横に動かす
    const alongY = vertical && !tab?.pinned
    const rects = els.map((x) => x.getBoundingClientRect())
    const centers = rects.map((r) => (alongY ? r.top + r.height / 2 : r.left + r.width / 2))
    const size = alongY ? rects[from].height : rects[from].width
    const start = alongY ? e.clientY : e.clientX
    // 固定したタブは固定の列の中、ほかはその外だけに落とせる
    const zone = order.map((tid, i) => !!props.tabs.find((t) => t.id === tid)?.pinned === !!tab?.pinned && i)
    const allowed = zone.filter((x): x is number => x !== false)
    let moved = false
    let last = { id, from, over: from, delta: 0, size }
    const onMove = (ev: MouseEvent) => {
      const delta = (alongY ? ev.clientY : ev.clientX) - start
      if (!moved && Math.abs(delta) < DRAG_PX) return
      moved = true
      const pos = centers[from] + delta
      let over = from
      let best = Infinity
      for (const i of allowed) {
        const d = Math.abs(centers[i] - pos)
        if (d < best) {
          best = d
          over = i
        }
      }
      last = { id, from, over, delta, size }
      setDrag(last)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrag(undefined)
      if (!moved) return
      justDragged.current = true
      if (last.over === last.from) return
      // 見えている並びの位置を、状態の並びの位置に直す
      const targetId = order[last.over]
      const index = latest.current.tabs.findIndex((t) => t.id === targetId)
      if (index >= 0) latest.current.onReorder(id, index)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  /** ドラッグ中に、ほかのタブをどれだけずらすか(つかんだタブの行き先を空ける)。i は見えている並びの位置 */
  const shiftOf = (i: number): number => {
    if (!drag) return 0
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.size
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return drag.size
    return 0
  }
  const visibleIndex = (id: string) => visible.findIndex((t) => t.id === id)

  /** マウスで閉じるときは、いまの幅のまま固定する */
  const closeByPointer = (id: string) => {
    setFrozenWidth(tabWidth)
    props.onClose([id])
  }

  /** タブを押したとき: Ctrl は選択に足し外し、Shift は範囲、ふつうは選択を解いて開く */
  const onTabClick = (e: React.MouseEvent, id: string) => {
    if (justDragged.current) {
      justDragged.current = false
      return
    }
    const ids = props.tabs.map((t) => t.id)
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(props.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      anchorRef.current = id
      props.onSelectionChange(next)
      return
    }
    if (e.shiftKey) {
      const from = ids.indexOf(anchorRef.current ?? props.activeId ?? id)
      const to = ids.indexOf(id)
      const [a, b] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)]
      props.onSelectionChange(new Set(ids.slice(a, b + 1)))
      return
    }
    anchorRef.current = id
    props.onSelectionChange(new Set())
    props.onSelect(id)
  }

  // ページのスクロールを止めるため、受け身でない(passive: false)受け手を直に付ける
  useEffect(() => {
    const el = barRef.current
    if (!el || !props.wheelSwitch) return
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      const { tabs, groups, activeId, onSelect } = latest.current
      // 横のホイール(Shift+ホイール・タッチパッドの横なぞり)は、今までどおり帯の横スクロールに使う
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      const d = e.deltaMode === 0 ? e.deltaY : e.deltaY * 100
      // 向きが変わったら、ためた分を捨てる
      if (Math.sign(d) !== Math.sign(acc)) acc = 0
      acc += d
      if (Math.abs(acc) < WHEEL_STEP) return
      const step = acc > 0 ? 1 : -1
      acc = 0
      // 折りたたんだグループの中は飛ばす
      const list = visibleTabs(tabs, groups)
      const i = list.findIndex((t) => t.id === activeId)
      // 端まで行ったら反対の端へ回る
      const next = list[i < 0 ? 0 : (i + step + list.length) % list.length]
      if (next && next.id !== activeId) onSelect(next.id)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasTabs, props.wheelSwitch])

  // 全部閉じると帯がなくなって onMouseLeave が来ないので、ここで固定を解く
  useEffect(() => {
    if (props.tabs.length === 0) setFrozenWidth(undefined)
  }, [props.tabs.length])

  // 選んだタブが見えるようにスクロールする
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.activeId])

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(undefined)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  if (props.tabs.length === 0) return null

  const ids = props.tabs.map((t) => t.id)
  const byId = (id: string) => props.tabs.find((t) => t.id === id)
  const closableIds = (list: TabItem[]) => closable(list).map((t) => t.id)
  /** グループに入れる項目(新しいグループと、ほかのグループ) */
  const groupItems = (targets: string[], exceptGroup?: string): MenuItem[] => [
    {
      label: targets.length > 1 ? `選んだ ${targets.length} 個を新しいグループに` : '新しいグループに追加',
      sep: true,
      // 作ったら、そのまま名前と色を決める窓を出す(Chrome と同じ)
      run: () => (menu ? { kind: 'group', groupId: props.onGroup(targets), x: menu.x, y: menu.y } : undefined),
    },
    ...props.groups
      .filter((g) => g.id !== exceptGroup)
      .map((g) => ({ label: `「${groupLabel(g)}」に追加`, dot: groupHex(g), run: () => void props.onGroup(targets, g.id) })),
  ]
  const after = vertical ? '下側' : '右側'
  let menuItems: MenuItem[] = []
  if (menu?.kind === 'tab') {
    const me = byId(menu.id)
    // 右クリックしたタブが選択の中にあれば、選んだタブ(と開いているタブ)にまとめて効かせる
    const group = props.selectedIds.has(menu.id) ? ids.filter((id) => props.selectedIds.has(id) || id === props.activeId) : undefined
    if (group && group.length > 1) {
      const all = group.map(byId).filter((t): t is TabItem => !!t)
      const allPinned = all.every((t) => t.pinned)
      menuItems = [
        { label: `選んだ ${group.length} 個のタブを閉じる (Ctrl+W)`, run: () => props.onClose(group) },
        { label: `選んだ ${group.length} 個のタブのログを削除 (Shift+Delete)`, run: () => props.onDeleteLogs(group) },
        { label: allPinned ? `選んだ ${group.length} 個の固定を解除` : `選んだ ${group.length} 個のタブを固定`, sep: true, run: () => props.onPin(group, !allPinned) },
        ...groupItems(group),
        ...(all.some((t) => t.groupId !== undefined) ? [{ label: 'グループから外す', run: () => props.onUngroup(group) }] : []),
        { label: 'すべて閉じる', sep: true, run: () => props.onClose(closableIds(props.tabs)) },
      ]
    } else if (me) {
      const i = ids.indexOf(menu.id)
      const myGroup = me.groupId !== undefined ? props.groups.find((g) => g.id === me.groupId) : undefined
      const others = props.tabs.filter((t) => t.id !== menu.id)
      const rightSide = props.tabs.slice(i + 1)
      const noUnread = others.filter((t) => t.loaded && t.unread === 0)
      const ended = props.tabs.filter((t) => t.ended)
      menuItems = [
        { label: '閉じる (Ctrl+W)', run: () => props.onClose([menu.id]) },
        { label: '他のタブを閉じる', disabled: closable(others).length === 0, run: () => props.onClose(closableIds(others)) },
        { label: `${after}のタブを閉じる`, disabled: closable(rightSide).length === 0, run: () => props.onClose(closableIds(rightSide)) },
        { label: '未読のないタブを閉じる', disabled: closable(noUnread).length === 0, run: () => props.onClose(closableIds(noUnread)) },
        { label: `終わったスレのタブを閉じる(落ち・満 ${closable(ended).length})`, disabled: closable(ended).length === 0, run: () => props.onClose(closableIds(ended)) },
        { label: 'すべて閉じる', disabled: closable(props.tabs).length === 0, run: () => props.onClose(closableIds(props.tabs)) },
        { label: me.pinned ? 'タブの固定を解除' : 'タブを固定', sep: true, run: () => props.onPin([menu.id], !me.pinned) },
        ...groupItems([menu.id], me.groupId),
        ...(myGroup ? [{ label: `「${groupLabel(myGroup)}」から外す`, run: () => props.onUngroup([menu.id]) }] : []),
        { label: 'ログを削除して閉じる (Shift+Delete)', sep: true, run: () => props.onDeleteLogs([menu.id]) },
      ]
    }
  }
  const menuGroup = menu?.kind === 'group' ? props.groups.find((g) => g.id === menu.groupId) : undefined
  const groupTabs = (g: TabGroup) => props.tabs.filter((t) => t.groupId === g.id)

  /** 固定したタブ(アイコンだけ。横は帯の左、縦は上の格子) */
  const renderPinned = (t: TabItem) => {
    const active = t.id === props.activeId
    const selected = !active && props.selectedIds.has(t.id)
    const vi = visibleIndex(t.id)
    const dragging = drag?.id === t.id
    return (
      <div
        key={t.id}
        data-tab-id={t.id}
        data-fixed=""
        ref={active ? activeRef : undefined}
        onClick={(e) => onTabClick(e, t.id)}
        onDoubleClick={(e) => {
          if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) props.onRefresh?.(t.id)
        }}
        onMouseDown={(e) => onDragMouseDown(e, t.id)}
        onAuxClick={(e) => {
          if (e.button === 1) closeByPointer(t.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ kind: 'tab', id: t.id, x: e.clientX, y: e.clientY })
        }}
        title={`${t.title}(固定)${t.ended ? ` ${ENDED[t.ended].name}` : ''}`}
        style={{
          width: vertical ? ROW_HEIGHT : PIN_WIDTH,
          background: active ? 'var(--tab-active-fill)' : selected ? 'color-mix(in srgb, var(--tab-active-fill) 70%, transparent)' : undefined,
          transform: dragging ? `translateX(${drag.delta}px)` : vertical ? undefined : `translateX(${shiftOf(vi)}px)`,
          transition: dragging ? 'none' : 'transform 150ms ease-out, background-color 150ms',
        }}
        className={`relative flex-shrink-0 h-8 flex items-center justify-center cursor-pointer select-none ${vertical ? 'rounded-md' : 'rounded-t-lg'} ${
          active ? 'z-10' : 'hover:bg-[color-mix(in_srgb,var(--tab-active-fill)_50%,transparent)]'
        } ${dragging ? 'z-30 shadow-lg' : ''}`}
      >
        {active && !vertical && <span className="absolute left-2 right-2 top-0 h-[2px] rounded-b-full bg-c-accent pointer-events-none" />}
        {t.loading ? (
          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
        ) : t.ended ? (
          <span className="w-[14px] h-[14px] rounded-sm flex items-center justify-center text-[10px] font-bold leading-none text-white" style={{ background: ENDED[t.ended].color }}>
            {ENDED[t.ended].mark}
          </span>
        ) : (
          <BoardIcon boardUrl={t.boardUrl} override={t.icon} size={16} />
        )}
        {/* 未読は数の代わりに点で(幅がないので) */}
        {t.unread > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'var(--c-unread)' }} title={`未読 ${t.unread}`} />}
      </div>
    )
  }

  /** グループの見出し。押すと折りたたむ・広げる。右クリックで名前と色 */
  const renderGroupHeader = (g: TabGroup, count: number) => {
    const hex = groupHex(g)
    const open = (e: React.MouseEvent) => {
      e.preventDefault()
      setMenu({ kind: 'group', groupId: g.id, x: e.clientX, y: e.clientY })
    }
    if (vertical)
      return (
        <div
          key={`g:${g.id}`}
          onClick={() => props.onGroupChange({ ...g, collapsed: !g.collapsed })}
          onContextMenu={open}
          className="mx-1.5 h-7 flex items-center gap-1.5 px-1.5 rounded-md cursor-pointer select-none text-xs text-c-text-body hover:bg-c-surface2"
          title={g.collapsed ? `広げる(${count} 個のタブ)` : '折りたたむ'}
        >
          <span className="material-symbols-outlined text-base leading-none text-c-text-muted">{g.collapsed ? 'chevron_right' : 'expand_more'}</span>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: hex }} />
          <span className={`flex-1 min-w-0 truncate font-bold ${g.name ? '' : 'text-c-text-muted'}`}>{groupLabel(g)}</span>
          {g.collapsed && <span className="text-[10px] text-c-text-muted tabular-nums">{count}</span>}
        </div>
      )
    return (
      <div
        key={`g:${g.id}`}
        data-fixed=""
        onClick={() => props.onGroupChange({ ...g, collapsed: !g.collapsed })}
        onContextMenu={open}
        className="relative flex-shrink-0 h-8 flex items-center pl-1.5 pr-1 cursor-pointer select-none"
        title={g.collapsed ? `${groupLabel(g)}: 広げる(${count} 個のタブ)` : `${groupLabel(g)}: 折りたたむ`}
      >
        <span
          className={`h-5 flex items-center rounded-full text-[11px] font-bold leading-none text-white max-w-[9rem] ${g.name || g.collapsed ? 'px-2' : 'w-5 justify-center'}`}
          style={{ background: hex }}
        >
          <span className="truncate">
            {g.name}
            {g.collapsed && ` ${count}`}
          </span>
        </span>
        {/* 見出しの右へ続く線(グループのタブの下の線とつながる) */}
        {!g.collapsed && <span className="absolute left-0 right-0 bottom-0 h-[2px] pointer-events-none" style={{ background: hex }} />}
      </div>
    )
  }

  /** ふつうのタブ */
  const renderTab = (t: TabItem, groupHexColor?: string) => {
    const active = t.id === props.activeId
    // 区切り線は、自分と右隣のどちらも開いていないときだけ出す(Chrome と同じ)
    const next = visible[visibleIndex(t.id) + 1]
    const separator = !vertical && !active && next !== undefined && !next.pinned && next.groupId === t.groupId && next.id !== props.activeId
    const selected = !active && props.selectedIds.has(t.id)
    const dragging = drag?.id === t.id
    const vi = visibleIndex(t.id)
    const shift = dragging ? drag.delta : shiftOf(vi)
    return (
      <div
        key={t.id}
        data-tab-id={t.id}
        ref={active ? activeRef : undefined}
        onClick={(e) => onTabClick(e, t.id)}
        onDoubleClick={(e) => {
          // 1 回目のクリックでタブは開いているので、ここでは更新だけ(選ぶための Ctrl/Shift のときはしない)
          if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) props.onRefresh?.(t.id)
        }}
        onMouseDown={(e) => onDragMouseDown(e, t.id)}
        onAuxClick={(e) => {
          if (e.button === 1) closeByPointer(t.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ kind: 'tab', id: t.id, x: e.clientX, y: e.clientY })
        }}
        title={t.ended ? `${t.title}(${ENDED[t.ended].name})` : t.title}
        style={{
          width: vertical ? undefined : tabWidth,
          background: active
            ? 'var(--tab-active-fill)'
            : selected
              ? 'color-mix(in srgb, var(--tab-active-fill) 70%, transparent)'
              : undefined,
          // つかんだタブはマウスについて動かし、ほかのタブはなめらかにずらして場所を空ける
          transform: `translate${vertical ? 'Y' : 'X'}(${shift}px)`,
          transition: dragging ? 'none' : 'transform 150ms ease-out, background-color 150ms',
          // 縦: グループのタブは左に色の線
          borderLeft: vertical && groupHexColor ? `3px solid ${groupHexColor}` : undefined,
        }}
        className={`group relative flex-shrink-0 h-8 flex items-center gap-1.5 pl-3 pr-1.5 cursor-pointer select-none text-xs ${
          vertical ? `rounded-md ${groupHexColor ? 'ml-3 mr-1.5' : 'mx-1.5'}` : 'rounded-t-lg'
        } ${active || selected ? 'text-c-text-strong' : 'text-c-text-muted hover:text-c-text-body hover:bg-[color-mix(in_srgb,var(--tab-active-fill)_50%,transparent)]'} ${
          active ? 'z-10' : ''
        } ${dragging ? 'z-30 shadow-lg' : ''}`}
      >
        {/* 開いているタブは、上の端に強調色の線を引く(暗い配色では、開いているタブと、ほかのタブの面の色の差が小さいため)。
            終わったスレ(dat 落ち・満)は、ファビコンの場所の「落」「満」の印と薄い字だけで示す(線を引くと、開いているタブの印と見間違える) */}
        {active && !vertical && (
          <>
            <span className="absolute left-2 right-2 top-0 h-[2px] rounded-b-full bg-c-accent pointer-events-none" />
            {/* タブの下の両端の、スレ表示へ流れ込む内側の曲線 */}
            <span
              className="absolute bottom-0 -left-2 w-2 h-2 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 0 0, transparent 8px, var(--tab-active-fill) 8.5px)' }}
            />
            <span
              className="absolute bottom-0 -right-2 w-2 h-2 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 100% 0, transparent 8px, var(--tab-active-fill) 8.5px)' }}
            />
          </>
        )}
        {/* 横: グループのタブは下に色の線(見出しから続く) */}
        {!vertical && groupHexColor && <span className="absolute left-0 right-0 bottom-0 h-[2px] pointer-events-none" style={{ background: groupHexColor }} />}
        {separator && (
          <span
            className="absolute right-0 top-2 bottom-2 w-px pointer-events-none"
            style={{ background: 'color-mix(in srgb, var(--c-text-muted) 45%, transparent)' }}
          />
        )}
        {t.loading ? (
          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
        ) : t.ended ? (
          // ファビコンの場所に「落」「満」の印を出し、ひと目で分かるようにする
          <span
            className="flex-shrink-0 w-[14px] h-[14px] rounded-sm flex items-center justify-center text-[10px] font-bold leading-none text-white"
            style={{ background: ENDED[t.ended].color }}
            title={ENDED[t.ended].name}
          >
            {ENDED[t.ended].mark}
          </span>
        ) : (
          <BoardIcon boardUrl={t.boardUrl} override={t.icon} size={14} />
        )}
        <span className={`flex-1 min-w-0 truncate ${t.ended ? 'opacity-60' : ''}`}>{t.title || '(読み込み中)'}</span>
        {t.unread > 0 && (
          <span
            className="flex-shrink-0 font-bold text-[9px] px-1 rounded"
            style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}
          >
            +{t.unread}
          </span>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeByPointer(t.id)
          }}
          className={`flex-shrink-0 p-0.5 rounded-full hover:bg-c-surface3 ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
          title="閉じる (Ctrl+W)"
        >
          <span className="material-symbols-outlined text-sm leading-none">close</span>
        </button>
      </div>
    )
  }

  const body = segments.map((seg) => {
    if (seg.kind === 'pinned')
      return vertical ? (
        <div key="pinned" className="flex flex-wrap gap-1 px-1.5 pb-1.5 mb-1 border-b border-c-border">
          {seg.tabs.map(renderPinned)}
        </div>
      ) : (
        seg.tabs.map(renderPinned)
      )
    if (seg.kind === 'tab') return renderTab(seg.tab)
    const hex = groupHex(seg.group)
    return [renderGroupHeader(seg.group, seg.tabs.length), ...(seg.group.collapsed ? [] : seg.tabs.map((t) => renderTab(t, hex)))]
  })

  const refreshAll = (
    <button
      type="button"
      onClick={props.onRefreshAll}
      disabled={props.refreshingAll}
      className={`flex-shrink-0 h-8 px-2.5 text-c-text-muted hover:text-c-text-strong ${vertical ? 'w-full flex items-center gap-2 text-xs' : 'mr-1 rounded-t-lg'}`}
      title="すべてのタブを更新"
    >
      <span className={`material-symbols-outlined text-lg ${props.refreshingAll ? 'animate-spin' : ''}`}>sync</span>
      {vertical && 'すべてのタブを更新'}
    </button>
  )

  const popups = (
    <>
      {menu && menuItems.length > 0 && (
        <div
          ref={menuRef}
          className="fixed z-[9600] w-56 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 text-sm"
          style={clampPos(menu.x, menu.y, 224, menuItems.length * 32 + 24)}
        >
          {menuItems.map((m, i) => (
            <button
              key={i}
              type="button"
              disabled={m.disabled}
              onClick={() => setMenu(m.run() ?? undefined)}
              className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-c-text-body hover:bg-c-surface2 disabled:opacity-40 ${m.sep ? 'mt-1 pt-1.5 border-t border-c-border' : ''}`}
            >
              {m.dot && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.dot }} />}
              <span className="flex-1 min-w-0 truncate">{m.label}</span>
            </button>
          ))}
        </div>
      )}
      {menu?.kind === 'group' && menuGroup && (
        <GroupEditor
          ref={menuRef}
          group={menuGroup}
          count={groupTabs(menuGroup).length}
          x={menu.x}
          y={menu.y}
          onChange={props.onGroupChange}
          onDissolve={() => {
            props.onDissolveGroup(menuGroup.id)
            setMenu(undefined)
          }}
          onCloseTabs={() => {
            props.onClose(groupTabs(menuGroup).map((t) => t.id))
            setMenu(undefined)
          }}
          onDone={() => setMenu(undefined)}
        />
      )}
    </>
  )

  if (vertical)
    return (
      <div ref={barRef} className="flex-shrink-0 flex flex-col bg-panel-tabbar border-r border-c-border" style={{ width: SIDE_WIDTH }}>
        <div ref={stripRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1.5 flex flex-col gap-0.5" onMouseLeave={() => setFrozenWidth(undefined)}>
          {body}
        </div>
        <div className="flex-shrink-0 border-t border-c-border">{refreshAll}</div>
        {popups}
      </div>
    )

  return (
    <div ref={barRef} className="flex-shrink-0 flex items-end pt-1.5 bg-panel-tabbar">
      <div
        ref={stripRef}
        className="flex-1 min-w-0 flex items-end overflow-x-auto no-scrollbar px-2"
        onMouseLeave={() => setFrozenWidth(undefined)}
      >
        {body}
      </div>
      {refreshAll}
      {popups}
    </div>
  )
}

/** グループの名前と色を変える小さな窓(Chrome の見出しを押したときのもの)。名前は打つたびに反映する */
const GroupEditor = forwardRef<
  HTMLDivElement,
  {
    group: TabGroup
    count: number
    x: number
    y: number
    onChange: (g: TabGroup) => void
    onDissolve: () => void
    onCloseTabs: () => void
    onDone: () => void
  }
>(function GroupEditor(props, ref) {
  const g = props.group
  return (
    <div
      ref={ref}
      className="fixed z-[9600] w-64 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl p-3 text-sm flex flex-col gap-2"
      style={clampPos(props.x, props.y, 256, 220)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') props.onDone()
      }}
    >
      <input
        autoFocus
        value={g.name}
        onChange={(e) => props.onChange({ ...g, name: e.target.value })}
        placeholder="グループの名前"
        className={`${INPUT} w-full px-2 py-1`}
      />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="グループの色">
        {TAB_GROUP_COLOR_KEYS.map((c: TabGroupColor) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={g.color === c}
            title={TAB_GROUP_COLORS[c].name}
            onClick={() => props.onChange({ ...g, color: c })}
            className={`w-6 h-6 rounded-full flex items-center justify-center ${g.color === c ? 'ring-2 ring-offset-1 ring-c-text-strong' : ''}`}
            style={{ background: TAB_GROUP_COLORS[c].hex }}
          >
            {g.color === c && <span className="material-symbols-outlined text-sm leading-none text-white">check</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-col border-t border-c-border pt-1 -mx-1">
        <button type="button" onClick={() => props.onChange({ ...g, collapsed: !g.collapsed })} className="text-left px-2 py-1 rounded text-c-text-body hover:bg-c-surface2">
          {g.collapsed ? 'グループを広げる' : 'グループを折りたたむ'}
        </button>
        <button type="button" onClick={props.onDissolve} className="text-left px-2 py-1 rounded text-c-text-body hover:bg-c-surface2">
          グループを解除(タブは残す)
        </button>
        <button type="button" onClick={props.onCloseTabs} className="text-left px-2 py-1 rounded text-c-text-body hover:bg-c-surface2">
          グループのタブを閉じる({props.count})
        </button>
      </div>
    </div>
  )
})
