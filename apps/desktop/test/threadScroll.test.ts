import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import {
  HeightCache,
  estimatePostHeight,
  newPostsTarget,
  openTarget,
  readProgress,
  staggerDelays,
  type PostRect,
} from '../src/utils/threadScroll'

describe('openTarget: 開いたときの行き先', () => {
  const base = { savedFound: false, openPosition: 'unread' as const, unreadFrom: 1, hasUnreadPost: false }

  it('初めて開いたスレは先頭', () => {
    expect(openTarget(base)).toEqual({ kind: 'top' })
  })

  it('読みかけのスレは最初の未読へ', () => {
    expect(openTarget({ ...base, unreadFrom: 51, hasUnreadPost: true })).toEqual({ kind: 'unread', no: 51 })
  })

  it('最後まで読んでいたスレは一番下に置いて、新着を待つ', () => {
    expect(openTarget({ ...base, unreadFrom: 101, hasUnreadPost: false })).toEqual({ kind: 'bottom', pendingUnread: true })
  })

  it('タブを切り替えて戻ってきたときは、前の位置が設定より優先', () => {
    const saved = { no: 30, offset: -12 }
    expect(openTarget({ ...base, saved, savedFound: true, unreadFrom: 51, hasUnreadPost: true })).toEqual({
      kind: 'saved',
      position: saved,
    })
  })

  it('一番下まで見ていたタブは、レスの位置ではなく一番下へ戻す', () => {
    const saved = { no: 95, offset: -300, bottom: true }
    expect(openTarget({ ...base, saved, savedFound: true })).toEqual({ kind: 'bottom', pendingUnread: false })
  })

  it('前の位置のレスが見つからなければ設定どおり', () => {
    expect(openTarget({ ...base, saved: { no: 30, offset: 0 }, openPosition: 'bottom' })).toEqual({
      kind: 'bottom',
      pendingUnread: false,
    })
  })
})

describe('newPostsTarget: 新着が届いたときの行き先', () => {
  const base = {
    pendingUnread: false,
    unreadFrom: 101,
    hasUnreadPost: true,
    prevLastNo: 100,
    readNo: 100,
    opening: false,
    autoScrollOnNew: true,
    atBottom: true,
  }

  it('最後まで読んでいたスレを開いたら、届いた未読の頭へすぐ移る', () => {
    expect(newPostsTarget({ ...base, pendingUnread: true })).toEqual({ no: 101, animate: false })
  })

  it('開いた直後で読み終えていれば、一番下からずれていても新着の頭へすぐ移る', () => {
    expect(newPostsTarget({ ...base, opening: true, atBottom: false })).toEqual({ no: 101, animate: false })
  })

  it('開いた直後でも、読みかけなら動かさない', () => {
    expect(newPostsTarget({ ...base, opening: true, readNo: 60 })).toBeUndefined()
  })

  it('読んでいる途中で一番下にいれば、動かして見せる', () => {
    expect(newPostsTarget(base)).toEqual({ no: 101, animate: true })
  })

  it('一番下にいなければ動かさない', () => {
    expect(newPostsTarget({ ...base, atBottom: false })).toBeUndefined()
  })

  it('自動で送る設定がオフなら動かさない', () => {
    expect(newPostsTarget({ ...base, autoScrollOnNew: false })).toBeUndefined()
  })
})

describe('readProgress: どこまで読んだか', () => {
  // 100px ずつ縦に並んだレス。画面は 0〜300、ヘッダーの下端は 50
  const rects = (n: number, hidden: number[] = []): PostRect[] =>
    Array.from({ length: n }, (_, i) => ({ no: i + 1, top: i * 100, bottom: i * 100 + 100, hidden: hidden.includes(i + 1) }))
  const view = { viewTop: 50, viewBottom: 300 }

  it('画面の下端より上に頭が出ている最後のレスまでを既読にする', () => {
    expect(readProgress({ rects: rects(10), ...view, atBottom: false, lastNo: 10 })).toEqual({
      last: 3,
      position: { no: 1, offset: -50, bottom: false },
    })
  })

  it('隠しているレスは数えない', () => {
    expect(readProgress({ rects: rects(10, [3]), ...view, atBottom: false, lastNo: 10 }).last).toBe(2)
  })

  it('一番下まで来ていれば、NG や絞り込みで隠れた後ろのレスも既読', () => {
    expect(readProgress({ rects: rects(3, [3]), ...view, atBottom: true, lastNo: 3 }).last).toBe(3)
  })
})

describe('staggerDelays: 新着を順に出す遅れ', () => {
  it('若い番号から順にずらす', () => {
    expect([...staggerDelays([5, 6, 7]).values()]).toEqual([0, 35, 70])
  })

  it('多いときは全体で決めた時間に収める', () => {
    const d = staggerDelays(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(Math.max(...d.values())).toBe(450)
  })
})

describe('estimatePostHeight: 描く前のレスの高さの見積もり', () => {
  const m = { charsPerLine: 40, lineHeight: 24, chrome: 40, thumbRow: 90, linkPreview: 88, showThumbnails: true }
  const post = (body: string): Post => ({ no: 1, name: '', mail: '', date: '', body })

  it('行数に比例する', () => {
    expect(estimatePostHeight(post('a'), m)).toBe(64)
    expect(estimatePostHeight(post('a\nb\nc'), m)).toBe(112)
  })

  it('1 行に入りきらない長い行は折り返して数える', () => {
    expect(estimatePostHeight(post('あ'.repeat(81)), m)).toBe(40 + 3 * 24)
  })

  it('画像があればサムネイルの段を足す', () => {
    expect(estimatePostHeight(post('https://i.imgur.com/abc.jpg'), m)).toBeGreaterThan(64 + 80)
  })
})

describe('HeightCache', () => {
  it('幅ごとに分けて覚え、多すぎたら古いものから捨てる', () => {
    const c = new HeightCache(2)
    c.set('t', 800, 1, 100)
    c.set('t', 800, 2, 120)
    expect(c.get('t', 803, 1)).toBe(100)
    expect(c.get('t', 600, 1)).toBeUndefined()
    c.set('t', 800, 3, 140)
    expect(c.get('t', 800, 1)).toBeUndefined()
    expect(c.size).toBe(2)
  })
})

describe('newPostsTarget: 一番下を見ているときの新着', () => {
  const base = { pendingUnread: false, unreadFrom: 11, hasUnreadPost: true, prevLastNo: 10, readNo: 10, opening: false, autoScrollOnNew: true, atBottom: true }
  it('新着の頭まで送る(一番下まで送る設定は 2026-11 にやめた)', () => {
    expect(newPostsTarget(base)).toEqual({ no: 11, animate: true })
  })
  it('一番下を見ていなければ動かさない', () => {
    expect(newPostsTarget({ ...base, atBottom: false })).toBeUndefined()
  })
})
