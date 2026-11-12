import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import {
  HeightCache,
  PositionMemory,
  anchorCorrection,
  anchorShift,
  centerOffset,
  displayText,
  displayUnits,
  estimatePostHeight,
  heightKind,
  heightOffsets,
  movedByOthers,
  newPostsTarget,
  openTarget,
  postShape,
  readProgress,
  contiguousRead,
  settleDone,
  staggerDelays,
  type PostRect,
  type ScrollPosition,
} from '../src/utils/threadScroll'


describe('openTarget: 開いたときの行き先', () => {
  const base = { savedFound: false, openPosition: 'unread' as const, unreadFrom: 1, hasUnreadPost: false }

  it('初めて開いたスレは先頭', () => {
    expect(openTarget(base)).toEqual({ kind: 'top' })
  })

  it('ログを消したスレを開き直すと、覚えた位置がなく既読も 0 なので先頭', () => {
    expect(openTarget({ ...base, saved: undefined, closed: undefined, unreadFrom: 1, hasUnreadPost: true })).toEqual({ kind: 'top' })
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

  describe('タブを閉じたときの位置', () => {
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

  // スマホ版 ThreadScrollTest と同じ場面
  describe('同期で既読が進んだとき', () => {
    const base = { savedFound: true, openPosition: 'unread' as const }
    const open = (saved: ScrollPosition | undefined, savedFound: boolean, readNo: number, hasUnreadPost: boolean) =>
      openTarget({ ...base, saved, savedFound, readNo, unreadFrom: readNo + 1, hasUnreadPost })

    it('覚えたときより既読が先なら、既読の次から', () => {
      expect(open({ no: 95, offset: 0, readNo: 100 }, true, 200, true)).toEqual({ kind: 'unread', no: 201 })
    })
    it('既読の次がまだ手元になければ、一番下で新着を待つ', () => {
      expect(open({ no: 95, offset: 0, readNo: 100 }, true, 200, false)).toEqual({ kind: 'bottom', pendingUnread: true })
    })
    it('覚えたときの既読が今と同じなら覚えた位置', () => {
      const saved = { no: 95, offset: -12, readNo: 100 }
      expect(open(saved, true, 100, true)).toEqual({ kind: 'saved', position: saved })
    })
    it('覚えた位置の方が先(既読の書き込みが追いついていない)なら覚えた位置', () => {
      const saved = { no: 115, offset: 0, readNo: 120 }
      expect(open(saved, true, 100, true)).toEqual({ kind: 'saved', position: saved })
    })
    it('どちらもなければ先頭', () => {
      expect(open(undefined, false, 0, false)).toEqual({ kind: 'top' })
    })
    it('覚えた位置のレスが手元にない(ログを取り直した)なら既読の次', () => {
      expect(open({ no: 500, offset: 0, readNo: 500 }, false, 500, true)).toEqual({ kind: 'unread', no: 501 })
    })
    it('覚えた位置が見つからず既読も 0 なら先頭', () => {
      expect(open({ no: 500, offset: 0, readNo: 500 }, false, 0, false)).toEqual({ kind: 'top' })
    })
    it('既読を添えていない古い覚えはそのまま使う', () => {
      const saved = { no: 95, offset: 0 }
      expect(open(saved, true, 200, true)).toEqual({ kind: 'saved', position: saved })
    })
    it('閉じたときの位置も、既読が進んでいれば使わない', () => {
      const closed = { no: 578, offset: 0, readNo: 1000 }
      expect(openTarget({ ...base, savedFound: false, closed, readNo: 1200, unreadFrom: 1201, hasUnreadPost: false })).toEqual({ kind: 'bottom', pendingUnread: true })
      expect(openTarget({ ...base, savedFound: false, closed, readNo: 1000, unreadFrom: 1001, hasUnreadPost: false })).toEqual({ kind: 'saved', position: closed, pendingUnread: true })
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

  it('同期で既読が手元のレスより先なら、新着の頭は既読の次', () => {
    expect(newPostsTarget({ ...base, opening: true, readNo: 200 })).toEqual({ no: 201, animate: false })
    expect(newPostsTarget({ ...base, readNo: 200 })).toEqual({ no: 201, animate: true })
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

describe('contiguousRead: ツリー表示の既読(1 番から途切れずに出し終えた所まで)', () => {
  const nos = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  it('後ろの番号の返信が先に見えても、間を読むまでは飛ばさない', () => {
    expect(contiguousRead(nos, 0, new Set([1, 9, 2]))).toBe(2)
  })
  it('間を出し終えたら、先に見えていた分までまとめて進む', () => {
    expect(contiguousRead(nos, 0, new Set([1, 9, 2, 3, 4, 5, 6, 7, 8]))).toBe(9)
  })
  it('前の既読から続ける(既読までは出していなくてよい)', () => {
    expect(contiguousRead(nos, 5, new Set([6, 8]))).toBe(6)
    expect(contiguousRead(nos, 5, new Set([8]))).toBe(5)
  })
  it('取れていない番号(飛び)は数えない', () => {
    expect(contiguousRead([1, 2, 5, 6], 0, new Set([1, 2, 5]))).toBe(5)
  })
  it('何も出していなければ既読のまま', () => {
    expect(contiguousRead(nos, 3, new Set())).toBe(3)
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

  describe('高さを決める条件', () => {
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

describe('anchorShift: 基準のレスを戻す scrollTop(ブラウザが先に詰めたときも二重に戻さない)', () => {
  it('上のレスが伸びたら、いまの scrollTop に伸びた分を足す', () => {
    expect(anchorShift({ y: 5000, scrollTop: 4800 }, { y: 5060, scrollTop: 4800, maxScrollTop: 9000 })).toBe(4860)
  })
  it('上のレスが縮んだら、縮んだ分だけ引く', () => {
    expect(anchorShift({ y: 5000, scrollTop: 4800 }, { y: 4970, scrollTop: 4800, maxScrollTop: 9000 })).toBe(4770)
  })
  it('変わっていなければ直さない', () => {
    expect(anchorShift({ y: 5000, scrollTop: 4800 }, { y: 5000.3, scrollTop: 4800, maxScrollTop: 9000 })).toBeUndefined()
  })
  it('利用者がスクロールしていても、高さの変化の分だけ直す', () => {
    expect(anchorShift({ y: 5000, scrollTop: 4800 }, { y: 5050, scrollTop: 5100, maxScrollTop: 9000 })).toBe(5150)
  })
  it('一番下で中身が縮み、ブラウザが scrollTop を詰めていたら、覚えた scrollTop から縮んだ分を引く(二重に戻らない)', () => {
    // 130053 の中身で一番下(129427)にいた。中身が 110239 に縮んでブラウザが 109613 に詰め、基準のレスは 19900 上へ動いた
    const to = anchorShift({ y: 129500, scrollTop: 129427 }, { y: 109600, scrollTop: 109613, maxScrollTop: 109613 })
    expect(to).toBe(109527)
  })
  it('一番下にいて中身が縮んだが、基準のレスが動いていなければ直さない(下だけが縮んだ)', () => {
    expect(anchorShift({ y: 129500, scrollTop: 129427 }, { y: 129500, scrollTop: 129000, maxScrollTop: 129000 })).toBeUndefined()
  })
  it('答えは 0 と一番下の間に収める', () => {
    expect(anchorShift({ y: 100, scrollTop: 50 }, { y: 20, scrollTop: 50, maxScrollTop: 9000 })).toBe(0)
    expect(anchorShift({ y: 100, scrollTop: 8990 }, { y: 200, scrollTop: 8990, maxScrollTop: 9000 })).toBe(9000)
  })
})

describe('centerOffset: 飛んだレスを見える範囲の真ん中に置く', () => {
  it('レスの真ん中が見える範囲の真ん中に来る位置', () => {
    // 高さ 600 の領域に 100 のレス → 頭は 250
    expect(centerOffset(600, 100)).toBe(250)
  })
  it('ヘッダーがスクロール領域の中にあれば、その下の範囲で真ん中にする', () => {
    expect(centerOffset(700, 100, 100)).toBe(350)
  })
  it('レスが見える範囲より高ければ、頭を上(ヘッダーの下)に置く', () => {
    expect(centerOffset(600, 900)).toBe(0)
    expect(centerOffset(700, 900, 100)).toBe(100)
  })
  it('ちょうど同じ高さなら頭を上に', () => {
    expect(centerOffset(600, 600)).toBe(0)
  })
})

describe('displayUnits: 描いたときの 1 行の字の数', () => {
  const urls = { shorten: true, omitImages: true, collapseImageRuns: true }
  it('全角は 1、半角は 0.5', () => {
    expect(displayUnits('あいう')).toBe(3)
    expect(displayUnits('abcd')).toBe(2)
  })
  it('URL は短く出す設定なら shortUrl の長さ(36 字 + …)で数える', () => {
    const long = 'https://example.com/' + 'a'.repeat(80)
    expect(displayUnits(long)).toBe(long.length / 2)
    expect(displayUnits(long, urls)).toBe((35 + 1) / 2 + 0.5)
  })
  it('画像の URL は「画像」の札として数える', () => {
    // 「見て 」(2.5)+「画像」の札(2 + 空き 1)
    expect(displayUnits('見て https://i.imgur.com/abc.jpg', urls)).toBe(2.5 + 3)
  })
  it('続いた画像の札は 1 つにまとまる', () => {
    const two = displayUnits('https://i.imgur.com/a.jpg https://i.imgur.com/b.jpg', urls)
    const one = displayUnits('https://i.imgur.com/a.jpg', urls)
    expect(two).toBe(one)
  })
  it('改行だけを挟んで続いた画像の URL も 1 つの札にまとまる(行が減る)', () => {
    const body = '6 枚\nhttps://i.imgur.com/a.jpg\nhttps://i.imgur.com/b.jpg\nhttps://i.imgur.com/c.jpg'
    expect(displayText(body, urls)).toBe('6 枚\n画像　')
    expect(displayText(body, { ...urls, collapseImageRuns: false }).split('\n')).toHaveLength(4)
  })
  it('設定がなければそのまま数える', () => {
    expect(displayUnits('https://i.imgur.com/abc.jpg')).toBe('https://i.imgur.com/abc.jpg'.length / 2)
  })
})

describe('estimatePostHeight: AA と描くときの本文', () => {
  const m = { charsPerLine: 20, lineHeight: 26, aaLineHeight: 18, chrome: 40, thumbRow: 88, linkPreview: 88, showThumbnails: true }
  const post = (body: string): Post => ({ no: 1, name: '', mail: '', date: '', body })
  it('AA は折り返さず、AA の行の高さで数える', () => {
    const aa = '　　　∧＿∧　　　　　　　　　　　　　　　　　　　　　　　　　　　\n　　（　´∀｀）     ＜　長い行でも折り返さない'
    expect(estimatePostHeight(post(aa), m)).toBe(40 + 2 * 18)
  })
  it('描くときの本文(空行を整えたもの)を渡せば、その行数で数える', () => {
    const p = post('a\n\n\n\n\nb')
    expect(estimatePostHeight(p, m, 'a\n\nb')).toBe(40 + 3 * 26)
  })
  it('URL を短く出す設定では、長い URL の行も 1 行と数える', () => {
    const p = post('https://example.com/' + 'a'.repeat(60))
    expect(estimatePostHeight(p, m)).toBe(40 + 2 * 26)
    expect(estimatePostHeight(p, { ...m, urls: { shorten: true, omitImages: false, collapseImageRuns: false } })).toBe(40 + 1 * 26)
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

  it('捨てたスレは覚えていない', () => {
    const m = new PositionMemory()
    m.set('a', { no: 1, offset: 0 })
    m.delete('a')
    expect(m.get('a')).toBeUndefined()
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
