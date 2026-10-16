import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shitarabaConnector } from '../src/shitaraba/connector'
import { twoChConnector } from '../src/twoch/connector'
import { builtinConnectors } from '../src/index'
import { encodeEucJpForm, eucJpByteLength } from '../src/eucjp'
import { parseShitarabaWrite } from '../src/shitaraba/parse'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

// 見本は作り物の中身を EUC-JP にしたもの(形は 2026-10 に実際の板で確かめたものに合わせた)
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))

/** URL ごとに応答を決めた偽サーバー */
function fake(routes: Record<string, { status?: number; body?: Uint8Array; headers?: Record<string, string> }>) {
  const got: string[] = []
  const ctx: ConnectorContext = {
    decode: (b, e) => new TextDecoder(e).decode(b),
    http: {
      async get(url): Promise<HttpResponse> {
        got.push(url)
        const r = routes[url]
        if (!r) return { status: 404, headers: { error: 'ERROR: THREAD NOT FOUND' }, body: new Uint8Array() }
        return { status: r.status ?? 200, headers: { 'content-type': 'text/plain; charset=EUC-JP', ...r.headers }, body: r.body ?? new Uint8Array() }
      },
      post: async () => {
        throw new Error('書き込まない')
      },
    },
  }
  return { ctx, got }
}

const board = { connectorId: 'shitaraba', url: 'https://jbbs.shitaraba.net/computer/351/', name: 'テスト板' }
const thread: ThreadSummary = { connectorId: 'shitaraba', boardUrl: board.url, key: '1600000000', title: '', postCount: 0, order: 0 }
const RAW = 'https://jbbs.shitaraba.net/bbs/rawmode.cgi/computer/351/1600000000/'

describe('したらばのコネクタ', () => {
  it('したらばの URL はしたらばのコネクタが受け持ち、2ch 互換は受け持たない', () => {
    const url = 'https://jbbs.shitaraba.net/bbs/read.cgi/computer/351/1600000000/'
    expect(shitarabaConnector.canHandle(url)).toBe(true)
    expect(twoChConnector.canHandle(url)).toBe(false)
    expect(builtinConnectors.find((c) => c.canHandle(url))?.id).toBe('shitaraba')
  })

  it('スレの URL から板とスレを割り出し、板名は setting.cgi から取る', async () => {
    const { ctx } = fake({ 'https://jbbs.shitaraba.net/bbs/api/setting.cgi/computer/351/': { body: fixture('shitaraba-setting.txt') } })
    const r = await shitarabaConnector.resolveUrl('https://jbbs.shitaraba.net/bbs/read.cgi/computer/351/1600000000/l50', ctx)
    expect(r?.board).toEqual(board)
    expect(r?.thread).toMatchObject({ key: '1600000000', boardUrl: board.url })
  })

  it('スレ一覧を読み、最後の繰り返しの行は除く', async () => {
    const { ctx } = fake({ [`${board.url}subject.txt`]: { body: fixture('shitaraba-subject.txt') } })
    const list = await shitarabaConnector.listThreads(board, ctx)
    expect(list.map((t) => [t.key, t.title, t.postCount])).toEqual([
      ['1600000000', 'テスト&スレ', 3],
      ['1500000000', 'ふたつめ', 1000],
    ])
  })

  it('スレの中身を全部読み、次は続きの番号から取る', async () => {
    const { ctx, got } = fake({ [RAW]: { body: fixture('shitaraba-raw.txt') }, [`${RAW}3-`]: { body: fixture('shitaraba-raw-diff.txt') } })
    const first = await shitarabaConnector.fetchPosts(thread, null, ctx)
    expect(first).toMatchObject({ status: 'updated', title: 'テストのスレ' })
    expect(first.posts).toEqual([
      { no: 1, name: '名無しさん', mail: 'sage', date: '2026/10/17(金) 10:00:00', id: 'abcd1234', body: '一行目\n二行目' },
      { no: 2, name: 'コテ', mail: '', date: '2026/10/17(金) 10:01:00', id: 'efgh5678', body: '>>1 ｱｲｳ' },
    ])
    const second = await shitarabaConnector.fetchPosts(thread, first.cursor, ctx)
    expect(second.posts.map((p) => p.no)).toEqual([3])
    expect(got.at(-1)).toBe(`${RAW}3-`)
  })

  it('新着がなければ「変化なし」', async () => {
    const { ctx } = fake({ [`${RAW}3-`]: { body: new Uint8Array() } })
    expect(await shitarabaConnector.fetchPosts(thread, { lastNo: 2 }, ctx)).toMatchObject({ status: 'notModified', posts: [] })
  })

  it('過去ログ倉庫に入ったスレは、中身を保存して dat 落ちとして扱い、次からは取りに行かない', async () => {
    const { ctx, got } = fake({ [RAW]: { body: fixture('shitaraba-raw.txt'), headers: { error: 'ERROR: STORAGE IN' } } })
    const r = await shitarabaConnector.fetchPosts(thread, null, ctx)
    expect(r).toMatchObject({ status: 'updated', archived: true })
    expect(await shitarabaConnector.fetchPosts(thread, r.cursor, ctx)).toMatchObject({ status: 'notModified', archived: true })
    expect(got).toHaveLength(1)
  })

  it('ないスレは dat 落ち', async () => {
    const { ctx } = fake({})
    expect(await shitarabaConnector.fetchPosts(thread, null, ctx)).toMatchObject({ status: 'archived' })
  })
})

describe('EUC-JP の書き込み', () => {
  it('EUC-JP で URL エンコードし、表にない文字は &#数字; にする', () => {
    expect(encodeEucJpForm({ MESSAGE: 'あ a' })).toBe('MESSAGE=%A4%A2+a')
    expect(encodeEucJpForm({ MESSAGE: 'ｱ' })).toBe('MESSAGE=%8E%B1')
    expect(encodeEucJpForm({ MESSAGE: '😀' })).toBe('MESSAGE=%26%23128512%3B')
  })

  it('バイト数を数える', () => {
    expect(eucJpByteLength('aあｱ\n')).toBe(1 + 2 + 2 + 2)
  })

  it('書き込みの応答を読む', () => {
    expect(parseShitarabaWrite('<html><head><title>書きこみました</title></head><body>書きこみました。</body></html>').status).toBe('ok')
    const e = parseShitarabaWrite('<html><head><title>ERROR</title></head><body>ERROR: 本文がありません</body></html>')
    expect(e).toMatchObject({ status: 'error' })
    expect(e.message).toContain('本文がありません')
  })
})

describe('したらばの板の確かめ', () => {
  it('ない板は理由を付けて断る', async () => {
    const { ctx } = fake({})
    await expect(shitarabaConnector.resolveUrl('https://jbbs.shitaraba.net/computer/99999999/', ctx)).rejects.toThrow('板が見つかりません')
  })
})
