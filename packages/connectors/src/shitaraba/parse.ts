// したらば(jbbs.shitaraba.net)の応答を読む。どれも EUC-JP をデコードした文字列を受け取る

import type { Post } from '../types'
import { htmlToText } from '../html'
import { POST_FAILED } from '../twoch/parse'

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

/** write.cgi の応答。書けたら ok、ERROR やエラーの文言があれば error(理由を添える) */
export function parseShitarabaWrite(html: string): { status: 'ok' | 'error'; message: string } {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1].trim() ?? ''
  const text = htmlToText(html.replace(/<head>[\s\S]*?<\/head>/i, '')).replace(/\s+/g, ' ').trim()
  // ERROR の題のページは、書き込んだ文字が本文に戻ってきていることがあるので、本文の文言では成功にしない
  const errorTitle = /^\s*(?:ERROR|ＥＲＲＯＲ)(?:[\s:：!！]|$)/i.test(title)
  if (/書き?こみました/.test(title) || (!errorTitle && /書き?こみました/.test(text))) return { status: 'ok', message: '書きこみました' }
  const err = /ERROR[:：]?\s*([^\n]{0,200})/i.exec(text)
  return { status: 'error', message: err ? err[0].trim() : title || text.slice(0, 200) || POST_FAILED }
}
