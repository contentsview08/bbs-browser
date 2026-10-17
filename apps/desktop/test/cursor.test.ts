import { describe, expect, it } from 'vitest'
import { followDelta, isDoublePress, isNear, isSeen, keepCursorOnNew, pickAfterPage, stepCursor } from '../src/utils/cursor'

// 画面: ヘッダーの下 100 から 500 まで(高さ 400)
const view = { top: 100, bottom: 500 }
/** 高さ 50 のものを、top から並べる */
const rows = (n: number, top = 0) => Array.from({ length: n }, (_, i) => ({ top: top + i * 50, bottom: top + i * 50 + 50 }))

describe('isSeen / isNear: 見えているか・近いか', () => {
  it('端の 4px だけなら見えていない', () => {
    expect(isSeen({ top: 0, bottom: 103 }, view)).toBe(false)
    expect(isSeen({ top: 0, bottom: 110 }, view)).toBe(true)
    expect(isSeen({ top: 497, bottom: 600 }, view)).toBe(false)
  })
  it('1 画面分の外までは近い(押し続けて送るのが遅れているだけ)', () => {
    expect(isNear({ top: 520, bottom: 570 }, view)).toBe(true)
    expect(isNear({ top: 950, bottom: 1000 }, view)).toBe(false)
  })
})

describe('stepCursor: J・K で次に選ぶもの', () => {
  const base = { count: 10, current: 3, onScreen: true, hidden: false, d: 1 as const, seen: [2, 3, 4, 5] }
  it('見えていれば次・前。端で止まる', () => {
    expect(stepCursor(base)).toBe(4)
    expect(stepCursor({ ...base, d: -1 })).toBe(2)
    expect(stepCursor({ ...base, current: 9 })).toBe(9)
    expect(stepCursor({ ...base, current: 0, d: -1 })).toBe(0)
  })
  it('画面から離れていたら、見えている所から選び直す(J は一番上、K は一番下)', () => {
    expect(stepCursor({ ...base, onScreen: false })).toBe(2)
    expect(stepCursor({ ...base, onScreen: false, d: -1 })).toBe(5)
  })
  it('まだ選んでいなければ、新着の頭から。なければ見えている一番上', () => {
    expect(stepCursor({ ...base, current: -1, onScreen: false, startAt: 7 })).toBe(7)
    expect(stepCursor({ ...base, current: -1, onScreen: false })).toBe(2)
  })
  it('Esc 2 回で隠していたら、最初の 1 回は動かさない。離れていたら選び直す', () => {
    expect(stepCursor({ ...base, hidden: true })).toBe('stay')
    expect(stepCursor({ ...base, hidden: true, onScreen: false })).toBe(2)
  })
  it('何も並んでいなければ何もしない', () => {
    expect(stepCursor({ ...base, count: 0 })).toBeUndefined()
  })
})

describe('followDelta: 選んだものを見せるために送る量', () => {
  it('見えていて余白の内なら送らない', () => {
    expect(followDelta({ top: 200, bottom: 250 }, view, 1)).toBe(0)
  })
  it('下へ進むときは、下から 1/4 の所に来たら送り始める', () => {
    // 余白は 400 の 1/4 = 100。下の限り 400 を 20 越えている
    expect(followDelta({ top: 370, bottom: 420 }, view, 1)).toBe(20)
    // 上へ進むときは下の余白を見ないので、まだ送らない
    expect(followDelta({ top: 370, bottom: 420 }, view, -1)).toBe(0)
  })
  it('上へ進むときは、上から 1/4 の所に来たら戻し始める', () => {
    expect(followDelta({ top: 180, bottom: 230 }, view, -1)).toBe(-20)
  })
  it('画面より高いものは、頭をヘッダーのすぐ下に合わせる', () => {
    expect(followDelta({ top: 300, bottom: 1000 }, view, 1)).toBe(196)
  })
})

describe('pickAfterPage: 1 画面送ったあとに選ぶもの', () => {
  const items = rows(20)
  it('同じ高さにあるもの(送った量だけずらした所)', () => {
    // y=110 は 2 番目(100〜150)。400 送ると 510 → 10 番目(500〜550)
    expect(pickAfterPage(items, 110, 400, 1)).toBe(10)
  })
  it('送れなかったら端のもの', () => {
    expect(pickAfterPage(items, 110, 0, 1)).toBe(19)
    expect(pickAfterPage(items, 110, 0, -1)).toBe(0)
  })
  it('並びの外に出たら端のもの', () => {
    expect(pickAfterPage(items, 110, 5000, 1)).toBe(19)
  })
})

describe('isDoublePress / keepCursorOnNew', () => {
  it('間隔の内なら 2 回押し', () => {
    expect(isDoublePress(1000, 1400, 500)).toBe(true)
    expect(isDoublePress(1000, 1600, 500)).toBe(false)
  })
  it('一番下まで読んでいたら残し、それより前なら忘れる', () => {
    expect(keepCursorOnNew(100, 101)).toBe(100)
    expect(keepCursorOnNew(50, 101)).toBeUndefined()
    expect(keepCursorOnNew(undefined, 101)).toBeUndefined()
  })
})
