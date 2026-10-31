import { describe, expect, it } from 'vitest'
import { honoBbsConnector, formatDate } from '../src/honobbs/connector'
import { twoChConnector } from '../src/twoch/connector'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

// 見本は作り物(形は 2026-10 に hono-bbs の API で確かめたものに合わせた)
const WEB = 'https://bbs.example.com'
const API = 'https://api.example.com/api/v1'
const T1 = '6aefe762-1722-4b73-80f5-59db564142c7'
const enc = (o: unknown) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o))

function fake(routes: Record<string, { status?: number; body: unknown }>, posts: Record<string, { status?: number; body: unknown }> = {}) {
  const got: string[] = []
  const sent: { url: string; body: string; opts?: unknown }[] = []
  const ctx: ConnectorContext = {
    decode: (b) => new TextDecoder().decode(b),
    http: {
      async get(url): Promise<HttpResponse> {
        got.push(url)
        const r = routes[url]
        if (!r) return { status: 404, headers: {}, body: enc({ error: 'NOT_FOUND' }) }
        return { status: r.status ?? 200, headers: {}, body: enc(r.body) }
      },
      async post(url, body, opts): Promise<HttpResponse> {
        sent.push({ url, body: String(body), opts })
        const r = posts[url]
        if (!r) return { status: 500, headers: {}, body: enc({ error: 'X' }) }
        return { status: r.status ?? 200, headers: {}, body: enc(r.body) }
      },
    },
  }
  return { ctx, got, sent }
}

const page = `<html><head><meta name="bbs-api" content="${API}" /></head></html>`
const board = { connectorId: 'honobbs', url: `${WEB}/boards/livejupter/`, name: 'なんでも実況J' }
const thread: ThreadSummary = { connectorId: 'honobbs', boardUrl: board.url, key: T1, title: '', postCount: 0, order: 0 }
const post = (n: number, extra: Record<string, unknown> = {}) => ({
  postNumber: n, authorId: `id${n}`, posterName: '風吹けば名無し', posterOptionInfo: '', content: `本文${n}`, isDeleted: false, createdAt: '2026-09-19T19:02:29.239Z', ...extra,
})

describe('hono-bbs のコネクタ', () => {
  it('web の板・スレの URL を受け持ち、2ch 互換は受け持たない', () => {
    expect(honoBbsConnector.canHandle(`${WEB}/boards/livejupter/${T1}`)).toBe(true)
    expect(honoBbsConnector.canHandle(`${WEB}/boards/livejupter/`)).toBe(true)
    expect(honoBbsConnector.isThreadUrl!(`${WEB}/boards/livejupter/${T1}`)).toBe(true)
    expect(honoBbsConnector.canHandle('https://medaka.5ch.io/test/read.cgi/prog/1600000000/')).toBe(false)
    expect(twoChConnector.canHandle('https://medaka.5ch.io/prog/')).toBe(true)
  })

  it('日付は日本時間の 2ch の形にする', () => {
    expect(formatDate('2026-09-19T19:02:29.239Z')).toBe('2026/09/20(日) 04:02:29.239')
  })

  it('スレ一覧は 1 レス目から、のぞき・立てた人の ID・サムネイルを作る(API の場所は web のページの印から)', async () => {
    const { ctx, got } = fake({
      [`${WEB}/`]: { body: page },
      [`${API}/boards/livejupter/threads?limit=500`]: {
        body: {
          data: [
            { id: T1, boardId: 'livejupter', title: 'スレ一覧見にくい', postCount: 32, createdAt: '2026-09-19T19:02:29.239Z', firstPost: post(1, { content: '画像\nhttps://img.example.com/a.jpg' }) },
          ],
          nextCursor: null,
        },
      },
    })
    const list = await honoBbsConnector.listThreads(board, ctx)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ key: T1, title: 'スレ一覧見にくい', postCount: 32, authorId: 'id1', thumb: 'https://img.example.com/a.jpg' })
    expect(list[0].preview?.[0]).toMatchObject({ no: 1, body: '画像\nhttps://img.example.com/a.jpg' })
    expect(got[0]).toBe(`${WEB}/`)
  })

  it('レスは差分を続きの印(base64url)で取る。消されたレスはあぼーん', async () => {
    const { ctx, got } = fake({
      [`${WEB}/`]: { body: page },
      [`${API}/boards/livejupter/threads/${T1}`]: { body: { data: { id: T1, boardId: 'livejupter', title: 'スレタイ', postCount: 2, createdAt: '2026-09-19T19:02:29.239Z' } } },
      [`${API}/boards/livejupter/threads/${T1}/posts?limit=500`]: { body: { data: [post(1), post(2, { isDeleted: true, content: '', posterName: '', authorId: '' })], nextCursor: null } },
      [`${API}/boards/livejupter/threads/${T1}/posts?limit=500&cursor=eyJwb3N0TnVtYmVyIjoyfQ`]: { body: { data: [post(3)], nextCursor: null } },
    })
    const first = await honoBbsConnector.fetchPosts(thread, null, ctx)
    expect(first.status).toBe('updated')
    expect(first.title).toBe('スレタイ')
    expect(first.posts.map((p) => p.no)).toEqual([1, 2])
    expect(first.posts[0]).toMatchObject({ name: '風吹けば名無し', id: 'id1', body: '本文1', date: '2026/09/20(日) 04:02:29.239' })
    expect(first.posts[1].body).toBe('あぼーん')
    const more = await honoBbsConnector.fetchPosts(thread, first.cursor, ctx)
    expect(more.posts.map((p) => p.no)).toEqual([3])
    expect(got).toContain(`${API}/boards/livejupter/threads/${T1}/posts?limit=500&cursor=eyJwb3N0TnVtYmVyIjoyfQ`)
  })

  it('Turnstile が要るときは、つなぎのコードと認証ページを返す(エッヂと同じ流れ)', async () => {
    const { ctx, sent } = fake(
      { [`${WEB}/`]: { body: page } },
      {
        [`${API}/boards/livejupter/threads/${T1}/posts`]: { status: 400, body: { error: 'TURNSTILE_REQUIRED', message: 'X-Turnstile-Session header required' } },
        [`${API}/auth/turnstile/pair`]: { body: { data: { code: 'ABC234', url: `${API}/auth/turnstile?pair=ABC234` } } },
      },
    )
    const r = await honoBbsConnector.createPost!(thread, { name: '', mail: 'sage', body: 'テスト' }, ctx)
    expect(r).toMatchObject({ status: 'auth', code: 'ABC234', url: `${API}/auth/turnstile?pair=ABC234` })
    expect(JSON.parse(sent[0].body)).toEqual({ content: 'テスト', posterOptionInfo: 'sage' })
  })

  it('書けたらレス番号を返す', async () => {
    const { ctx } = fake({ [`${WEB}/`]: { body: page } }, { [`${API}/boards/livejupter/threads/${T1}/posts`]: { status: 201, body: { data: { postNumber: 33 } } } })
    const r = await honoBbsConnector.createPost!(thread, { name: '', mail: '', body: 'テスト' }, ctx)
    expect(r).toMatchObject({ status: 'ok', resNumber: 33 })
  })
})
