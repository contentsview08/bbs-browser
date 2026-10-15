// 2ch 互換コネクタ(標準コネクタ)。5ch、eddist、hono-bbs の互換窓口などを読む。
// いまは読む専用。書き込み(bbs.cgi)は capabilities.post を立てて後から足す。

import type {
  Board,
  Connector,
  ConnectorContext,
  Encoding,
  FetchPostsResult,
  HttpResponse,
  ThreadSummary,
} from '../types'
import { parseBbsMenuHtml, parseBbsMenuJson, parseDat, parseSubjectTxt } from './parse'

/** dat 差分取得の続き */
interface DatCursor {
  /** 読み終えたバイト数(最後の改行まで) */
  bytes: number
  postCount: number
  lastModified?: string
}

const ID = '2ch-compat'
const LF = 0x0a

/** Content-Type の charset から文字コードを決める。書かれていなければ 2ch 互換の慣習どおり Shift_JIS */
function encodingOf(res: HttpResponse): Encoding {
  const charset = /charset=([^;]+)/i.exec(res.headers['content-type'] ?? '')?.[1].trim().toLowerCase()
  if (charset === 'utf-8' || charset === 'utf8') return 'utf-8'
  if (charset === 'euc-jp') return 'euc-jp'
  return 'shift_jis'
}

function ensureOk(res: HttpResponse, url: string): void {
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`)
}

function datUrl(thread: ThreadSummary): string {
  return `${thread.boardUrl}dat/${thread.key}.dat`
}

/** 最後の改行までを切り出す(書き込み途中の行を読まないため) */
function completeLines(body: Uint8Array): Uint8Array {
  const last = body.lastIndexOf(LF)
  return last < 0 ? body.subarray(0, 0) : body.subarray(0, last + 1)
}

export const twoChConnector: Connector = {
  id: ID,
  name: '2ch 互換',
  capabilities: { post: false, images: false, incremental: true },

  canHandle(url) {
    return /\/test\/read\.cgi\/[^/]+\/\d+/.test(url) || /\/subject\.txt$/.test(url) || /\/bbsmenu\.(html|json)$/.test(url)
  },

  async listBoards(site, ctx) {
    const res = await ctx.http.get(site.menuUrl)
    ensureOk(res, site.menuUrl)
    const text = ctx.decode(res.body, site.menuUrl.endsWith('.json') ? 'utf-8' : encodingOf(res))
    const parsed = site.menuUrl.endsWith('.json') ? parseBbsMenuJson(text) : parseBbsMenuHtml(text)
    return parsed.map((b): Board => ({ connectorId: ID, ...b }))
  },

  async listThreads(board, ctx) {
    const url = `${board.url}subject.txt`
    const res = await ctx.http.get(url)
    ensureOk(res, url)
    return parseSubjectTxt(ctx.decode(res.body, encodingOf(res))).map(
      (e, order): ThreadSummary => ({
        connectorId: ID,
        boardUrl: board.url,
        key: e.key,
        title: e.title,
        postCount: e.postCount,
        order,
        // dat 番号はスレが立った時刻の UNIX 秒(10 桁のときだけ信用する)
        createdAt: /^\d{10}$/.test(e.key) ? new Date(Number(e.key) * 1000) : undefined,
      }),
    )
  },

  async fetchPosts(thread, rawCursor, ctx): Promise<FetchPostsResult> {
    const url = datUrl(thread)
    const cursor = rawCursor as DatCursor | null

    const fetchAll = async (): Promise<FetchPostsResult> => {
      const res = await ctx.http.get(url)
      if (res.status === 404 || res.status === 302) return { status: 'archived', posts: [], cursor }
      ensureOk(res, url)
      const body = completeLines(res.body)
      const { posts, title } = parseDat(ctx.decode(body, encodingOf(res)))
      return {
        status: cursor ? 'reset' : 'updated',
        posts,
        title,
        cursor: { bytes: body.length, postCount: posts.length, lastModified: res.headers['last-modified'] } satisfies DatCursor,
      }
    }

    if (!cursor || cursor.bytes === 0) return fetchAll()

    // 1 バイト手前から取り、その 1 バイトが改行であることで「前回までの内容が変わっていない」と確かめる
    const headers: Record<string, string> = { Range: `bytes=${cursor.bytes - 1}-` }
    if (cursor.lastModified) headers['If-Modified-Since'] = cursor.lastModified
    const res = await ctx.http.get(url, { headers })

    if (res.status === 304) return { status: 'notModified', posts: [], cursor }
    if (res.status === 404 || res.status === 302) return { status: 'archived', posts: [], cursor }
    // 416 はファイルが縮んだ(あぼーん等)、200 はサーバーが Range を無視した
    if (res.status === 416 || res.status === 200) return fetchAll()
    if (res.status !== 206) ensureOk(res, url)
    if (res.body[0] !== LF) return fetchAll()

    const added = completeLines(res.body.subarray(1))
    const { posts } = parseDat(ctx.decode(added, encodingOf(res)), cursor.postCount + 1)
    return {
      status: 'updated',
      posts,
      cursor: {
        bytes: cursor.bytes + added.length,
        postCount: cursor.postCount + posts.length,
        lastModified: res.headers['last-modified'] ?? cursor.lastModified,
      } satisfies DatCursor,
    }
  },

  threadWebUrl(thread) {
    const u = new URL(thread.boardUrl)
    const board = u.pathname.replace(/\//g, '')
    return `${u.origin}/test/read.cgi/${board}/${thread.key}/`
  },
}
