// sync-post.json を作る。スマホ版は同じ表を読んで比べる
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fitPostBody, hashLines, postIdOf } from '../src/index'

const url = new URL('../../conformance/sync-post.json', import.meta.url)
const BODIES: [string, string][] = [
  ['短い', '本文'],
  ['空', ''],
  ['4096 文字ちょうど', 'あ'.repeat(4096)],
  ['長い', 'あ'.repeat(5000)],
  ['絵文字の途中で切らない', `${'a'.repeat(4095)}😀😀`],
  ['制御文字は 6 バイト', '\u0001'.repeat(3000)],
  ['改行と引用符は 2 バイト', '\n"\\'.repeat(3000)],
  ['半端なサロゲート', `a\ud83db`],
]
const fresh = {
  posts: BODIES.map(([name, body]) => ({ name, board: 'a.5ch.io/x/', key: '123', posted_at: 1800000000000, body, cut_length: fitPostBody(body).length, post_id: postIdOf('a.5ch.io/x/', '123', 1800000000000, body) })),
  hash_lines: [
    { lines: [], hash: hashLines([]) },
    { lines: ['b', 'a', 'あ'], hash: hashLines(['b', 'a', 'あ']) },
  ],
}

describe('sync-post.json', () => {
  it('表と同じ', () => {
    if (process.env.SYNC_UPDATE_DIGESTS === '1' || !existsSync(url)) writeFileSync(url, `${JSON.stringify(fresh, null, 1)}\n`)
    expect(JSON.parse(readFileSync(url, 'utf-8'))).toEqual(JSON.parse(JSON.stringify(fresh)))
  })
})
