import { describe, expect, it } from 'vitest'
import { resolvePlacements } from '../src/utils/toolbar'

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
