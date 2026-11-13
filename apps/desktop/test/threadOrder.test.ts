import { describe, expect, it } from 'vitest'
import { sortByOrder } from '../src/utils/thread'
import { isListTabActive, LIST_TABS, HISTORY_LIST_TABS } from '../src/ui/settings'

const t = (key: string, order?: number) => ({ key, order })

describe('スレ順(掲示板が返した順 = order)', () => {
  const list = [t('c', 2), t('a', 0), t('b', 1)]
  it('いつもの並びは order の小さい順', () => {
    expect(sortByOrder(list, 'asc').map((x) => x.key)).toEqual(['a', 'b', 'c'])
  })
  it('逆順は order の大きい順', () => {
    expect(sortByOrder(list, 'desc').map((x) => x.key)).toEqual(['c', 'b', 'a'])
  })
  it('order のないスレは、どちらの向きでも後ろに来た順のまま', () => {
    const mixed = [t('x'), t('b', 1), t('y', Number.NaN), t('a', 0)]
    expect(sortByOrder(mixed, 'asc').map((x) => x.key)).toEqual(['a', 'b', 'x', 'y'])
    expect(sortByOrder(mixed, 'desc').map((x) => x.key)).toEqual(['b', 'a', 'x', 'y'])
  })
  it('同じ order のスレは来た順のまま(並べ替えで入れ替わらない)', () => {
    expect(sortByOrder([t('p', 0), t('q', 0)], 'desc').map((x) => x.key)).toEqual(['p', 'q'])
  })
  it('元の一覧は変えない', () => {
    sortByOrder(list, 'asc')
    expect(list.map((x) => x.key)).toEqual(['c', 'a', 'b'])
  })
})

describe('スレ順のタブ', () => {
  it('並べ替えていない(掲示板の並び)ときと、スレ順の逆順のときに選んでいる', () => {
    expect(isListTabActive('order', null, null)).toBe(true)
    expect(isListTabActive('order', null, { mode: 'order' })).toBe(true)
    expect(isListTabActive('order', null, { mode: 'momentum' })).toBe(false)
    expect(isListTabActive('order', 'unread', null)).toBe(false)
  })
  it('設定で選べるタブに入っていて、履歴の一覧には出さない(サーバーの順がない)', () => {
    expect(LIST_TABS.map((x) => x.key)).toContain('order')
    expect(HISTORY_LIST_TABS).not.toContain('order')
  })
})
