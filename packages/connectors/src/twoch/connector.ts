// 2ch 互換コネクタ(標準コネクタ)。5ch、eddist、hono-bbs の互換窓口などを読む。
// いまは読む専用。書き込み(bbs.cgi)は capabilities.post を立てて後から足す。

import type {
  Board,
  BoardInfo,
  Connector,
  ConnectorContext,
  Encoding,
  FetchPostsResult,
  HttpResponse,
  LoginResult,
  PostInput,
  PostResult,
  ThreadSummary,
} from '../types'
import { parseBbsCgiResponse, parseConfirmForm, parseBbsMenuHtml, parseBbsMenuJson, parseDat, parseSettingTxt, parseSubjectTxt } from './parse'
import { encodeShiftJisForm } from '../sjis'

/** dat 差分取得の続き */
interface DatCursor {
  /** 読み終えたバイト数(最後の改行まで) */
  bytes: number
  postCount: number
  lastModified?: string
  /** 過去ログから取った(中身はもう変わらないので、次からは取りに行かない) */
  kako?: boolean
}

/**
 * dat 落ちしたスレの過去ログの dat。5ch(と bbspink)では、板/oyster/キーの頭 4 桁/キー.dat に置かれ、
 * 2026-10 時点ではログインなしで取れる。過去ログの置き場がない掲示板では undefined
 */
function kakoDatUrl(thread: ThreadSummary): string | undefined {
  const host = new URL(thread.boardUrl).hostname
  if (!/(?:^|\.)(?:5ch\.io|5ch\.net|bbspink\.com)$/.test(host)) return undefined
  return `${thread.boardUrl}oyster/${thread.key.slice(0, 4)}/${thread.key}.dat`
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
 * bbs.cgi へ送って応答を読み分ける(書き込み・スレ立て・書き込み確認の承諾で共通)。
 * 5ch の初めての書き込みでは「書き込み確認」が返る。利用規約への承諾なので勝手には送り直さず、
 * 確認画面のフォームの項目と送り先を添えて返す。承諾されたら submitConfirm で送る
 */
async function sendBbsCgi(
  url: string,
  fields: Record<string, string>,
  referer: string,
  ctx: ConnectorContext,
  excludeCookies: string[] = [],
): Promise<PostResult> {
  const res = await ctx.http.post(url, encodeShiftJisForm(fields), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
    excludeCookies,
  })
  const html = ctx.decode(res.body, encodingOf(res))
  const r = parseBbsCgiResponse(html)
  if (r.status === 'confirm') {
    const form = parseConfirmForm(html)
    return {
      status: 'confirm',
      message: r.message,
      html,
      confirm: {
        url: form.action ? new URL(form.action, url).href : url,
        fields: { ...fields, ...form.hidden },
        referer,
        excludeCookies,
      },
    }
  }
  if (r.status === 'ok') {
    // eddist は書き込んだレスの番号を x-resnum で返す
    const n = Number(res.headers['x-resnum'])
    return Number.isInteger(n) && n > 0 ? { ...r, resNumber: n } : r
  }
  if (r.status === 'error' && res.status >= 400 && !r.message) return { status: 'error', message: `HTTP ${res.status}`, html }
  return { ...r, html }
}

/** SETTING.TXT を読む。取れなくても困らない情報なので、失敗したら空で返す */
async function readSettingTxt(boardUrl: string, ctx: ConnectorContext): Promise<BoardInfo> {
  try {
    const res = await ctx.http.get(`${boardUrl}SETTING.TXT`)
    if (res.status < 200 || res.status >= 300) return {}
    const s = parseSettingTxt(ctx.decode(res.body, encodingOf(res)))
    return { title: s.BBS_TITLE || undefined, nonameName: s.BBS_NONAME_NAME || undefined }
  } catch {
    return {}
  }
}

function threadWebUrl(thread: ThreadSummary): string {
  const u = new URL(thread.boardUrl)
  const board = u.pathname.replace(/\//g, '')
  return `${u.origin}/test/read.cgi/${board}/${thread.key}/`
}

/** これより先の日時は、スレが立った時刻としては信用しない */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/**
 * dat 番号はスレが立った時刻の UNIX 秒(10 桁のときだけ信用する)。
 * 5ch のお知らせスレ(9240230830 など)は番号がわざと未来になっていて、勢いの計算が狂うので、未来の日時は「不明」にする
 */
function createdAtOf(key: string, now = Date.now()): Date | undefined {
  if (!/^\d{10}$/.test(key)) return undefined
  const date = new Date(Number(key) * 1000)
  return date.getTime() > now + FUTURE_TOLERANCE_MS ? undefined : date
}

/** スレの URL(…/test/read.cgi/板/番号/)と板の URL(…/板/)を見分ける */
const THREAD_URL = /^(https?:\/\/[^/]+)\/test\/read\.cgi\/([^/?#]+)\/(\d+)/
const BOARD_URL = /^(https?:\/\/[^/]+)\/([^/?#]+)\/?(?:subject\.txt)?(?:[?#].*)?$/

/** 最後の改行までを切り出す(書き込み途中の行を読まないため) */
function completeLines(body: Uint8Array): Uint8Array {
  const last = body.lastIndexOf(LF)
  return last < 0 ? body.subarray(0, 0) : body.subarray(0, last + 1)
}

/**
 * 5ch の BE のログイン画面(https://be.5ch.io/ のフォーム)。2026-10 時点で mail・pass・login を /log に送る作り。
 * 成功すると DMDM・MDMD の Cookie が .5ch.io に渡り、以後 5ch の板への書き込みに自動で付く
 */
const BE_LOGIN_URL = 'https://be.5ch.io/log'
/** BE にログインしたときに受け取る Cookie。BE を使わない書き込みでは外す */
const BE_COOKIES = ['DMDM', 'MDMD']

/** 書き込みで外す Cookie。BE を使うと言われていなければ、BE の Cookie を外す */
function excludedCookies(input: PostInput): string[] {
  return input.accounts?.includes('be') ? [] : BE_COOKIES
}

/**
 * BE にログインできたかを、返ってきたページで見分ける。
 * ログイン画面(パスワードの欄)がまた出ていれば失敗、出ていなければ成功とみなす
 */
export function beLoginSucceeded(status: number, html: string): LoginResult {
  if (status >= 400) return { ok: false, message: `BE のサーバーが応答しません(HTTP ${status})` }
  if (/<input[^>]+name=["']?pass["'\s>]/i.test(html))
    return { ok: false, message: 'ログインできませんでした。メールアドレスとパスワードを確かめてください' }
  return { ok: true, message: 'BE にログインしました' }
}

export const twoChConnector: Connector = {
  id: ID,
  name: '2ch 互換',
  capabilities: { post: true, images: false, incremental: true },

  canHandle(url) {
    return THREAD_URL.test(url) || BOARD_URL.test(url) || /\/bbsmenu\.(html|json)$/.test(url)
  },

  async boardInfo(board, ctx) {
    return readSettingTxt(board.url, ctx)
  },

  async resolveUrl(url, ctx) {
    const t = THREAD_URL.exec(url.trim())
    const b = t ? null : BOARD_URL.exec(url.trim())
    const [origin, dir] = t ? [t[1], t[2]] : b ? [b[1], b[2]] : []
    if (!origin || !dir || dir === 'test') return null
    const boardUrl = `${origin}/${dir}/`

    // 板名は SETTING.TXT の BBS_TITLE。取れなければディレクトリ名で代用する
    const name = (await readSettingTxt(boardUrl, ctx)).title || dir

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

    // 過去ログから取ったスレは、もう変わらないので取りに行かない
    if (cursor?.kako) return { status: 'notModified', posts: [], cursor, archived: true }

    /** dat 落ちしたとき。過去ログがあればそこから全部取り、なければ dat 落ちとだけ返す */
    const archived = async (): Promise<FetchPostsResult> => {
      const kako = kakoDatUrl(thread)
      if (kako) {
        const res = await ctx.http.get(kako)
        if (res.status === 200 && res.body.length > 0) {
          const body = completeLines(res.body)
          const { posts, title } = parseDat(ctx.decode(body, encodingOf(res)))
          if (posts.length > 0)
            return {
              status: cursor ? 'reset' : 'updated',
              posts,
              title,
              archived: true,
              cursor: { bytes: body.length, postCount: posts.length, kako: true } satisfies DatCursor,
            }
        }
      }
      return { status: 'archived', posts: [], cursor }
    }

    const fetchAll = async (): Promise<FetchPostsResult> => {
      const res = await ctx.http.get(url)
      if (res.status === 404 || res.status === 302) return archived()
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
    if (res.status === 404 || res.status === 302) return archived()
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
      `${board.origin}/test/bbs.cgi`,
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
      excludedCookies(input),
    )
  },

  async createThread(board, input, ctx) {
    const u = new URL(board.url)
    return sendBbsCgi(
      `${u.origin}/test/bbs.cgi`,
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
      excludedCookies(input),
    )
  },

  submitConfirm(confirm, ctx) {
    return sendBbsCgi(confirm.url, confirm.fields, confirm.referer, ctx, confirm.excludeCookies)
  },

  accounts: [{ id: 'be', name: 'BE', site: '5ch', registerUrl: 'https://be.5ch.io/', hosts: ['5ch.io', '5ch.net', 'bbspink.com'] }],

  async login(accountId, credential, ctx) {
    if (accountId !== 'be') return { ok: false, message: `知らないアカウントです(${accountId})` }
    const body = new URLSearchParams({ mail: credential.user, pass: credential.password, login: '' }).toString()
    const res = await ctx.http.post(BE_LOGIN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://be.5ch.io/' },
    })
    return beLoginSucceeded(res.status, ctx.decode(res.body, encodingOf(res)))
  },

  threadWebUrl,
}
