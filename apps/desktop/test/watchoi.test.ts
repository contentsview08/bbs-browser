import { describe, expect, it } from 'vitest'
import { countIconKeys, iconKeyOf, shortWatchoi, watchoiOf } from '../src/utils/watchoi'

const w = (name: string, id?: string) => ({ name, id })

describe('ワッチョイ', () => {
  it('名前からワッチョイを取り出し、短くする', () => {
    expect(watchoiOf('名無しさん (ワッチョイ 1a2b-3c4d)')).toBe('1a2b-3c4d')
    expect(watchoiOf('名無しさん (ワッチョイ 1a2b-3c4d [203.0.113.1])')).toBe('1a2b-3c4d')
    expect(watchoiOf('名無しさん')).toBeUndefined()
    expect(shortWatchoi('名無しさん (ワッチョイ 1a2b-3c4d [203.0.113.1])')).toBe('名無しさん (1a2b-3c4d)')
  })

  it('アイコンの鍵: 設定がオンならワッチョイ、なければ ID。オフならいつも ID', () => {
    expect(iconKeyOf(w('(ワッチョイ 1a2b-3c4d)', 'abc'), true)).toBe('1a2b-3c4d')
    expect(iconKeyOf(w('名無し', 'abc'), true)).toBe('abc')
    expect(iconKeyOf(w('(ワッチョイ 1a2b-3c4d)', 'abc'), false)).toBe('abc')
  })

  it('アイコンの数字: ID が違っても、同じワッチョイなら 1 人として数える', () => {
    const posts = [w('(ワッチョイ 1a2b-3c4d)', 'aaa'), w('(ワッチョイ 1a2b-3c4d)', 'bbb'), w('名無し', 'ccc')]
    expect(countIconKeys(posts, true).get('1a2b-3c4d')).toBe(2)
    expect(countIconKeys(posts, true).get('ccc')).toBe(1)
    expect(countIconKeys(posts, false).get('aaa')).toBe(1)
  })
})
