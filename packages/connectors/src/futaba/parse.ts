// ふたば☆ちゃんねるの応答の読み方(2026-10-17 に may.2chan.net/b/ で確かめた形)。
// - カタログ(futaba.php?mode=cat、Shift_JIS): <td><a href='res/番号.htm'><img src='/b/cat/時刻s.jpg'></a><br><small>スレタイ</small><br><font size=2>返信の数</font></td>
//   スレタイの長さと並べる数は Cookie の cxyl で決まる(既定は 4 文字)
// - スレのページ(res/番号.htm、Shift_JIS): スレを立てた人のレスは <div class="thre" data-res="番号"> の中、
//   返信は <td class=rtd> の中。どちらも cnm(名前)・cnw(日付・ID)・cno(No.番号)・blockquote(本文)、画像は src/ への <a>
// - スレの JSON(futaba.php?mode=json&res=番号&start=番号、UTF-8): 返信だけ。res に 番号 → { now, name, email, com, src, rsc(何番目の返信か) }

import { decodeEntities, htmlToText } from '../html'
import type { Post } from '../types'

export interface CatalogEntry {
  key: string
  title: string
  /** 返信の数(スレを立てた人のレスは入らない) */
  replies: number
  /** サムネイルの絵の場所(板の頭からの /b/cat/... )。ないスレもある */
  thumb?: string
}

export function parseCatalog(html: string): CatalogEntry[] {
  const out: CatalogEntry[] = []
  const table = html.slice(html.indexOf("id='cattable'"))
  for (const cell of table.split(/<td[\s>]/i).slice(1)) {
    const key = /href=['"]res\/(\d+)\.htm/.exec(cell)?.[1]
    if (!key) continue
    const thumb = /<img[^>]*src=['"]([^'"]+)['"]/i.exec(cell)?.[1]
    const title = /<small>([\s\S]*?)<\/small>/i.exec(cell)?.[1] ?? ''
    const replies = Number(/<font[^>]*>(\d+)<\/font>/i.exec(cell)?.[1] ?? 0)
    out.push({ key, title: decodeEntities(title.replace(/<[^>]*>/g, '')).trim(), replies, ...(thumb && { thumb }) })
  }
  return out
}

/** レスの本文の HTML を、表示用の文字にする。画像があれば本文の頭に画像の URL を置く(サムネイルとビューアーで出すため) */
function bodyOf(comHtml: string, image: string | undefined, origin: string): string {
  const text = htmlToText(comHtml.replace(/\r?\n/g, '')).trim()
  return image ? `${new URL(image, origin).href}${text ? `\n${text}` : ''}` : text
}

/** 名前の HTML から、名前とメール(mailto)を取り出す */
function nameAndMail(nameHtml: string): { name: string; mail: string } {
  const mail = /href=["']mailto:([^"']*)["']/i.exec(nameHtml)?.[1] ?? ''
  return { name: decodeEntities(nameHtml.replace(/<[^>]*>/g, '')).trim(), mail: decodeEntities(mail) }
}

/** cnw(日付。ID のある板は「日付 ID:xxxx」) から、日付と ID を分ける */
function dateAndId(cnwHtml: string): { date: string; id?: string } {
  const text = decodeEntities(cnwHtml.replace(/<[^>]*>/g, '')).trim()
  const m = /^(.*?)\s*ID:(\S+)/.exec(text)
  return m ? { date: m[1].trim(), id: m[2] } : { date: text }
}

const span = (html: string, cls: string) => new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`, 'i').exec(html)?.[1] ?? ''

/** 1 つのレスの HTML(スレを立てた人の部分、または返信の <td class=rtd> の中身)を読む */
function parsePostHtml(html: string, no: number, origin: string): Post | undefined {
  const ref = Number(/No\.(\d+)/.exec(span(html, 'cno'))?.[1])
  if (!Number.isFinite(ref) || ref <= 0) return undefined
  const image = /<a href=["']([^"']*\/src\/[^"']+)["']/i.exec(html)?.[1]
  const body = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(html)?.[1] ?? ''
  const { name, mail } = nameAndMail(span(html, 'cnm'))
  const { date, id } = dateAndId(span(html, 'cnw'))
  return { no, ref, name, mail, date, ...(id && { id }), body: bodyOf(body, image, origin) }
}

/**
 * スレのページを読む(レスと、そうだねの数)。スレを立てた人のレスを 1 番、返信を 2 番から(何番目の返信か + 1)にする。
 * スレがない(消えた)ページなら undefined
 */
export function parseThreadPage(html: string, origin: string): { posts: Post[]; votes: Record<string, number> } | undefined {
  const start = html.indexOf('class="thre"')
  if (start < 0) return undefined
  const thre = html.slice(start)
  // スレを立てた人の部分は、最初の返信の表が始まるまで
  const firstReply = thre.search(/<table border=0><tr><td class=rts>/i)
  const opHtml = firstReply < 0 ? thre : thre.slice(0, firstReply)
  const op = parsePostHtml(opHtml, 1, origin)
  if (!op) return undefined
  const posts: Post[] = [op]
  const votes: Record<string, number> = {}
  const vote = (html: string, ref: number | undefined) => {
    // 「そうだねx18」(まだないレスは「+」)
    const n = Number(/class=sod[^>]*>そうだねx(\d+)</.exec(html)?.[1] ?? 0)
    if (ref !== undefined && n > 0) votes[ref] = n
  }
  vote(opHtml, op.ref)
  for (const cell of thre.split(/<td class=rtd>/i).slice(1)) {
    const td = cell.slice(0, cell.search(/<\/td>/i))
    const rsc = Number(/class="rsc">(\d+)</.exec(td)?.[1])
    const p = parsePostHtml(td, Number.isFinite(rsc) ? rsc + 1 : posts.length + 1, origin)
    if (!p) continue
    posts.push(p)
    vote(td, p.ref)
  }
  return { posts, votes }
}

interface JsonRes {
  now?: string
  name?: string
  email?: string
  com?: string
  src?: string
  id?: string
  rsc?: number
}

/** スレの JSON の返信を、番号の順に読む(何番目の返信か + 1 を no にする) */
export function parseThreadJson(text: string, origin: string): { posts: Post[]; votes: Record<string, number> } {
  const d = JSON.parse(text) as { res?: Record<string, JsonRes>; sd?: Record<string, string | number> }
  // そうだねの数(スレ全体の分。番号 → 数)
  const votes: Record<string, number> = {}
  for (const [ref, n] of Object.entries(d.sd ?? {})) if (Number(n) > 0) votes[ref] = Number(n)
  const posts: Post[] = []
  for (const [ref, r] of Object.entries(d.res ?? {})) {
    if (typeof r.rsc !== 'number') continue
    const id = r.id ? r.id.replace(/^ID:/, '') : ''
    posts.push({
      no: r.rsc + 1,
      ref: Number(ref),
      name: decodeEntities(r.name ?? ''),
      mail: decodeEntities(r.email ?? ''),
      date: r.now ?? '',
      ...(id && { id }),
      body: bodyOf(r.com ?? '', r.src || undefined, origin),
    })
  }
  posts.sort((a, b) => a.no - b.no)
  return { posts, votes }
}

/**
 * 書き込みのフォーム(id="fm")の隠し欄(mode・hash・ptua など)。hash は時刻を含み、ページを取るたびに変わる。
 * 見つからなければ undefined(スレが消えた・形が変わった)
 */
export function parsePostForm(html: string): { action: string; hidden: Record<string, string> } | undefined {
  const start = html.search(/<form[^>]*id=["']?fm["']?/i)
  if (start < 0) return undefined
  const form = html.slice(start, html.indexOf('</form>', start))
  const action = decodeEntities(/action=["']([^"']+)["']/i.exec(form)?.[1] ?? '')
  const hidden: Record<string, string> = {}
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/type=["']?hidden/i.test(tag)) continue
    const name = /name=["']?([^"'\s>]+)/i.exec(tag)?.[1]
    if (!name) continue
    hidden[name] = decodeEntities(/value=["']([^"']*)["']/i.exec(tag)?.[1] ?? '')
  }
  return action ? { action, hidden } : undefined
}

/**
 * 書き込んだあとの返事を読む(responsemode=ajax で送ったとき。ふたばの書き込みボタンの JavaScript と同じ読み方)。
 * 書けたときは「ok」か JSON だけが返る。それ以外はエラー: HTML ならその <title>、文字ならそのまま
 */
export function parsePostResult(text: string): { ok: boolean; message: string; ref?: number } {
  const t = text.trim()
  if (t === 'ok') return { ok: true, message: '書きこみました' }
  if (/^[{[]/.test(t)) {
    try {
      // 書き込んだレスの番号(thisno)。スレ立てなら新しいスレの番号(jumpto)にもなる
      const d = JSON.parse(t) as { thisno?: number }
      return { ok: true, message: '書きこみました', ...(typeof d.thisno === 'number' && { ref: d.thisno }) }
    } catch {
      // JSON ではなかった。エラーとして読む
    }
  }
  if (/<html[> ]|<body[> ]/i.test(t)) {
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(t)?.[1] ?? '').trim()
    const body = decodeEntities(t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    return { ok: false, message: title || body.slice(0, 200) || '書き込めませんでした' }
  }
  return { ok: false, message: t.slice(0, 200) || '書き込めませんでした(返事が空でした)' }
}

/** /bin/cachemt7.php の中身(function caco(){return "1792228311081";})から、書き込みの pthb・pthc に入れる値 */
export function parseCaco(js: string): string {
  return /return\s*["'](\d+)["']/.exec(js)?.[1] ?? ''
}

/** ページの <title>(板名) */
export function titleOf(html: string): string {
  return decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()
}
