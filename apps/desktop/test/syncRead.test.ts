import { describe, expect, it } from 'vitest'
import { mergeSyncedHistory, syncedTabReadNo } from '../src/utils/syncRead'
import { threadUnread, unreadFirstOrder } from '../src/utils/unread'

const row = (key: string, readNo: number, postCount = 100) => ({ thread: { boardUrl: 'b', key }, readNo, postCount })

describe('同期で届いた既読と画面', () => {
  it('読んでいる最中: 上がるときだけ追い、下がっても動かさない', () => {
    expect(syncedTabReadNo(50, 80)).toBe(80)
    expect(syncedTabReadNo(50, 0)).toBe(50)
    expect(syncedTabReadNo(50, undefined)).toBe(50)
    expect(syncedTabReadNo(50, 50)).toBe(50)
  })

  it('履歴の一覧の並びを変えず、外れた行を消し、増えた行を後ろに足す', () => {
    const merged = mergeSyncedHistory([row('a', 1), row('b', 2), row('c', 3)], [row('d', 9), row('c', 30), row('a', 10)])
    expect(merged.map((x) => [x.thread.key, x.readNo])).toEqual([['a', 10], ['c', 30], ['d', 9]])
  })

  it('未読を上に: ログを消して未読に戻ったスレは上へ、自動整理のあと既読が戻ったスレは下へ', () => {
    const list = [row('読了', 100), row('リセット', 0), row('整理後', 100), row('途中', 40)]
    const order = unreadFirstOrder(list, (x) => threadUnread({ readNo: x.readNo }, x.postCount) > 0)
    expect(order.map((x) => x.thread.key)).toEqual(['リセット', '途中', '読了', '整理後'])
  })

  it('読み進めたあとの未読の数は DB の既読から数える', () => {
    expect(threadUnread({ readNo: 60 }, 100)).toBe(40)
    expect(threadUnread({ readNo: 0 }, 100)).toBe(100)
  })
})
