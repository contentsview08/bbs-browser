// まちBBS(machi.to)のコネクタ。2026-11-04 に実際の板で確かめた作り:
// - 板の URL は https://machi.to/板/(kanto・tokyo など。地域ごとに 15 ほど)、スレは /bbs/read.cgi/板/キー/
// - スレ一覧は 板/subject.txt(Shift_JIS)。「キー.cgi,スレタイ(レス数)」(2ch と違い dat はない。dat/キー.dat は 404)
// - スレの中身は /bbs/offlaw.cgi/板/キー/(Shift_JIS)。「番号<>名前<>メール<>日付 ID:xxx<>本文<>ホスト」、1 番目のレスだけ本文の後ろにスレタイが入る。
//   差分は末尾に「何番から-」を付けて取り、新着がなければ空で返る。ないスレは HTTP 200 のまま「<ERROR>スレッドを発見できません</ERROR>」
//   (/bbs/json.cgi/板/キー/ に UTF-8 の JSON もあるが、差分が取れないので使わない)
// - 板の設定(SETTING.TXT)は板名も名無しの名前も入っていない。板の名前はトップページの一覧から取る
// - 書き込みはスレのページのフォームと同じく /bbs/write.cgi?guid=ON へ Shift_JIS で送る
//   (NAME・MAIL・MESSAGE・BBS・KEY・TIME・READ=TRUE・CC=あ・submit=書き込む)。
//   書けると「書きこみました」ではなく、スレのページがそのまま返る。parseMachiWrite で読む
// - スレ立てはアプリからはできない(まちBBS は依頼制で、板のページにもスレ立てのフォームがない)
// 板の一覧はトップページから読める(handlesSite)。板は URL で足してもよい

import type { Board, Connector, ConnectorContext, FetchPostsResult, HttpResponse, ThreadSummary } from '../types'
import { encodeShiftJisForm, shiftJisByteLength } from '../sjis'
import { detectEncoding } from '../encoding'
import { createdAtOfKey, isCgiSubject, parseCgiSubject } from '../common'
import { machiError, parseMachiTop, parseMachiWrite, parseOfflaw } from './parse'

const ID = 'machi'
/** スレがないことを示すエラーの文(offlaw.cgi は「スレッドを発見できません」) */
const isGoneError = (message: string) => /発見できません|見つかりません|存在しません/.test(message)
const ORIGIN = 'https://machi.to'

interface MachiCursor {
  /** 取り終えた最後のレス番号 */
  lastNo: number
}

/** 昔は kanto.machi.to のように板ごとのホストだった(いまは machi.to に集まり、古いホストもそのまま返る) */
const HOST = /^https?:\/\/(?:[a-z0-9]+\.)?machi\.to\//
const SITE_URL = /^https?:\/\/(?:www\.)?machi\.to\/?(?:index\.html)?(?:[?#].*)?$/
const THREAD_URL = /^https?:\/\/(?:[a-z0-9]+\.)?machi\.to\/bbs\/(?:read|offlaw|json)\.cgi\/([a-z0-9]+)\/(\d+)/
const BOARD_URL = /^https?:\/\/(?:[a-z0-9]+\.)?machi\.to\/([a-z0-9]+)\/?(?:subject\.txt|index\.html)?(?:[?#].*)?$/
/** 板ではないパス */
const NOT_BOARD = new Set(['bbs', 'lib', 'cdn-cgi'])

/** トップページが読めなかったときの板の名前(2026-11-04 のトップページの並び) */
const KNOWN_BOARDS: Record<string, string> = {
  hokkaidou: '北海道地区',
  touhoku: '東北地区',
  kanto: '関東地区',
  tokyo: '東京',
  tama: '多摩',
  kana: '神奈川',
  kousinetu: '北陸・甲信越地区',
  toukai: '東海地区',
  kinki: '近畿地区',
  osaka: '大阪',
  cyugoku: '中国地区',
  sikoku: '四国地区',
  kyusyu: '九州地区',
  okinawa: '沖縄地区',
  tawara: 'まちBBS会議室',
}

/** 板の URL から 板の名前(kanto など)を取り出す */
function bbsOf(boardUrl: string): string {
  const m = /^\/([a-z0-9]+)\/?$/.exec(new URL(boardUrl).pathname)
  if (!m || NOT_BOARD.has(m[1])) throw new Error(`まちBBS の板の URL ではありません: ${boardUrl}`)
  return m[1]
}

const boardUrlOf = (bbs: string) => `${ORIGIN}/${bbs}/`

const decode = (res: HttpResponse, ctx: ConnectorContext) => ctx.decode(res.body, detectEncoding(res.body, res.headers['content-type'], 'shift_jis'))

function threadWebUrl(thread: ThreadSummary): string {
  return `${ORIGIN}/bbs/read.cgi/${bbsOf(thread.boardUrl)}/${thread.key}/`
}

/** 板の名前。KNOWN_BOARDS にあればそれ、なければ板のページの <title>(「まちBBS関東掲示板」)、それもなければ URL の名前 */
async function boardNameOf(bbs: string, ctx: ConnectorContext): Promise<string> {
  if (KNOWN_BOARDS[bbs]) return KNOWN_BOARDS[bbs]
  try {
    const res = await ctx.http.get(boardUrlOf(bbs))
    if (res.status === 200) {
      const title = /<title>([^<]*)<\/title>/i.exec(decode(res, ctx))?.[1].trim()
      if (title) return title.replace(/^まちBBS/, '').replace(/掲示板$/, '').trim() || title
    }
  } catch {
    // 名前が取れなくても、板は開ける
  }
  return bbs
}

export const machiConnector: Connector = {
  id: ID,
  name: 'まちBBS',
  maxPosts: 1000,

  canHandle(url) {
    return HOST.test(url)
  },

  handlesSite(menuUrl) {
    return SITE_URL.test(menuUrl)
  },

  isThreadUrl(url) {
    return THREAD_URL.test(url)
  },

  async resolveUrl(url, ctx) {
    const t = THREAD_URL.exec(url)
    const b = t ? undefined : BOARD_URL.exec(url)
    const bbs = t?.[1] ?? b?.[1]
    if (!bbs || NOT_BOARD.has(bbs)) return null
    const boardUrl = boardUrlOf(bbs)
    // 板が本当にあるかを、スレ一覧(subject.txt)が取れるかで確かめる(ない板は 404)
    let res: HttpResponse
    try {
      res = await ctx.http.get(`${boardUrl}subject.txt`)
    } catch (e) {
      throw new Error(`まちBBS に届きません(${e instanceof Error ? e.message : String(e)})`)
    }
    if (res.status === 404) throw new Error('まちBBS の板が見つかりません(HTTP 404)')
    if (res.status !== 200) throw new Error(`まちBBS の板を開けません(HTTP ${res.status})`)
    if (!isCgiSubject(decode(res, ctx))) throw new Error('まちBBS の板ではないようです(スレ一覧が読めません)')
    const board: Board = { connectorId: ID, url: boardUrl, name: await boardNameOf(bbs, ctx) }
    if (!t) return { board }
    return {
      board,
      thread: { connectorId: ID, boardUrl, key: t[2], title: '', postCount: 0, order: 0, createdAt: createdAtOfKey(t[2]) },
    }
  },

  async boardInfo(board, ctx) {
    // SETTING.TXT に板名も名無しの名前も入っていないので、名前だけ返す
    return { title: await boardNameOf(bbsOf(board.url), ctx) }
  },

  // 板の一覧はトップページ(https://machi.to/)から。読めなければ知っている板を返す
  async listBoards(_site, ctx) {
    let parsed: { bbs: string; name: string }[] = []
    try {
      const res = await ctx.http.get(`${ORIGIN}/`)
      if (res.status === 200) parsed = parseMachiTop(decode(res, ctx))
    } catch {
      // 下の既知の一覧にする
    }
    const list = parsed.length > 0 ? parsed : Object.entries(KNOWN_BOARDS).map(([bbs, name]) => ({ bbs, name }))
    return list.map((b) => ({ connectorId: ID, url: boardUrlOf(b.bbs), name: b.name, category: 'まちBBS' }))
  },

  async listThreads(board, ctx) {
    const res = await ctx.http.get(`${board.url}subject.txt`)
    if (res.status === 404) throw new Error(`まちBBS の板が見つかりません(HTTP 404): ${board.url}`)
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${board.url}subject.txt`)
    const text = decode(res, ctx)
    if (!isCgiSubject(text)) throw new Error(`スレ一覧を読めませんでした: ${board.url}`)
    return parseCgiSubject(text).map((e, i) => ({
      connectorId: ID,
      boardUrl: board.url,
      key: e.key,
      title: e.title,
      postCount: e.count,
      order: i,
      createdAt: createdAtOfKey(e.key),
    }))
  },

  async fetchPosts(thread, rawCursor, ctx): Promise<FetchPostsResult> {
    const cursor = rawCursor as MachiCursor | null
    const from = cursor ? cursor.lastNo + 1 : 1
    const url = `${ORIGIN}/bbs/offlaw.cgi/${bbsOf(thread.boardUrl)}/${thread.key}/${from > 1 ? `${from}-` : ''}`
    const res = await ctx.http.get(url)
    if (res.status === 404) return { status: 'archived', posts: [], cursor }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
    const text = decode(res, ctx)
    // dat 落ちにするのはスレがないと言われたときだけ。混雑などの一時的なエラーで、自動の更新から外さない
    const error = machiError(text)
    if (error !== undefined) {
      if (isGoneError(error)) return { status: 'archived', posts: [], cursor }
      throw new Error(`まちBBS のエラー: ${error.slice(0, 200)}`)
    }
    const { posts, title } = parseOfflaw(text)
    const lastNo = posts.at(-1)?.no ?? cursor?.lastNo ?? 0
    const next: MachiCursor = { lastNo }
    if (posts.length === 0) return { status: 'notModified', posts: [], cursor: next }
    return { status: 'updated', posts, title, cursor: next }
  },

  async createPost(thread, input, ctx) {
    const bbs = bbsOf(thread.boardUrl)
    const referer = threadWebUrl(thread)
    const fields = {
      submit: '書き込む',
      NAME: input.name,
      MAIL: input.mail,
      MESSAGE: input.body,
      BBS: bbs,
      KEY: thread.key,
      TIME: String(Math.floor(Date.now() / 1000)),
      READ: 'TRUE',
      CC: 'あ',
    }
    const res = await ctx.http.post(`${ORIGIN}/bbs/write.cgi?guid=ON`, encodeShiftJisForm(fields), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
    })
    const html = decode(res, ctx)
    if (res.status >= 400) return { status: 'error', message: `HTTP ${res.status}`, html }
    const r = parseMachiWrite(html)
    return r.status === 'ok' ? r : { ...r, html }
  },

  postByteLength: shiftJisByteLength,

  threadWebUrl,
}
