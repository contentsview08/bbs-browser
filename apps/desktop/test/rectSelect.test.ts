import { describe, expect, it } from 'vitest'
import { edgeScrollSpeed, intersects, rectFrom, selectByRect, selectRange, toggled } from '../src/utils/rectSelect'

const tile = (key: string, left: number, top: number) => ({ key, rect: { left, top, right: left + 10, bottom: top + 10 } })

describe('画像一覧の選択', () => {
  const tiles = [tile('a', 0, 0), tile('b', 20, 0), tile('c', 0, 20)]

  it('どの向きに引いても同じ四角形になる', () => {
    expect(rectFrom({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ left: 0, top: 5, right: 10, bottom: 20 })
  })

  it('触れただけで当たり、辺が接するだけでは当たらない', () => {
    expect(intersects({ left: 0, top: 0, right: 5, bottom: 5 }, tile('x', 4, 4).rect)).toBe(true)
    expect(intersects({ left: 0, top: 0, right: 5, bottom: 5 }, tile('x', 5, 0).rect)).toBe(false)
  })

  it('四角形に当たったものだけを選ぶ', () => {
    expect([...selectByRect({ left: 5, top: 5, right: 25, bottom: 8 }, tiles, new Set(['c']), false)].sort()).toEqual(['a', 'b'])
  })

  it('Ctrl を押して引くと、元の選択に対して裏返す', () => {
    expect([...selectByRect({ left: 5, top: 5, right: 25, bottom: 8 }, tiles, new Set(['a', 'c']), true)].sort()).toEqual(['b', 'c'])
  })

  it('Ctrl+クリックで足し引きする', () => {
    expect([...toggled(new Set(['a']), 'b')].sort()).toEqual(['a', 'b'])
    expect([...toggled(new Set(['a']), 'a')]).toEqual([])
  })

  it('Shift+クリックは起点から押したものまで。上へもよい', () => {
    const order = ['a', 'b', 'c', 'd']
    expect([...selectRange(order, 'b', 'd', new Set(['a']), false)]).toEqual(['b', 'c', 'd'])
    expect([...selectRange(order, 'd', 'b', new Set(), false)].sort()).toEqual(['b', 'c', 'd'])
    expect([...selectRange(order, 'b', 'c', new Set(['a']), true)].sort()).toEqual(['a', 'b', 'c'])
    expect([...selectRange(order, undefined, 'c', new Set(), false)]).toEqual(['c'])
  })

  it('スクロール端に近いほど速く動かし、真ん中では動かさない', () => {
    expect(edgeScrollSpeed(300, 100, 500)).toBe(0)
    expect(edgeScrollSpeed(120, 100, 500)).toBeLessThan(0)
    expect(edgeScrollSpeed(50, 100, 500)).toBe(-18)
    expect(edgeScrollSpeed(490, 100, 500)).toBeGreaterThan(edgeScrollSpeed(470, 100, 500))
    expect(edgeScrollSpeed(900, 100, 500)).toBe(18)
  })
})
