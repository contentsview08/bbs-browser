import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import { EMPTY_MARKS, bodyKey, distinctRatio, judgeAutoNg, normalizeBody } from '../src/utils/autoNg'

const post = (no: number, body: string): Post => ({ no, name: '名無し', mail: '', date: '', body })
const spam = 'しゃあっ頑張れ頑張れ' + 'がんばれ'.repeat(2) + 'これは六十文字を超えるように長くした、同じ文を何度も貼り付ける荒らしの本文の例です。'

describe('normalizeBody / bodyKey: 比べるための本文', () => {
  it('アンカーだけの行と空白は除く(同じ文を別のレスへ向けて貼るので)', () => {
    expect(normalizeBody('>>12\n>>34\nこんにちは 世界')).toBe('こんにちは世界')
    expect(bodyKey('>>1\n同じ文')).toBe(bodyKey('>>99\n同じ 文'))
    expect(bodyKey('同じ文')).not.toBe(bodyKey('違う文'))
  })
})

describe('distinctRatio: 繰り返しの多さ', () => {
  it('繰り返しばかりの文は小さく、普通の文は大きい', () => {
    expect(distinctRatio('死ね'.repeat(60))).toBeLessThan(0.05)
    expect(distinctRatio('ガチで詳しい分野を語りたくてもついて来れる奴が居ないから悲しくなるんよな')).toBeGreaterThan(0.9)
  })
})

describe('judgeAutoNg: 決まりと印で荒らしを決める', () => {
  it('同じスレで同じ長い本文が 3 回以上なら荒らし', () => {
    const posts = [post(1, '1 です'), post(2, `>>1\n${spam}`), post(3, `>>2\n${spam}`), post(4, spam), post(5, '普通のレス')]
    const r = judgeAutoNg(posts, EMPTY_MARKS)
    expect([...r.keys()]).toEqual([2, 3, 4])
    expect(r.get(2)).toEqual({ kind: 'dup', count: 3 })
  })
  it('短い叫び(実況の「エラーエラー…」)は、何回あっても荒らしにしない', () => {
    const shout = 'エラー'.repeat(19)
    const r = judgeAutoNg([post(1, shout), post(2, shout), post(3, shout), post(4, shout)], EMPTY_MARKS)
    expect(r.size).toBe(0)
  })
  it('100 文字以上の繰り返しは 1 回でも荒らし', () => {
    const r = judgeAutoNg([post(1, '死ね'.repeat(60)), post(2, '死ね死ね')], EMPTY_MARKS)
    expect(r.get(1)).toEqual({ kind: 'repeat' })
    expect(r.has(2)).toBe(false)
  })
  it('「荒らしじゃない」の印は決まりより強く、「荒らし」の印は 1 回でも効く', () => {
    const marks = { troll: new Set([bodyKey('宣伝の貼り付け')]), notTroll: new Set([bodyKey('死ね'.repeat(60))]) }
    const r = judgeAutoNg([post(1, '死ね'.repeat(60)), post(2, '>>1\n宣伝の貼り付け'), post(3, '普通')], marks)
    expect(r.has(1)).toBe(false)
    expect(r.get(2)).toEqual({ kind: 'marked' })
    expect(r.has(3)).toBe(false)
  })
})
