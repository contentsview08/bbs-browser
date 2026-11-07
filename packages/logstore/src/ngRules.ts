// NG の配列の差分と、同期の本文との行き来。ngRules は配列まるごとの書き込みなので、古い窓の配列をそのまま書くと別の窓の変更が消える。
// 差分は「その配列を作った窓が見ていた配列」と比べて作り、今の値に重ねる

export interface NgRuleData {
  id: string
  target: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  expiresOnDate?: string
  boardUrl?: string
  boardName?: string
  note?: string
  createdAt?: number
}

export interface NgDiff<T extends NgRuleData = NgRuleData> {
  /** 足した・直した */
  upsert: T[]
  /** 利用者が消した。全端末で消える */
  remove: string[]
  /** 手元からだけ消す。期限切れの片づけはどの端末でも同じ結果になるので送らない */
  drop: string[]
}

const same = (a: NgRuleData, b: NgRuleData) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
const sorted = (r: NgRuleData) => Object.entries(r).filter(([, v]) => v !== undefined && v !== null).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/** before は after を作るもとになった配列。読み込み直前の値を渡さない。keepRemoved は消えた要素を送らない(読み込みなど、消す操作でないもの) */
export function ngDiff<T extends NgRuleData>(before: readonly T[], after: readonly T[], today: string, o: { keepRemoved?: boolean } = {}): NgDiff<T> {
  const old = new Map(before.map((r) => [r.id, r]))
  const now = new Set(after.map((r) => r.id))
  const gone = before.filter((r) => !now.has(r.id))
  const expired = (r: T) => r.expiresOnDate !== undefined && r.expiresOnDate !== '' && r.expiresOnDate < today
  return {
    upsert: after.filter((r) => {
      const was = old.get(r.id)
      return !was || !same(was, r)
    }),
    remove: gone.filter((r) => !expired(r) && !o.keepRemoved).map((r) => r.id),
    drop: gone.filter((r) => expired(r) || o.keepRemoved).map((r) => r.id),
  }
}

export const isEmptyNgDiff = (d: NgDiff<NgRuleData>) => d.upsert.length === 0 && d.remove.length === 0 && d.drop.length === 0

export function applyNgDiff<T extends NgRuleData>(base: readonly T[], d: NgDiff<T>): T[] {
  const gone = new Set([...d.remove, ...d.drop])
  const next = new Map(d.upsert.map((r) => [r.id, r]))
  const kept = base.filter((r) => !gone.has(r.id)).map((r) => next.get(r.id) ?? r)
  const have = new Set(kept.map((r) => r.id))
  return [...kept, ...d.upsert.filter((r) => !have.has(r.id))]
}

const NAME_MAX = 256
const NOTE_MAX = 1024

/** 同期の本文の形。id も値も手元の値そのまま。長すぎるものは検査で落ちて送られない */
export function ngRuleToBody(r: NgRuleData): Record<string, unknown> {
  return {
    id: r.id,
    type: r.target,
    value: r.pattern,
    is_regex: r.isRegex === true,
    enabled: r.enabled !== false,
    ...(!!r.expiresOnDate && { expires_on: r.expiresOnDate }),
    ...(!!r.boardUrl && { board_url: r.boardUrl }),
    ...(!!r.boardName && { board_name: r.boardName.slice(0, NAME_MAX) }),
    ...(!!r.note && { note: r.note.slice(0, NOTE_MAX) }),
    ...(!!r.createdAt && { created_at: r.createdAt }),
  }
}

export function ngRuleFromBody(b: Record<string, unknown>): NgRuleData {
  const str = (k: string) => (typeof b[k] === 'string' && b[k] !== '' ? (b[k] as string) : undefined)
  const expiresOnDate = str('expires_on')
  const boardUrl = str('board_url')
  const boardName = str('board_name')
  const note = str('note')
  return {
    id: b.id as string,
    target: b.type as string,
    pattern: b.value as string,
    isRegex: b.is_regex === true,
    enabled: b.enabled !== false,
    ...(!!expiresOnDate && { expiresOnDate }),
    ...(!!boardUrl && { boardUrl }),
    ...(!!boardName && { boardName }),
    ...(!!note && { note }),
    ...(typeof b.created_at === 'number' && b.created_at > 0 && { createdAt: b.created_at }),
  }
}
