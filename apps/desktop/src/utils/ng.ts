// NG(あぼーん)。対象と書式は web 版(settingsStore の NgRule)に合わせている。
// スマホのアプリ(data/Prefs.kt の NgRule)も同じ形・同じ当て方(2026-11 にそろえた):
// 種類・文字・正規表現か・有効か・期限(この日まで)・効く板(なければすべての板)・メモ

import type { Post, ThreadSummary } from '@bbs-browser/connectors'

export type NgTarget = 'content' | 'posterName' | 'posterId' | 'threadTitle'

export interface NgRule {
  id: string
  target: NgTarget
  pattern: string
  isRegex: boolean
  enabled: boolean
  /** この日付(YYYY-MM-DD、端末の日付)まで有効な一時的な NG。なければずっと有効 */
  expiresOnDate?: string
  /** この板(板の URL)だけで効く NG。なければすべての板 */
  boardUrl?: string
  /** 効く板の名前(画面に出すため。boardUrl があるときだけ) */
  boardName?: string
  /** 自分用のメモ(なぜ NG にしたかなど) */
  note?: string
  /** 足した時刻(ミリ秒)。並べ替えに使う。前からある NG にはない */
  createdAt?: number
}

export const NG_TARGETS: { key: NgTarget; name: string }[] = [
  { key: 'content', name: '本文' },
  { key: 'posterName', name: '名前' },
  { key: 'posterId', name: 'ID' },
  { key: 'threadTitle', name: 'スレタイ' },
]

export function todayDateString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今日から days 日後(その日まで有効)。期限の選択肢(今日だけ・7 日・30 日)に使う */
export function daysLaterDateString(days: number, d = new Date()): string {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return todayDateString(x)
}

export function isValidPattern(pattern: string, isRegex: boolean): boolean {
  return patternError(pattern, isRegex) === undefined
}

/** 正規表現として読めないときの理由(画面に出す)。読めれば undefined */
export function patternError(pattern: string, isRegex: boolean): string | undefined {
  if (!pattern) return '文字を入れてください'
  if (!isRegex) return undefined
  try {
    new RegExp(pattern)
    return undefined
  } catch (e) {
    return `正規表現として読めません(${e instanceof Error ? e.message : String(e)})`
  }
}

/** いま効いているか(有効で、期限が切れていない) */
export function isActive(r: NgRule, today = todayDateString()): boolean {
  return r.enabled && (!r.expiresOnDate || r.expiresOnDate >= today)
}

type Matcher = (text: string, boardUrl?: string) => boolean

/**
 * ルールを判定関数にしておく(レスの数だけ正規表現を作り直さないため)。
 * 正規表現でない文字は、大文字・小文字を区別せずに含むか(スマホのアプリと同じ)。正規表現は書いたまま(i などは (?i) ではなく書かない)
 */
function compile(rules: NgRule[], target: NgTarget): Matcher[] {
  const today = todayDateString()
  return rules
    .filter((r) => r.target === target && isActive(r, today))
    .flatMap((r): Matcher[] => {
      const inBoard = (b?: string) => !r.boardUrl || r.boardUrl === b
      if (!r.isRegex) {
        const p = r.pattern.toLowerCase()
        return [(t, b) => inBoard(b) && t.toLowerCase().includes(p)]
      }
      try {
        const re = new RegExp(r.pattern)
        return [(t, b) => inBoard(b) && re.test(t)]
      } catch {
        return []
      }
    })
}

/** ID の NG: 正規表現でなければ完全一致(部分一致だと別の ID まで巻き込む) */
function idMatcher(rules: NgRule[]): (id: string | undefined, boardUrl?: string) => boolean {
  const today = todayDateString()
  const exact = rules.filter((r) => r.target === 'posterId' && !r.isRegex && isActive(r, today))
  const regex = compile(rules.filter((r) => r.isRegex), 'posterId')
  return (id, b) => id !== undefined && (exact.some((r) => r.pattern === id && (!r.boardUrl || r.boardUrl === b)) || regex.some((m) => m(id, b)))
}

/** レスの NG。boardUrl はそのレスのスレの板(「この板だけ」の NG を当てるため) */
export function postMatcher(rules: NgRule[]): (p: Post, boardUrl?: string) => boolean {
  const body = compile(rules, 'content')
  const name = compile(rules, 'posterName')
  const id = idMatcher(rules)
  return (p, b) => body.some((m) => m(p.body, b)) || name.some((m) => m(p.name, b)) || id(p.id, b)
}

/** スレ一覧の NG: スレタイの NG と、立てた人の ID の NG */
export function threadMatcher(rules: NgRule[]): (t: ThreadSummary) => boolean {
  const title = compile(rules, 'threadTitle')
  const id = idMatcher(rules)
  return (t) => title.some((m) => m(t.title, t.boardUrl)) || id(t.authorId, t.boardUrl)
}

/** NG の試し: text のうち、ルールに当たる所(始まり・終わり)。正規表現の試し欄で色を付けるのに使う */
export function matchRanges(rule: Pick<NgRule, 'pattern' | 'isRegex' | 'target'>, text: string): [number, number][] {
  if (!rule.pattern) return []
  if (rule.target === 'posterId' && !rule.isRegex) return text === rule.pattern ? [[0, text.length]] : []
  const out: [number, number][] = []
  if (!rule.isRegex) {
    const t = text.toLowerCase()
    const p = rule.pattern.toLowerCase()
    for (let i = t.indexOf(p); i >= 0 && out.length < 200; i = t.indexOf(p, i + Math.max(1, p.length))) out.push([i, i + p.length])
    return out
  }
  let re: RegExp
  try {
    re = new RegExp(rule.pattern, 'g')
  } catch {
    return []
  }
  for (let m = re.exec(text); m && out.length < 200; m = re.exec(text)) {
    out.push([m.index, m.index + m[0].length])
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

/** 期限の切れた一時 NG を取り除く */
export function pruneExpired(rules: NgRule[]): NgRule[] {
  const today = todayDateString()
  return rules.filter((r) => !r.expiresOnDate || r.expiresOnDate >= today)
}

export function newRule(target: NgTarget, pattern: string, opts: Partial<NgRule> = {}): NgRule {
  return { id: crypto.randomUUID(), target, pattern, isRegex: false, enabled: true, createdAt: Date.now(), ...opts }
}
