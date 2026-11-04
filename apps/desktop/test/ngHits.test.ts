import { describe, expect, it } from 'vitest'
import { newRule, ngHitsOf } from '../src/utils/ng'

const post = { no: 1, name: '名無し', mail: '', date: '', id: 'abc', body: '今日はいい天気' }

describe('レスに当たっている NG', () => {
  it('種類ごとに返し、当たらない NG は入れない', () => {
    const id = newRule('posterId', 'abc')
    const name = newRule('posterName', '名無し')
    const word = newRule('content', '天気')
    const other = newRule('content', '雨')
    const r = ngHitsOf([id, name, word, other], post)
    expect(r.posterId).toEqual([id])
    expect(r.posterName).toEqual([name])
    expect(r.content).toEqual([word])
  })

  it('別の板だけの NG と、切ってある NG は当たらない', () => {
    const elsewhere = newRule('posterId', 'abc', { boardUrl: 'https://example.com/a/' })
    const off = newRule('content', '天気', { enabled: false })
    const r = ngHitsOf([elsewhere, off], post, 'https://example.com/b/')
    expect(r.posterId).toEqual([])
    expect(r.content).toEqual([])
    expect(ngHitsOf([elsewhere], post, 'https://example.com/a/').posterId).toEqual([elsewhere])
  })
})
