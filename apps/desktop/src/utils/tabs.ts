// タブの並びの決まり(固定・グループ)。Chrome・Edge に寄せつつ、固定したタブもふつうのタブと同じ見た目にする:
// - 固定したタブは左(縦なら上)にまとめて置く(ピンの印を付ける)。まとめて閉じる操作(他のタブ・右側・すべて・未読なし・終わったスレ)では閉じない
// - グループのタブは隣り合わせに置く。つかんで動かしてグループの中に落とすとそのグループに入り、外に出すと抜ける
// - 固定はグループごとにもできる(そのグループの全部のタブが固定になり、グループのまま左の列に入る)。
//   タブ 1 つだけを固定するときはグループから抜ける(グループの一部だけが左の列に行くと、隣り合わせでなくなるため)。
//   固定したグループに入れたタブは固定になる
// ここは配列を並べ替えるだけの純粋な関数。画面(TabBar)と状態(App)はこれを呼ぶ

export interface TabGroup {
  id: string
  name: string
  /** TAB_GROUP_COLORS の鍵 */
  color: TabGroupColor
  /** 折りたたんでいる(帯には名前だけを出し、中のタブは隠す) */
  collapsed?: boolean
}

/** グループの色(Chrome・Edge と同じ 9 色) */
export const TAB_GROUP_COLORS = {
  grey: { name: 'グレー', hex: '#5f6368' },
  blue: { name: '青', hex: '#1a73e8' },
  red: { name: '赤', hex: '#d93025' },
  yellow: { name: '黄', hex: '#f9ab00' },
  green: { name: '緑', hex: '#188038' },
  pink: { name: 'ピンク', hex: '#d01884' },
  purple: { name: '紫', hex: '#a142f4' },
  cyan: { name: '水色', hex: '#007b83' },
  orange: { name: 'オレンジ', hex: '#fa903e' },
} as const
export type TabGroupColor = keyof typeof TAB_GROUP_COLORS
export const TAB_GROUP_COLOR_KEYS = Object.keys(TAB_GROUP_COLORS) as TabGroupColor[]

/** 並べ替えに要るぶんだけのタブ */
export interface Arrangeable {
  id: string
  pinned?: boolean
  groupId?: string
}

/** 固定したタブの数(左端に並ぶ) */
export const pinnedCount = <T extends Arrangeable>(tabs: T[]): number => tabs.filter((t) => t.pinned).length

/** 新しいタブを、いま開いているタブ(afterId)の右に入れる。開いているタブがグループなら同じグループに入り、固定なら固定の列の右に出す */
export function insertTab<T extends Arrangeable>(tabs: T[], tab: T, afterId: string | undefined): T[] {
  const i = tabs.findIndex((t) => t.id === afterId)
  if (i < 0) return [...tabs, tab]
  const after = tabs[i]
  if (after.pinned) {
    const at = pinnedCount(tabs)
    return [...tabs.slice(0, at), { ...tab, pinned: false, groupId: undefined }, ...tabs.slice(at)]
  }
  return [...tabs.slice(0, i + 1), { ...tab, groupId: after.groupId }, ...tabs.slice(i + 1)]
}

/**
 * つかんで動かしたタブを index の位置へ。固定の列と、そうでない列はまたげない(列の端に止まる)。
 * 動かした先の両隣が同じグループならそのグループに入る。元のグループの隣でなくなったら抜ける
 */
export function moveTab<T extends Arrangeable>(tabs: T[], id: string, index: number): T[] {
  const from = tabs.findIndex((t) => t.id === id)
  if (from < 0) return tabs
  const tab = tabs[from]
  const pinned = pinnedCount(tabs)
  const to = tab.pinned ? Math.min(index, pinned - 1) : Math.max(index, pinned)
  const bounded = Math.max(0, Math.min(tabs.length - 1, to))
  if (bounded === from) return tabs
  const rest = tabs.filter((t) => t.id !== id)
  const prev = rest[bounded - 1]
  const next = rest[bounded]
  const groupId =
    prev?.groupId !== undefined && prev.groupId === next?.groupId
      ? prev.groupId
      : tab.groupId !== undefined && (prev?.groupId === tab.groupId || next?.groupId === tab.groupId)
        ? tab.groupId
        : undefined
  const moved = groupId === tab.groupId ? tab : { ...tab, groupId }
  return [...rest.slice(0, bounded), moved, ...rest.slice(bounded)]
}

/**
 * 固定する(固定の列の右端へ)・固定を解く(固定でない列の左端へ)。
 * keepGroup: グループごとの固定(ids にそのグループの全部が入っている)。そうでなければグループから抜ける
 */
export function setPinned<T extends Arrangeable>(tabs: T[], ids: string[], on: boolean, keepGroup = false): T[] {
  const targets = tabs.filter((t) => ids.includes(t.id) && !!t.pinned !== on)
  if (targets.length === 0) return tabs
  const rest = tabs.filter((t) => !targets.includes(t))
  const at = pinnedCount(rest)
  const changed = targets.map((t) => ({ ...t, pinned: on, groupId: keepGroup ? t.groupId : undefined }))
  return [...rest.slice(0, at), ...changed, ...rest.slice(at)]
}

/** グループの全部のタブを固定する・固定を解く(グループのまま列を移る) */
export function setGroupPinned<T extends Arrangeable>(tabs: T[], groupId: string, on: boolean): T[] {
  return setPinned(tabs, tabs.filter((t) => t.groupId === groupId).map((t) => t.id), on, true)
}

/** そのグループが固定か(グループのタブが全部固定なら固定。タブがなければ false) */
export const isGroupPinned = <T extends Arrangeable>(tabs: T[], groupId: string): boolean => {
  const members = tabs.filter((t) => t.groupId === groupId)
  return members.length > 0 && members.every((t) => t.pinned)
}

/**
 * タブをグループに入れる。グループにもうタブがあればその右端へ、まだなければ最初のタブの位置に作る。
 * 入れた先のグループが固定ならタブも固定に、そうでなければ固定を解く(グループの中で固定がそろうように)
 */
export function assignGroup<T extends Arrangeable>(tabs: T[], ids: string[], groupId: string): T[] {
  const targets = tabs.filter((t) => ids.includes(t.id))
  if (targets.length === 0) return tabs
  const rest = tabs.filter((t) => !targets.includes(t))
  const pinned = rest.some((t) => t.groupId === groupId) && isGroupPinned(rest, groupId)
  const changed = targets.map((t) => (t.groupId === groupId && !!t.pinned === pinned ? t : { ...t, pinned, groupId }))
  const last = rest.map((t) => t.groupId).lastIndexOf(groupId)
  const at = last >= 0 ? last + 1 : Math.max(pinnedCount(rest), Math.min(rest.length, tabs.indexOf(targets[0])))
  return [...rest.slice(0, at), ...changed, ...rest.slice(at)]
}

/** タブをグループから出す(グループの右隣へ。グループの中に残るタブの並びは崩さない) */
export function removeFromGroup<T extends Arrangeable>(tabs: T[], ids: string[]): T[] {
  const targets = tabs.filter((t) => ids.includes(t.id) && t.groupId !== undefined)
  if (targets.length === 0) return tabs
  let out = tabs
  // グループごとに、そのグループの右端の後ろへ出す
  for (const groupId of new Set(targets.map((t) => t.groupId))) {
    const moving = out.filter((t) => targets.includes(t) && t.groupId === groupId)
    const rest = out.filter((t) => !moving.includes(t))
    const last = rest.map((t) => t.groupId).lastIndexOf(groupId)
    // グループのタブを全部出すときは、元の位置に置く
    const at = last >= 0 ? last + 1 : out.indexOf(moving[0])
    out = [...rest.slice(0, at), ...moving.map((t) => ({ ...t, groupId: undefined })), ...rest.slice(at)]
  }
  return out
}

/** グループを解く(名前の付いたまとまりをやめる。タブはそのまま残る) */
export function dissolveGroup<T extends Arrangeable>(tabs: T[], groupId: string): T[] {
  return tabs.some((t) => t.groupId === groupId) ? tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)) : tabs
}

/** タブがなくなったグループを捨てる(最後のタブを閉じたらグループも消える。Chrome と同じ) */
export function pruneGroups<T extends Arrangeable>(groups: TabGroup[], tabs: T[]): TabGroup[] {
  const used = new Set(tabs.map((t) => t.groupId))
  return groups.every((g) => used.has(g.id)) ? groups : groups.filter((g) => used.has(g.id))
}

/** 帯に並べるもの。グループ(見出しの後ろにそのタブ)か、ひとつのタブ。固定したタブも同じ並びの中(先頭に寄っている) */
export type TabSegment<T> = { kind: 'group'; group: TabGroup; tabs: T[] } | { kind: 'tab'; tab: T }

export function segmentTabs<T extends Arrangeable>(tabs: T[], groups: TabGroup[]): TabSegment<T>[] {
  const out: TabSegment<T>[] = []
  for (const t of tabs) {
    const group = t.groupId !== undefined ? groups.find((g) => g.id === t.groupId) : undefined
    if (!group) {
      out.push({ kind: 'tab', tab: t })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'group' && last.group.id === group.id) last.tabs.push(t)
    else out.push({ kind: 'group', group, tabs: [t] })
  }
  return out
}

/** 帯に見えているタブ(折りたたんだグループの中は除く)。ホイールの切り替え・つかんで動かす先はこの中で決める */
export function visibleTabs<T extends Arrangeable>(tabs: T[], groups: TabGroup[]): T[] {
  const hidden = new Set(groups.filter((g) => g.collapsed).map((g) => g.id))
  return hidden.size === 0 ? tabs : tabs.filter((t) => t.groupId === undefined || !hidden.has(t.groupId))
}

/** まとめて閉じるときに閉じてよいタブ(固定したタブは残す) */
export const closable = <T extends Arrangeable>(tabs: T[]): T[] => tabs.filter((t) => !t.pinned)

/** 新しいグループの id */
export const newGroupId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/** 新しいグループの色: まだ使っていない色があればそれ、全部使っていれば順番に */
export function nextGroupColor(groups: TabGroup[]): TabGroupColor {
  const used = new Set(groups.map((g) => g.color))
  return TAB_GROUP_COLOR_KEYS.find((c) => !used.has(c)) ?? TAB_GROUP_COLOR_KEYS[groups.length % TAB_GROUP_COLOR_KEYS.length]
}
