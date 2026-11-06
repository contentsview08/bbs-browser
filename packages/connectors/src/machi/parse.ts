// まちBBS(machi.to)の応答を読む。どれも Shift_JIS をデコードした文字列を受け取る

import type { Post } from '../types'
import { htmlToText } from '../html'

/** offlaw.cgi の応答が「スレがない」のしるし(<ERROR>スレッドを発見できません</ERROR>。HTTP は 200 のまま) */
export function machiError(text: string): string | undefined {
  return /<ERROR>([\s\S]*?)<\/ERROR>/i.exec(text)?.[1].trim()
}

/**
 * offlaw.cgi の 1 行は「番号<>名前<>メール<>日付 ID:xxx<>本文<>ホスト」。1 番目のレスだけ、本文とホストの間にスレタイが入る
 * (「番号<>名前<>メール<>日付 ID:xxx<>本文<>スレタイ<>ホスト」)。本文は HTML(<br>)なので文字にする。
 * 日付の後ろの「ID:xxx」は 2ch の dat と同じ書き方なので、日付と ID に分ける
 */
export function parseOfflaw(text: string): { posts: Post[]; title?: string } {
  const posts: Post[] = []
  let title: string | undefined
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('<>')
    const no = Number(f[0])
    if (!Number.isInteger(no) || no <= 0 || f.length < 5) continue
    const [, name = '', mail = '', dateId = '', body = ''] = f
    if (f.length >= 7 && !title) title = htmlToText(f[5]).trim()
    const m = /^(.*?)\s*ID:(\S+)\s*$/.exec(dateId)
    posts.push({
      no,
      name: htmlToText(name).trim(),
      mail: htmlToText(mail).trim(),
      date: (m ? m[1] : dateId).trim(),
      id: m?.[2] || undefined,
      body: htmlToText(body),
    })
  }
  return { posts, title }
}

/**
 * write.cgi の応答。まちBBS は書けると「書きこみました」ではなく、スレのページ(書き込み欄のあるページ)をそのまま返す(2026-11-04 に確かめた)。
 * 1. 題に「書きこみました」があれば成功
 * 2. 題が ERROR で始まれば失敗。題に ERROR・エラー があるだけなら、書き込みフォームがなければ失敗、あればスレタイの一部とみなす(失敗にすると送り直して二重になる)
 * 3. 本文に「書きこみました」があるか、スレのページ(name="posting" の書き込みフォーム・read.cgi のリンク)なら成功
 * 4. それ以外は失敗
 */
export function parseMachiWrite(html: string): { status: 'ok' | 'error'; message: string } {
  const title = htmlToText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()
  const bodyHtml = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  const text = htmlToText(bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\r?\n/g, '')).replace(/\s+/g, ' ').trim()
  const posting = /<form[^>]*name=["']?posting["']?/i.test(html)
  if (/書き?こみました/.test(title)) return { status: 'ok', message: '書きこみました' }
  if (/^\s*(?:ERROR|ＥＲＲＯＲ)(?:[\s:：!！]|$)/i.test(title) || (/ERROR|ＥＲＲＯＲ|エラー/i.test(title) && !posting))
    return { status: 'error', message: text.slice(0, 300) || title }
  if (/書き?こみました/.test(text) || posting || /\/bbs\/read\.cgi\//.test(html)) return { status: 'ok', message: '書きこみました' }
  const err = /(?:ERROR|ＥＲＲＯＲ)[:：!！]?\s*([^。]{0,200})/i.exec(text)
  return { status: 'error', message: err ? err[0].trim() : title || text.slice(0, 300) || '書き込めませんでした' }
}

/** 板の一覧はトップページ(https://machi.to/)の「<a href="/板/">名前」から読む */
export function parseMachiTop(html: string): { bbs: string; name: string }[] {
  const out: { bbs: string; name: string }[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\s+href="\/([a-z0-9]+)\/"[^>]*>([^<]+)/gi)) {
    const bbs = m[1]
    const name = htmlToText(m[2]).trim()
    if (!name || seen.has(bbs) || bbs === 'bbs' || bbs === 'lib') continue
    seen.add(bbs)
    out.push({ bbs, name })
  }
  return out
}
