import { describe, expect, it } from 'vitest'
import { measurePost } from '../src/utils/postLimit'

// 全角を 2、ほかを 1 と数える簡単な数え方
const bytes = (s: string) => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0)

describe('measurePost', () => {
  it('上限の中なら何も言わない', () => {
    expect(measurePost({ body: 'あいう\nえお' }, { messageBytes: 100, lines: 4 }, bytes)).toEqual({ messageBytes: 11, lines: 2, over: [] })
  })

  it('本文のバイト数・行数・スレタイの長さを超えたら知らせる', () => {
    const m = measurePost({ body: 'あ\nい\nう', subject: 'スレタイ' }, { messageBytes: 4, lines: 2, subjectBytes: 6 }, bytes)
    expect(m.over).toHaveLength(3)
  })

  it('上限が分からなければ数えるだけ', () => {
    expect(measurePost({ body: 'abc' }, undefined, bytes)).toEqual({ messageBytes: 3, lines: 1, over: [] })
  })
})
