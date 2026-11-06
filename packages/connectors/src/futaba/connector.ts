// ふたば☆ちゃんねる(*.2chan.net)のコネクタ。2026-10-17 に may.2chan.net/b/ で確かめた作り:
// - 板の URL は https://サーバー.2chan.net/板/(例: https://may.2chan.net/b/)、スレは 板/res/番号.htm
// - スレ一覧はカタログ(板/futaba.php?mode=cat)。Cookie の cxyl で「列 x 行 x スレタイの文字数」を決められるので、
//   200 スレ・40 文字にして 1 回で取る。サムネイルの絵の名前はスレを立てた時刻(ミリ秒)
// - スレの中身は、最初はスレのページ(HTML)で全部、そのあとは JSON(futaba.php?mode=json&res=番号&start=最後の番号)で新しい返信だけ
// - レスの番号は板全体の通し番号(Post.ref)。アンカーは >No.番号 や >番号 の形でこの番号を指す(anchorTarget: 'ref')
// - スレは時間が来ると消える(ページが 404)。消えたら dat 落ちと同じに扱う。スレの数の上限(1000)はない
// - 書き込みの送り方はほかの掲示板と違う。詳しいことは非公開の資料に置いている

import type { Board, Connector, ConnectorContext, FetchPostsResult, HttpResponse, ListSort, PostFile, PostInput, PostResult, ThreadSummary } from '../types'
import { shiftJisByteLength } from '../sjis'
import { detectEncoding } from '../encoding'
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

/**
 * ふたばへの通信は、ふつうのブラウザの名乗り(User-Agent)で送る。専ブラの名乗り(Monazilla)のままだと、
 * 書き込みが「書きこみました」と返るのに出てこない(黙って捨てられる)ことがあったため。ptua も Chromium の値にしてある
 */
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
}

/** 書き込みの pthb に入れる、このアプリを開いてから初めて書いたときの pthc(ブラウザの localStorage の代わり) */
let firstCaco: string | undefined

/**
 * multipart/form-data の本文(バイト列)。文字の欄は UTF-8、upfile の欄はファイルの中身(なければ空のファイル)。
 * upfile はフォームと同じく textonly・pwd の前に置く
 */
function multipart(fields: [string, string][], boundary: string, file?: PostFile): Uint8Array {
  const crlf = '\r\n'
  const enc = new TextEncoder()
  const text = (k: string, v: string) => enc.encode(`--${boundary}${crlf}Content-Disposition: form-data; name="${k}"${crlf}${crlf}${v.replace(/\r?\n/g, crlf)}${crlf}`)
  // ファイル名の " と改行は、ブラウザと同じく %22・%0A などに置き換える
  const fname = (file?.name ?? '').replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  const upfile = [
    enc.encode(`--${boundary}${crlf}Content-Disposition: form-data; name="upfile"; filename="${fname}"${crlf}Content-Type: ${file?.type || 'application/octet-stream'}${crlf}${crlf}`),
    file?.data ?? new Uint8Array(),
    enc.encode(crlf),
  ]
  const at = fields.findIndex(([k]) => k === 'textonly' || k === 'pwd')
  const before = at < 0 ? fields : fields.slice(0, at)
  const after = at < 0 ? [] : fields.slice(at)
  const chunks = [...before.map(([k, v]) => text(k, v)), ...upfile, ...after.map(([k, v]) => text(k, v)), enc.encode(`--${boundary}--${crlf}`)]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

/** カタログを 200 スレ(20 列 x 10 行)・スレタイ 40 文字で返してもらう */
const CATALOG_COOKIE = 'cxyl=20x10x40x0x0'

const boardUrlOf = (server: string, board: string) => `https://${server}.2chan.net/${board}/`
const originOf = (boardUrl: string) => new URL(boardUrl).origin
const sjis = (res: HttpResponse, ctx: ConnectorContext) => ctx.decode(res.body, detectEncoding(res.body, res.headers['content-type'], 'shift_jis'))

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

/**
 * 書き込み・スレ立てを送る(ふたばの書き込みボタンの JavaScript と同じ送り方)。
 * pageUrl のページのフォームの隠し欄を写し、extra(返信なら resto、スレ立てなら sub)と本文・ファイルを足して送る
 */
async function sendRegist(
  pageUrl: string,
  boardUrl: string,
  extra: { resto?: string; sub?: string },
  input: PostInput,
  ctx: ConnectorContext,
): Promise<PostResult> {
  // 書き込む直前にページを取り直し、フォームの隠し欄(hash・ptua など)を写す
  const page = await ctx.http.get(pageUrl, { headers: BROWSER })
  if (page.status === 404) return { status: 'error', message: extra.resto ? 'スレが消えています(もう書き込めません)' : '板のページが見つかりません' }
  if (page.status !== 200) return { status: 'error', message: `ページを開けません(HTTP ${page.status})` }
  const form = parsePostForm(sjis(page, ctx))
  if (!form) return { status: 'error', message: '書き込みのフォームが見つかりません(スレが消えたか、ページの形が変わりました)' }
  // 書き込みボタンの JavaScript が入れる値。pthc は /bin/cachemt7.php の時刻
  let caco = ''
  try {
    const c = await ctx.http.get(`${originOf(boardUrl)}/bin/cachemt7.php`, { headers: BROWSER })
    if (c.status === 200) caco = parseCaco(new TextDecoder().decode(c.body))
  } catch {
    // 取れなければ空のまま送る(断られたら、その文を出す)
  }
  // pthb は、ブラウザなら localStorage に残した「初めて書いたときの pthc」。初めては空で、2 回目からその値を入れる
  // (いつも pthc と同じ値だと、ふつうのブラウザではありえない組み合わせになる)。ここではアプリを開いている間だけ覚える
  const pthb = firstCaco ?? ''
  if (firstCaco === undefined && caco) firstCaco = caco
  const file = input.files?.[0]
  // ふたばのフォームと同じ並びで、書き込みボタンの JavaScript が埋める値を入れる
  const fields: [string, string][] = [
    ...Object.entries({
      ...form.hidden,
      mode: 'regist',
      pthb,
      pthc: caco,
      ptua: CHROMIUM_PTUA,
      // JavaScript が動いたことにする(ふつうのブラウザと同じ)
      scsz: '1920x1080x24',
      js: 'on',
      // サーバーはこの欄の文字の形で、送られた文字コード(UTF-8)を見分ける
      chrenc: '文字',
      ...(extra.resto && { resto: extra.resto }),
    }),
    ['name', input.name],
    ['email', input.mail],
    ['sub', extra.sub ?? ''],
    ['com', input.body],
    // ファイルを付けないときは「画像なし」にする
    ...(file ? [] : [['textonly', 'on'] as [string, string]]),
    // 削除キー。アプリが覚えておき、自分の書き込みを消すとき(deletePost)に同じものを送る
    ['pwd', input.deleteKey ?? ''],
    ['responsemode', 'ajax'],
  ]
  const url = new URL(form.action, pageUrl).href
  // ブラウザの FormData と同じく、multipart/form-data で、文字は UTF-8 で送る(ファイルがなくても upfile の欄は空で付く)
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2, 18)}`
  const res = await ctx.http.post(url, multipart(fields, boundary, file), {
    headers: { ...BROWSER, 'Content-Type': `multipart/form-data; boundary=${boundary}`, Referer: pageUrl, Origin: originOf(boardUrl) },
    // ページを見たときに渡された Cookie(posttime など)が要る。ないと「cookieを有効にして…」で断られる
    sameCookiesAsGet: true,
  })
  const html = sjis(res, ctx)
  const r = parsePostResult(html)
  // 書けたときも、ふたばが何と返したかを添える(書けたのに出てこないときに、手がかりにするため)
  return r.ok
    ? { status: 'ok', message: `${r.message}(ふたばの返事: ${html.trim().slice(0, 80)})`, ...(r.ref !== undefined && { ref: r.ref }) }
    : { status: 'error', message: r.message, html }
}

/** そうだね(ふたばの、レスへの反応は 1 種類だけ) */
const SODANE = 'sodane'
/** パーサーが返す「番号 → そうだねの数」を、反応の形(番号 → { sodane: 数 })にする */
const sodane = (votes: Record<string, number>): Record<string, Record<string, number>> =>
  Object.fromEntries(Object.entries(votes).map(([ref, n]) => [ref, { [SODANE]: n }]))

/** サーバーに頼む並び順と、カタログの sort の番号 */
const CATALOG_SORT: Record<ListSort, number> = { newest: 1, oldest: 2, most: 3, fewest: 4, momentum: 6 }

/** 板の URL の道の頭(https://may.2chan.net/b/ なら b) */
const boardNameOf = (boardUrl: string) => new URL(boardUrl).pathname.split('/').filter(Boolean)[0]

export const futabaConnector: Connector = {
  id: ID,
  name: 'ふたば☆ちゃんねる',
  anchorTarget: 'ref',
  reactions: [{ id: SODANE, label: 'そうだね', icon: 'thumb_up' }],
  // 引用は番号ではなく「>前のレスの文章」で書く
  textQuotes: true,
  // 書き込みに画像・動画を 1 つ付けられる(フォームの MAX_FILE_SIZE と「添付可能:GIF,JPG,PNG,WEBM,MP4」)
  attachments: { maxFiles: 1, maxBytes: 8_192_000, types: ['image/gif', 'image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4'] },

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
      res = await ctx.http.get(`${boardUrl}futaba.htm`, { headers: BROWSER })
    } catch (e) {
      throw new Error(`ふたばに届きません(${e instanceof Error ? e.message : String(e)})`)
    }
    if (res.status === 404) throw new Error('ふたばの板が見つかりません(HTTP 404)')
    if (res.status !== 200) throw new Error(`ふたばの板を開けません(HTTP ${res.status})`)
    const board: Board = { connectorId: ID, url: boardUrl, name: titleOf(sjis(res, ctx)) || `${server}/${name}` }
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

  // カタログの並び順(futaba.php?mode=cat&sort=番号)。番号はカタログのページの「新順・古順・多順・少順・勢順」のリンクで確かめた(2026-10-18)。
  // 並び順を変えると、更新順の上位に入っていないスレも載る(板のスレ全部から選び直す)
  serverSorts: ['momentum', 'newest', 'oldest', 'most', 'fewest'],

  async listThreads(board, ctx, opts) {
    const sort = opts?.sort ? CATALOG_SORT[opts.sort] : undefined
    const url = `${board.url}futaba.php?mode=cat${sort ? `&sort=${sort}` : ''}`
    const res = await ctx.http.get(url, { headers: { ...BROWSER, Cookie: CATALOG_COOKIE } })
    if (res.status === 404) throw new Error(`ふたばの板が見つかりません(HTTP 404): ${board.url}`)
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
    const html = sjis(res, ctx)
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
      const res = await ctx.http.get(threadWebUrl(thread), { headers: BROWSER })
      if (res.status === 404) return { status: 'archived', posts: [], cursor }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${threadWebUrl(thread)}`)
      const page = parseThreadPage(sjis(res, ctx), origin)
      if (!page) return { status: 'archived', posts: [], cursor }
      const { posts, votes } = page
      const last = posts.at(-1)!
      return {
        status: 'updated',
        posts,
        reactions: sodane(votes),
        cursor: { lastRef: last.ref ?? 0, lastNo: last.no } satisfies RawCursor,
        ...(!thread.title && { title: titleFromOp(posts[0].body) }),
      }
    }
    // そのあとは、JSON で最後の番号より新しい返信だけ
    const url = `${thread.boardUrl}futaba.php?mode=json&res=${thread.key}&start=${cursor.lastRef}`
    const res = await ctx.http.get(url, { headers: BROWSER })
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
    if (fresh.length === 0) return { status: 'notModified', posts: [], cursor, reactions: sodane(parsed.votes) }
    const last = fresh.at(-1)!
    return { status: 'updated', posts: fresh, reactions: sodane(parsed.votes), cursor: { lastRef: last.ref ?? cursor.lastRef, lastNo: last.no } satisfies RawCursor }
  },

  async createPost(thread, input, ctx): Promise<PostResult> {
    return sendRegist(threadWebUrl(thread), thread.boardUrl, { resto: thread.key }, input, ctx)
  },

  // 自分の書き込みを消す: 板/futaba.php?guid=on へ mode=usrdel・番号=delete・pwd=削除キー(ふたばの JavaScript の usrdelsend と同じ)
  async deletePost(thread, post, deleteKey, ctx): Promise<PostResult> {
    const ref = post.ref ?? post.no
    const board = boardNameOf(thread.boardUrl)
    const body = new URLSearchParams({ responsemode: 'ajax', pwd: deleteKey, [String(ref)]: 'delete', mode: 'usrdel' }).toString()
    const res = await ctx.http.post(`${originOf(thread.boardUrl)}/${board}/futaba.php?guid=on`, body, {
      headers: { ...BROWSER, 'Content-Type': 'application/x-www-form-urlencoded', Referer: threadWebUrl(thread), Origin: originOf(thread.boardUrl) },
      sameCookiesAsGet: true,
    })
    const text = sjis(res, ctx).trim()
    if (text === 'ok') return { status: 'ok', message: '削除しました' }
    const r = parsePostResult(text)
    return { status: 'error', message: r.ok ? text.slice(0, 100) : r.message, html: text }
  },

  // そうだね: /sd.php?板名.番号 を GET すると、新しい数が返る(ふたばの JavaScript の sd() と同じ)
  async react(thread, post, reactionId, ctx) {
    if (reactionId !== SODANE) throw new Error(`ふたばにない反応です: ${reactionId}`)
    const board = boardNameOf(thread.boardUrl)
    const res = await ctx.http.get(`${originOf(thread.boardUrl)}/sd.php?${board}.${post.ref ?? post.no}`, { headers: { ...BROWSER, Referer: threadWebUrl(thread) } })
    if (res.status !== 200) throw new Error(`そうだねを送れませんでした(HTTP ${res.status})`)
    const n = parseInt(new TextDecoder().decode(res.body), 10)
    return Number.isFinite(n) ? n : 0
  },

  async createThread(board, input, ctx): Promise<PostResult> {
    // スレ立ては、板の入口のページのフォームから(resto なし、題名を sub に)。画像が要る板が多い
    return sendRegist(`${board.url}futaba.htm`, board.url, { sub: input.title }, input, ctx)
  },

  postByteLength: shiftJisByteLength,

  threadWebUrl,
}
