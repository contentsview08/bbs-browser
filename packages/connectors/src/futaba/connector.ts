// ふたば☆ちゃんねる(*.2chan.net)のコネクタ。読むだけ(書き込みはまだ)。2026-10-17 に may.2chan.net/b/ で確かめた作り:
// - 板の URL は https://サーバー.2chan.net/板/(例: https://may.2chan.net/b/)、スレは 板/res/番号.htm
// - スレ一覧はカタログ(板/futaba.php?mode=cat)。Cookie の cxyl で「列 x 行 x スレタイの文字数」を決められるので、
//   200 スレ・40 文字にして 1 回で取る。サムネイルの絵の名前はスレを立てた時刻(ミリ秒)
// - スレの中身は、最初はスレのページ(HTML)で全部、そのあとは JSON(futaba.php?mode=json&res=番号&start=最後の番号)で新しい返信だけ
// - レスの番号は板全体の通し番号(Post.ref)。アンカーは >No.番号 や >番号 の形でこの番号を指す(anchorTarget: 'ref')
// - スレは時間が来ると消える(ページが 404)。消えたら dat 落ちと同じに扱う。スレの数の上限(1000)はない

import type { Board, Connector, ConnectorContext, FetchPostsResult, ThreadSummary } from '../types'
import { parseCatalog, parseThreadJson, parseThreadPage, titleOf } from './parse'

const ID = 'futaba'

interface RawCursor {
  /** 取り終えた最後のレスの、板の通し番号 */
  lastRef: number
  /** 取り終えた最後のレスの、スレの中の番号 */
  lastNo: number
}

const HOST = /^https?:\/\/[a-z0-9]+\.2chan\.net\//
const THREAD_URL = /^https?:\/\/([a-z0-9]+)\.2chan\.net\/([a-z0-9]+)\/res\/(\d+)\.html?/
const BOARD_URL = /^https?:\/\/([a-z0-9]+)\.2chan\.net\/([a-z0-9]+)\/?(?:futaba\.html?|futaba\.php[^#]*)?(?:#.*)?$/

/** カタログを 200 スレ(20 列 x 10 行)・スレタイ 40 文字で返してもらう */
const CATALOG_COOKIE = 'cxyl=20x10x40x0x0'

const boardUrlOf = (server: string, board: string) => `https://${server}.2chan.net/${board}/`
const originOf = (boardUrl: string) => new URL(boardUrl).origin
const sjis = (bytes: Uint8Array, ctx: ConnectorContext) => ctx.decode(bytes, 'shift_jis')

/** サムネイルの絵の名前(スレを立てた時刻のミリ秒)から、スレの作られた時刻 */
function createdAtOfThumb(thumb: string | undefined): Date | undefined {
  const ms = thumb ? /\/(\d{13})s\.\w+$/.exec(thumb)?.[1] : undefined
  return ms ? new Date(Number(ms)) : undefined
}

function threadWebUrl(thread: ThreadSummary): string {
  return `${thread.boardUrl}res/${thread.key}.htm`
}

/** スレを立てた人のレスの、本文の最初の行(画像の URL は除く)。URL から開いたスレのスレタイにする */
function titleFromOp(body: string): string {
  const line = body.split('\n').find((l) => l.trim() && !/^https?:\/\//.test(l)) ?? ''
  return line.trim().slice(0, 60)
}

export const futabaConnector: Connector = {
  id: ID,
  name: 'ふたば☆ちゃんねる',
  capabilities: { post: false, images: true, incremental: true },
  anchorTarget: 'ref',
  voteLabel: 'そうだね',

  canHandle(url) {
    return HOST.test(url)
  },

  isThreadUrl(url) {
    return THREAD_URL.test(url)
  },

  async resolveUrl(url, ctx) {
    const t = THREAD_URL.exec(url)
    const b = t ? undefined : BOARD_URL.exec(url)
    const server = t?.[1] ?? b?.[1]
    const name = t?.[2] ?? b?.[2]
    if (!server || !name) return null
    const boardUrl = boardUrlOf(server, name)
    // 板の名前は、板の入口のページの <title> から(「二次元裏＠ふたば」など)
    let res
    try {
      res = await ctx.http.get(`${boardUrl}futaba.htm`)
    } catch (e) {
      throw new Error(`ふたばに届きません(${e instanceof Error ? e.message : String(e)})`)
    }
    if (res.status === 404) throw new Error('ふたばの板が見つかりません(HTTP 404)')
    if (res.status !== 200) throw new Error(`ふたばの板を開けません(HTTP ${res.status})`)
    const board: Board = { connectorId: ID, url: boardUrl, name: titleOf(sjis(res.body, ctx)) || `${server}/${name}` }
    if (!t) return { board }
    return { board, thread: { connectorId: ID, boardUrl, key: t[3], title: '', postCount: 0, order: 0 } }
  },

  async boardInfo(board) {
    // 名無しの名前は板ごとに違う(二次元裏は「としあき」)が、決まった置き場がないので持たない
    return { title: board.name }
  },

  // 板の一覧は公開されていないので、板は URL で足してもらう
  async listBoards() {
    return []
  },

  async listThreads(board, ctx) {
    const url = `${board.url}futaba.php?mode=cat`
    const res = await ctx.http.get(url, { headers: { Cookie: CATALOG_COOKIE } })
    if (res.status === 404) throw new Error(`ふたばの板が見つかりません(HTTP 404): ${board.url}`)
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
    const html = sjis(res.body, ctx)
    if (!html.includes("id='cattable'")) throw new Error(`カタログを読めませんでした: ${board.url}`)
    const origin = originOf(board.url)
    return parseCatalog(html).map((e, i) => ({
      connectorId: ID,
      boardUrl: board.url,
      key: e.key,
      title: e.title,
      // カタログの数は返信だけなので、スレを立てた人のレスを足す
      postCount: e.replies + 1,
      order: i,
      createdAt: createdAtOfThumb(e.thumb),
      ...(e.thumb && { thumb: new URL(e.thumb, origin).href }),
    }))
  },

  async fetchPosts(thread, rawCursor, ctx): Promise<FetchPostsResult> {
    const cursor = rawCursor as RawCursor | null
    const origin = originOf(thread.boardUrl)
    if (!cursor) {
      // 最初は、スレのページで全部を取る(スレを立てた人のレスは JSON に入っていないため)
      const res = await ctx.http.get(threadWebUrl(thread))
      if (res.status === 404) return { status: 'archived', posts: [], cursor }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${threadWebUrl(thread)}`)
      const page = parseThreadPage(sjis(res.body, ctx), origin)
      if (!page) return { status: 'archived', posts: [], cursor }
      const { posts, votes } = page
      const last = posts.at(-1)!
      return {
        status: 'updated',
        posts,
        votes,
        cursor: { lastRef: last.ref ?? 0, lastNo: last.no } satisfies RawCursor,
        ...(!thread.title && { title: titleFromOp(posts[0].body) }),
      }
    }
    // そのあとは、JSON で最後の番号より新しい返信だけ
    const url = `${thread.boardUrl}futaba.php?mode=json&res=${thread.key}&start=${cursor.lastRef}`
    const res = await ctx.http.get(url)
    if (res.status === 404) return { status: 'archived', posts: [], cursor }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
    let parsed
    try {
      parsed = parseThreadJson(new TextDecoder().decode(res.body), origin)
    } catch {
      // スレが消えると JSON ではなく HTML の知らせが返る
      return { status: 'archived', posts: [], cursor }
    }
    const fresh = parsed.posts.filter((p) => (p.ref ?? 0) > cursor.lastRef)
    // そうだねは前のレスにも増えるので、新しいレスがなくても返す
    if (fresh.length === 0) return { status: 'notModified', posts: [], cursor, votes: parsed.votes }
    const last = fresh.at(-1)!
    return { status: 'updated', posts: fresh, votes: parsed.votes, cursor: { lastRef: last.ref ?? cursor.lastRef, lastNo: last.no } satisfies RawCursor }
  },

  threadWebUrl,
}
