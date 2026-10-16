import { describe, expect, it } from 'vitest'
import type { ThreadSummary } from '@bbs-browser/connectors'
import { favIncreases, keywordHits } from '../src/utils/watch'

describe('favIncreases: お気に入りのスレの新着', () => {
  const e = (id: string, readNo: number, localCount: number) => ({ id, title: `スレ${id}`, readNo, localCount })

  it('前に知っていた数より増えて、未読があるものだけ', () => {
    const before = new Map([['a', 10]])
    const after = new Map([
      ['a', 15],
      ['b', 20],
      ['c', 30],
    ])
    expect(favIncreases([e('a', 10, 10), e('b', 20, 20), e('c', 5, 25)], before, after)).toEqual([
      { id: 'a', title: 'スレa', added: 5 },
      { id: 'c', title: 'スレc', added: 5 },
    ])
  })

  it('同じ数なら知らせない(2 回目の確認で同じ新着を何度も知らせない)', () => {
    const counts = new Map([['a', 15]])
    expect(favIncreases([e('a', 10, 10)], counts, counts)).toEqual([])
  })
})

describe('keywordHits: キーワードに合う新しいスレ', () => {
  const t = (key: string, title: string): ThreadSummary => ({
    connectorId: '2ch-compat',
    boardUrl: 'https://x/',
    key,
    title,
    postCount: 1,
    order: 0,
    createdAt: new Date(Number(key) * 1000),
  })

  it('境目より後に立った、キーワードを含むスレ(全角半角・大文字小文字は区別しない)', () => {
    const hits = keywordHits([t('100', 'Rust 総合'), t('200', 'ｒｕｓｔ part2'), t('300', '晩ごはん')], ['rust'], 150_000)
    expect(hits.map((h) => h.thread.key)).toEqual(['200'])
    expect(hits[0].keyword).toBe('rust')
  })

  it('キーワードがなければ何も返さない', () => {
    expect(keywordHits([t('200', 'Rust')], ['  '], 0)).toEqual([])
  })
})
