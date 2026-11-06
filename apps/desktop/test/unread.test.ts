import { describe, expect, it } from 'vitest'
import { favUnread, threadUnread, unreadCount } from '../src/utils/unread'

describe('unreadCount: 未読の数', () => {
  it('レス数から既読を引く', () => {
    expect(unreadCount(10, 15)).toBe(5)
  })

  it('全部読んでいれば 0。既読のほうが多くても(ログを消した後など)負にしない', () => {
    expect(unreadCount(15, 15)).toBe(0)
    expect(unreadCount(20, 15)).toBe(0)
  })

  it('分かっているレス数のうち一番多いものを使う(手元のログ・スレ一覧のどちらかが遅れていてもずれない)', () => {
    expect(unreadCount(10, 12, 20)).toBe(10)
    expect(unreadCount(10, 20, 12)).toBe(10)
  })

  it('レス数が分からなければ 0', () => {
    expect(unreadCount(0)).toBe(0)
  })
})

describe('threadUnread: スレの未読', () => {
  it('読んだことのないスレは、レスがあっても未読に数えない', () => {
    expect(threadUnread(undefined, 100)).toBe(0)
  })

  it('開いたことがあるスレは数える。読み始める前(既読 0)なら全部', () => {
    expect(threadUnread({ readNo: 0 }, 100)).toBe(100)
    expect(threadUnread({ readNo: 40 }, 100)).toBe(60)
  })
})

describe('favUnread: お気に入りのスレの未読', () => {
  it('まだ一度も取っていないスレは、見張りでレス数が分かっていても数えない', () => {
    expect(favUnread({ postCount: 0, readNo: 0 }, 500)).toBe(0)
  })

  it('見張りで分かったレス数を使い、なければ手元のレス数', () => {
    expect(favUnread({ postCount: 20, readNo: 20 }, 25)).toBe(5)
    expect(favUnread({ postCount: 20, readNo: 15 }, undefined)).toBe(5)
  })

  it('読み終えていれば 0', () => {
    expect(favUnread({ postCount: 20, readNo: 25 }, 20)).toBe(0)
  })
})
