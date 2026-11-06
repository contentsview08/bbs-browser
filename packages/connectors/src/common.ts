// 複数の掲示板に共通する応答の読み方

import { htmlToText } from './html'

/** subject.txt の 1 行は「キー.cgi,スレタイ(レス数)」(したらば・まちBBS)。同じキーは 1 つにする(したらばは最後の行が最初の行の繰り返し) */
export function parseCgiSubject(text: string): { key: string; title: string; count: number }[] {
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

/** 最初の行が「キー.cgi,」の形か。空の一覧は正しいものとして扱う */
export function isCgiSubject(text: string): boolean {
  const first = text.split('\n').find((l) => l.trim() !== '')
  return first === undefined || /^\d+\.cgi,/.test(first)
}

/**
 * スレの URL の後ろのレスの指定(123・123-456・123,456・123n)の先頭の番号を読む。
 * l50・-100 は先頭のレス番号がないので読まない。スマホ版の bbs/UrlRoute.kt と同じ
 */
export function postNoInUrl(url: string): number | undefined {
  let path: string
  try {
    path = new URL(url.trim()).pathname
  } catch {
    return undefined
  }
  const parts = /\/read\.cgi\/(.+)$/.exec(path)?.[1].split('/')
  // したらばは カテゴリ/板/キー、ほかは 板/キー
  const keyAt = /(?:^|\.)jbbs\.(?:shitaraba\.net|livedoor\.jp)$/.test(new URL(url.trim()).hostname) ? 2 : 1
  const m = /^(\d+)(?:[-,][\d,-]*)?n?$/.exec(parts?.[keyAt + 1] ?? '')
  const no = m ? Number(m[1]) : 0
  return no > 0 ? no : undefined
}

/** 「キー=値」の行の並び(SETTING.TXT・setting.cgi) */
export function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/** スレのキーはスレが立った時刻の UNIX 秒(10 桁のときだけ信用する) */
export function createdAtOfKey(key: string): Date | undefined {
  return /^\d{10}$/.test(key) ? new Date(Number(key) * 1000) : undefined
}
