import { describe, expect, it } from 'vitest'
import { favUnread, threadUnread, treeFreshFrom, unreadCount } from '../src/utils/unread'

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

describe('treeFreshFrom: ツリー表示の新着の印をどこから付けるか', () => {
  it('更新で届いた分だけに付ける(開いてから見たレスには付けない。既読が 7 で止まっていても 8 以降を全部赤くしない)', () => {
    expect(treeFreshFrom({ current: 1, readNo: 7, lastBefore: 40, arrived: true, manual: true })).toBe(41)
    expect(treeFreshFrom({ current: 1, readNo: 7, lastBefore: 40, arrived: true, manual: false })).toBe(41)
  })

  it('既読 0 のスレ(開いたときは印なし)を更新しても、届いた分だけ', () => {
    expect(treeFreshFrom({ current: 1, readNo: 0, lastBefore: 40, arrived: true, manual: true })).toBe(41)
  })

  it('手で更新して何も届かなければ、前の印は消える(最後の次から)', () => {
    expect(treeFreshFrom({ current: 41, readNo: 7, lastBefore: 44, arrived: false, manual: true })).toBe(45)
  })

  it('自動更新で何も届かなければ、前の印を残す', () => {
    expect(treeFreshFrom({ current: 41, readNo: 7, lastBefore: 44, arrived: false, manual: false })).toBe(41)
  })

  it('別の端末の既読が届いた分より先なら、既読の次から(読んだものには付けない)', () => {
    expect(treeFreshFrom({ current: 1, readNo: 43, lastBefore: 40, arrived: true, manual: true })).toBe(44)
  })

  it('手元に何もなかったスレ(初めての取得)は既読の次から。読んだことがなければ印なし(1)', () => {
    expect(treeFreshFrom({ current: 1, readNo: 0, lastBefore: 0, arrived: true, manual: true })).toBe(1)
  })
})
