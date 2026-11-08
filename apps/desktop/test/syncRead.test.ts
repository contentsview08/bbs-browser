import { describe, expect, it } from 'vitest'
import { droppedTabIds, mergeSyncedHistory, mergeSyncedStates, syncedTabReadNo } from '../src/utils/syncRead'
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

  it('板の一覧の既読は DB の値を元に、スレごとに大きい方を取る', () => {
    const cur = new Map([['a', { readNo: 80, n: 1 }], ['b', { readNo: 10, n: 1 }], ['gone', { readNo: 5, n: 1 }]])
    const db = new Map([['a', { readNo: 50, n: 2 }], ['b', { readNo: 30, n: 2 }], ['new', { readNo: 7, n: 2 }]])
    expect([...mergeSyncedStates(cur, db)]).toEqual([['a', { readNo: 80, n: 2 }], ['b', { readNo: 30, n: 2 }], ['new', { readNo: 7, n: 2 }]])
  })

  it('閉じるのは削除が写ったスレのタブだけ。行がないだけのタブは残す。URL の書き方の違いはそろえる', () => {
    const tab = (id: string, boardUrl: string, key: string) => ({ id, thread: { boardUrl, key } })
    const tabs = [tab('1', 'https://a.5ch.net/x/', '1'), tab('2', 'https://a.5ch.io/x/', '2'), tab('3', 'https://b.test/y/', '1')]
    expect(droppedTabIds(tabs, [{ board_url: 'https://a.5ch.io/x/', key: '1' }])).toEqual(['1'])
    expect(droppedTabIds(tabs, [])).toEqual([])
    expect(droppedTabIds(tabs, [{ board_url: 'http://b.test/y/', key: '1' }, { board_url: 'https://b.test/y/', key: '9' }])).toEqual(['3'])
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
