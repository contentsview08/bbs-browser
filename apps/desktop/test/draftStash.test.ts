import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stashGet, stashSet } from '../src/utils/draftStash'

const KEY = 'bbs:drafts'
let data: Map<string, string>
let fail = false

beforeEach(() => {
  data = new Map()
  fail = false
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail) throw new Error('quota')
      data.set(k, v)
    },
  })
})

describe('書きかけの置き場', () => {
  it('書いたものを読める', () => {
    stashSet('a', 'あ')
    expect(stashGet('a')).toBe('あ')
    expect(JSON.parse(data.get(KEY)!).a.v).toBe('あ')
  })
  it('別のウィンドウが書いた分も読め、上書きで消さない', () => {
    stashSet('a', 'あ')
    data.set(KEY, JSON.stringify({ a: { v: 'あ', t: 1 }, b: { v: 'い', t: 2 } }))
    expect(stashGet('b')).toBe('い')
    stashSet('c', 'う')
    expect(Object.keys(JSON.parse(data.get(KEY)!)).sort()).toEqual(['a', 'b', 'c'])
  })
  it('書けなかったものは覚えていることにしない', () => {
    stashSet('a', 'あ')
    fail = true
    stashSet('b', 'い')
    expect(stashGet('b')).toBeUndefined()
    expect(stashGet('a')).toBe('あ')
  })
})
