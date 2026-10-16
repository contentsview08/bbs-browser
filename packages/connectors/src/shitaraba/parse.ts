// したらば(jbbs.shitaraba.net)の応答を読む。どれも EUC-JP をデコードした文字列を受け取る

import type { Post } from '../types'
import { htmlToText } from '../html'

/** subject.txt の 1 行は「キー.cgi,スレタイ(レス数)」。最後の行は最初の行の繰り返しなので、同じキーは 1 つにする */
export function parseShitarabaSubject(text: string): { key: string; title: string; count: number }[] {
  const out: { key: string; title: string; count: number }[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const m = /^(\d+)\.cgi,(.*)\((\d+)\)\s*$/.exec(line)
    if (!m || seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ key: m[1], title: htmlToText(m[2]).trim(), count: Number(m[3]) })
  }
  return out
}

/**
 * rawmode.cgi の 1 行は「番号<>名前<>メール<>日付<>本文<>スレタイ<>ID」。
 * スレタイは 1 番目のレスにだけ入っている。名前と本文は HTML(<b> や <br>)なので文字にする
 */
export function parseRawmode(text: string): { posts: Post[]; title?: string } {
  const posts: Post[] = []
  let title: string | undefined
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const f = line.split('<>')
    const no = Number(f[0])
    if (!Number.isInteger(no) || no <= 0) continue
    const [, name = '', mail = '', date = '', body = '', t = '', id = ''] = f
    if (t && !title) title = htmlToText(t).trim()
    posts.push({
      no,
      name: htmlToText(name).trim(),
      mail: htmlToText(mail).trim(),
      date: htmlToText(date).trim(),
      id: id.trim() || undefined,
      body: htmlToText(body.replace(/^ /, '').replace(/ $/, '')),
    })
  }
  return { posts, title }
}

/** setting.cgi は「キー=値」の行 */
export function parseShitarabaSetting(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/** write.cgi の応答。書けたら ok、ERROR やエラーの文言があれば error(理由を添える) */
export function parseShitarabaWrite(html: string): { status: 'ok' | 'error'; message: string } {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1].trim() ?? ''
  const text = htmlToText(html.replace(/<head>[\s\S]*?<\/head>/i, '')).replace(/\s+/g, ' ').trim()
  if (/書き?こみました/.test(title) || /書き?こみました/.test(text)) return { status: 'ok', message: '書きこみました' }
  const err = /ERROR[:：]?\s*([^\n]{0,200})/i.exec(text)
  return { status: 'error', message: err ? err[0].trim() : title || text.slice(0, 200) || '書き込めませんでした' }
}
