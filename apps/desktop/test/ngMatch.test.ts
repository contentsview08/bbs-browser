import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post, ThreadSummary } from '@bbs-browser/connectors'
import { daysLaterDateString, isActive, isValidPattern, matchRanges, newRule, pruneExpired, postMatcher, threadMatcher, todayDateString, type NgRule } from '../src/utils/ng'

const post = (o: Partial<Post> = {}): Post => ({ no: 1, name: '名無し', mail: '', date: '', id: 'AbC123', body: '今日は Rust の話', ...o })
const thread = (o: Partial<ThreadSummary> = {}): ThreadSummary => ({
  connectorId: '2ch-compat',
  boardUrl: 'https://x.test/a/',
  key: '1',
  title: '雑談スレ Part1',
  postCount: 1,
  order: 0,
  ...o,
})

describe('postMatcher: レスの NG', () => {
  it('文字は大文字・小文字を区別せずに含むかで見る', () => {
    expect(postMatcher([newRule('content', 'RUST')])(post())).toBe(true)
    expect(postMatcher([newRule('posterName', '名無')])(post())).toBe(true)
    expect(postMatcher([newRule('content', 'Go')])(post())).toBe(false)
  })

  it('文字の NG の記号は、正規表現として読まない', () => {
    expect(postMatcher([newRule('content', 'R.st')])(post())).toBe(false)
    expect(postMatcher([newRule('content', '(')])(post({ body: 'かっこ(' }))).toBe(true)
  })

  it('正規表現は書いたまま(大文字・小文字を区別する)', () => {
    const rule = (pattern: string) => newRule('content', pattern, { isRegex: true })
    expect(postMatcher([rule('R.st')])(post())).toBe(true)
    expect(postMatcher([rule('RUST')])(post())).toBe(false)
  })

  it('同じ判定を何度呼んでも結果が変わらない', () => {
    const m = postMatcher([newRule('content', 'Rust', { isRegex: true })])
    expect([m(post()), m(post()), m(post())]).toEqual([true, true, true])
  })

  it('読めない正規表現は当たらず、ほかの NG は効く', () => {
    const broken = newRule('content', '(', { isRegex: true })
    expect(postMatcher([broken])(post())).toBe(false)
    expect(postMatcher([broken, newRule('content', 'Rust')])(post())).toBe(true)
  })

  it('ID は完全一致で、大文字・小文字も区別する(別の ID を巻き込まない)', () => {
    expect(postMatcher([newRule('posterId', 'AbC123')])(post())).toBe(true)
    expect(postMatcher([newRule('posterId', 'AbC')])(post())).toBe(false)
    expect(postMatcher([newRule('posterId', 'abc123')])(post())).toBe(false)
  })

  it('ID の正規表現は部分一致で当たる', () => {
    expect(postMatcher([newRule('posterId', '^AbC', { isRegex: true })])(post())).toBe(true)
  })

  it('ID のないレスには ID の NG が当たらない', () => {
    const m = postMatcher([newRule('posterId', 'AbC123'), newRule('posterId', '.*', { isRegex: true })])
    expect(m(post({ id: undefined }))).toBe(false)
  })

  it('スレタイの NG はレスに当たらない', () => {
    expect(postMatcher([newRule('threadTitle', 'Rust')])(post())).toBe(false)
  })

  it('空の文字の NG は、すべてのレスを消さない', () => {
    const rules: NgRule[] = [
      newRule('content', ''),
      newRule('content', '', { isRegex: true }),
      newRule('posterName', ''),
      newRule('posterId', ''),
      newRule('posterId', '', { isRegex: true }),
    ]
    expect(postMatcher(rules)(post())).toBe(false)
    expect(postMatcher(rules)(post({ id: '' }))).toBe(false)
    expect(threadMatcher([newRule('threadTitle', '')])(thread())).toBe(false)
  })

  it('この板だけの NG は、板が分からないレスにも別の板にも当たらない', () => {
    const r = newRule('content', 'Rust', { boardUrl: 'https://x.test/a/' })
    expect(postMatcher([r])(post(), 'https://x.test/a/')).toBe(true)
    expect(postMatcher([r])(post(), 'https://x.test/b/')).toBe(false)
    expect(postMatcher([r])(post())).toBe(false)
    const id = newRule('posterId', 'AbC123', { boardUrl: 'https://x.test/a/' })
    expect(postMatcher([id])(post(), 'https://x.test/b/')).toBe(false)
  })
})

describe('threadMatcher: スレ一覧の NG', () => {
  it('スレタイと、立てた人の ID で当てる。本文の NG は当てない', () => {
    expect(threadMatcher([newRule('threadTitle', 'part1')])(thread())).toBe(true)
    expect(threadMatcher([newRule('posterId', 'x1')])(thread({ authorId: 'x1' }))).toBe(true)
    expect(threadMatcher([newRule('posterId', 'x1')])(thread())).toBe(false)
    expect(threadMatcher([newRule('content', '雑談')])(thread())).toBe(false)
  })

  it('この板だけの NG は、スレの板で見る', () => {
    const r = newRule('threadTitle', '雑談', { boardUrl: 'https://x.test/a/' })
    expect(threadMatcher([r])(thread())).toBe(true)
    expect(threadMatcher([r])(thread({ boardUrl: 'https://x.test/b/' }))).toBe(false)
  })
})

describe('期限のある NG', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 6, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('日付は端末の日付で、桁をそろえる', () => {
    expect(todayDateString(new Date(2026, 0, 2))).toBe('2026-01-02')
  })

  it('n 日後は月と年をまたげる', () => {
    expect(daysLaterDateString(7, new Date(2026, 11, 28))).toBe('2027-01-04')
    expect(daysLaterDateString(0, new Date(2026, 1, 28))).toBe('2026-02-28')
  })

  it('期限の日までは効き、次の日から効かない', () => {
    const until = (d: string) => newRule('content', 'Rust', { expiresOnDate: d })
    expect(isActive(until('2026-11-06'))).toBe(true)
    expect(isActive(until('2026-11-05'))).toBe(false)
    expect(postMatcher([until('2026-11-06')])(post())).toBe(true)
    expect(postMatcher([until('2026-11-05')])(post())).toBe(false)
  })

  it('切ってある NG は期限に関係なく効かない', () => {
    expect(isActive(newRule('content', 'a', { enabled: false, expiresOnDate: '2099-01-01' }))).toBe(false)
  })

  it('期限の切れた NG だけ取り除く(切ってあるだけの NG は残す)', () => {
    const old = newRule('content', 'a', { expiresOnDate: '2026-11-05' })
    const today = newRule('content', 'b', { expiresOnDate: '2026-11-06' })
    const forever = newRule('content', 'c')
    const off = newRule('content', 'd', { enabled: false })
    expect(pruneExpired([old, today, forever, off])).toEqual([today, forever, off])
  })
})

describe('isValidPattern・matchRanges: NG の試し', () => {
  it('空と読めない正規表現は受け付けない', () => {
    expect(isValidPattern('', false)).toBe(false)
    expect(isValidPattern('', true)).toBe(false)
    expect(isValidPattern('(', true)).toBe(false)
    expect(isValidPattern('(', false)).toBe(true)
  })

  it('文字は大文字・小文字を区別せず、重ならずに全部', () => {
    expect(matchRanges({ pattern: 'ab', isRegex: false, target: 'content' }, 'AB ab aB')).toEqual([[0, 2], [3, 5], [6, 8]])
    expect(matchRanges({ pattern: 'aa', isRegex: false, target: 'content' }, 'aaa')).toEqual([[0, 2]])
  })

  it('ID は全体が同じときだけ', () => {
    expect(matchRanges({ pattern: 'abc', isRegex: false, target: 'posterId' }, 'abc')).toEqual([[0, 3]])
    expect(matchRanges({ pattern: 'abc', isRegex: false, target: 'posterId' }, 'abcd')).toEqual([])
  })

  it('何にでも当たる正規表現でも止まる', () => {
    expect(matchRanges({ pattern: 'x*', isRegex: true, target: 'content' }, 'ab')).toEqual([])
    expect(matchRanges({ pattern: '(', isRegex: true, target: 'content' }, 'ab')).toEqual([])
    expect(matchRanges({ pattern: '', isRegex: true, target: 'content' }, 'ab')).toEqual([])
    expect(matchRanges({ pattern: 'a', isRegex: false, target: 'content' }, 'a'.repeat(500))).toHaveLength(200)
  })
})
