import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { machiConnector } from '../src/machi/connector'
import { twoChConnector } from '../src/twoch/connector'
import { builtinConnectors } from '../src/index'
import { parseMachiTop, parseMachiWrite, parseOfflaw } from '../src/machi/parse'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

// 見本は作り物の中身を Shift_JIS にしたもの(形は 2026-11-04 に実際の板で確かめたものに合わせた)
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))

/** URL ごとに応答を決めた偽サーバー */
function fake(routes: Record<string, { status?: number; body?: Uint8Array }>) {
  const got: string[] = []
  const posted: { url: string; body: string; headers?: Record<string, string> }[] = []
  const ctx: ConnectorContext = {
    decode: (b, e) => new TextDecoder(e).decode(b),
    http: {
      async get(url): Promise<HttpResponse> {
        got.push(url)
        const r = routes[url]
        if (!r) return { status: 404, headers: {}, body: new Uint8Array() }
        return { status: r.status ?? 200, headers: { 'content-type': 'text/plain;charset=Shift_JIS' }, body: r.body ?? new Uint8Array() }
      },
      async post(url, body, opts): Promise<HttpResponse> {
        posted.push({ url, body: body as string, headers: opts?.headers })
        // 書きこみました(2ch 互換と同じ形のはず。本物の応答は確かめていない)
        return { status: 200, headers: {}, body: fixture('machi-written.html') }
      },
    },
  }
  return { ctx, got, posted }
}

const board = { connectorId: 'machi', url: 'https://machi.to/kanto/', name: '関東地区' }
const thread: ThreadSummary = { connectorId: 'machi', boardUrl: board.url, key: '1600000000', title: '', postCount: 0, order: 0 }
const OFFLAW = 'https://machi.to/bbs/offlaw.cgi/kanto/1600000000/'

describe('まちBBS のコネクタ', () => {
  it('まちBBS の URL はまちBBS のコネクタが受け持ち、2ch 互換は受け持たない', () => {
    const url = 'https://machi.to/bbs/read.cgi/kanto/1600000000/'
    expect(machiConnector.canHandle(url)).toBe(true)
    expect(builtinConnectors.find((c) => c.canHandle(url))?.id).toBe('machi')
    expect(builtinConnectors.find((c) => c.canHandle('https://kanto.machi.to/bbs/read.cgi/kanto/1600000000/'))?.id).toBe('machi')
    expect(builtinConnectors.find((c) => c.canHandle('https://mi.5ch.io/news4vip/'))?.id).toBe('2ch-compat')
    expect(machiConnector.isThreadUrl!(url)).toBe(true)
    expect(machiConnector.isThreadUrl!('https://machi.to/kanto/')).toBe(false)
    expect(twoChConnector.isThreadUrl!(url)).toBe(false)
    expect(machiConnector.handlesSite!('https://machi.to/')).toBe(true)
    expect(machiConnector.handlesSite!('https://machi.to/kanto/')).toBe(false)
  })

  it('スレの URL から板とスレを割り出す(板は subject.txt が取れるかで確かめ、名前は知っている一覧から)', async () => {
    const { ctx } = fake({ [`${board.url}subject.txt`]: { body: fixture('machi-subject.txt') } })
    const r = await machiConnector.resolveUrl('https://machi.to/bbs/read.cgi/kanto/1600000000/l50', ctx)
    expect(r?.board).toEqual(board)
    expect(r?.thread).toMatchObject({ key: '1600000000', boardUrl: board.url })
    expect((await machiConnector.resolveUrl('https://machi.to/kanto/', ctx))?.thread).toBeUndefined()
    expect(await machiConnector.resolveUrl('https://machi.to/bbs/', ctx)).toBeNull()
  })

  it('ない板は理由を付けて断る', async () => {
    const { ctx } = fake({})
    await expect(machiConnector.resolveUrl('https://machi.to/nosuch/', ctx)).rejects.toThrow('板が見つかりません')
  })

  it('スレ一覧を読む', async () => {
    const { ctx } = fake({ [`${board.url}subject.txt`]: { body: fixture('machi-subject.txt') } })
    const list = await machiConnector.listThreads(board, ctx)
    expect(list.map((t) => [t.key, t.title, t.postCount])).toEqual([
      ['1600000000', 'テスト&スレ', 3],
      ['1500000000', 'ふたつめ', 1000],
    ])
    expect(list[0].createdAt).toEqual(new Date(1600000000 * 1000))
  })

  it('スレの中身を全部読み(日付と ID を分け、1 番目からスレタイを取る)、次は続きの番号から取る', async () => {
    const { ctx, got } = fake({ [OFFLAW]: { body: fixture('machi-offlaw.txt') }, [`${OFFLAW}3-`]: { body: fixture('machi-offlaw-diff.txt') } })
    const first = await machiConnector.fetchPosts(thread, null, ctx)
    expect(first).toMatchObject({ status: 'updated', title: 'テストのスレ' })
    expect(first.posts).toEqual([
      { no: 1, name: '名無しさん', mail: 'sage', date: '2026/10/17(金) 10:00:00', id: 'abcd1234', body: '一行目\n二行目' },
      { no: 2, name: 'コテ', mail: '', date: '2026/10/17(金) 10:01:00', id: 'efgh5678', body: '>>1 ｱｲｳ' },
    ])
    const second = await machiConnector.fetchPosts(thread, first.cursor, ctx)
    expect(second.posts.map((p) => p.no)).toEqual([3])
    expect(got.at(-1)).toBe(`${OFFLAW}3-`)
  })

  it('新着がなければ「変化なし」', async () => {
    const { ctx } = fake({ [`${OFFLAW}3-`]: { body: new Uint8Array() } })
    expect(await machiConnector.fetchPosts(thread, { lastNo: 2 }, ctx)).toMatchObject({ status: 'notModified', posts: [] })
  })

  it('ないスレ(<ERROR>)は dat 落ち', async () => {
    const { ctx } = fake({ [OFFLAW]: { body: fixture('machi-error.txt') } })
    expect(await machiConnector.fetchPosts(thread, null, ctx)).toMatchObject({ status: 'archived' })
  })

  it('板の一覧はトップページから(板でないリンクは除き、同じ板は 1 つ)', async () => {
    const { ctx } = fake({ 'https://machi.to/': { body: fixture('machi-top.html') } })
    const list = await machiConnector.listBoards({ connectorId: 'machi', name: 'まちBBS', menuUrl: 'https://machi.to/' }, ctx)
    expect(list.map((b) => [b.url, b.name])).toEqual([
      ['https://machi.to/kanto/', '関東地区'],
      ['https://machi.to/tokyo/', '東京'],
      ['https://machi.to/tawara/', 'まちBBS会議室'],
    ])
    expect(parseMachiTop('')).toEqual([])
    // トップページが読めなければ、知っている板
    const fallback = await machiConnector.listBoards({ connectorId: 'machi', name: 'まちBBS', menuUrl: 'https://machi.to/' }, fake({}).ctx)
    expect(fallback.length).toBeGreaterThan(10)
  })

  it('書き込みはスレのページのフォームと同じ項目を Shift_JIS で write.cgi?guid=ON に送る', async () => {
    const { ctx, posted } = fake({})
    const r = await machiConnector.createPost!(thread, { name: '', mail: 'sage', body: 'あ' }, ctx)
    expect(r.status).toBe('ok')
    expect(posted[0].url).toBe('https://machi.to/bbs/write.cgi?guid=ON')
    expect(posted[0].headers?.Referer).toBe('https://machi.to/bbs/read.cgi/kanto/1600000000/')
    const q = Object.fromEntries(posted[0].body.split('&').map((kv) => kv.split('=')))
    expect(q).toMatchObject({ BBS: 'kanto', KEY: '1600000000', MAIL: 'sage', MESSAGE: '%82%A0', READ: 'TRUE', CC: '%82%A0', submit: '%8F%91%82%AB%8D%9E%82%DE' })
    expect(machiConnector.createThread).toBeUndefined()
  })

  it('書き込みの応答: スレのページがそのまま返れば成功、ERROR の題なら失敗', () => {
    expect(parseMachiWrite('<html><head><title>入間市のことを話そう</title></head><body><dl><dt>1 名前：名無し</dt></dl><form name="posting" method=POST action="/bbs/write.cgi?guid=ON"></form></body></html>')).toEqual({ status: 'ok', message: '書きこみました' })
    const e = parseMachiWrite('<html><head><title>ＥＲＲＯＲ！</title></head><body>ERROR：本文がありません！</body></html>')
    expect(e.status).toBe('error')
    expect(e.message).toContain('本文がありません')
    expect(parseMachiWrite('<html><head><title>何か</title></head><body>ただの文</body></html>').status).toBe('error')
  })

  it('offlaw の行で ID のない日付も読める', () => {
    const { posts } = parseOfflaw('5<>名無し<><>2026/10/17(金) 10:00:00<>本文<>host\n')
    expect(posts[0]).toMatchObject({ date: '2026/10/17(金) 10:00:00', id: undefined, body: '本文' })
  })
})
