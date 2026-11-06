import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import { aiTextOf, hypothesisOf, judgeAiNg, predictRule, setOverride, trainRule, trainRules, type AiNgRule } from '../src/utils/aiNg'

const post = (no: number, body: string): Post => ({ no, name: '', mail: '', date: '', body })
const rule = (o: Partial<AiNgRule> = {}): AiNgRule => ({ id: 'r', name: '煽り', prompt: '他人を煽っている', threshold: 0.8, show: 'fold', enabled: true, ...o })

describe('AI NG の決め方', () => {
  it('仮説は条件の文に句点を付けただけ', () => {
    expect(hypothesisOf('他人を煽っている。')).toBe('他人を煽っている。')
    expect(hypothesisOf(' 政治の話 ')).toBe('政治の話。')
  })
  it('本文はアンカーの行と URL を除く', () => {
    expect(aiTextOf('>>12\nありがとう https://example.com/a')).toBe('ありがとう')
    expect(aiTextOf('>>3')).toBe('')
    expect(aiTextOf('>>3 死ね\n＞＞4 ばか')).toBe('死ね ばか')
  })
  it('境目以上の当たり具合で当たる。まだ出ていなければ当てない', () => {
    const posts = [post(1, 'あ'), post(2, 'い'), post(3, 'う')]
    const scores: Record<string, number> = { あ: 0.9, い: 0.5 }
    const r = judgeAiNg(posts, [rule()], (b) => scores[b], {})
    expect([...r.keys()]).toEqual([1])
    expect(r.get(1)!.p).toBe(0.9)
  })
  it('手の印は判定より先: 当たらないは外し、当たるは当てる', () => {
    const posts = [post(1, 'あ'), post(2, 'い')]
    let o = setOverride({}, 'r', 'あ', 'miss')
    o = setOverride(o, 'r', 'い', 'hit')
    const r = judgeAiNg(posts, [rule()], () => 0.99, o)
    expect(r.has(1)).toBe(false)
    expect(r.get(2)!.manual).toBe(true)
    // 外せば元に戻る
    const back = judgeAiNg(posts, [rule()], () => 0.99, setOverride(o, 'r', 'あ', null))
    expect(back.has(1)).toBe(true)
  })
  it('いくつも当たったら、強い見せ方(隠す > 畳む > 印だけ)を使う', () => {
    const rules = [rule({ id: 'a', show: 'mark' }), rule({ id: 'b', show: 'hide' }), rule({ id: 'c', show: 'fold' })]
    expect(judgeAiNg([post(1, 'あ')], rules, () => 0.95, {}).get(1)!.rule.id).toBe('b')
  })
  it('印が 3 件ずつそろうと学び、当たるものに近い文を高く出す', () => {
    let o = {}
    for (const t of ['情弱乙ｗｗ', 'お前ほんと頭悪いなｗ', '底辺乙ｗｗｗ']) o = setOverride(o, 'r', t, 'hit')
    for (const t of ['ラーメン食べたい', '今日は雨だった', '試合おもしろかった']) o = setOverride(o, 'r', t, 'miss')
    const ex = (o as Record<string, { examples: { text: string; hit: boolean }[] }>).r.examples
    expect(trainRule(ex.slice(0, 5))).toBeUndefined()
    const m = trainRule(ex)!
    expect(predictRule(m, 'ほんと情弱乙ｗｗ')).toBeGreaterThan(predictRule(m, 'ラーメンおいしかった'))
  })
})

describe('印から学ぶ判定の使い回し', () => {
  const examples = ['情弱乙', 'ばかじゃねえの', 'お前ら無能', 'おいしかった', 'ありがとう', '今日は晴れ'].map((text, i) => ({ text, hit: i < 3 }))
  it('印の並びが同じなら学び直さず、新しい並びなら学び直す', () => {
    const r = rule()
    const a = trainRules([r], { r: { hit: [], miss: [], examples } }).get('r')!
    expect(trainRules([r], { r: { hit: [], miss: [], examples } }).get('r')).toBe(a)
    expect(trainRules([r], { r: { hit: [], miss: [], examples: [...examples] } }).get('r')).not.toBe(a)
  })
  it('覚えた結果も同じ値', () => {
    const m = trainRule(examples)!
    expect(predictRule(m, 'ばか')).toBe(predictRule(m, 'ばか'))
  })
})
