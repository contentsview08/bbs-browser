// したらば(jbbs.shitaraba.net)のコネクタ。2026-10 に実際の板で確かめた作り:
// - 板の URL は https://jbbs.shitaraba.net/カテゴリ/番号/、スレは /bbs/read.cgi/カテゴリ/番号/キー/
// - スレ一覧は 板/subject.txt(EUC-JP)。「キー.cgi,スレタイ(レス数)」、最後の行は最初の行の繰り返し
// - スレの中身は /bbs/rawmode.cgi/カテゴリ/番号/キー/(EUC-JP)。「番号<>名前<>メール<>日付<>本文<>スレタイ<>ID」。
//   差分は末尾に「何番から-」を付けて取り、新着がなければ空で返る
// - 過去ログ倉庫に入ったスレは、ヘッダーに「ERROR: STORAGE IN」が付いて中身が返る。ないスレは 404 と「ERROR: THREAD NOT FOUND」
// - 板の設定(板名・名無しの名前)は /bbs/api/setting.cgi/カテゴリ/番号/
// - 書き込みは /bbs/write.cgi/カテゴリ/番号/キー/(スレ立ては キー の代わりに new)へ EUC-JP のフォームで送る。
//   本番の板への試し書き込みはしないので、応答の読み方(書きこみました / ERROR)は確かめていない
// 板の一覧(bbsmenu)はないので、板は URL で足してもらう

import type { Board, Connector, ConnectorContext, FetchPostsResult, HttpResponse, PostResult, ThreadSummary } from '../types'
import { encodeEucJpForm, eucJpByteLength } from '../eucjp'
import { parseRawmode, parseShitarabaSetting, parseShitarabaSubject, parseShitarabaWrite } from './parse'

const ID = 'shitaraba'
const ORIGIN = 'https://jbbs.shitaraba.net'

interface RawCursor {
  /** 取り終えた最後のレス番号 */
  lastNo: number
  /** 過去ログ倉庫に入ったスレ(もう変わらないので取りに行かない) */
  kako?: boolean
}

const HOST = /^https?:\/\/jbbs\.(?:shitaraba\.net|livedoor\.jp)\//
const THREAD_URL = /^https?:\/\/jbbs\.(?:shitaraba\.net|livedoor\.jp)\/bbs\/(?:read|rawmode)\.cgi\/([a-z]+)\/(\d+)\/(\d+)/
const BOARD_URL = /^https?:\/\/jbbs\.(?:shitaraba\.net|livedoor\.jp)\/([a-z]+)\/(\d+)\/?(?:subject\.txt)?(?:[?#].*)?$/

/** 板の URL から カテゴリ と 番号 を取り出す */
function dirOf(boardUrl: string): { dir: string; bbs: string } {
  const m = /\/([a-z]+)\/(\d+)\/?$/.exec(new URL(boardUrl).pathname)
  if (!m) throw new Error(`したらばの板の URL ではありません: ${boardUrl}`)
  return { dir: m[1], bbs: m[2] }
}

const boardUrlOf = (dir: string, bbs: string) => `${ORIGIN}/${dir}/${bbs}/`

function createdAtOf(key: string): Date | undefined {
  return /^\d{10}$/.test(key) ? new Date(Number(key) * 1000) : undefined
}

const decode = (res: HttpResponse, ctx: ConnectorContext) => ctx.decode(res.body, 'euc-jp')

/** 応答のヘッダーの ERROR(過去ログ倉庫・スレなし など) */
const errorOf = (res: HttpResponse) => res.headers['error'] ?? ''

async function readSetting(boardUrl: string, ctx: ConnectorContext): Promise<Record<string, string>> {
  try {
    const { dir, bbs } = dirOf(boardUrl)
    const res = await ctx.http.get(`${ORIGIN}/bbs/api/setting.cgi/${dir}/${bbs}/`)
    if (res.status !== 200) return {}
    return parseShitarabaSetting(decode(res, ctx))
  } catch {
    return {}
  }
}

function threadWebUrl(thread: ThreadSummary): string {
  const { dir, bbs } = dirOf(thread.boardUrl)
  return `${ORIGIN}/bbs/read.cgi/${dir}/${bbs}/${thread.key}/`
}

async function sendWrite(url: string, fields: Record<string, string>, referer: string, ctx: ConnectorContext): Promise<PostResult> {
  const res = await ctx.http.post(url, encodeEucJpForm(fields), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
  })
  const html = decode(res, ctx)
  const r = parseShitarabaWrite(html)
  return r.status === 'ok' ? r : { ...r, html }
}

export const shitarabaConnector: Connector = {
  id: ID,
  name: 'したらば',
  capabilities: { post: true, images: false, incremental: true },

  canHandle(url) {
    return HOST.test(url)
  },

  async resolveUrl(url, ctx) {
    const t = THREAD_URL.exec(url)
    const b = t ? undefined : BOARD_URL.exec(url)
    const dir = t?.[1] ?? b?.[1]
    const bbs = t?.[2] ?? b?.[2]
    if (!dir || !bbs) return null
    const boardUrl = boardUrlOf(dir, bbs)
    const setting = await readSetting(boardUrl, ctx)
    const board: Board = { connectorId: ID, url: boardUrl, name: setting.BBS_TITLE || `${dir}/${bbs}` }
    if (!t) return { board }
    return {
      board,
      thread: { connectorId: ID, boardUrl, key: t[3], title: '', postCount: 0, order: 0, createdAt: createdAtOf(t[3]) },
    }
  },

  async boardInfo(board, ctx) {
    const s = await readSetting(board.url, ctx)
    return { title: s.BBS_TITLE || undefined, nonameName: s.BBS_NONAME_NAME || undefined }
  },

  // 板の一覧は公開されていないので、板は URL で足してもらう
  async listBoards() {
    return []
  },

  async listThreads(board, ctx) {
    const res = await ctx.http.get(`${board.url}subject.txt`)
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${board.url}subject.txt`)
    return parseShitarabaSubject(decode(res, ctx)).map((e, i) => ({
      connectorId: ID,
      boardUrl: board.url,
      key: e.key,
      title: e.title,
      postCount: e.count,
      order: i,
      createdAt: createdAtOf(e.key),
    }))
  },

  async fetchPosts(thread, rawCursor, ctx): Promise<FetchPostsResult> {
    const cursor = rawCursor as RawCursor | null
    if (cursor?.kako) return { status: 'notModified', posts: [], cursor, archived: true }
    const { dir, bbs } = dirOf(thread.boardUrl)
    const from = cursor ? cursor.lastNo + 1 : 1
    const url = `${ORIGIN}/bbs/rawmode.cgi/${dir}/${bbs}/${thread.key}/${from > 1 ? `${from}-` : ''}`
    const res = await ctx.http.get(url)
    const error = errorOf(res)
    if (res.status === 404 || /THREAD NOT FOUND/i.test(error)) return { status: 'archived', posts: [], cursor }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
    const { posts, title } = parseRawmode(decode(res, ctx))
    // 過去ログ倉庫に入ったスレ。中身は返るので保存し、dat 落ちとして扱う
    const kako = /STORAGE IN/i.test(error)
    const lastNo = posts.at(-1)?.no ?? cursor?.lastNo ?? 0
    const next: RawCursor = kako ? { lastNo, kako: true } : { lastNo }
    if (posts.length === 0) return { status: 'notModified', posts: [], cursor: next, archived: kako || undefined }
    return { status: 'updated', posts, title, cursor: next, archived: kako || undefined }
  },

  async createPost(thread, input, ctx) {
    const { dir, bbs } = dirOf(thread.boardUrl)
    return sendWrite(
      `${ORIGIN}/bbs/write.cgi/${dir}/${bbs}/${thread.key}/`,
      {
        DIR: dir,
        BBS: bbs,
        KEY: thread.key,
        TIME: String(Math.floor(Date.now() / 1000)),
        NAME: input.name,
        MAIL: input.mail,
        MESSAGE: input.body,
        submit: '書き込む',
      },
      threadWebUrl(thread),
      ctx,
    )
  },

  async createThread(board, input, ctx) {
    const { dir, bbs } = dirOf(board.url)
    return sendWrite(
      `${ORIGIN}/bbs/write.cgi/${dir}/${bbs}/new/`,
      {
        DIR: dir,
        BBS: bbs,
        TIME: String(Math.floor(Date.now() / 1000)),
        SUBJECT: input.title,
        NAME: input.name,
        MAIL: input.mail,
        MESSAGE: input.body,
        submit: '新規スレッド作成',
      },
      board.url,
      ctx,
    )
  },

  postByteLength: eucJpByteLength,

  threadWebUrl,
}
