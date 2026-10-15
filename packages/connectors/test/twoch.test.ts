import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { twoChConnector } from '../src/twoch/connector'
import { parseBbsMenuHtml, parseDatLine, parseSubjectTxt } from '../src/twoch/parse'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const sjis = (bytes: Uint8Array) => new TextDecoder('shift_jis').decode(bytes)

/** 1 つの dat を返す偽サーバー。Range と If-Modified-Since をそれらしく扱う */
function fakeServer(initial: Uint8Array) {
  const state = { body: initial, lastModified: 'Thu, 01 Oct 2026 00:00:00 GMT' }
  const ctx: ConnectorContext = {
    decode: (bytes, enc) => new TextDecoder(enc).decode(bytes),
    http: {
      async get(_url, opts): Promise<HttpResponse> {
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
      },
      post: async () => {
        throw new Error('この試験では書き込まない')
      },
    },
  }
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
})

describe('resolveUrl', () => {
  // SETTING.TXT だけを返す偽サーバー
  const ctx: ConnectorContext = {
    decode: (bytes, enc) => new TextDecoder(enc).decode(bytes),
    http: {
      async get(url): Promise<HttpResponse> {
        if (url === 'https://bbs.eddibb.cc/liveedge/SETTING.TXT') {
          const body = new TextEncoder().encode('liveedge@liveedge\nBBS_TITLE=エッヂ\nBBS_NONAME_NAME=エッヂの名無し\n')
          return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body }
        }
        return { status: 404, headers: {}, body: new Uint8Array() }
      },
      post: async () => {
        throw new Error('この試験では書き込まない')
      },
    },
  }

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

  it('SETTING.TXT が取れなければディレクトリ名を板名にする', async () => {
    const r = await twoChConnector.resolveUrl('https://medaka.5ch.io/prog/', ctx)
    expect(r?.board.name).toBe('prog')
  })

  it('板でもスレでもない URL は null', async () => {
    expect(await twoChConnector.resolveUrl('https://example.com/a/b/c.html', ctx)).toBeNull()
  })
})
