// キーワード(スレ一覧の帯・通知)。1 つの言葉(か正規表現、立てた人の ID)が 1 つの帯。
// スマホ版の data/KeywordRule.kt と同じ項目・同じ JSON・同じ当て方(設定 keywordRules。同期する)
import type { ThreadSummary } from '@bbs-browser/connectors'
import { legacyAuthorId } from './authorId'
import { ngRegExp } from './ng'
import { normalizeForSearch } from './postBody'

export type KeywordKind = 'title' | 'author'

export interface KeywordRule {
  id: string
  /** title: スレタイの言葉(pattern を含めば当たる。isRegex なら正規表現)。author: 立てた人の ID(pattern と同じなら当たる) */
  kind: KeywordKind
  pattern: string
  isRegex: boolean
  /** 帯に出す別名。空なら言葉そのもの(正規表現が長くて読めないときに付ける)。立てた人は「立てた人 ID」 */
  label: string
  /** この板(板の URL)だけで効く。なければすべての板 */
  boardUrl?: string
  boardName?: string
  enabled: boolean
  createdAt: number
}

/** 立てた人のキーワードの帯・通知に出す名前(スマホ版の authorKeywordLabel と同じ) */
export const authorKeywordLabel = (authorId: string) => `立てた人 ${authorId}`

export function newKeywordRule(p: Partial<KeywordRule> & { pattern: string }): KeywordRule {
  return { id: crypto.randomUUID(), kind: 'title', isRegex: false, label: '', enabled: true, createdAt: Date.now(), ...p }
}

/** 帯・通知に出す名前(別名があればそれ) */
export function keywordLabel(r: KeywordRule): string {
  const l = r.label.trim()
  if (l !== '') return l
  return r.kind === 'author' ? authorKeywordLabel(r.pattern.trim()) : r.pattern.trim()
}

/** 同じ中身か(種類・言葉・正規表現か・板が同じ。足すときに重ねない。別名は見ない) */
export const sameKeyword = (a: KeywordRule, b: KeywordRule) => a.kind === b.kind && a.pattern.trim() === b.pattern.trim() && a.isRegex === b.isRegex && (a.boardUrl ?? undefined) === (b.boardUrl ?? undefined)

/** バックアップ・同期で読んだ値がキーワードの形か */
export function isKeywordRule(v: unknown): v is KeywordRule {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    (r.kind === 'title' || r.kind === 'author') &&
    typeof r.pattern === 'string' &&
    r.pattern.trim() !== '' &&
    typeof r.isRegex === 'boolean' &&
    typeof r.label === 'string' &&
    typeof r.enabled === 'boolean' &&
    (r.boardUrl === undefined || typeof r.boardUrl === 'string')
  )
}

/** 前の形(スレタイの言葉の並び keywords・立てた人の並び keywordAuthors)から作る。1 つの言葉が 1 つのキーワード */
export function migrateLegacyKeywords(keywords: string[], authors: string[], now = Date.now()): KeywordRule[] {
  const out: KeywordRule[] = []
  const seen = new Set<string>()
  keywords.map((k) => k.trim()).filter(Boolean).forEach((k, i) => {
    if (seen.has(`t:${k}`)) return
    seen.add(`t:${k}`)
    out.push({ id: crypto.randomUUID(), kind: 'title', pattern: k, isRegex: false, label: '', enabled: true, createdAt: now + i })
  })
  authors.map((a) => a.trim()).filter(Boolean).forEach((a, i) => {
    if (seen.has(`a:${a}`)) return
    seen.add(`a:${a}`)
    out.push({ id: crypto.randomUUID(), kind: 'author', pattern: a, isRegex: false, label: '', enabled: true, createdAt: now + 100_000 + i })
  })
  return out
}

export interface KeywordMatcher {
  /** この板で効いているキーワード(登録の順) */
  active: KeywordRule[]
  isEmpty: boolean
  /** 当たったキーワード(スレタイの言葉が先、立てた人が後) */
  hit: (t: ThreadSummary) => KeywordRule | undefined
}

/**
 * キーワードの当て方(スレ一覧・通知で同じ)。boardUrl はその一覧の板(板限定のキーワードをここで絞る)。
 * スレタイの言葉は検索と同じく全角半角・大文字小文字・カナとかなを同じに扱う。正規表現は NG と同じ読み方(ngRegExp)でスレタイそのものに当てる。
 * 読めない正規表現は当たらない。立てた人は legacyAuthorId でそろえて比べる
 */
export function keywordMatcher(rules: KeywordRule[], boardUrl?: string): KeywordMatcher {
  const active = rules.filter((r) => r.enabled && r.pattern.trim() !== '' && (!r.boardUrl || r.boardUrl === boardUrl))
  const titles: { rule: KeywordRule; word?: string; re?: RegExp }[] = []
  for (const r of active) {
    if (r.kind !== 'title') continue
    if (r.isRegex) {
      try {
        titles.push({ rule: r, re: ngRegExp(r.pattern.trim()) })
      } catch {
        // 読めない正規表現は当たらない
      }
    } else {
      const w = normalizeForSearch(r.pattern.trim())
      if (w) titles.push({ rule: r, word: w })
    }
  }
  const authors = active.filter((r) => r.kind === 'author').map((r) => ({ rule: r, id: legacyAuthorId(r.pattern.trim()) })).filter((x) => x.id)
  return {
    active,
    isEmpty: titles.length === 0 && authors.length === 0,
    hit(t) {
      const title = normalizeForSearch(t.title)
      const x = titles.find((k) => (k.re ? k.re.test(t.title) : title.includes(k.word!)))
      if (x) return x.rule
      if (!t.authorId) return undefined
      return authors.find((a) => a.id === t.authorId)?.rule
    },
  }
}

/**
 * キーワードごとにスレをまとめる。先のキーワードに当たったスレは後のキーワードに数えない。
 * 運営のお知らせはどのまとまりにも入れず、残りの最後に置く(スマホ版の KeywordMatcher.groups と同じ)
 */
export function keywordGroupsOf<T extends ThreadSummary>(threads: T[], m: KeywordMatcher, isAnnouncement: (t: T) => boolean): { groups: { rule: KeywordRule; threads: T[] }[]; rest: T[] } {
  const byRule = new Map<string, T[]>()
  const rest: T[] = []
  const notices: T[] = []
  for (const t of threads) {
    if (isAnnouncement(t)) {
      notices.push(t)
      continue
    }
    const r = m.hit(t)
    if (!r) rest.push(t)
    else {
      const list = byRule.get(r.id)
      if (list) list.push(t)
      else byRule.set(r.id, [t])
    }
  }
  return { groups: m.active.flatMap((r) => (byRule.has(r.id) ? [{ rule: r, threads: byRule.get(r.id)! }] : [])), rest: [...rest, ...notices] }
}
