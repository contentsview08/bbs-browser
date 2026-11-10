import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import { buildPostTree, TREE_SHARED_MAX } from '../src/utils/postTree'
import { targetsOfPost } from '../src/utils/postBody'

/** 本文だけのレスを並べる(番号は 1 から) */
const posts = (...bodies: string[]): Post[] => bodies.map((body, i) => ({ no: i + 1, name: '', mail: '', date: '', body }) as Post)
/** 本物のアンカーの読み方(範囲・複数を広げる)でツリーを組む */
function tree(ps: Post[], o: { maxDepth?: number; gone?: number[] } = {}) {
  const byNo = new Map(ps.map((p) => [p.no, p]))
  const gone = new Set(o.gone ?? [])
  return buildPostTree(
    ps.map((p) => p.no),
    (no) => targetsOfPost(byNo.get(no)!),
    { maxDepth: o.maxDepth ?? 6, isGone: (no) => gone.has(no) },
  )
}
/** 行を「番号:深さ(重ねた分は *)」の文字にする(見比べやすく) */
const show = (t: ReturnType<typeof tree>) => t.rows.map((r) => `${r.no}:${r.depth}${r.dup ? '*' : ''}`).join(' ')

describe('buildPostTree: ツリーの並べ方', () => {
  it('アンカーのないレスは根、あるレスは最初のアンカー先の子(親の子の中では番号の順)', () => {
    const t = tree(posts('a', '>>1', 'b', '>>1', '>>2', '>>3'))
    expect(show(t)).toBe('1:0 2:1 5:2 4:1 3:0 6:1')
    expect(t.order).toEqual([1, 2, 5, 4, 3, 6])
  })
  it('親を覚える', () => {
    const t = tree(posts('a', '>>1', '>>2'))
    expect(t.rows.map((r) => r.parent)).toEqual([undefined, 1, 2])
  })
  it('範囲のアンカー(>>1-3)は 3 つ先として数え、最初の 1 を親にする', () => {
    const t = tree(posts('a', 'b', 'c', '>>1-3'))
    expect(show(t)).toBe('1:0 4:1 2:0 4:1* 3:0 4:1*')
  })
  it('複数のアンカー(>>1,2)も同じ', () => {
    const t = tree(posts('a', 'b', '>>1,2'))
    expect(show(t)).toBe('1:0 3:1 2:0 3:1*')
  })
  it('最初のアンカー先は本文に出てくる順(番号の小さい順ではない)', () => {
    const t = tree(posts('a', 'b', '>>2 >>1'))
    expect(show(t)).toBe('1:0 3:1* 2:0 3:1')
    expect(t.order).toEqual([1, 2, 3])
  })
  it(`アンカー先が ${TREE_SHARED_MAX + 1} つ以上なら、最初の親の下だけ`, () => {
    const t = tree(posts('a', 'b', 'c', 'd', '>>1 >>2 >>3 >>4'))
    expect(show(t)).toBe('1:0 5:1 2:0 3:0 4:0')
  })
  it('重ねて出した分には子を付けない(子は 1 回目の下だけ)', () => {
    const t = tree(posts('a', 'b', '>>1 >>2', '>>3'))
    expect(show(t)).toBe('1:0 3:1 4:2 2:0 3:1*')
  })
  it('同じ先へのアンカーが重なっても 1 つと数える', () => {
    const t = tree(posts('a', '>>1 >>1 >>1'))
    expect(show(t)).toBe('1:0 2:1')
  })
  it('自分より後ろ・自分・スレにない先へのアンカーは、ないものとして扱う(ほかになければ根)', () => {
    const t = tree(posts('>>3', '>>2', 'c', '>>99 >>1'))
    expect(show(t)).toBe('1:0 4:1 2:0 3:0')
  })
  it('あぼーんのレスへのアンカーは、ないものとして扱う。あぼーんのレス自身はふつうに並べる', () => {
    const t = tree(posts('a', '>>1', '>>2', '>>2 >>1'), { gone: [2] })
    expect(show(t)).toBe('1:0 2:1 4:1 3:0')
  })
  it('あぼーんのレス自身は、2 つ目からのアンカー先の下に重ねて出さない', () => {
    const t = tree(posts('a', 'b', '>>1 >>2'), { gone: [3] })
    expect(show(t)).toBe('1:0 3:1 2:0')
  })
  it('深さの上限を超えたら、上限の段のまま並べる(親子の順は保つ)', () => {
    const t = tree(posts('a', '>>1', '>>2', '>>3', '>>4', 'f', '>>5'), { maxDepth: 2 })
    expect(show(t)).toBe('1:0 2:1 3:2 4:2 5:2 7:2 6:0')
  })
  it('全部のレスが 1 回だけ order に入る', () => {
    const ps = posts(...Array.from({ length: 50 }, (_, i) => (i % 3 === 0 ? 'x' : `>>${Math.max(1, i - 2)} >>${i}`)))
    const t = tree(ps)
    expect([...t.order].sort((a, b) => a - b)).toEqual(ps.map((p) => p.no))
  })
  it('1000 レスの長い鎖でも止まらず、すぐ組める', () => {
    const ps = posts('a', ...Array.from({ length: 999 }, (_, i) => `>>${i + 1}`))
    const start = performance.now()
    const t = tree(ps, { maxDepth: 6 })
    expect(performance.now() - start).toBeLessThan(200)
    expect(t.order).toHaveLength(1000)
    expect(t.rows.at(-1)).toMatchObject({ no: 1000, depth: 6 })
  })
  it('1000 レスがみな >>1 と前のレスに付けても、手間はレスの数に比例する', () => {
    const ps = posts('a', ...Array.from({ length: 999 }, (_, i) => `>>1 >>${i + 1} >>${Math.max(1, i)}`))
    const start = performance.now()
    const t = tree(ps)
    expect(performance.now() - start).toBeLessThan(200)
    expect(t.order).toHaveLength(1000)
  })
})
