// レスの本文で文字を選んで右クリックしたときのメニュー(PC)。項目の出し分けと、引用・検索の文の作り方
import type { MenuItem } from '../components/PostMenu'

/** 選んだ文の各行に「>」を付ける(書き込み欄の「引用して返信」と同じ形。最後の改行は付けない) */
export function quoteLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => `>${l}`)
    .join('\n')
}

/** スキームのない「example.com」を URL とみなすドメインの終わり */
const BARE_TLDS = new Set(['com', 'net', 'org', 'jp', 'io', 'co', 'me', 'tv', 'info', 'dev', 'app', 'be', 'cc', 'to', 'ly', 'gl', 'gg', 'xyz', 'us', 'uk'])

/**
 * 選んだ文が 1 つの URL らしければ、開ける形の URL。2ch の「ttp://」や「www.」で始まるもの、
 * 「example.com/xx」のようにドメインだけのものも開けるようにする。空白を含む・URL らしくなければ undefined
 */
export function urlOfSelection(text: string): string | undefined {
  const s = text.trim()
  if (!s || /\s/.test(s)) return undefined
  const m = /^h?(ttps?):\/\/(.+)$/i.exec(s)
  if (m) return /^[^/?#.]+\.[^/?#]+|^localhost\b|^\[/i.test(m[2]) ? `h${m[1].toLowerCase()}://${m[2]}` : undefined
  if (/^www\.[^/?#]+\.[a-z]{2,}([/?#:]\S*)?$/i.test(s)) return `https://${s}`
  // ドメインだけ: よく見るドメインの終わりに限る(「index.html」「memo.txt」のようなファイル名を URL にしない)
  const host = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.([a-z]{2,}))(?:[/?#:]\S*)?$/i.exec(s)
  if (host && BARE_TLDS.has(host[2].toLowerCase())) return `https://${s}`
  return undefined
}

/** 外部のブラウザで検索するときの URL(検索先の設定はないので Google) */
export function webSearchUrl(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(text.replace(/\s+/g, ' ').trim())}`
}

/** 項目の名前に入れる、選んだ文の短い形 */
function shortText(text: string, max = 16): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export interface SelectionActions {
  copy: (text: string) => void
  /** 選んだ文を「>」付きで書き込み欄へ。書き込めない・選んだ所がほかのレスにまたがるときは undefined */
  quoteReply?: (text: string) => void
  /** URL を開く(本文のリンクを押したのと同じ) */
  openUrl?: (url: string) => void
  /** このスレの中を検索 */
  searchThread?: (text: string) => void
  /** OS の既定のブラウザで開く */
  openExternal?: (url: string) => void
  /** 本文の NG の下書きを開く */
  ngDraft?: (text: string) => void
  /** ふだんの右クリックの項目(レスの操作)。小項目にまとめて最後に置く */
  postItems?: MenuItem[]
}

/** 文字を選んでいるときの右クリックの項目 */
export function selectionMenuItems(text: string, a: SelectionActions): MenuItem[] {
  const url = urlOfSelection(text)
  const items: MenuItem[] = [
    { label: 'コピー', icon: 'content_copy', onClick: () => a.copy(text) },
    ...(a.quoteReply ? [{ label: '引用して返信', icon: 'format_quote', onClick: () => a.quoteReply!(text) }] : []),
    { label: '引用をコピー', icon: 'content_copy', onClick: () => a.copy(quoteLines(text)) },
    ...(url && a.openUrl ? [{ label: 'リンクを開く', icon: 'open_in_new', onClick: () => a.openUrl!(url) }] : []),
    ...(a.searchThread ? [{ label: 'このスレで検索', icon: 'search', onClick: () => a.searchThread!(text) }] : []),
    ...(a.openExternal ? [{ label: `Google で「${shortText(text)}」を検索`, icon: 'travel_explore', onClick: () => a.openExternal!(webSearchUrl(text)) }] : []),
    ...(a.ngDraft ? [{ label: '選んだ文字を NG に(直して足す)', icon: 'edit_note', onClick: () => a.ngDraft!(text) }] : []),
  ]
  // 文字を選んだままでも、レスへの操作に届くように
  if (a.postItems && a.postItems.length > 0) items.push({ label: 'このレスの操作', icon: 'more_horiz', children: a.postItems })
  return items
}

/**
 * 右クリックした要素(el)にかかっている選んだ文。選んでいない・el にかかっていなければ undefined。
 * inside は、選んだ所が el の中だけに収まっているか(ほかのレスにまたがっていれば、どのレスへの引用か決まらない)
 */
export function selectionOn(el: HTMLElement): { text: string; inside: boolean } | undefined {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return undefined
  const inside = el.contains(sel.anchorNode) && el.contains(sel.focusNode)
  if (!inside && !sel.containsNode(el, true)) return undefined
  const text = sel.toString().trim()
  return text ? { text, inside } : undefined
}
