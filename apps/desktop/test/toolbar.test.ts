import { describe, expect, it } from 'vitest'
import { foldMenuActions, openSub, resolvePlacements } from '../src/utils/toolbar'

describe('resolvePlacements', () => {
  it('何も変えていなければ既定の置き場所', () => {
    const p = resolvePlacements('thread', undefined)
    expect(p.search).toBe('header')
    expect(p.findNext).toBe('menu')
  })

  it('変えたものだけ上書きし、ほかは既定のまま', () => {
    const p = resolvePlacements('list', { list: { refresh: 'footer' } })
    expect(p.refresh).toBe('footer')
    expect(p.search).toBe('header')
  })
})

describe('foldMenuActions', () => {
  type A = { id: string; children?: A[] }
  const fold = (area: 'thread' | 'list', ids: string[]) =>
    foldMenuActions<A>(area, ids.map((id) => ({ id })), (f, members) => ({ id: f.id, children: members }))
  const shape = (list: A[]) => list.map((a) => (a.children ? `${a.id}(${a.children.map((c) => c.id).join(',')})` : a.id))

  it('まとまりは最初の操作の場所に置く', () => {
    expect(shape(fold('thread', ['search', 'replyToggle', 'gallery', 'replyLayout', 'delete']))).toEqual(['search', 'replyMenu(replyToggle,replyLayout)', 'gallery', 'delete'])
  })

  it('1 つしかないまとまりは作らない', () => {
    expect(shape(fold('thread', ['copyUrl', 'delete']))).toEqual(['copyUrl', 'delete'])
  })

  it('文字の大きさは、表示スタイルがあれば並べない', () => {
    expect(shape(fold('list', ['style', 'fontSize']))).toEqual(['style'])
    expect(shape(fold('list', ['fontSize']))).toEqual(['fontSize'])
  })
})

describe('openSub', () => {
  const items = [{ label: 'A', children: [{ label: 'B', children: [] }] }, { label: 'C' }]
  it('道をたどって親を引く', () => {
    expect(openSub(items, [])).toBeUndefined()
    expect(openSub(items, ['A'])?.label).toBe('A')
    expect(openSub(items, ['A', 'B'])?.label).toBe('B')
  })
  it('なくなった項目は大項目へ戻す', () => {
    expect(openSub(items, ['A', 'Z'])).toBeUndefined()
  })
})
