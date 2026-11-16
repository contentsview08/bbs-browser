import { describe, expect, it } from 'vitest'
import type { Post, ThreadSummary } from '@bbs-browser/connectors'
import { importLogStatements } from '@bbs-browser/logstore'

const thread: ThreadSummary = { connectorId: '2ch', boardUrl: 'https://bbs.eddibb.cc/liveedge/', key: '1791503299', title: 'てすと', postCount: 0, order: 0 }
const post = (no: number): Post => ({ no, name: 'n', mail: '', date: 'd', id: 'x', body: `b${no}` })

describe('ほかのアプリのログをまとめて入れる文', () => {
  it('入れ替えるときは スレの行・レスの消去・レスの挿入・スレの更新・既読・見た時刻・自分の印', () => {
    const s = importLogStatements(thread, [post(1), post(2)], { title: 'てすと', readNo: 2, viewedAt: 100, ownNos: [2], replace: true }, 999)
    expect(s.map((x) => x.sql.split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'INSERT OR IGNORE',
      'DELETE FROM posts',
      'INSERT OR REPLACE',
      'UPDATE threads SET',
      'UPDATE threads SET',
      'UPDATE threads SET',
      'INSERT OR IGNORE',
    ])
    // レスは 1 文にまとめる(2 行 × 10 列)
    expect(s[2].params?.length).toBe(20)
    // 既読は読んだ時刻で
    expect(s[4].params).toEqual([2, 100, thread.boardUrl, thread.key])
  })
  it('手元の方が進んでいればレスは触らず、既読と見た時刻だけ', () => {
    const s = importLogStatements(thread, [post(1)], { title: '', readNo: 0, viewedAt: 100, ownNos: [], replace: false })
    expect(s.map((x) => x.sql.split(/\s+/).slice(0, 3).join(' '))).toEqual(['INSERT OR IGNORE', 'UPDATE threads SET'])
    expect(s[1].sql).toContain('read_at')
  })
})
