import { describe, expect, it } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS, reachedMaxPosts, shouldAutoRefresh, updateCheckDue } from '../src/utils/autoRefresh'
import { compareVersions } from '../src/host/update'

describe('shouldAutoRefresh: 開いているスレを自動で取りに行くか', () => {
  const base = { visible: true, status: 'active', postCount: 10, maxPosts: 1000 }

  it('見えていて、まだ増えるスレは取りに行く', () => {
    expect(shouldAutoRefresh(base)).toBe(true)
    expect(shouldAutoRefresh({ ...base, status: undefined })).toBe(true)
  })

  it('アプリが見えていないときは取りに行かない', () => {
    expect(shouldAutoRefresh({ ...base, visible: false })).toBe(false)
  })

  it('dat 落ちのスレは取りに行かない', () => {
    expect(shouldAutoRefresh({ ...base, status: 'archived' })).toBe(false)
  })

  it('上限に届いたスレは取りに行かない。1 つ手前なら行く', () => {
    expect(shouldAutoRefresh({ ...base, postCount: 1000 })).toBe(false)
    expect(shouldAutoRefresh({ ...base, postCount: 1001 })).toBe(false)
    expect(shouldAutoRefresh({ ...base, postCount: 999 })).toBe(true)
  })

  it('上限のない掲示板は、いくら増えても取りに行く', () => {
    expect(reachedMaxPosts(100000, undefined)).toBe(false)
    expect(shouldAutoRefresh({ ...base, postCount: 100000, maxPosts: undefined })).toBe(true)
  })
})

describe('updateCheckDue: 新しい版を確かめる頃か', () => {
  const now = 1_800_000_000_000

  it('一度も確かめていなければ確かめる', () => {
    expect(updateCheckDue(0, now)).toBe(true)
  })

  it('間隔の境目', () => {
    expect(updateCheckDue(now - UPDATE_CHECK_INTERVAL_MS + 1, now)).toBe(false)
    expect(updateCheckDue(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true)
  })

  it('前回が未来(時計を戻した)でも、確かめられなくならない', () => {
    expect(updateCheckDue(now + 1000, now)).toBe(true)
  })
})

describe('compareVersions: 版の比べ', () => {
  it.each([
    ['0.1.2', '0.1.1', 1],
    ['0.1.1', '0.1.2', -1],
    ['0.1.2', '0.1.2', 0],
    // 文字の順ではなく数の順
    ['0.10.0', '0.9.9', 1],
    ['1.0.0', '0.99.99', 1],
    // 桁の数が違っても同じ版は同じ
    ['1.2', '1.2.0', 0],
    ['1.2.1', '1.2', 1],
  ])('%s と %s → %i', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want)
  })

  it('読めない版は 0 とみなし、例外を出さない', () => {
    expect(compareVersions('abc', '0.0.0')).toBe(0)
    expect(compareVersions('', '0.0.1')).toBe(-1)
  })
})
