import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ConnectorContext, HttpResponse } from '@bbs-browser/connectors'
import { hostAllowed, loadSandboxedConnector, parseManifest, restrictContext } from '../src/host/connectorSandbox'

const manifest = parseManifest(JSON.stringify({ id: 'my-bbs', name: '自作の掲示板', version: '1.0.0', api: 1, hosts: ['bbs.example.com'] }))

/** 偽のサーバー。URL ごとの返事と、届いた通信を覚える */
function fakeCtx(routes: Record<string, unknown>) {
  const got: { method: string; url: string; body?: string | Uint8Array }[] = []
  const res = (url: string): HttpResponse => {
    if (!(url in routes)) return { status: 404, headers: {}, body: new Uint8Array() }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(routes[url])) }
  }
  const ctx: ConnectorContext = {
    decode: (bytes, enc) => new TextDecoder(enc).decode(bytes),
    http: {
      get: async (url) => (got.push({ method: 'GET', url }), res(url)),
      post: async (url, body) => (got.push({ method: 'POST', url, body }), res(url)),
    },
  }
  return { ctx: restrictContext(ctx, manifest.hosts), got }
}

/** JSON の API を読む、小さなコネクタ(外付けのコネクタの見本と同じ書き方) */
const CODE = `
const API = 'https://bbs.example.com/api'
const json = (res, ctx) => JSON.parse(ctx.decode(res.body, 'utf-8'))
defineConnector({
  capabilities: { post: true, images: false, incremental: true },
  reactions: [{ id: 'like', label: 'いいね', icon: 'thumb_up' }],
  canHandle: (url) => url.startsWith('https://bbs.example.com/'),
  isThreadUrl: (url) => /\\/t\\/\\d+$/.test(url),
  threadWebUrl: (t) => 'https://bbs.example.com/t/' + t.key,
  async resolveUrl(url, ctx) {
    const u = new URL(url)
    return { board: { connectorId: 'my-bbs', url: u.origin + '/', name: 'テスト' } }
  },
  async listBoards() { return [] },
  async listThreads(board, ctx, opts) {
    const res = await ctx.http.get(API + '/threads' + (opts && opts.sort ? '?sort=' + opts.sort : ''))
    return json(res, ctx).map((t, order) => ({ connectorId: 'my-bbs', boardUrl: board.url, key: String(t.id), title: t.title, postCount: t.count, order, createdAt: new Date(t.created * 1000) }))
  },
  async fetchPosts(thread, cursor, ctx) {
    const res = await ctx.http.get(API + '/threads/' + thread.key + '/posts?after=' + (cursor ? cursor.last : 0))
    const posts = json(res, ctx).map((p) => ({ no: p.no, name: p.name, mail: '', date: p.date, body: p.body }))
    return { status: 'updated', posts, cursor: { last: posts.length ? posts[posts.length - 1].no : 0 }, reactions: { '1': { like: 3 } } }
  },
  async createPost(thread, input, ctx) {
    const body = new URLSearchParams({ body: input.body, name: input.name }).toString()
    const res = await ctx.http.post(API + '/threads/' + thread.key + '/posts', body)
    return res.status === 200 ? { status: 'ok', message: '書き込みました' } : { status: 'error', message: 'HTTP ' + res.status }
  },
  async react(thread, post, id, ctx) {
    const res = await ctx.http.post(API + '/react', new TextEncoder().encode(JSON.stringify({ no: post.no, id })))
    return json(res, ctx).count
  },
})
`

describe('外付けのコネクタの囲い', () => {
  it('囲いの中からは、window・fetch・Tauri の機能・Node の機能に届かない', async () => {
    const { ctx } = fakeCtx({})
    const probe = `
      defineConnector({
        probe: [typeof window, typeof fetch, typeof XMLHttpRequest, typeof globalThis.__TAURI_INTERNALS__, typeof globalThis.__TAURI__,
                typeof require, typeof process, typeof globalThis.__host, typeof WebSocket, typeof importScripts],
        canHandle: () => false, threadWebUrl: () => '', async resolveUrl() { return null }, async listBoards() { return [] },
        async listThreads() { return [] }, async fetchPosts() { return { status: 'notModified', posts: [], cursor: null } },
      })`
    const { connector, dispose } = await loadSandboxedConnector(probe, manifest, { ctx })
    expect((connector as unknown as { probe: string[] }).probe.every((t) => t === 'undefined')).toBe(true)
    dispose()
  })

  it('組み込みと同じ形のコネクタとして使える(通信・JSON・URL・日付・反応・書き込み)', async () => {
    const { ctx, got } = fakeCtx({
      'https://bbs.example.com/api/threads?sort=newest': [{ id: 7, title: 'はじめてのスレ', count: 2, created: 1792300000 }],
      'https://bbs.example.com/api/threads/7/posts?after=0': [
        { no: 1, name: '名無し', date: '2026/10/18', body: 'こんにちは' },
        { no: 2, name: '名無し', date: '2026/10/18', body: '>>1\nどうも' },
      ],
      'https://bbs.example.com/api/threads/7/posts': { ok: true },
      'https://bbs.example.com/api/react': { count: 4 },
    })
    const { connector, dispose } = await loadSandboxedConnector(CODE, manifest, { ctx })
    expect(connector.id).toBe('my-bbs')
    expect(connector.reactions?.[0].label).toBe('いいね')
    expect(connector.canHandle('https://bbs.example.com/t/7')).toBe(true)
    expect(connector.isThreadUrl?.('https://bbs.example.com/t/7')).toBe(true)
    const board = { connectorId: 'my-bbs', url: 'https://bbs.example.com/', name: 'テスト' }
    // アプリは ctx を渡すが、囲いの中では囲いの ctx が使われる。ctx の後ろの引数(並び順)はそのまま届く
    const [t] = await connector.listThreads(board, ctx, { sort: 'newest' })
    expect(t.title).toBe('はじめてのスレ')
    expect(t.createdAt).toBeInstanceOf(Date)
    expect(connector.threadWebUrl(t)).toBe('https://bbs.example.com/t/7')
    const r = await connector.fetchPosts(t, null, ctx)
    expect(r.posts.map((p) => p.body)).toEqual(['こんにちは', '>>1\nどうも'])
    expect(r.cursor).toEqual({ last: 2 })
    expect(r.reactions).toEqual({ '1': { like: 3 } })
    expect(await connector.createPost!(t, { name: 'テスト', mail: '', body: 'あいう' }, ctx)).toMatchObject({ status: 'ok' })
    expect(got.at(-1)?.body).toBe('body=%E3%81%82%E3%81%84%E3%81%86&name=%E3%83%86%E3%82%B9%E3%83%88')
    // バイト列の本文も、そのまま外に届く
    expect(await connector.react!(t, r.posts[0], 'like', ctx)).toBe(4)
    expect(new TextDecoder().decode(got.at(-1)?.body as Uint8Array)).toBe('{"no":1,"id":"like"}')
    dispose()
  })

  it('manifest.json の hosts にない先へは通信できず、ほかの掲示板の URL も受け持たない', async () => {
    const { ctx } = fakeCtx({})
    const evil = CODE.replace("const API = 'https://bbs.example.com/api'", "const API = 'https://evil.example.org/api'").replace(
      "canHandle: (url) => url.startsWith('https://bbs.example.com/')",
      'canHandle: () => true',
    )
    const { connector, dispose } = await loadSandboxedConnector(evil, manifest, { ctx })
    await expect(connector.listThreads({ connectorId: 'my-bbs', url: 'https://bbs.example.com/', name: '' }, ctx)).rejects.toThrow('通信できない先です')
    expect(connector.canHandle('https://mi.5ch.io/test/read.cgi/news4vip/1/')).toBe(false)
    dispose()
  })

  it('止まらない処理は打ち切り、コードの誤りは理由を付けて断る', async () => {
    const { ctx } = fakeCtx({})
    const loop = CODE.replace('canHandle: (url) =>', 'canHandle: (url) => { for (;;) {} },\n  _x: (url) =>')
    const { connector, dispose } = await loadSandboxedConnector(loop, manifest, { ctx, timeoutMs: 100 })
    expect(() => connector.canHandle('https://bbs.example.com/')).toThrow()
    dispose()
    await expect(loadSandboxedConnector('defineConnector({ canHandle: () => true })', manifest, { ctx })).rejects.toThrow('がありません')
    await expect(loadSandboxedConnector('this is not javascript', manifest, { ctx })).rejects.toThrow('connector.js')
  })

  it('manifest.json を確かめる', () => {
    expect(() => parseManifest('{')).toThrow('JSON')
    expect(() => parseManifest(JSON.stringify({ id: 'futaba', name: 'x', version: '1', api: 1, hosts: ['a.example.com'] }))).toThrow('組み込み')
    expect(() => parseManifest(JSON.stringify({ id: 'abc', name: 'x', version: '1', api: 2, hosts: ['a.example.com'] }))).toThrow('api')
    expect(() => parseManifest(JSON.stringify({ id: 'abc', name: 'x', version: '1', api: 1, hosts: [] }))).toThrow('hosts')
    expect(hostAllowed('https://sub.example.com/x', ['*.example.com'])).toBe(true)
    expect(hostAllowed('https://example.com/x', ['*.example.com'])).toBe(true)
    expect(hostAllowed('https://badexample.com/x', ['*.example.com'])).toBe(false)
    expect(hostAllowed('file:///C:/x', ['*.example.com'])).toBe(false)
  })

  it('リポジトリの見本(examples/connectors/sample-offline)が、そのまま読み込めて動く', async () => {
    const dir = fileURLToPath(new URL('../../../examples/connectors/sample-offline/', import.meta.url))
    const m = parseManifest(readFileSync(dir + 'manifest.json', 'utf8'))
    const { ctx } = fakeCtx({})
    const { connector, dispose } = await loadSandboxedConnector(readFileSync(dir + 'connector.js', 'utf8'), m, { ctx: restrictContext(ctx, m.hosts) })
    const r = await connector.resolveUrl('https://sample.bbs-browser.invalid/board/1/', ctx)
    expect(r?.thread?.title).toContain('ようこそ')
    const posts = await connector.fetchPosts(r!.thread!, null, ctx)
    expect(posts.posts[0].badges?.[0].label).toBe('管理人')
    expect(await connector.react!(r!.thread!, posts.posts[1], 'like', ctx)).toBe(1)
    dispose()
  })
})
