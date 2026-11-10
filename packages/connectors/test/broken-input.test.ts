// 壊れた入力と、差分取得の分かれ道。応答はどれも作り物で、本物の掲示板へは取りに行かない
import { describe, expect, it } from 'vitest'
import { encodeUtf8Form } from '../src/encoding'
import { decodeEntities, htmlToText } from '../src/html'
import { honoBbsConnector } from '../src/honobbs/connector'
import { machiConnector } from '../src/machi/connector'
import { parseOfflaw } from '../src/machi/parse'
import { shitarabaConnector } from '../src/shitaraba/connector'
import { parseRawmode } from '../src/shitaraba/parse'
import { encodeShiftJisForm } from '../src/sjis'
import { twoChConnector } from '../src/twoch/connector'
import { parseBbsMenuHtml, parseBbsMenuJson, parseDat, parseDatLine, parseSubjectTxt } from '../src/twoch/parse'
import { parseKeyValue } from '../src/common'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

const enc = (s: string) => new TextEncoder().encode(s)
const UTF8 = { 'content-type': 'text/plain; charset=utf-8' }

describe('文字参照とタグ', () => {
  it('数値の文字参照を戻す(16 進の X は大文字でも)', () => {
    expect(decodeEntities('&#65;&#x41;&#X41;&#128512;')).toBe('AAA😀')
  })

  it('範囲の外・知らない名前は、そのまま残す', () => {
    expect(decodeEntities('&#0;&#x110000;&#99999999999;&unknown;&;&#;')).toBe('&#0;&#x110000;&#99999999999;&unknown;&;&#;')
  })

  it('2 重には戻さない', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })

  it('<br> の書き方の違いを改行にし、タグでない < は残す', () => {
    expect(htmlToText(' 一<br>二<BR />三 <br> 四 ')).toBe('一\n二\n三\n四')
    expect(htmlToText('a < b')).toBe('a < b')
  })

  it('閉じていないタグは文字として残す', () => {
    expect(htmlToText('<b>太字</b><a href="x')).toBe('太字<a href="x')
  })
})

describe('dat の壊れた行', () => {
  it('ID・BE を日付から外す', () => {
    const { post } = parseDatLine('名無し<>sage<>2026/10/01(木) 00:00:00.00 ID:abc BE:123-2BP(0)<> 本文 <>', 1)
    expect(post).toMatchObject({ date: '2026/10/01(木) 00:00:00.00', id: 'abc', mail: 'sage', body: '本文' })
  })

  it('ID のない日付', () => {
    const { post, title } = parseDatLine('名無し<><>2026/10/01<> 本文 <>   ', 7)
    expect(post.id).toBeUndefined()
    expect(title).toBeUndefined()
    expect(post.no).toBe(7)
  })

  it('スレタイの欄がなくても読む', () => {
    expect(parseDatLine('名無し<><>日付<>本文', 1).post.body).toBe('本文')
  })

  it.each([
    ['区切りが足りない', 'あぼーん<>あぼーん', 'あぼーんあぼーん'],
    ['空', '', ''],
    ['文字だけ', 'Service<br>Unavailable', 'Service\nUnavailable'],
  ])('%s行も、番号を保ったまま本文に入れる', (_, line, body) => {
    expect(parseDatLine(line, 5).post).toEqual({ no: 5, name: '', mail: '', date: '', body })
  })

  it('途中の壊れた行で後ろの番号がずれない', () => {
    const { posts, title } = parseDat('a<><>d<>一<>スレタイ\n壊れた行\n\nb<><>d<>四<>\n')
    expect(posts.map((p) => [p.no, p.body])).toEqual([
      [1, '一'],
      [2, '壊れた行'],
      [3, ''],
      [4, '四'],
    ])
    expect(title).toBe('スレタイ')
  })

  it('CR LF の行でも、スレタイに CR が残らない', () => {
    expect(parseDat('a<><>d<>一<>スレタイ\r\n').title).toBe('スレタイ')
  })

  it('空の本文はレスなし', () => {
    expect(parseDat('')).toEqual({ posts: [], title: undefined })
  })

  it('2 行目以降のスレタイの欄で、1 行目のスレタイを上書きしない', () => {
    expect(parseDat('a<><>d<>一<>はじめ\nb<><>d<>二<>あと\n').title).toBe('はじめ')
  })
})

describe('スレ一覧・板一覧・板の設定の壊れた入力', () => {
  it('subject.txt の形でない行は飛ばす', () => {
    expect(parseSubjectTxt('壊れた行\n1.dat<>レス数なし\nabc.dat<>番号でない (1)\n\n2.dat<>読める &amp; (3)\r\n3.cgi,カンマ (4)\n')).toEqual([
      { key: '2', title: '読める &', postCount: 3 },
      { key: '3', title: 'カンマ', postCount: 4 },
    ])
  })

  it('スレタイの中のかっこは、最後の (数字) だけをレス数にする', () => {
    expect(parseSubjectTxt('1.dat<>(1) スレ (2) (30)\n')).toEqual([{ key: '1', title: '(1) スレ (2)', postCount: 30 }])
  })

  it('SETTING.TXT の値の = を残し、= のない行・キーのない行は飛ばす', () => {
    expect(parseKeyValue('板名だけの行\n=値だけ\nA=b=c\r\nB = 空白 \nC=\n')).toEqual({ A: 'b=c', B: '空白', C: '' })
  })

  it('bbsmenu.json: 壊れていれば投げ、足りない所は空として読み、板の形でない URL は除く', () => {
    expect(() => parseBbsMenuJson('<html>')).toThrow()
    expect(parseBbsMenuJson('{}')).toEqual([])
    expect(parseBbsMenuJson('{"menu_list":[{}]}')).toEqual([])
    const boards = parseBbsMenuJson(
      '{"menu_list":[{"category_content":[{"url":"https://a.example/x/","board_name":"板"},{"url":"https://a.example/","board_name":"トップ"},{"url":"https://a.example/x/y/","board_name":"深い"},{"url":"ftp://a.example/x/","board_name":"別"}]}]}',
    )
    expect(boards.map((b) => b.name)).toEqual(['板'])
  })

  it('bbsmenu.html: カテゴリの前のリンクと板の形でないリンクは除く', () => {
    const html = '<a href="https://a.example/before/">前</a><b>分類 &amp; 他</b><a href="https://a.example/x/">板</a><a href=https://a.example/>トップ</a>'
    expect(parseBbsMenuHtml(html)).toEqual([{ url: 'https://a.example/x/', name: '板', category: '分類 & 他' }])
    expect(parseBbsMenuHtml('')).toEqual([])
  })

  const board = { connectorId: '2ch-compat', url: 'https://setting.example/b/', name: 'b' }
  const ctxOf = (get: () => Promise<HttpResponse>): ConnectorContext => ({
    decode: (b, e) => new TextDecoder(e).decode(b),
    http: {
      get,
      post: async () => {
        throw new Error('書き込まない')
      },
    },
  })

  it('板の設定: 数字でない上限は「なし」、取れなければ空', async () => {
    const ok = ctxOf(async () => ({ status: 200, headers: UTF8, body: enc('BBS_TITLE=\nBBS_MESSAGE_COUNT=abc\nBBS_LINE_NUMBER=-1\nBBS_NAME_COUNT=64\n') }))
    expect(await twoChConnector.boardInfo!(board, ok)).toEqual({
      title: undefined,
      nonameName: undefined,
      limits: { messageBytes: undefined, lines: undefined, nameBytes: 64, mailBytes: undefined, subjectBytes: undefined },
    })
    expect(await twoChConnector.boardInfo!(board, ctxOf(async () => ({ status: 500, headers: {}, body: new Uint8Array() })))).toEqual({})
    expect(
      await twoChConnector.boardInfo!(
        board,
        ctxOf(async () => {
          throw new Error('届かない')
        }),
      ),
    ).toEqual({})
  })

  it('スレ一覧: サーバーの失敗と HTML のページは、空の一覧にせず投げる', async () => {
    await expect(twoChConnector.listThreads(board, ctxOf(async () => ({ status: 503, headers: {}, body: new Uint8Array() })))).rejects.toThrow('HTTP 503')
    await expect(twoChConnector.listThreads(board, ctxOf(async () => ({ status: 200, headers: UTF8, body: enc('<html>メンテナンス中</html>\n') })))).rejects.toThrow('スレ一覧を読めませんでした')
  })

  it('板一覧: 壊れた JSON は投げる', async () => {
    const site = { connectorId: '2ch-compat', name: 's', menuUrl: 'https://setting.example/bbsmenu.json' }
    await expect(twoChConnector.listBoards!(site, ctxOf(async () => ({ status: 200, headers: UTF8, body: enc('<html>') })))).rejects.toThrow()
  })
})

describe('フォームのエンコード', () => {
  const fields = { MESSAGE: 'a+b=c&d%e f' }
  it('Shift_JIS: 区切りと同じ文字を逃がす', () => {
    expect(encodeShiftJisForm(fields)).toBe('MESSAGE=a%2Bb%3Dc%26d%25e+f')
  })
  it('UTF-8: 区切りと同じ文字を逃がし、改行は CR LF', () => {
    expect(encodeUtf8Form(fields)).toBe('MESSAGE=a%2Bb%3Dc%26d%25e+f')
    expect(encodeUtf8Form({ m: 'あ\nい\r\nう' })).toBe('m=%E3%81%82%0D%0A%E3%81%84%0D%0A%E3%81%86')
  })
  it('空の値も項目として送る', () => {
    expect(encodeShiftJisForm({ FROM: '', mail: '' })).toBe('FROM=&mail=')
    expect(encodeUtf8Form({ FROM: '' })).toBe('FROM=')
  })
})

describe('dat の差分取得の分かれ道', () => {
  const thread: ThreadSummary = { connectorId: '2ch-compat', boardUrl: 'https://diff.example/b/', key: '1789358916', title: '', postCount: 0, order: 0 }
  const LM = 'Thu, 01 Oct 2026 00:00:00 GMT'
  const line = (s: string, title = '') => `名無し<><>日付<> ${s} <>${title}\n`
  const two = line('一', 'スレタイ') + line('二')
  const cursorOf = (text: string, lastModified?: string) => ({ bytes: enc(text).length, postCount: text.split('\n').length - 1, lastModified })

  /** 用意した応答を順に返し、送られたヘッダーを覚える偽サーバー */
  function fake(...responses: { status: number; body?: string | Uint8Array; headers?: Record<string, string> }[]) {
    const sent: Record<string, string>[] = []
    const ctx: ConnectorContext = {
      decode: (b, e) => new TextDecoder(e).decode(b),
      http: {
        async get(_url, opts): Promise<HttpResponse> {
          sent.push(opts?.headers ?? {})
          const r = responses[sent.length - 1]
          if (!r) throw new Error('用意より多く取りに来た')
          return { status: r.status, headers: { ...UTF8, ...r.headers }, body: typeof r.body === 'string' ? enc(r.body) : (r.body ?? new Uint8Array()) }
        },
        post: async () => {
          throw new Error('書き込まない')
        },
      },
    }
    return { ctx, sent }
  }

  it('1 バイト手前から取り、更新日時があれば If-Modified-Since を付ける', async () => {
    const { ctx, sent } = fake({ status: 304 }, { status: 304 })
    await twoChConnector.fetchPosts(thread, cursorOf(two, LM), ctx)
    expect(sent[0]).toEqual({ Range: `bytes=${enc(two).length - 1}-`, 'If-Modified-Since': LM })
    await twoChConnector.fetchPosts(thread, cursorOf(two), ctx)
    expect(sent[1]).toEqual({ Range: `bytes=${enc(two).length - 1}-` })
  })

  it.each([
    ['Range を無視した(200)', { status: 200, body: two }],
    ['ファイルが縮んだ(416)', { status: 416 }],
    ['前回の続きでない(先頭が改行でない)', { status: 206, body: 'x新しい行\n' }],
    ['206 なのに本文が空', { status: 206 }],
  ])('%sときは全件を取り直して reset にする', async (_, first) => {
    const { ctx, sent } = fake(first, { status: 200, body: line('取り直し', 'スレタイ'), headers: { 'last-modified': LM } })
    const r = await twoChConnector.fetchPosts(thread, cursorOf(two), ctx)
    expect(r.status).toBe('reset')
    expect(r.posts.map((p) => p.body)).toEqual(['取り直し'])
    expect(r.title).toBe('スレタイ')
    expect(sent[1]).toEqual({})
    expect(r.cursor).toEqual({ bytes: enc(line('取り直し', 'スレタイ')).length, postCount: 1, lastModified: LM })
  })

  it('サーバーの失敗は投げて、手元の Cursor を進めない', async () => {
    await expect(twoChConnector.fetchPosts(thread, cursorOf(two), fake({ status: 503 }).ctx)).rejects.toThrow('HTTP 503')
    await expect(twoChConnector.fetchPosts(thread, null, fake({ status: 500 }).ctx)).rejects.toThrow('HTTP 500')
  })

  it('全件の取り直しでのサーバーの失敗も投げる', async () => {
    await expect(twoChConnector.fetchPosts(thread, cursorOf(two), fake({ status: 416 }, { status: 502 }).ctx)).rejects.toThrow('HTTP 502')
  })

  it.each([404, 302])('dat が %d で過去ログ倉庫(kako の dat.gz・dat)にもなければ dat 落ちで、Cursor はそのまま', async (status) => {
    const c = cursorOf(two)
    const { ctx, sent } = fake({ status }, { status: 404 }, { status: 404 })
    expect(await twoChConnector.fetchPosts(thread, c, ctx)).toEqual({ status: 'archived', posts: [], cursor: c })
    expect(sent).toHaveLength(3)
  })

  it('改行だけ返れば、レスなしで Cursor は変わらない', async () => {
    const c = cursorOf(two, LM)
    const r = await twoChConnector.fetchPosts(thread, c, fake({ status: 206, body: '\n' }).ctx)
    expect(r).toMatchObject({ status: 'updated', posts: [] })
    expect(r.cursor).toEqual(c)
  })

  it('差分を続けて取っても、番号とバイト数が合い続ける', async () => {
    const a = line('三')
    const b = line('四') + line('五')
    const { ctx } = fake({ status: 206, body: `\n${a}`, headers: { 'last-modified': 'A' } }, { status: 206, body: `\n${b}` })
    const r1 = await twoChConnector.fetchPosts(thread, cursorOf(two), ctx)
    expect(r1.posts.map((p) => p.no)).toEqual([3])
    expect(r1.cursor).toEqual({ bytes: enc(two + a).length, postCount: 3, lastModified: 'A' })
    const r2 = await twoChConnector.fetchPosts(thread, r1.cursor, ctx)
    expect(r2.posts.map((p) => p.no)).toEqual([4, 5])
    // 更新日時が返らなければ、前のものを使い続ける
    expect(r2.cursor).toEqual({ bytes: enc(two + a + b).length, postCount: 5, lastModified: 'A' })
  })

  it('差分の途中で文字が切れていても、切れた行は読まず、バイト数も進めない', async () => {
    const next = enc(line('続きの行'))
    const cut = next.subarray(0, next.length - 8)
    const body = new Uint8Array([0x0a, ...enc(line('三')), ...cut])
    const r = await twoChConnector.fetchPosts(thread, cursorOf(two), fake({ status: 206, body }).ctx)
    expect(r.posts.map((p) => p.body)).toEqual(['三'])
    expect((r.cursor as { bytes: number }).bytes).toBe(enc(two + line('三')).length)
  })

  it('初回に完全な行がなければ、次は全件を取りに行く', async () => {
    const { ctx, sent } = fake({ status: 200, body: '書きかけ' }, { status: 200, body: two })
    const first = await twoChConnector.fetchPosts(thread, null, ctx)
    expect(first).toMatchObject({ status: 'updated', posts: [], cursor: { bytes: 0, postCount: 0 } })
    const second = await twoChConnector.fetchPosts(thread, first.cursor, ctx)
    expect(sent[1]).toEqual({})
    expect(second.posts).toHaveLength(2)
  })

  it('過去ログから取ったスレは、通信せずに dat 落ちのまま', async () => {
    const c = { bytes: 10, postCount: 1, kako: true }
    expect(await twoChConnector.fetchPosts(thread, c, fake().ctx)).toEqual({ status: 'notModified', posts: [], cursor: c, archived: true })
  })
})

describe('hono-bbs のレスの取得の壊れた応答', () => {
  const API = 'https://api.fetch.example.com/api/v1'
  const T = '6aefe762-1722-4b73-80f5-59db564142c7'
  const thread: ThreadSummary = { connectorId: 'honobbs', boardUrl: 'https://fetch.example.com/boards/b/', key: T, title: '', postCount: 0, order: 0 }
  const BASE = `${API}/boards/b/threads/${T}`
  const post = (n: number) => ({ postNumber: n, content: `本文${n}`, createdAt: 'いつか' })

  function fake(routes: Record<string, { status?: number; body: string }>) {
    const ctx: ConnectorContext = {
      decode: (b) => new TextDecoder().decode(b),
      http: {
        async get(url): Promise<HttpResponse> {
          if (url === 'https://fetch.example.com/') return { status: 200, headers: {}, body: enc(`<meta name="bbs-api" content="${API}">`) }
          const r = routes[url]
          return r ? { status: r.status ?? 200, headers: {}, body: enc(r.body) } : { status: 404, headers: {}, body: enc('{}') }
        },
        post: async () => {
          throw new Error('書き込まない')
        },
      },
    }
    return ctx
  }

  it('スレの情報が取れなくても、レスは読む', async () => {
    const ctx = fake({ [BASE]: { status: 500, body: 'x' }, [`${BASE}/posts?limit=500`]: { body: JSON.stringify({ data: [post(1)] }) } })
    const r = await honoBbsConnector.fetchPosts(thread, null, ctx)
    expect(r.posts.map((p) => p.no)).toEqual([1])
    expect(r.title).toBeUndefined()
  })

  it('日時が読めなければ、そのままの文字を日付にする', async () => {
    const ctx = fake({ [BASE]: { status: 500, body: 'x' }, [`${BASE}/posts?limit=500`]: { body: JSON.stringify({ data: [post(1)] }) } })
    expect((await honoBbsConnector.fetchPosts(thread, null, ctx)).posts[0].date).toBe('いつか')
  })

  it('サーバーの失敗と壊れた本文は投げる(手元のログを変えない)', async () => {
    const cursorUrl = `${BASE}/posts?limit=500&cursor=eyJwb3N0TnVtYmVyIjoyfQ`
    await expect(honoBbsConnector.fetchPosts(thread, { lastNo: 2 }, fake({ [cursorUrl]: { status: 503, body: 'x' } }))).rejects.toThrow('HTTP 503')
    await expect(honoBbsConnector.fetchPosts(thread, { lastNo: 2 }, fake({ [cursorUrl]: { body: '<html>' } }))).rejects.toThrow()
    await expect(honoBbsConnector.fetchPosts(thread, { lastNo: 2 }, fake({ [cursorUrl]: { body: '{}' } }))).rejects.toThrow()
  })

  it('新着がなければ notModified で、前の番号を保つ。古い番号が混ざっても足さない', async () => {
    const cursorUrl = `${BASE}/posts?limit=500&cursor=eyJwb3N0TnVtYmVyIjoyfQ`
    const empty = await honoBbsConnector.fetchPosts(thread, { lastNo: 2 }, fake({ [cursorUrl]: { body: '{"data":[]}' } }))
    expect(empty).toMatchObject({ status: 'notModified', cursor: { lastNo: 2 } })
    const mixed = await honoBbsConnector.fetchPosts(thread, { lastNo: 2 }, fake({ [cursorUrl]: { body: JSON.stringify({ data: [post(2), post(3)] }) } }))
    expect(mixed.posts.map((p) => p.no)).toEqual([3])
    expect(mixed.cursor).toEqual({ lastNo: 3 })
  })

  it('ページを続けて読む', async () => {
    const ctx = fake({
      [BASE]: { body: JSON.stringify({ data: { title: 't', isArchived: true } }) },
      [`${BASE}/posts?limit=500`]: { body: JSON.stringify({ data: [post(1)], nextCursor: 'n/x' }) },
      [`${BASE}/posts?limit=500&cursor=n%2Fx`]: { body: JSON.stringify({ data: [post(2)], nextCursor: null }) },
    })
    expect(await honoBbsConnector.fetchPosts(thread, null, ctx)).toMatchObject({ status: 'updated', title: 't', archived: true, cursor: { lastNo: 2 } })
  })
})

describe('まちBBS・したらばのレスの壊れた行', () => {
  it('まちBBS: 番号が読めない行と区切りの足りない行は飛ばす', () => {
    const { posts, title } = parseOfflaw('abc<>名<><>日付<>本文<>h\n0<>名<><>日付<>本文<>h\n-1<>名<><>日付<>本文<>h\n1.5<>名<><>日付<>本文<>h\n2<>区切りが足りない\n\n3<>名<><>日付 ID:x<>本文<>スレタイ<>h\n')
    expect(posts.map((p) => p.no)).toEqual([3])
    expect(posts[0].id).toBe('x')
    expect(title).toBe('スレタイ')
    expect(parseOfflaw('')).toEqual({ posts: [], title: undefined })
  })

  it('したらば: 番号が読めない行は飛ばし、欄が足りなければ空で読む', () => {
    const { posts, title } = parseRawmode('abc<>名<><>日付<>本文<>t<>i\n<html>\n3<>名前だけ\n4<>名<><>日付<> 本文 <><>id \n')
    expect(posts).toEqual([
      { no: 3, name: '名前だけ', mail: '', date: '', id: undefined, body: '' },
      { no: 4, name: '名', mail: '', date: '日付', id: 'id', body: '本文' },
    ])
    expect(title).toBeUndefined()
  })

  const ctxOf = (status: number, text: string, headers: Record<string, string> = {}): ConnectorContext => ({
    decode: (b) => new TextDecoder().decode(b),
    http: {
      get: async (): Promise<HttpResponse> => ({ status, headers, body: enc(text) }),
      post: async () => {
        throw new Error('書き込まない')
      },
    },
  })
  const machi: ThreadSummary = { connectorId: 'machi', boardUrl: 'https://machi.to/kanto/', key: '1600000000', title: '', postCount: 0, order: 0 }
  const shitaraba: ThreadSummary = { connectorId: 'shitaraba', boardUrl: 'https://jbbs.shitaraba.net/computer/351/', key: '1600000000', title: '', postCount: 0, order: 0 }

  it('サーバーの失敗は投げる', async () => {
    await expect(machiConnector.fetchPosts(machi, { lastNo: 2 }, ctxOf(500, ''))).rejects.toThrow('HTTP 500')
    await expect(shitarabaConnector.fetchPosts(shitaraba, { lastNo: 2 }, ctxOf(500, ''))).rejects.toThrow('HTTP 500')
  })

  it('読める行がなければ、Cursor を戻さず notModified', async () => {
    expect(await machiConnector.fetchPosts(machi, { lastNo: 9 }, ctxOf(200, '<html>x</html>\n'))).toEqual({ status: 'notModified', posts: [], cursor: { lastNo: 9 } })
    expect(await shitarabaConnector.fetchPosts(shitaraba, { lastNo: 9 }, ctxOf(200, '<html>x</html>\n'))).toMatchObject({ status: 'notModified', posts: [], cursor: { lastNo: 9 } })
  })

  it('したらば: 過去ログ倉庫の印で、新着がなくても dat 落ちを覚える', async () => {
    const r = await shitarabaConnector.fetchPosts(shitaraba, { lastNo: 9 }, ctxOf(200, '', { error: 'STORAGE IN' }))
    expect(r).toEqual({ status: 'notModified', posts: [], cursor: { lastNo: 9, kako: true }, archived: true })
  })

  it('したらば: 200 でもヘッダーに THREAD NOT FOUND があれば dat 落ち', async () => {
    expect(await shitarabaConnector.fetchPosts(shitaraba, { lastNo: 9 }, ctxOf(200, '', { error: 'THREAD NOT FOUND' }))).toEqual({ status: 'archived', posts: [], cursor: { lastNo: 9 } })
  })
})
