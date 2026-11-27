import { beforeEach, describe, expect, it } from 'vitest'
import { clearConditionalCache } from '../src/conditional'
import { twoChConnector } from '../src/twoch/connector'
import type { ConnectorContext, HttpResponse } from '../src/types'

/** 送られた GET のヘッダーを記録し、用意した応答を順に返す */
function fake(responses: Partial<HttpResponse>[]) {
  const sent: { url: string; headers: Record<string, string> }[] = []
  const ctx: ConnectorContext = {
    decode: (b, e) => new TextDecoder(e).decode(b),
    http: {
      async get(url, opts) {
        sent.push({ url, headers: opts?.headers ?? {} })
        const r = responses[Math.min(sent.length - 1, responses.length - 1)]
        return { status: r.status ?? 200, headers: r.headers ?? {}, body: r.body ?? new Uint8Array() }
      },
      post: async () => {
        throw new Error('post は使わない')
      },
    },
  }
  return { ctx, sent }
}
const subject = new TextEncoder().encode('1700000000.dat<>テスト (12)\n')
const board = { connectorId: '2ch-compat', url: 'https://bbs.example.test/news/', name: '' }

describe('スレ一覧の条件付きの取得', () => {
  beforeEach(() => clearConditionalCache())

  it('前の応答の Last-Modified と ETag を次に付け、304 なら前の一覧を返す', async () => {
    const { ctx, sent } = fake([
      { status: 200, headers: { 'last-modified': 'Thu, 27 Nov 2026 00:00:00 GMT', etag: '"abc"', 'content-type': 'text/plain; charset=UTF-8' }, body: subject },
      { status: 304, headers: {} },
    ])
    const first = await twoChConnector.listThreads(board, ctx)
    expect(sent[0].headers).toEqual({})
    const second = await twoChConnector.listThreads(board, ctx)
    expect(sent[1].headers).toEqual({ 'If-Modified-Since': 'Thu, 27 Nov 2026 00:00:00 GMT', 'If-None-Match': '"abc"' })
    expect(second).toEqual(first)
    expect(second[0].postCount).toBe(12)
  })

  it('検証の値がない応答は覚えず、次も条件なしで取る', async () => {
    const { ctx, sent } = fake([{ status: 200, headers: { 'content-type': 'text/plain; charset=UTF-8' }, body: subject }])
    await twoChConnector.listThreads(board, ctx)
    await twoChConnector.listThreads(board, ctx)
    expect(sent[1].headers).toEqual({})
  })

  it('同じ一覧を同時に頼んでも通信は 1 本', async () => {
    const { ctx, sent } = fake([{ status: 200, headers: { 'content-type': 'text/plain; charset=UTF-8' }, body: subject }])
    const [a, b] = await Promise.all([twoChConnector.listThreads(board, ctx), twoChConnector.listThreads(board, ctx)])
    expect(sent.length).toBe(1)
    expect(a).toEqual(b)
  })

  it('304 が来ても前の応答を覚えていなければ(別の経路で消えた)、そのまま断る', async () => {
    const { ctx } = fake([{ status: 304, headers: {} }])
    await expect(twoChConnector.listThreads(board, ctx)).rejects.toThrow()
  })
})
