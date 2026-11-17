import { describe, expect, it } from 'vitest'
import type { ThreadSummary } from '@bbs-browser/connectors'
import { favIncreases, keywordHits } from '../src/utils/watch'
import type { KeywordRule } from '../src/utils/keywords'

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
  const word = (pattern: string, over: Partial<KeywordRule> = {}): KeywordRule => ({ id: pattern, kind: 'title', pattern, isRegex: false, label: '', enabled: true, createdAt: 0, ...over })
  const author = (id: string): KeywordRule => ({ id: `a:${id}`, kind: 'author', pattern: id, isRegex: false, label: '', enabled: true, createdAt: 0 })

  it('境目より後に立った、キーワードを含むスレ(全角半角・大文字小文字は区別しない)', () => {
    const hits = keywordHits([t('100', 'Rust 総合'), t('200', 'ｒｕｓｔ part2'), t('300', '晩ごはん')], [word('rust')], 150_000)
    expect(hits.map((h) => h.thread.key)).toEqual(['200'])
    expect(hits[0].keyword).toBe('rust')
  })

  it('キーワードがなければ何も返さない。無効・ほかの板限定も数えない', () => {
    expect(keywordHits([t('200', 'Rust')], [word('  ')], 0)).toEqual([])
    expect(keywordHits([t('200', 'Rust')], [word('rust', { enabled: false })], 0)).toEqual([])
    expect(keywordHits([t('200', 'Rust')], [word('rust', { boardUrl: 'https://y/' })], 0, 'https://x/')).toEqual([])
    expect(keywordHits([t('200', 'Rust')], [word('rust', { boardUrl: 'https://x/' })], 0, 'https://x/')).toHaveLength(1)
  })

  it('正規表現と別名: 当たった名前は別名', () => {
    const hits = keywordHits([t('200', 'イラスト置き場'), t('300', '絵の話')], [word('絵|イラスト', { isRegex: true, label: 'お絵描き' })], 0)
    expect(hits.map((h) => [h.thread.key, h.keyword])).toEqual([
      ['200', 'お絵描き'],
      ['300', 'お絵描き'],
    ])
  })

  it('立てた人のキーワード: authorId が同じスレ(完全一致)。スレタイのキーワードに当たればそちらを添える', () => {
    const a = (key: string, title: string, authorId?: string) => ({ ...t(key, title), authorId })
    const hits = keywordHits([a('200', '雑談', 'abcd'), a('300', '雑談', 'abcde'), a('400', 'Rust', 'abcd'), a('100', '古い', 'abcd')], [word('rust'), author('abcd')], 150_000)
    expect(hits.map((h) => [h.thread.key, h.keyword])).toEqual([
      ['200', '立てた人 abcd'],
      ['400', 'rust'],
    ])
    expect(keywordHits([a('200', '雑談', 'abcd')], [author('abcd')], 0)).toHaveLength(1)
  })
})
