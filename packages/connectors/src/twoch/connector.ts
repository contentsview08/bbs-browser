// 2ch 互換コネクタ(標準コネクタ)。5ch、eddist、hono-bbs の互換窓口などを読む。
// いまは読む専用。書き込み(bbs.cgi)は capabilities.post を立てて後から足す。

import type {
  Board,
  Connector,
  ConnectorContext,
  Encoding,
  FetchPostsResult,
  HttpResponse,
  PostResult,
  ThreadSummary,
} from '../types'
import { parseBbsCgiResponse, parseBbsMenuHtml, parseBbsMenuJson, parseDat, parseSettingTxt, parseSubjectTxt } from './parse'
import { encodeShiftJisForm } from '../sjis'

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

/**
 * bbs.cgi へ送って応答を読み分ける(書き込みとスレ立てで共通)。
 * 5ch の「書き込み確認」は、受け取った Cookie を持ってもう一度送れば通る。それでも確認なら諦める
 */
async function sendBbsCgi(
  origin: string,
  fields: Record<string, string>,
  referer: string,
  ctx: ConnectorContext,
): Promise<PostResult> {
  const url = `${origin}/test/bbs.cgi`
  const body = encodeShiftJisForm(fields)
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await ctx.http.post(url, body, { headers })
    const r = parseBbsCgiResponse(ctx.decode(res.body, encodingOf(res)))
    if (r.status === 'confirm') continue
    if (r.status === 'ok') {
      // eddist は書き込んだレスの番号を x-resnum で返す
      const n = Number(res.headers['x-resnum'])
      return Number.isInteger(n) && n > 0 ? { ...r, resNumber: n } : r
    }
    if (r.status === 'error' && res.status >= 400 && !r.message) return { status: 'error', message: `HTTP ${res.status}` }
    return r
  }
  return { status: 'error', message: '書き込みの確認画面が繰り返し返されました' }
}

function threadWebUrl(thread: ThreadSummary): string {
  const u = new URL(thread.boardUrl)
  const board = u.pathname.replace(/\//g, '')
  return `${u.origin}/test/read.cgi/${board}/${thread.key}/`
}

/** dat 番号はスレが立った時刻の UNIX 秒(10 桁のときだけ信用する) */
function createdAtOf(key: string): Date | undefined {
  return /^\d{10}$/.test(key) ? new Date(Number(key) * 1000) : undefined
}

/** スレの URL(…/test/read.cgi/板/番号/)と板の URL(…/板/)を見分ける */
const THREAD_URL = /^(https?:\/\/[^/]+)\/test\/read\.cgi\/([^/?#]+)\/(\d+)/
const BOARD_URL = /^(https?:\/\/[^/]+)\/([^/?#]+)\/?(?:subject\.txt)?(?:[?#].*)?$/

/** 最後の改行までを切り出す(書き込み途中の行を読まないため) */
function completeLines(body: Uint8Array): Uint8Array {
  const last = body.lastIndexOf(LF)
  return last < 0 ? body.subarray(0, 0) : body.subarray(0, last + 1)
}

export const twoChConnector: Connector = {
  id: ID,
  name: '2ch 互換',
  capabilities: { post: true, images: false, incremental: true },

  canHandle(url) {
    return THREAD_URL.test(url) || BOARD_URL.test(url) || /\/bbsmenu\.(html|json)$/.test(url)
  },

  async resolveUrl(url, ctx) {
    const t = THREAD_URL.exec(url.trim())
    const b = t ? null : BOARD_URL.exec(url.trim())
    const [origin, dir] = t ? [t[1], t[2]] : b ? [b[1], b[2]] : []
    if (!origin || !dir || dir === 'test') return null
    const boardUrl = `${origin}/${dir}/`

    // 板名は SETTING.TXT の BBS_TITLE。取れなければディレクトリ名で代用する
    let name = dir
    try {
      const res = await ctx.http.get(`${boardUrl}SETTING.TXT`)
      if (res.status >= 200 && res.status < 300) {
        name = parseSettingTxt(ctx.decode(res.body, encodingOf(res))).BBS_TITLE || dir
      }
    } catch {
      // 板名が分からなくても開けるので握りつぶす
    }

    const board: Board = { connectorId: ID, url: boardUrl, name }
    if (!t) return { board }
    const key = t[3]
    return {
      board,
      thread: { connectorId: ID, boardUrl, key, title: '', postCount: 0, order: 0, createdAt: createdAtOf(key) },
    }
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
        createdAt: createdAtOf(e.key),
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

  async createPost(thread, input, ctx) {
    const board = new URL(thread.boardUrl)
    return sendBbsCgi(
      board.origin,
      {
        bbs: board.pathname.replace(/\//g, ''),
        key: thread.key,
        time: String(Math.floor(Date.now() / 1000)),
        FROM: input.name,
        mail: input.mail,
        MESSAGE: input.body,
        submit: '書き込む',
      },
      // 5ch はスレの URL を Referer に求める
      threadWebUrl(thread),
      ctx,
    )
  },

  async createThread(board, input, ctx) {
    const u = new URL(board.url)
    return sendBbsCgi(
      u.origin,
      {
        bbs: u.pathname.replace(/\//g, ''),
        subject: input.title,
        time: String(Math.floor(Date.now() / 1000)),
        FROM: input.name,
        mail: input.mail,
        MESSAGE: input.body,
        submit: '新規スレッド作成',
      },
      board.url,
      ctx,
    )
  },

  threadWebUrl,
}
