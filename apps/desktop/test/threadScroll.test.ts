import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import {
  HeightCache,
  PositionMemory,
  anchorCorrection,
  estimatePostHeight,
  heightKind,
  heightOffsets,
  movedByOthers,
  newPostsTarget,
  openTarget,
  postShape,
  readProgress,
  settleDone,
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

describe('estimatePostHeight: 高さを決める条件', () => {
  const m = { charsPerLine: 40, lineHeight: 24, chrome: 40, thumbRow: 88, linkPreview: 88, showThumbnails: true, showLinkPreview: true }
  const post = (body: string) => ({ no: 1, name: '', mail: '', date: '', id: '', body }) as Post
  const img = (n: number) => `https://i.imgur.com/a${n}.jpg`

  it('サムネイルは 1 段に入る数で折り返す', () => {
    const body = [1, 2, 3, 4, 5].map(img).join('\n')
    const oneRow = estimatePostHeight(post(body), { ...m, thumbsPerRow: 5 })
    const twoRows = estimatePostHeight(post(body), { ...m, thumbsPerRow: 3 })
    expect(twoRows - oneRow).toBe(88)
  })
  it('リンクの札は 3 件までで、家の中のアドレスには出さない', () => {
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://example.com/p${i}`).join('\n')
    expect(postShape(post(urls(5)), m).links).toBe(3)
    expect(postShape(post('http://192.168.0.1/x'), m).links).toBe(0)
    expect(postShape(post(urls(2)), { ...m, showLinkPreview: false }).links).toBe(0)
  })
  it('札の高さを足す', () => {
    const plain = estimatePostHeight(post('a\nb'), m)
    const carded = estimatePostHeight(post('a\nhttps://example.com/p'), m)
    expect(carded - plain).toBe(88)
  })
  it('サムネイルを出さない設定なら足さない', () => {
    expect(estimatePostHeight(post('a\n' + img(1)), { ...m, showThumbnails: false })).toBe(estimatePostHeight(post('a\nb'), { ...m, showThumbnails: false, showLinkPreview: false }))
  })
})

describe('heightOffsets: 見積もりの補正', () => {
  it('種類ごとの中央値を使う。飛び抜けた値には引きずられない', () => {
    const samples = [
      { kind: '', diff: 10 },
      { kind: '', diff: 12 },
      { kind: '', diff: 500 },
      { kind: 'c', diff: -30 },
      { kind: 'c', diff: -28 },
      { kind: 'c', diff: -32 },
    ]
    const { byKind } = heightOffsets(samples)
    expect(byKind.get('')).toBe(12)
    expect(byKind.get('c')).toBe(-30)
  })
  it('数の少ない種類は持たず、全体の中央値に任せる', () => {
    const { all, byKind } = heightOffsets([
      { kind: '', diff: 5 },
      { kind: '', diff: 6 },
      { kind: '', diff: 7 },
      { kind: 'm', diff: 100 },
    ])
    expect(byKind.has('m')).toBe(false)
    expect(all).toBe(7)
  })
  it('実測がなければ補正しない', () => {
    expect(heightOffsets([]).all).toBe(0)
  })
  it('種類の名前は、頭の省略・サムネイル・札の組で分かれる', () => {
    expect(heightKind({})).toBe('')
    expect(heightKind({ continued: true, media: true, links: true })).toBe('cml')
    expect(heightKind({ media: true })).not.toBe(heightKind({ links: true }))
  })
})

describe('anchorCorrection: 基準のレスの補正', () => {
  // 位置は 画面上の位置 + scrollTop で比べるので、スクロールしただけなら変わらない
  const y = (top: number, scrollTop: number) => top + scrollTop

  it('スクロールしただけなら直さない', () => {
    expect(anchorCorrection(y(100, 1000), y(40, 1060))).toBe(0)
  })
  it('上のレスが伸びたら、伸びた分だけ足す', () => {
    expect(anchorCorrection(y(100, 1000), y(160, 1000))).toBe(60)
  })
  it('上のレスが縮んだら、縮んだ分だけ引く', () => {
    expect(anchorCorrection(y(100, 1000), y(70, 1000))).toBe(-30)
  })
  it('スクロールと高さの変化が重なっても、高さの変化の分だけ直す(利用者のスクロールを打ち消さない)', () => {
    expect(anchorCorrection(y(100, 1000), y(100 - 200 + 50, 1200))).toBe(50)
  })
  it('小数の丸めの分は直さない', () => {
    expect(anchorCorrection(y(100, 1000), y(100.4, 1000))).toBe(0)
  })
})

describe('settleDone: ジャンプの打ち切り', () => {
  it('行き先が動いている間は続ける', () => {
    expect(settleDone({ now: 1100, start: 1000, lastChange: 1050 }, 250, 2000)).toBe(false)
  })
  it('行き先が決めた時間動かなければ着いたものとする', () => {
    expect(settleDone({ now: 1400, start: 1000, lastChange: 1100 }, 250, 2000)).toBe(true)
  })
  it('動き続けていても上限で打ち切る', () => {
    expect(settleDone({ now: 3000, start: 1000, lastChange: 2999 }, 250, 2000)).toBe(true)
  })
})

describe('movedByOthers: ジャンプの途中で誰かが動かしたか', () => {
  it('自分で書いた位置のままなら動かしていない', () => {
    expect(movedByOthers(500, 500, 9000)).toBe(false)
    expect(movedByOthers(500.5, 500, 9000)).toBe(false)
  })
  it('まだ書いていなければ動かしていない', () => {
    expect(movedByOthers(500, NaN, 9000)).toBe(false)
  })
  it('書いた位置から離れていれば、誰かが動かした', () => {
    expect(movedByOthers(800, 500, 9000)).toBe(true)
  })
  it('中身が縮んで一番下に押し戻されただけなら、動かしたことにしない', () => {
    expect(movedByOthers(300, 500, 300)).toBe(false)
  })
})

describe('openTarget: タブを閉じたときの位置', () => {
  const base = { savedFound: false, openPosition: 'unread' as const, unreadFrom: 1001, hasUnreadPost: false }
  it('全部読み終えたスレは、閉じたときの位置へ戻し、新着が届いたら未読の頭へ移れるようにしておく', () => {
    const closed = { no: 578, offset: -12 }
    expect(openTarget({ ...base, closed })).toEqual({ kind: 'saved', position: closed, pendingUnread: true })
  })
  it('閉じたときに一番下にいたなら一番下', () => {
    expect(openTarget({ ...base, closed: { no: 990, offset: 0, bottom: true } })).toEqual({ kind: 'bottom', pendingUnread: true })
  })
  it('未読があれば未読の頭を優先する', () => {
    expect(openTarget({ ...base, unreadFrom: 701, hasUnreadPost: true, closed: { no: 578, offset: 0 } })).toEqual({ kind: 'unread', no: 701 })
  })
  it('開く位置を一番下にしている人は、閉じたときの位置を使わない', () => {
    expect(openTarget({ ...base, openPosition: 'bottom', closed: { no: 578, offset: 0 } })).toEqual({ kind: 'bottom', pendingUnread: false })
  })
})

describe('PositionMemory', () => {
  it('スレごとに覚え、多すぎたら古いものから捨てる', () => {
    const m = new PositionMemory(2)
    m.set('a', { no: 1, offset: 0 })
    m.set('b', { no: 2, offset: 0 })
    m.set('a', { no: 3, offset: 0 })
    m.set('c', { no: 4, offset: 0 })
    expect(m.get('b')).toBeUndefined()
    expect(m.get('a')?.no).toBe(3)
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
