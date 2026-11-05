// 5ch.net の板・スレを、偽の応答で確かめる(本物の掲示板には送らない)
import { describe, expect, it } from 'vitest'
import { twoChConnector } from '../src/twoch/connector'
import type { Board, ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

const res = (text: string, status = 200): HttpResponse => ({ status, headers: {}, body: new TextEncoder().encode(text) })

function fake(getBody: (url: string) => HttpResponse = () => res('1700000000.dat<>スレ (1)\n')) {
  const gets: string[] = []
  const posts: { url: string; body: string; referer?: string }[] = []
  const ctx: ConnectorContext = {
    http: {
      get: async (url) => {
        gets.push(url)
        return getBody(url)
      },
      post: async (url, body, opts) => {
        posts.push({ url, body: String(body), referer: opts?.headers?.Referer })
        return res('<html><title>書きこみました</title></html>')
      },
    },
    decode: (bytes) => new TextDecoder().decode(bytes),
  }
  return { ctx, gets, posts }
}

const netBoard: Board = { connectorId: '2ch-compat', url: 'https://eagle.5ch.net/x/', name: 'x' }
const netThread: ThreadSummary = { connectorId: '2ch-compat', boardUrl: 'https://eagle.5ch.net/x/', key: '1700000000', title: '', postCount: 0, order: 0 }
const input = { name: '', mail: '', body: 'a\nb' }

describe('保存済みの 5ch.net の板・スレ', () => {
  it('スレ一覧は 5ch.io へ取りに行き、スレは今の板の URL のまま返す', async () => {
    const { ctx, gets } = fake()
    const list = await twoChConnector.listThreads(netBoard, ctx)
    expect(gets).toEqual(['https://eagle.5ch.io/x/subject.txt'])
    expect(list[0].boardUrl).toBe('https://eagle.5ch.net/x/')
  })
  it('dat も 5ch.io へ取りに行く', async () => {
    const { ctx, gets } = fake(() => res('名無し<><>2026/01/01 ID:a<>本文<>スレタイ\n'))
    const r = await twoChConnector.fetchPosts(netThread, null, ctx)
    expect(gets).toEqual(['https://eagle.5ch.io/x/dat/1700000000.dat'])
    expect(r.posts).toHaveLength(1)
  })
  it('書き込みの送り先と Referer は 5ch.io で、改行は CR LF', async () => {
    const { ctx, posts } = fake()
    await twoChConnector.createPost!(netThread, input, ctx)
    expect(posts[0].url).toBe('https://eagle.5ch.io/test/bbs.cgi')
    expect(posts[0].referer).toBe('https://eagle.5ch.io/test/read.cgi/x/1700000000/')
    expect(posts[0].body).toContain('MESSAGE=a%0D%0Ab')
  })
  it('スレ立ての送り先と Referer も 5ch.io', async () => {
    const { ctx, posts } = fake()
    await twoChConnector.createThread!(netBoard, { ...input, title: 't' }, ctx)
    expect(posts[0].url).toBe('https://eagle.5ch.io/test/bbs.cgi')
    expect(posts[0].referer).toBe('https://eagle.5ch.io/x/')
  })
  it('書き込み確認の承諾で 5ch.net が来ても 5ch.io へ送る', async () => {
    const { ctx, posts } = fake()
    await twoChConnector.submitConfirm!({ url: 'https://eagle.5ch.net/test/bbs.cgi', fields: { a: 'b' }, referer: 'https://eagle.5ch.net/x/' }, ctx)
    expect(posts[0].url).toBe('https://eagle.5ch.io/test/bbs.cgi')
    expect(posts[0].referer).toBe('https://eagle.5ch.io/x/')
  })
  it('開くときの板の URL は 5ch.io に直す', () => {
    expect(twoChConnector.canonicalBoardUrl?.('https://eagle.5ch.net/x/')).toBe('https://eagle.5ch.io/x/')
    expect(twoChConnector.canonicalBoardUrl?.('https://bbs.eddibb.cc/x/')).toBe('https://bbs.eddibb.cc/x/')
  })
})

describe('resolveUrl', () => {
  it('5ch.net のスレは 5ch.io の板で確かめて開く', async () => {
    const { ctx, gets } = fake()
    const r = await twoChConnector.resolveUrl('https://eagle.5ch.net/test/read.cgi/x/1700000000/', ctx)
    expect(r?.board.url).toBe('https://eagle.5ch.io/x/')
    expect(r?.thread?.boardUrl).toBe('https://eagle.5ch.io/x/')
    expect(gets[0]).toBe('https://eagle.5ch.io/x/subject.txt')
  })
  it('スレが 0 件の板も開く', async () => {
    const { ctx } = fake((url) => (url.endsWith('subject.txt') ? res('') : res('BBS_TITLE=板の名前\n')))
    const r = await twoChConnector.resolveUrl('https://host.example/a/', ctx)
    expect(r?.board).toMatchObject({ url: 'https://host.example/a/', name: '板の名前' })
  })
  it('スレ一覧の形でなければ断る', async () => {
    const { ctx } = fake(() => res('<html></html>'))
    await expect(twoChConnector.resolveUrl('https://youtu.be/xxx', ctx)).rejects.toThrow('板ではない')
  })
  it('itest はページからサーバーを探す', async () => {
    const { ctx } = fake((url) => (url.includes('itest.') ? res('<a href="https://mercury.5ch.io/x/">x</a>') : res('')))
    const r = await twoChConnector.resolveUrl('https://itest.5ch.net/test/read.cgi/x/1700000000/', ctx)
    expect(r?.thread?.boardUrl).toBe('https://mercury.5ch.io/x/')
  })
})
