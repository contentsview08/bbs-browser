// NG(あぼーん)。対象と書式は web 版(settingsStore の NgRule)に合わせている

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

export function isValidPattern(pattern: string, isRegex: boolean): boolean {
  if (!pattern) return false
  if (!isRegex) return true
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

type Matcher = (text: string) => boolean

/** ルールを判定関数にしておく(レスの数だけ正規表現を作り直さないため) */
function compile(rules: NgRule[], target: NgTarget): Matcher[] {
  const today = todayDateString()
  return rules
    .filter((r) => r.enabled && r.target === target && (!r.expiresOnDate || r.expiresOnDate >= today))
    .flatMap((r): Matcher[] => {
      if (!r.isRegex) return [(t) => t.includes(r.pattern)]
      try {
        const re = new RegExp(r.pattern)
        return [(t) => re.test(t)]
      } catch {
        return []
      }
    })
}

export function postMatcher(rules: NgRule[]): (p: Post) => boolean {
  const body = compile(rules, 'content')
  const name = compile(rules, 'posterName')
  // ID は部分一致だと別の ID まで巻き込むので、正規表現でなければ完全一致にする
  const idRegex = compile(rules.filter((r) => r.isRegex), 'posterId')
  const today = todayDateString()
  const idExact = new Set(
    rules
      .filter((r) => r.enabled && r.target === 'posterId' && !r.isRegex && (!r.expiresOnDate || r.expiresOnDate >= today))
      .map((r) => r.pattern),
  )
  return (p) =>
    body.some((m) => m(p.body)) ||
    name.some((m) => m(p.name)) ||
    (p.id !== undefined && (idExact.has(p.id) || idRegex.some((m) => m(p.id!))))
}

export function threadMatcher(rules: NgRule[]): (t: ThreadSummary) => boolean {
  const title = compile(rules, 'threadTitle')
  return (t) => title.some((m) => m(t.title))
}

/** 期限の切れた一時 NG を取り除く */
export function pruneExpired(rules: NgRule[]): NgRule[] {
  const today = todayDateString()
  return rules.filter((r) => !r.expiresOnDate || r.expiresOnDate >= today)
}

export function newRule(target: NgTarget, pattern: string, opts: Partial<NgRule> = {}): NgRule {
  return { id: crypto.randomUUID(), target, pattern, isRegex: false, enabled: true, ...opts }
}
