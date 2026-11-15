import { describe, expect, it } from 'vitest'
import { assignGroup, closable, dissolveGroup, insertTab, isGroupPinned, moveTab, nextGroupColor, pruneGroups, removeFromGroup, segmentTabs, setGroupPinned, setPinned, visibleTabs, type TabGroup } from '../src/utils/tabs'

type T = { id: string; pinned?: boolean; groupId?: string }
const t = (id: string, extra: Partial<T> = {}): T => ({ id, ...extra })
const ids = (tabs: T[]) => tabs.map((x) => x.id).join('')
const groups: TabGroup[] = [
  { id: 'g', name: '実況', color: 'blue' },
  { id: 'h', name: '', color: 'red', collapsed: true },
]

describe('新しいタブを入れる', () => {
  it('開いているタブの右に入り、そのグループに入る', () => {
    const tabs = [t('A', { groupId: 'g' }), t('B', { groupId: 'g' }), t('C')]
    const out = insertTab(tabs, t('N'), 'A')
    expect(ids(out)).toBe('ANBC')
    expect(out[1].groupId).toBe('g')
  })
  it('開いているタブが固定なら、固定の列のすぐ右に(固定しない)', () => {
    const tabs = [t('P', { pinned: true }), t('Q', { pinned: true }), t('A')]
    const out = insertTab(tabs, t('N'), 'P')
    expect(ids(out)).toBe('PQNA')
    expect(out[2].pinned).toBe(false)
  })
  it('開いているタブがなければ末尾', () => {
    expect(ids(insertTab([t('A')], t('N'), undefined))).toBe('AN')
  })
})

describe('つかんで動かす', () => {
  it('固定の列はまたげない', () => {
    const tabs = [t('P', { pinned: true }), t('A'), t('B')]
    expect(ids(moveTab(tabs, 'A', 0))).toBe('PAB')
    expect(ids(moveTab(tabs, 'P', 2))).toBe('PAB')
    expect(ids(moveTab(tabs, 'B', 1))).toBe('PBA')
  })
  it('グループの中に落とすと、そのグループに入る', () => {
    const tabs = [t('A', { groupId: 'g' }), t('B', { groupId: 'g' }), t('C')]
    const out = moveTab(tabs, 'C', 1)
    expect(ids(out)).toBe('ACB')
    expect(out[1].groupId).toBe('g')
  })
  it('グループの外へ出すと抜ける', () => {
    const tabs = [t('A', { groupId: 'g' }), t('B', { groupId: 'g' }), t('C'), t('D')]
    const out = moveTab(tabs, 'A', 3)
    expect(ids(out)).toBe('BCDA')
    expect(out[3].groupId).toBeUndefined()
  })
  it('グループの端へ動かしても、まだ隣ならグループに残る', () => {
    const tabs = [t('A', { groupId: 'g' }), t('B', { groupId: 'g' }), t('C')]
    const out = moveTab(tabs, 'A', 1)
    expect(ids(out)).toBe('BAC')
    expect(out[1].groupId).toBe('g')
  })
})

describe('固定', () => {
  it('固定すると左端の列の右端に入り、グループから抜ける', () => {
    const tabs = [t('P', { pinned: true }), t('A', { groupId: 'g' }), t('B', { groupId: 'g' })]
    const out = setPinned(tabs, ['B'], true)
    expect(ids(out)).toBe('PBA')
    expect(out[1]).toEqual({ id: 'B', pinned: true, groupId: undefined })
  })
  it('固定を解くと、固定でない列の左端へ', () => {
    const tabs = [t('P', { pinned: true }), t('Q', { pinned: true }), t('A')]
    expect(ids(setPinned(tabs, ['P'], false))).toBe('QPA')
  })
  it('まとめて閉じるときは固定したタブを残す', () => {
    expect(ids(closable([t('P', { pinned: true }), t('A')]))).toBe('A')
  })
  it('グループごとに固定すると、グループのまま左の列へ', () => {
    const tabs = [t('P', { pinned: true }), t('X'), t('A', { groupId: 'g' }), t('B', { groupId: 'g' })]
    const out = setGroupPinned(tabs, 'g', true)
    expect(ids(out)).toBe('PABX')
    expect(out.slice(1, 3).map((x) => [x.pinned, x.groupId])).toEqual([[true, 'g'], [true, 'g']])
    expect(isGroupPinned(out, 'g')).toBe(true)
    const back = setGroupPinned(out, 'g', false)
    expect(ids(back)).toBe('PABX')
    expect(isGroupPinned(back, 'g')).toBe(false)
  })
  it('固定したグループに入れたタブは固定になる', () => {
    const tabs = [t('A', { pinned: true, groupId: 'g' }), t('X')]
    const out = assignGroup(tabs, ['X'], 'g')
    expect(ids(out)).toBe('AX')
    expect(out[1]).toEqual({ id: 'X', pinned: true, groupId: 'g' })
  })
})

describe('グループ', () => {
  it('もうあるグループの右端に入る', () => {
    const tabs = [t('A', { groupId: 'g' }), t('B'), t('C')]
    const out = assignGroup(tabs, ['C'], 'g')
    expect(ids(out)).toBe('ACB')
    expect(out[1].groupId).toBe('g')
  })
  it('新しいグループは最初のタブの位置に作る(選んだタブをまとめる)', () => {
    const tabs = [t('A'), t('B'), t('C'), t('D')]
    const out = assignGroup(tabs, ['B', 'D'], 'n')
    expect(ids(out)).toBe('ABDC')
    expect(out.map((x) => x.groupId)).toEqual([undefined, 'n', 'n', undefined])
  })
  it('固定していないグループに固定したタブを入れると固定が解ける', () => {
    const tabs = [t('P', { pinned: true }), t('A', { groupId: 'g' })]
    const out = assignGroup(tabs, ['P'], 'g')
    expect(ids(out)).toBe('AP')
    expect(out[1].pinned).toBe(false)
  })
  it('グループから出すと、グループの右隣へ', () => {
    const tabs = [t('A', { groupId: 'g' }), t('B', { groupId: 'g' }), t('C', { groupId: 'g' }), t('D')]
    const out = removeFromGroup(tabs, ['A'])
    expect(ids(out)).toBe('BCAD')
    expect(out[2].groupId).toBeUndefined()
  })
  it('グループを解くとタブはそのまま残る', () => {
    const out = dissolveGroup([t('A', { groupId: 'g' }), t('B')], 'g')
    expect(ids(out)).toBe('AB')
    expect(out[0].groupId).toBeUndefined()
  })
  it('タブのなくなったグループは捨てる', () => {
    expect(pruneGroups(groups, [t('A', { groupId: 'g' })]).map((g) => g.id)).toEqual(['g'])
    expect(pruneGroups(groups, [t('A', { groupId: 'g' }), t('B', { groupId: 'h' })])).toBe(groups)
  })
  it('色は使っていないものから', () => {
    expect(nextGroupColor(groups)).toBe('grey')
    expect(nextGroupColor([...groups, { id: 'x', name: '', color: 'grey' }])).toBe('yellow')
  })
})

describe('帯に並べる', () => {
  const tabs = [t('P', { pinned: true }), t('A', { groupId: 'g' }), t('B', { groupId: 'g' }), t('C'), t('D', { groupId: 'h' })]
  it('グループとひとつのタブに分ける(固定したタブも同じ並びの中)', () => {
    const segs = segmentTabs(tabs, groups)
    expect(segs.map((s) => s.kind)).toEqual(['tab', 'group', 'tab', 'group'])
    expect(segs[1].kind === 'group' && ids(segs[1].tabs)).toBe('AB')
  })
  it('折りたたんだグループのタブは見えない', () => {
    expect(ids(visibleTabs(tabs, groups))).toBe('PABC')
  })
})
