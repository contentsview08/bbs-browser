import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import { countAnchors, countHeat } from '../src/utils/postBody'

const post = (no: number, body: string, id?: string, name = '名無し'): Post => ({ no, name, mail: '', date: '', id, body })

describe('人気の判定に使う被アンカー数(countHeat)', () => {
  it('同じ ID から何度アンカーを付けられても 1 と数える(見せる数はそのまま)', () => {
    const posts = [post(1, '元', 'AAA'), post(2, '>>1', 'BBB'), post(3, '>>1 また', 'BBB'), post(4, '>>1 さらに', 'BBB')]
    expect(countAnchors(posts).get(1)).toBe(3)
    expect(countHeat(posts).get(1)).toBe(1)
  })
  it('アンカー先を書いた本人からのアンカーは数えない', () => {
    const posts = [post(1, '元', 'AAA'), post(2, '>>1 自分で補足', 'AAA'), post(3, '>>1', 'BBB'), post(4, '>>1', 'CCC')]
    expect(countAnchors(posts).get(1)).toBe(3)
    expect(countHeat(posts).get(1)).toBe(2)
  })
  it('ID がなければワッチョイで同じ人と見る', () => {
    const w = (no: number, body: string, w: string) => post(no, body, undefined, `名無し (ワッチョイ ${w})`)
    const posts = [w(1, '元', '1a2b-3c4d'), w(2, '>>1', '1a2b-3c4d'), w(3, '>>1', 'ffff-0000'), w(4, '>>1', 'ffff-0000')]
    expect(countHeat(posts).get(1)).toBe(1)
  })
  it('ID もワッチョイもないレスは別の人として 1 つずつ数える', () => {
    const posts = [post(1, '元'), post(2, '>>1'), post(3, '>>1'), post(4, '>>1')]
    expect(countHeat(posts).get(1)).toBe(3)
  })
  it('1 つのレスの中に同じアンカーが 2 回あっても 1', () => {
    const posts = [post(1, '元', 'AAA'), post(2, '>>1 >>1', 'BBB')]
    expect(countHeat(posts).get(1)).toBe(1)
  })
})
