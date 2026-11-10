import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { gunzip } from '../src/gzip'
import { twoChConnector } from '../src/twoch/connector'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

const enc = new TextEncoder()
// 過去ログの dat(中身は UTF-8 で用意し、decode も UTF-8 にする)
const KAKO = enc.encode('名無し<><>2026/10/16 ID:a<> 一つ目 <>過去ログのスレ\n名無し<><>2026/10/16 ID:b<> 二つ目 <>\n')

/** URL ごとに応答を決めた偽サーバー。取りに来た URL を記録する */
function fake(routes: Record<string, { status: number; body?: Uint8Array }>) {
  const got: string[] = []
  const ctx: ConnectorContext = {
    decode: (b) => new TextDecoder('utf-8').decode(b),
    http: {
      async get(url): Promise<HttpResponse> {
        got.push(url)
        const r = routes[url] ?? { status: 404 }
        return { status: r.status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: r.body ?? new Uint8Array() }
      },
      post: async () => {
        throw new Error('書き込まない')
      },
    },
  }
  return { ctx, got }
}

const thread = (boardUrl: string): ThreadSummary => ({
  connectorId: '2ch-compat',
  boardUrl,
  key: '1792148654',
  title: '',
  postCount: 0,
  order: 0,
})

describe('dat 落ちしたスレの過去ログ', () => {
  it('5ch は dat が 404 なら oyster から全部取り、dat 落ちとして返す', async () => {
    const t = thread('https://mi.5ch.io/news4vip/')
    const { ctx, got } = fake({ 'https://mi.5ch.io/news4vip/oyster/1792/1792148654.dat': { status: 200, body: KAKO } })
    const r = await twoChConnector.fetchPosts(t, null, ctx)
    expect(got).toEqual(['https://mi.5ch.io/news4vip/dat/1792148654.dat', 'https://mi.5ch.io/news4vip/oyster/1792/1792148654.dat'])
    expect(r).toMatchObject({ status: 'updated', archived: true, title: '過去ログのスレ' })
    expect(r.posts.map((p) => p.body)).toEqual(['一つ目', '二つ目'])

    // 過去ログはもう変わらないので、次からは取りに行かない
    const again = await twoChConnector.fetchPosts(t, r.cursor, ctx)
    expect(again).toMatchObject({ status: 'notModified', archived: true })
    expect(got).toHaveLength(2)
  })

  it('途中まで読んでいたスレが落ちたら、過去ログで全部取り直す', async () => {
    const t = thread('https://mi.5ch.io/news4vip/')
    const { ctx } = fake({ 'https://mi.5ch.io/news4vip/oyster/1792/1792148654.dat': { status: 200, body: KAKO } })
    const r = await twoChConnector.fetchPosts(t, { bytes: 10, postCount: 1 }, ctx)
    expect(r).toMatchObject({ status: 'reset', archived: true })
    expect(r.posts).toHaveLength(2)
  })

  it('過去ログもなければ、dat 落ちとだけ返す(候補を全部試して終わる)', async () => {
    const { ctx, got } = fake({})
    expect(await twoChConnector.fetchPosts(thread('https://mi.5ch.io/news4vip/'), null, ctx)).toMatchObject({ status: 'archived', posts: [] })
    expect(got).toEqual([
      'https://mi.5ch.io/news4vip/dat/1792148654.dat',
      'https://mi.5ch.io/news4vip/oyster/1792/1792148654.dat',
      'https://mi.5ch.io/news4vip/kako/1792/17921/1792148654.dat.gz',
      'https://mi.5ch.io/news4vip/kako/1792/17921/1792148654.dat',
    ])
  })

  it('途中まで読んでいたスレの過去ログもなければ、手元のカーソルのまま dat 落ち', async () => {
    const { ctx } = fake({})
    const c = { bytes: 10, postCount: 1 }
    const r = await twoChConnector.fetchPosts(thread('https://bbs.eddibb.cc/liveedge/'), c, ctx)
    expect(r).toMatchObject({ status: 'archived', posts: [] })
    expect(r.cursor).toBe(c)
  })
})

describe('2ch 互換の過去ログ倉庫(kako)', () => {
  const edge = thread('https://bbs.eddibb.cc/liveedge/')
  const gz = 'https://bbs.eddibb.cc/liveedge/kako/1792/17921/1792148654.dat.gz'
  const plain = 'https://bbs.eddibb.cc/liveedge/kako/1792/17921/1792148654.dat'

  it('dat.gz が gzip のまま届いたら解いて読み、そこで止まる', async () => {
    const { ctx, got } = fake({ [gz]: { status: 200, body: new Uint8Array(gzipSync(KAKO)) }, [plain]: { status: 200, body: KAKO } })
    const r = await twoChConnector.fetchPosts(edge, null, ctx)
    expect(got).toEqual(['https://bbs.eddibb.cc/liveedge/dat/1792148654.dat', gz])
    expect(r).toMatchObject({ status: 'updated', archived: true, title: '過去ログのスレ', cursor: { kako: true, postCount: 2 } })
    expect(r.posts.map((p) => p.body)).toEqual(['一つ目', '二つ目'])
  })

  it('dat.gz が Content-Encoding で解かれて届いても、そのまま読む', async () => {
    const { ctx } = fake({ [gz]: { status: 200, body: KAKO } })
    const r = await twoChConnector.fetchPosts(edge, null, ctx)
    expect(r).toMatchObject({ status: 'updated', archived: true })
    expect(r.posts).toHaveLength(2)
  })

  it('dat.gz がなければ .dat を探す', async () => {
    const { ctx, got } = fake({ [plain]: { status: 200, body: KAKO } })
    const r = await twoChConnector.fetchPosts(edge, { bytes: 10, postCount: 1 }, ctx)
    expect(got.at(-2)).toBe(gz)
    expect(got.at(-1)).toBe(plain)
    expect(r).toMatchObject({ status: 'reset', archived: true })
    expect(r.posts).toHaveLength(2)
  })

  it('壊れた gzip は次の候補へ回る', async () => {
    const broken = new Uint8Array(gzipSync(KAKO)).subarray(0, 12)
    const { ctx } = fake({ [gz]: { status: 200, body: broken }, [plain]: { status: 200, body: KAKO } })
    expect((await twoChConnector.fetchPosts(edge, null, ctx)).posts).toHaveLength(2)
  })

  it('9 桁のキーは頭 3 桁の下を探す', async () => {
    const t = { ...edge, key: '123456789' }
    const { ctx, got } = fake({})
    expect((await twoChConnector.fetchPosts(t, null, ctx)).status).toBe('archived')
    expect(got.slice(1)).toEqual([
      'https://bbs.eddibb.cc/liveedge/kako/123/123456789.dat.gz',
      'https://bbs.eddibb.cc/liveedge/kako/123/123456789.dat',
    ])
  })

  it('過去ログはリダイレクトをたどらずに取る', async () => {
    const asked: boolean[] = []
    const { ctx } = fake({})
    const get = ctx.http.get
    ctx.http.get = (url, opts) => (asked.push(opts?.noRedirect === true), get(url, opts))
    await twoChConnector.fetchPosts(edge, null, ctx)
    expect(asked).toEqual([true, true, true])
  })
})

describe('gzip を解く', () => {
  it('解いた後が上限を超えるものは止める', async () => {
    const big = new Uint8Array(gzipSync(new Uint8Array(1024 * 1024)))
    expect(await gunzip(big, 1000)).toBeUndefined()
    expect((await gunzip(big))?.length).toBe(1024 * 1024)
  })
})

describe('dat 落ちを 302 で知らせる板', () => {
  /** リダイレクトをたどる通信なら行き先の HTML(200)を返し、たどらない取り方なら 302 をそのまま返す */
  function redirecting() {
    const asked: { url: string; noRedirect: boolean }[] = []
    const ctx: ConnectorContext = {
      decode: (b) => new TextDecoder('utf-8').decode(b),
      http: {
        async get(url, opts): Promise<HttpResponse> {
          asked.push({ url, noRedirect: opts?.noRedirect === true })
          if (opts?.noRedirect) return { status: 302, headers: { location: 'https://example.test/dead.html' }, body: new Uint8Array() }
          return { status: 200, headers: { 'content-type': 'text/html' }, body: enc.encode('<html>スレッドは落ちました</html>') }
        },
        post: async () => {
          throw new Error('書き込まない')
        },
      },
    }
    return { ctx, asked }
  }

  it('差分の取得でも全部の取得でも、dat はたどらずに取り、302 を dat 落ちにする', async () => {
    const t = thread('https://example.test/board/')
    const { ctx, asked } = redirecting()
    expect(await twoChConnector.fetchPosts(t, { bytes: 10, postCount: 1 }, ctx)).toMatchObject({ status: 'archived' })
    expect(await twoChConnector.fetchPosts(t, null, ctx)).toMatchObject({ status: 'archived' })
    expect(asked.every((a) => a.noRedirect)).toBe(true)
  })
})
