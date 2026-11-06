import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { twoChConnector } from '../src/twoch/connector'
import { parseBbsMenuHtml, parseDatLine, parseSubjectTxt, splitAuthorId } from '../src/twoch/parse'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const sjis = (bytes: Uint8Array) => new TextDecoder('shift_jis').decode(bytes)

/** get だけを持つ偽の ctx(書き込みはしない) */
const fakeCtx = (get: ConnectorContext['http']['get']): ConnectorContext => ({
  decode: (bytes, enc) => new TextDecoder(enc).decode(bytes),
  http: {
    get,
    post: async () => {
      throw new Error('この試験では書き込まない')
    },
  },
})

/** 1 つの dat を返す偽サーバー。Range と If-Modified-Since をそれらしく扱う */
function fakeServer(initial: Uint8Array) {
  const state = { body: initial, lastModified: 'Thu, 01 Oct 2026 00:00:00 GMT' }
  const ctx = fakeCtx(async (_url, opts): Promise<HttpResponse> => {
    const h = opts?.headers ?? {}
    const base = { 'content-type': 'text/plain', 'last-modified': state.lastModified }
    if (h['If-Modified-Since'] === state.lastModified) return { status: 304, headers: base, body: new Uint8Array() }
    const range = /^bytes=(\d+)-$/.exec(h.Range ?? '')
    if (range) {
      const from = Number(range[1])
      if (from >= state.body.length) return { status: 416, headers: base, body: new Uint8Array() }
      return { status: 206, headers: base, body: state.body.subarray(from) }
    }
    return { status: 200, headers: base, body: state.body }
  })
  const update = (body: Uint8Array, lastModified: string) => Object.assign(state, { body, lastModified })
  return { ctx, update }
}

const thread: ThreadSummary = {
  connectorId: '2ch-compat',
  boardUrl: 'https://example.5ch.io/test/',
  key: '1789358916',
  title: '',
  postCount: 0,
  order: 0,
}

describe('parse', () => {
  it('dat の 1 行から名前・日付・ID・本文・スレタイを取り出す', () => {
    const { post, title } = parseDatLine(sjis(fixture('thread.dat')).split('\n')[0], 1)
    expect(title).toBe('テスト用スレ Part1')
    expect(post).toMatchObject({ no: 1, name: '名無しさん', date: '2026/09/14(月) 13:08:36.42', id: 'abcd1234' })
    expect(post.body).toBe('一行目\n二行目 & <b>タグではない</b>\n>>2')
  })

  it('subject.txt を読む', () => {
    const entries = parseSubjectTxt(sjis(fixture('subject.txt')))
    expect(entries).toEqual([
      { key: '1789358916', title: 'テスト用スレ Part1', postCount: 3 },
      { key: '1789000000', title: '(括弧つき) スレ', postCount: 1000 },
    ])
  })

  it('bbsmenu.html からカテゴリつきで板だけを拾う', () => {
    const boards = parseBbsMenuHtml(sjis(fixture('bbsmenu.html')))
    expect(boards).toEqual([
      { url: 'https://medaka.5ch.io/prog/', name: 'プログラマー', category: 'PC等' },
      { url: 'https://egg.5ch.io/software/', name: 'ソフトウェア', category: 'PC等' },
    ])
  })
})

describe('fetchPosts の差分取得', () => {
  const full = fixture('thread.dat')
  const lines = sjis(full).split('\n').filter(Boolean).length

  it('初回は全件、変化がなければ notModified', async () => {
    const { ctx } = fakeServer(full)
    const first = await twoChConnector.fetchPosts(thread, null, ctx)
    expect(first.status).toBe('updated')
    expect(first.posts).toHaveLength(lines)
    expect(first.title).toBe('テスト用スレ Part1')

    const second = await twoChConnector.fetchPosts(thread, first.cursor, ctx)
    expect(second.status).toBe('notModified')
  })

  it('追記されたぶんだけを、続きの番号で返す', async () => {
    const { ctx, update } = fakeServer(full)
    const first = await twoChConnector.fetchPosts(thread, null, ctx)
    update(new Uint8Array([...full, ...fixture('append.dat')]), 'Thu, 01 Oct 2026 00:05:00 GMT')

    const next = await twoChConnector.fetchPosts(thread, first.cursor, ctx)
    expect(next.status).toBe('updated')
    expect(next.posts.map((p) => p.no)).toEqual([lines + 1])
    expect(next.posts[0].body).toBe('追記されたレス')
  })

  it('書き込み途中の行は読まず、次の取得で拾う', async () => {
    const append = fixture('append.dat')
    const { ctx, update } = fakeServer(full)
    const first = await twoChConnector.fetchPosts(thread, null, ctx)

    update(new Uint8Array([...full, ...append.subarray(0, 10)]), 'Thu, 01 Oct 2026 00:05:00 GMT')
    const partial = await twoChConnector.fetchPosts(thread, first.cursor, ctx)
    expect(partial.posts).toHaveLength(0)

    update(new Uint8Array([...full, ...append]), 'Thu, 01 Oct 2026 00:06:00 GMT')
    const rest = await twoChConnector.fetchPosts(thread, partial.cursor, ctx)
    expect(rest.posts.map((p) => p.no)).toEqual([lines + 1])
  })

  it('前回までの内容が変わっていたら(あぼーん)全件を取り直す', async () => {
    const { ctx, update } = fakeServer(full)
    const first = await twoChConnector.fetchPosts(thread, null, ctx)
    update(fixture('thread_aborn.dat'), 'Thu, 01 Oct 2026 00:07:00 GMT')

    const next = await twoChConnector.fetchPosts(thread, first.cursor, ctx)
    expect(next.status).toBe('reset')
    expect(next.posts[1].body).toBe('あぼーん')
  })

  it.each([
    ['空', new Uint8Array()],
    ['改行なし', new TextEncoder().encode('Service Unavailable')],
  ])('全件の取り直しで本文が%sなら、手元のログを置き換えない', async (_, body) => {
    const { ctx, update } = fakeServer(full)
    const first = await twoChConnector.fetchPosts(thread, null, ctx)
    update(body, 'Thu, 01 Oct 2026 00:08:00 GMT')

    const next = await twoChConnector.fetchPosts(thread, first.cursor, ctx)
    expect(next.status).toBe('notModified')
    expect(next.posts).toHaveLength(0)
    expect(next.cursor).toEqual(first.cursor)
  })
})

describe('resolveUrl', () => {
  // resolveUrl が読む URL だけに答える偽サーバー
  const ctx = fakeCtx(async (url): Promise<HttpResponse> => {
    if (url === 'https://bbs.eddibb.cc/liveedge/subject.txt' || url === 'https://medaka.5ch.io/prog/subject.txt')
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: new TextEncoder().encode('1792065954.dat<>スレ (1)\n') }
    if (url === 'https://mercury.bbspink.com/avideo/subject.txt' || url === 'https://example.com/bbs/news/subject.txt')
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: new TextEncoder().encode('1788606033.dat<>スレ (1)\n') }
    if (url === 'https://itest.bbspink.com/subback/avideo')
      return { status: 200, headers: { 'content-type': 'text/html' }, body: new TextEncoder().encode('<a href="https://itest.bbspink.com/subback/avideo">x</a><a href="https://mercury.bbspink.com/avideo/">PC版</a>') }
    if (url === 'https://example.com/foo/subject.txt')
      return { status: 200, headers: { 'content-type': 'text/html' }, body: new TextEncoder().encode('<!doctype html><html></html>') }
    if (url === 'https://bbs.eddibb.cc/liveedge/SETTING.TXT') {
      const body = new TextEncoder().encode('liveedge@liveedge\nBBS_TITLE=エッヂ\nBBS_NONAME_NAME=エッヂの名無し\nBBS_LINE_NUMBER=16\nBBS_MESSAGE_COUNT=9192\nBBS_SUBJECT_COUNT=192\n')
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body }
    }
    return { status: 404, headers: {}, body: new Uint8Array() }
  })

  it('板の URL(末尾スラッシュなしでも)から板名つきで板を返す', async () => {
    for (const url of ['https://bbs.eddibb.cc/liveedge', 'https://bbs.eddibb.cc/liveedge/']) {
      expect(await twoChConnector.resolveUrl(url, ctx)).toEqual({
        board: { connectorId: '2ch-compat', url: 'https://bbs.eddibb.cc/liveedge/', name: 'エッヂ' },
      })
    }
  })

  it('スレの URL なら板とスレを返す', async () => {
    const r = await twoChConnector.resolveUrl('https://bbs.eddibb.cc/test/read.cgi/liveedge/1792065954/l50', ctx)
    expect(r?.board.url).toBe('https://bbs.eddibb.cc/liveedge/')
    expect(r?.thread).toMatchObject({ key: '1792065954', boardUrl: 'https://bbs.eddibb.cc/liveedge/' })
    expect(r?.thread?.createdAt?.getTime()).toBe(1792065954 * 1000)
  })

  it('板の設定(名無しの名前と書き込みの上限)を読む', async () => {
    const board = { connectorId: '2ch-compat', url: 'https://bbs.eddibb.cc/liveedge/', name: 'エッヂ' }
    expect(await twoChConnector.boardInfo!(board, ctx)).toEqual({
      title: 'エッヂ',
      nonameName: 'エッヂの名無し',
      // 行数の上限は BBS_LINE_NUMBER の 2 倍。書かれていないものは undefined
      limits: { messageBytes: 9192, lines: 32, nameBytes: undefined, mailBytes: undefined, subjectBytes: 192 },
    })
  })

  it('SETTING.TXT が取れなければディレクトリ名を板名にする', async () => {
    const r = await twoChConnector.resolveUrl('https://medaka.5ch.io/prog/', ctx)
    expect(r?.board.name).toBe('prog')
  })

  it('itest(スマホ向け)のスレ・板の URL を、本当のサーバーの URL に直して開く', async () => {
    const r = await twoChConnector.resolveUrl('https://itest.bbspink.com/mercury/test/read.cgi/avideo/1788606033', ctx)
    expect(r?.board.url).toBe('https://mercury.bbspink.com/avideo/')
    expect(r?.thread?.key).toBe('1788606033')
    // 板の URL にはサーバー名がないので、itest の板のページから探す
    expect(twoChConnector.canHandle('https://itest.bbspink.com/subback/avideo')).toBe(true)
    expect((await twoChConnector.resolveUrl('https://itest.bbspink.com/subback/avideo', ctx))?.board.url).toBe('https://mercury.bbspink.com/avideo/')
    // サーバー名のないスレの URL も、板のページから探す
    expect((await twoChConnector.resolveUrl('https://itest.bbspink.com/test/read.cgi/avideo/1788606033', ctx))?.thread?.boardUrl).toBe(
      'https://mercury.bbspink.com/avideo/',
    )
  })

  it('/test/read.cgi/ の前に道があるスレの URL も開く', async () => {
    const r = await twoChConnector.resolveUrl('https://example.com/bbs/test/read.cgi/news/1788606033/', ctx)
    expect(r?.board.url).toBe('https://example.com/bbs/news/')
  })

  it('板でもスレでもない URL は null', async () => {
    expect(await twoChConnector.resolveUrl('https://example.com/a/b/c.html', ctx)).toBeNull()
  })

  it('形は板の URL でも、ない板・スレ一覧でないものは理由を付けて断る', async () => {
    await expect(twoChConnector.resolveUrl('https://mi.5ch.io/nosuchboard/', ctx)).rejects.toThrow('板が見つかりません')
    await expect(twoChConnector.resolveUrl('https://example.com/foo/', ctx)).rejects.toThrow('掲示板の板ではないようです')
  })
})

describe('スレが立った日時', () => {
  it('5ch のお知らせスレのような未来の dat 番号は「不明」にする(勢いの計算が狂わないように)', async () => {
    const subject = '9240230830.dat<>★ UPLIFT プレミアム・サービスのお知らせ (2)\n1789358916.dat<>普通のスレ (10)\n'
    const ctx = fakeCtx(async (): Promise<HttpResponse> => ({
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: new TextEncoder().encode(subject),
    }))
    const [notice, normal] = await twoChConnector.listThreads({ connectorId: '2ch-compat', url: 'https://mevius.5ch.io/x/', name: 'x' }, ctx)
    expect(notice.createdAt).toBeUndefined()
    expect(normal.createdAt?.getTime()).toBe(1789358916 * 1000)
    // お知らせの印も付ける(アプリが一覧の一番下に回す)
    expect(notice.announcement).toBe(true)
    expect(normal.announcement).toBeUndefined()
  })
})

describe('スレタイの後ろの角かっこ(立てた人)', () => {
  it('ID★・BE 番号・ほかの名前や ID を、立てた人として取り出す', () => {
    expect(splitAuthorId('【悲報】移民の話 [YN3MdpLR★]')).toEqual({ title: '【悲報】移民の話', authorId: 'YN3MdpLR' })
    expect(splitAuthorId('ニュース [834922174]')).toEqual({ title: 'ニュース', authorId: 'BE:834922174' })
    expect(splitAuthorId('雑談スレ [ﾀﾋﾁｬﾝ]')).toEqual({ title: '雑談スレ', authorId: 'ﾀﾋﾁｬﾝ' })
    expect(splitAuthorId('雑談スレ ［ab12CD］')).toEqual({ title: '雑談スレ', authorId: 'ab12CD' })
    expect(splitAuthorId('雑談スレ [名無し さん]')).toEqual({ title: '雑談スレ', authorId: '名無し さん' })
  })
  it('決まり文句・© で始まるもの・角かっこだけのスレタイ・途中の角かっこは、スレタイのまま', () => {
    expect(splitAuthorId('ニュース [無断転載禁止]')).toEqual({ title: 'ニュース [無断転載禁止]' })
    expect(splitAuthorId('ニュース [©2ch.net]')).toEqual({ title: 'ニュース [©2ch.net]' })
    expect(splitAuthorId('[速報]')).toEqual({ title: '[速報]' })
    expect(splitAuthorId('[速報] 地震')).toEqual({ title: '[速報] 地震' })
    expect(splitAuthorId('ふつうのスレ')).toEqual({ title: 'ふつうのスレ' })
  })
})

describe('エッジの立てた人の ID(subject-metadent.txt)', () => {
  const fake = (routes: Record<string, string>) => {
    const got: string[] = []
    const ctx = fakeCtx(async (url): Promise<HttpResponse> => {
      got.push(url)
      if (!(url in routes)) return { status: 404, headers: {}, body: new Uint8Array() }
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: new TextEncoder().encode(routes[url]) }
    })
    return { ctx, got }
  }
  const board = { connectorId: '2ch-compat', url: 'https://bbs.eddibb.cc/liveedge/', name: 'liveedge' }

  it('エッジは subject-metadent.txt を読み、スレタイの後ろの [ID★] を立てた人の ID にする', async () => {
    const { ctx, got } = fake({
      'https://bbs.eddibb.cc/liveedge/subject-metadent.txt':
        '1792487946.dat<>【悲報】移民の話 [YN3MdpLR★] (158)\n1792483602.dat<>削除されるwww  [Xiz3GTQy★] (728)\n1792489148.dat<>IDのないスレ (7)\n',
    })
    const [a, b, c] = await twoChConnector.listThreads(board, ctx)
    expect(got).toEqual(['https://bbs.eddibb.cc/liveedge/subject-metadent.txt'])
    expect(a).toMatchObject({ title: '【悲報】移民の話', authorId: 'YN3MdpLR', postCount: 158 })
    expect(b).toMatchObject({ title: '削除されるwww', authorId: 'Xiz3GTQy' })
    expect(c.authorId).toBeUndefined()
    expect(c.title).toBe('IDのないスレ')
  })

  it('subject-metadent.txt がなければ subject.txt を読む。ほかの掲示板は subject.txt だけ', async () => {
    const edge = fake({ 'https://bbs.eddibb.cc/liveedge/subject.txt': '1792489148.dat<>ふつうのスレ [abc★] (7)\n' })
    const [t] = await twoChConnector.listThreads(board, edge.ctx)
    expect(edge.got).toEqual(['https://bbs.eddibb.cc/liveedge/subject-metadent.txt', 'https://bbs.eddibb.cc/liveedge/subject.txt'])
    // subject.txt のスレタイの後ろの角かっこも、立てた人として取り出す
    expect(t).toMatchObject({ title: 'ふつうのスレ', authorId: 'abc' })
    const five = fake({ 'https://mevius.5ch.io/x/subject.txt': '1789358916.dat<>普通のスレ (10)\n' })
    await twoChConnector.listThreads({ connectorId: '2ch-compat', url: 'https://mevius.5ch.io/x/', name: 'x' }, five.ctx)
    expect(five.got).toEqual(['https://mevius.5ch.io/x/subject.txt'])
  })
})

describe('文字コードの違うサイト', () => {
  const ctxOf = (res: HttpResponse): ConnectorContext => ({
    http: { get: async () => res, post: async () => res },
    decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
  }) as unknown as ConnectorContext

  it('板一覧だけ UTF-8 で charset がヘッダーにないサイトでも、板の名前を読める', async () => {
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body>
<a href="/cdn-cgi/content?id=x" aria-hidden="true" style="display:none"></a>
<br><br><b>庭園板一覧</b><br>
<a href="https://example.net/garden/">チューリップ庭園</a><br>
<a href="https://example.net/karesansui/">枯山水</a><br>
</body></html>`
    const res = { status: 200, headers: { 'content-type': 'text/html' }, body: new TextEncoder().encode(html) }
    const boards = await twoChConnector.listBoards!({ menuUrl: 'https://example.net/bbsmenu.html' } as never, ctxOf(res))
    expect(boards.map((b) => [b.category, b.name, b.url])).toEqual([
      ['庭園板一覧', 'チューリップ庭園', 'https://example.net/garden/'],
      ['庭園板一覧', '枯山水', 'https://example.net/karesansui/'],
    ])
  })

  it('UTF-8 の板へは UTF-8 で書き、Shift_JIS の板へは Shift_JIS で書く', async () => {
    const sent: string[] = []
    const ctxFor = (setting: Uint8Array): ConnectorContext => ({
      decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
      http: {
        get: async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: setting }),
        post: async (_url: string, body: string | Uint8Array) => {
          sent.push(String(body))
          return { status: 200, headers: {}, body: new TextEncoder().encode('<html><!-- 2ch_X:true --><title>書きこみました</title></html>') }
        },
      },
    }) as unknown as ConnectorContext
    const thread = (host: string) => ({ connectorId: '2ch', boardUrl: `https://${host}/b/`, key: '1000000000', title: '', postCount: 0, order: 0 })
    const input = { name: '', mail: '', body: 'あ' }
    await twoChConnector.createPost!(thread('utf8.example'), input, ctxFor(new TextEncoder().encode('BBS_TITLE=日本語の板\n')))
    // 「板」の Shift_JIS は 94 C2
    await twoChConnector.createPost!(thread('sjis.example'), input, ctxFor(Uint8Array.from([0x42, 0x42, 0x53, 0x3d, 0x94, 0xc2, 0x0a])))
    expect(sent[0]).toContain('MESSAGE=%E3%81%82')
    expect(sent[1]).toContain('MESSAGE=%82%A0')
  })

  it('200 で返るエラーのページでは、手元のログを置き換えない', async () => {
    const html = new TextEncoder().encode('<html>\n<body>Service Unavailable</body>\n</html>\n')
    const res = { status: 200, headers: { 'content-type': 'text/html' }, body: html }
    const thread = { connectorId: '2ch', boardUrl: 'https://example.net/b/', key: '1000000000', title: '', postCount: 0, order: 0 }
    const cursor = { bytes: 100, postCount: 3 }
    await expect(twoChConnector.fetchPosts(thread, cursor, ctxOf(res))).resolves.toMatchObject({ status: 'notModified', cursor })
    await expect(twoChConnector.fetchPosts(thread, null, ctxOf(res))).rejects.toThrow('スレを読めませんでした')
  })
})
