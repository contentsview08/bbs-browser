// 2ch 互換形式(bbsmenu / subject.txt / dat)のパーサー。通信はしない純粋な関数だけを置く。

import { decodeEntities, htmlToText } from '../html'
import type { Post, PostResult } from '../types'

export interface MenuBoard {
  url: string
  name: string
  category?: string
}

/** 板の URL の形(https://host/dir/)をしているものだけを板とみなす */
export function isBoardUrl(url: string): boolean {
  return /^https?:\/\/[^/]+\/[^/?#]+\/$/.test(url)
}

/** 5ch の bbsmenu.json */
export function parseBbsMenuJson(text: string): MenuBoard[] {
  const json = JSON.parse(text) as {
    menu_list?: { category_content?: { url: string; board_name: string; category_name?: string }[] }[]
  }
  const boards: MenuBoard[] = []
  for (const cat of json.menu_list ?? []) {
    for (const b of cat.category_content ?? []) {
      if (isBoardUrl(b.url)) boards.push({ url: b.url, name: b.board_name, category: b.category_name })
    }
  }
  return boards
}

/** 一般的な bbsmenu.html。<B>カテゴリ</B> の後に <A HREF=板URL>板名</A> が並ぶ形 */
export function parseBbsMenuHtml(html: string): MenuBoard[] {
  const boards: MenuBoard[] = []
  let category: string | undefined
  const re = /<b>([^<]+)<\/b>|<a\s+href=["']?([^"'\s>]+)["']?[^>]*>([^<]+)<\/a>/gi
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      category = decodeEntities(m[1].trim())
      continue
    }
    const url = m[2]
    if (category && isBoardUrl(url)) boards.push({ url, name: decodeEntities(m[3].trim()), category })
  }
  return boards
}

/** SETTING.TXT(`KEY=値` の行の並び) */
export function parseSettingTxt(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export interface SubjectEntry {
  key: string
  title: string
  postCount: number
}

/** subject.txt の 1 行 = `1789358916.dat<>スレタイ (323)`。したらば系の `.cgi,` も受ける */
export function parseSubjectTxt(text: string): SubjectEntry[] {
  const entries: SubjectEntry[] = []
  for (const line of text.split('\n')) {
    const m = /^(\d+)\.(?:dat<>|cgi,)(.*)\((\d+)\)\s*$/.exec(line.trimEnd())
    if (!m) continue
    entries.push({ key: m[1], title: decodeEntities(m[2].trim()), postCount: Number(m[3]) })
  }
  return entries
}

/**
 * dat の 1 行 = `名前<>メール<>日付 ID:xxx<>本文<>スレタイ`(スレタイは 1 行目だけ)。
 * 形が崩れた行(あぼーんなど)も番号がずれないよう、1 行 1 レスとして返す。
 */
export function parseDatLine(line: string, no: number): { post: Post; title?: string } {
  const f = line.split('<>')
  if (f.length < 4) {
    return { post: { no, name: '', mail: '', date: '', body: htmlToText(line) } }
  }
  const [name, mail, dateField, body, title] = f
  const idMatch = /\sID:(\S+)/.exec(dateField)
  const date = dateField.replace(/\s(?:ID|BE):\S+/g, '').trim()
  return {
    post: {
      no,
      name: htmlToText(name),
      mail: decodeEntities(mail),
      date,
      id: idMatch?.[1],
      body: htmlToText(body),
    },
    title: title !== undefined && title.trim() !== '' ? decodeEntities(title.trim()) : undefined,
  }
}

/** 複数行をまとめて読む。startNo は最初の行のレス番号 */
export function parseDat(text: string, startNo = 1): { posts: Post[]; title?: string } {
  const posts: Post[] = []
  let title: string | undefined
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  lines.forEach((line, i) => {
    const r = parseDatLine(line, startNo + i)
    posts.push(r.post)
    if (r.title && !title) title = r.title
  })
  return { posts, title }
}

/**
 * bbs.cgi の応答を読み分ける。
 * - `<!-- 2ch_X:true -->` や「書きこみました」は成功
 * - `2ch_X:cookie` は 5ch の「書き込み確認」(Cookie を受け取ったのでもう一度送れば通る)
 * - 本文に認証ページの URL があれば認証待ち(eddist: 「認証コード'xxx'を用いて…/auth-code」)
 * - それ以外はエラー。本文のテキストをそのまま理由として返す
 */
export function parseBbsCgiResponse(html: string): PostResult | { status: 'confirm'; message: string } {
  const kind = /2ch_X:(\w+)/.exec(html)?.[1]
  const title = htmlToText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()
  const bodyHtml = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  const message = htmlToText(bodyHtml.replace(/\r?\n/g, '')).replace(/\n{2,}/g, '\n').trim()

  if (kind === 'true' || (!kind && title.includes('書きこみました'))) return { status: 'ok', message: message || title }
  if (kind === 'cookie') return { status: 'confirm', message }

  const url = /https?:\/\/[^\s<>"']+/.exec(message)?.[0]
  if (url && /auth|認証|ユーザー登録/.test(message)) {
    const code = /認証コード'([^']+)'|再認証コード'([^']+)'/.exec(message)
    return { status: 'auth', message, url, code: code?.[1] ?? code?.[2] }
  }
  return { status: 'error', message: message || title || '書き込めませんでした' }
}
