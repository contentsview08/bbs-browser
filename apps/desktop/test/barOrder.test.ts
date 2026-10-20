import { describe, expect, it } from 'vitest'
import { orderBy } from '../src/utils/toolbar'

describe('ボタンの並び(設定で並べ替えたとき)', () => {
  const a = [{ id: 'search' }, { id: 'favorite' }, { id: 'gallery' }, { id: 'refresh' }]
  it('決めた並びに並べ、並びにないもの(あとで増えた操作)は、もとの順のまま後ろに', () => {
    expect(orderBy(a, ['refresh', 'search']).map((x) => x.id)).toEqual(['refresh', 'search', 'favorite', 'gallery'])
  })
  it('並びを決めていなければ、もとの順のまま', () => {
    expect(orderBy(a, undefined)).toBe(a)
    expect(orderBy(a, [])).toBe(a)
  })
})
