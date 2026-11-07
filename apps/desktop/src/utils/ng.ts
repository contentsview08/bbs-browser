// NG(あぼーん)。スマホ版(data/Prefs.kt の NgRule)と同じ形・同じ当て方:
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

/**
 * NG の正規表現を読む。スマホ版(data/Ng.kt の ngRegex)と同じ書き方が同じ意味になるようにそろえる(packages/conformance/ng.json)。
 * 先頭の (?i) で大文字・小文字を区別しない。途中の (?i) は読めない。\p{Han} など文字の種類の名前も使える。
 * throw するのは読めないとき
 */
export function ngRegExp(pattern: string, global = false): RegExp {
  const ignoreCase = pattern.startsWith('(?i)')
  const src = (ignoreCase ? pattern.slice(4) : pattern).replace(/\\(?:([pP])\{(Han|Hiragana|Katakana|Latin|Hangul|Greek|Cyrillic)\}|[\s\S])/g, (all, p, name) =>
    p ? `\\${p}{Script=${name}}` : all,
  )
  if (/\(\?[a-zA-Z-]/.test(src.replace(/\\[\s\S]|\[(?:\\[\s\S]|[^\]\\])*\]/g, ''))) throw new SyntaxError('(?i) は先頭にだけ書けます')
  const flags = (ignoreCase ? 'i' : '') + (global ? 'g' : '')
  try {
    return new RegExp(src, `${flags}u`)
  } catch (e) {
    // u を付けると読めない書き方(\- や { だけなど)でも、前から作ってある NG が効かなくならないよう u なしで読む。\p は u なしだと別の意味になるので読めないまま
    if (/\\[pP]\{/.test(src)) throw e
    return new RegExp(src, flags)
  }
}

export function isValidPattern(pattern: string, isRegex: boolean): boolean {
  return patternError(pattern, isRegex) === undefined
}

/** 正規表現として読めないときの理由(画面に出す)。読めれば undefined */
export function patternError(pattern: string, isRegex: boolean): string | undefined {
  if (!pattern) return '文字を入れてください'
  if (!isRegex) return undefined
  try {
    ngRegExp(pattern)
    return undefined
  } catch (e) {
    return `正規表現として読めません(${e instanceof Error ? e.message : String(e)})`
  }
}

const NG_WIDE_MAX = 3
const NG_REPEAT_MAX = 1000
const NG_NESTED_REPEAT_MAX = 8
/** 選択肢の先頭が何にでも当たる印 */
const ANY_HEAD = '*'

/**
 * 同期で来た式を手元に入れる前の検査。正規表現は途中で止められないので、固まる形を文字の上で見分ける。
 * 繰り返しの中の繰り返し、重なる選択肢の繰り返し、幅の広い繰り返しの連続と多用、巨大な回数を落とす(data/Ng.kt と同じ。packages/conformance/ng-risky.json)
 */
export function ngRiskyPattern(pattern: string): boolean {
  const p = pattern.startsWith('(?i)') ? pattern.slice(4) : pattern
  interface Frame {
    variable: boolean
    alts: (string | null)[]
    head: string | null
    /** 直前の要素が幅の広い繰り返しだった */
    lastWide: boolean
  }
  const newFrame = (): Frame => ({ variable: false, alts: [], head: null, lastWide: false })
  const stack: Frame[] = [newFrame()]
  const top = () => stack[stack.length - 1]
  const setHead = (h: string) => {
    if (top().head === null) top().head = h
  }
  let wide = 0
  let i = 0
  while (i < p.length) {
    const c = p[i]
    let isWide = false
    let group: { variable: boolean; overlap: boolean } | null = null
    if (c === '(') {
      setHead(ANY_HEAD)
      i++
      const m = /^\?(?::|=|!|<=|<!|<[^>]*>)/.exec(p.slice(i))
      if (m) i += m[0].length
      stack.push(newFrame())
      continue
    }
    if (c === '|') {
      top().alts.push(top().head)
      top().head = null
      top().lastWide = false
      i++
      continue
    }
    if (c === '^' || c === '$') {
      i++
      continue
    }
    if (c === ')') {
      if (stack.length === 1) return false
      const f = stack.pop() as Frame
      const alts = [...f.alts, f.head]
      const overlap = alts.length > 1 && (alts.includes(null) || alts.includes(ANY_HEAD) || new Set(alts).size < alts.length)
      group = { variable: f.variable, overlap }
      top().variable ||= f.variable
      i++
    } else if (c === '\\') {
      const e = p[i + 1] ?? ''
      isWide = /[dDwWsSpP]/.test(e)
      i += 2
      if ((e === 'p' || e === 'P') && p[i] === '{') {
        const end = p.indexOf('}', i)
        i = end < 0 ? p.length : end + 1
      }
      setHead(isWide ? ANY_HEAD : `\\${e}`)
    } else if (c === '[') {
      i++
      if (p[i] === '^') i++
      while (i < p.length && p[i] !== ']') i += p[i] === '\\' ? 2 : 1
      i++
      isWide = true
      setHead(ANY_HEAD)
    } else {
      isWide = c === '.'
      i++
      setHead(isWide ? ANY_HEAD : c)
    }
    const q = /^(?:[*+?]|\{(\d+)(,(\d*))?\})\??/.exec(p.slice(i))
    if (!q) {
      top().lastWide = false
      continue
    }
    i += q[0].length
    const min = q[1] === undefined ? (q[0][0] === '+' ? 1 : 0) : Number(q[1])
    const open = q[0][0] === '*' || q[0][0] === '+' || (q[2] !== undefined && q[3] === '')
    const max = q[0][0] === '?' ? 1 : open ? Infinity : q[2] === undefined ? min : Number(q[3])
    if (min > NG_REPEAT_MAX || (max !== Infinity && max > NG_REPEAT_MAX)) return true
    if (group && ((group.variable && max > NG_NESTED_REPEAT_MAX) || (group.overlap && max > 1))) return true
    if (max !== min) top().variable = true
    if (open && (isWide || group)) {
      if (top().lastWide || ++wide > NG_WIDE_MAX) return true
      top().lastWide = true
    } else top().lastWide = false
  }
  return false
}

/** 同期で来た式を手元に入れてよいか */
export function ngPatternSyncable(pattern: string, isRegex: boolean): boolean {
  return patternError(pattern, isRegex) === undefined && (!isRegex || !ngRiskyPattern(pattern))
}

/** いま効いているか(有効で、期限が切れていない) */
export function isActive(r: NgRule, today = todayDateString()): boolean {
  return r.enabled && (!r.expiresOnDate || r.expiresOnDate >= today)
}

type Matcher = (text: string, boardUrl?: string) => boolean

/**
 * ルールを判定関数にしておく(レスの数だけ正規表現を作り直さないため)。
 * 正規表現でない文字は、大文字・小文字を区別せずに含むか(スマホのアプリと同じ)
 */
function compile(rules: NgRule[], target: NgTarget): Matcher[] {
  const today = todayDateString()
  return rules
    // 空の文字はどの文字列にも当たる。すべてのレスを消さないように外す
    .filter((r) => r.target === target && r.pattern !== '' && isActive(r, today))
    .flatMap((r): Matcher[] => {
      const inBoard = (b?: string) => !r.boardUrl || r.boardUrl === b
      if (!r.isRegex) {
        const p = r.pattern.toLowerCase()
        return [(t, b) => inBoard(b) && t.toLowerCase().includes(p)]
      }
      try {
        const re = ngRegExp(r.pattern)
        return [(t, b) => inBoard(b) && re.test(t)]
      } catch {
        return []
      }
    })
}

/** ID の NG: 正規表現でなければ完全一致(部分一致だと別の ID まで巻き込む) */
function idMatcher(rules: NgRule[]): (id: string | undefined, boardUrl?: string) => boolean {
  const today = todayDateString()
  const exact = rules.filter((r) => r.target === 'posterId' && !r.isRegex && r.pattern !== '' && isActive(r, today))
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
    re = ngRegExp(rule.pattern, true)
  } catch {
    return []
  }
  for (let m = re.exec(text); m && out.length < 200; m = re.exec(text)) {
    if (m[0].length === 0) re.lastIndex++
    else out.push([m.index, m.index + m[0].length])
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

/** このレスに当たっている NG(種類ごと)。「NG から外す」に使う */
export function ngHitsOf(rules: NgRule[], post: Post, boardUrl?: string): { posterId: NgRule[]; posterName: NgRule[]; content: NgRule[] } {
  const hit = (t: NgTarget) => rules.filter((r) => r.target === t && postMatcher([r])(post, boardUrl))
  return { posterId: hit('posterId'), posterName: hit('posterName'), content: hit('content') }
}
