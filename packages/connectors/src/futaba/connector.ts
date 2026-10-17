// ふたば☆ちゃんねる(*.2chan.net)のコネクタ。2026-10-17 に may.2chan.net/b/ で確かめた作り:
// - 板の URL は https://サーバー.2chan.net/板/(例: https://may.2chan.net/b/)、スレは 板/res/番号.htm
// - スレ一覧はカタログ(板/futaba.php?mode=cat)。Cookie の cxyl で「列 x 行 x スレタイの文字数」を決められるので、
//   200 スレ・40 文字にして 1 回で取る。サムネイルの絵の名前はスレを立てた時刻(ミリ秒)
// - スレの中身は、最初はスレのページ(HTML)で全部、そのあとは JSON(futaba.php?mode=json&res=番号&start=最後の番号)で新しい返信だけ
// - レスの番号は板全体の通し番号(Post.ref)。アンカーは >No.番号 や >番号 の形でこの番号を指す(anchorTarget: 'ref')
// - スレは時間が来ると消える(ページが 404)。消えたら dat 落ちと同じに扱う。スレの数の上限(1000)はない
// - 書き込みは、スレのページのフォーム(id="fm"、板/futaba.php?guid=on へ POST)。隠し欄の hash は時刻入りでページごとに変わるので、
//   書き込む直前にページを取り直して写す。文字だけ(textonly=on)を Shift_JIS のフォームで送る。
//   ページを見たときに渡される Cookie(posttime など)がないと「cookieを有効にしてもう一度送信してください」で断られるので、
//   書き込みは読む通信と同じ Cookie の置き場で送る(sameCookiesAsGet)
//   ふたばの書き込みボタンの JavaScript(/bin/base4esc.js の ptfk)と同じく、
//   pthc・pthb に /bin/cachemt7.php の値、ptua にブラウザの機能の数、js=on・scsz を入れ、responsemode=ajax を付けて送る。
//   返事は書けたら「ok」(か JSON)、断られたらエラーの文。2026-10-17 に JavaScript を読んで合わせた

import type { Board, Connector, ConnectorContext, FetchPostsResult, PostResult, ThreadSummary } from '../types'
import { encodeShiftJisForm, shiftJisByteLength } from '../sjis'
import { parseCaco, parseCatalog, parseThreadJson, parseThreadPage, parsePostForm, parsePostResult, titleOf } from './parse'

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

/**
 * 書き込みの ptua: ふたばの JavaScript が、ブラウザの機能の有無(33 項目)を 2 の累乗で足し合わせた数。
 * WebView2(Chromium)で真になる項目(onLine・sessionStorage・currentScript・EventSource・crypto・performance・
 * AudioContext・indexedDB・sendBeacon・getGamepads・languages・mediaDevices・caches・createImageBitmap・onstorage・
 * getBattery・WebkitAppearance)を足したもの
 */
const CHROMIUM_PTUA = String([10, 11, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 30].reduce((n, b) => n + 2 ** b, 0))

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
  capabilities: { post: true, images: true, incremental: true },
  anchorTarget: 'ref',
  voteLabel: 'そうだね',
  // 引用は番号ではなく「>前のレスの文章」で書く
  textQuotes: true,

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

  async createPost(thread, input, ctx): Promise<PostResult> {
    // 書き込む直前にスレのページを取り直し、フォームの隠し欄(hash・ptua など)を写す
    const page = await ctx.http.get(threadWebUrl(thread))
    if (page.status === 404) return { status: 'error', message: 'スレが消えています(もう書き込めません)' }
    if (page.status !== 200) return { status: 'error', message: `スレのページを開けません(HTTP ${page.status})` }
    const form = parsePostForm(sjis(page.body, ctx))
    if (!form) return { status: 'error', message: '書き込みのフォームが見つかりません(スレが消えたか、ページの形が変わりました)' }
    // 書き込みボタンの JavaScript が入れる値。pthc は /bin/cachemt7.php の時刻、pthb は初めて書いたときのその値
    // (ブラウザでは localStorage に残す。ここでは毎回いまの値を入れる)
    let caco = ''
    try {
      const c = await ctx.http.get(`${originOf(thread.boardUrl)}/bin/cachemt7.php`)
      if (c.status === 200) caco = parseCaco(new TextDecoder().decode(c.body))
    } catch {
      // 取れなければ空のまま送る(断られたら、その文を出す)
    }
    const fields: Record<string, string> = {
      ...form.hidden,
      mode: 'regist',
      resto: thread.key,
      // JavaScript が動いたことにする(ふつうのブラウザと同じ)
      js: 'on',
      scsz: '1920x1080x24',
      pthc: caco,
      pthb: caco,
      ptua: CHROMIUM_PTUA,
      responsemode: 'ajax',
      name: input.name,
      email: input.mail,
      sub: '',
      com: input.body,
      textonly: 'on',
      pwd: '',
    }
    const url = new URL(form.action, threadWebUrl(thread)).href
    const res = await ctx.http.post(url, encodeShiftJisForm(fields), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: threadWebUrl(thread) },
      // ページを見たときに渡された Cookie(posttime など)が要る。ないと「cookieを有効にして…」で断られる
      sameCookiesAsGet: true,
    })
    const html = sjis(res.body, ctx)
    const r = parsePostResult(html)
    if (r.ok) console.info('[futaba] 書き込みの返事', html.slice(0, 200))
    return r.ok ? { status: 'ok', message: r.message } : { status: 'error', message: r.message, html }
  },

  postByteLength: shiftJisByteLength,

  threadWebUrl,
}
