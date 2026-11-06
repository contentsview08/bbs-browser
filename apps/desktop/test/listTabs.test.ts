import { describe, expect, it } from 'vitest'
import { isListTabActive, type ListTabKey } from '../src/ui/settings'

describe('いま選んでいるスレ一覧のタブ', () => {
  const tabs: ListTabKey[] = ['momentum', 'newest', 'unread', 'viewed']
  const cur = (filter: Parameters<typeof isListTabActive>[1], sort: Parameters<typeof isListTabActive>[2]) => tabs.findIndex((k) => isListTabActive(k, filter, sort))
  it('絞り込み中は、既定の並びのタブではなく絞り込みのタブ', () => {
    expect(cur('unread', { mode: 'momentum' })).toBe(2)
  })
  it('絞り込みがなければ、並べ替えのタブ', () => {
    expect(cur(null, { mode: 'newest' })).toBe(1)
  })
  it('並べ替えも絞り込みもなければ、見た順のタブ', () => {
    expect(cur(null, null)).toBe(3)
  })
})
