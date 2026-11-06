// レコードの種類ごとのマージ。どれも可換・結合的・冪等(sync-merge.json とプロパティテストで確かめる)
import { SyncError } from './errors'
import { compareHlc } from './hlc'
import { canonicalJson } from './json'

/** 暗号文の中身。知らないフィールドはそのまま持ち続けて再送する */
export interface SyncPayload {
  kind: string
  hlc: string
  device_id: string
  deleted?: boolean
  body?: Record<string, unknown>
  [key: string]: unknown
}

export const compareCanonical = (a: unknown, b: unknown): number => {
  const x = canonicalJson(a)
  const y = canonicalJson(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** HLC が同じで中身が違うのは、端末を戻したときなどに起きる。中身でも決めて順番によらない結果にする */
export function mergeLww(a: SyncPayload, b: SyncPayload): SyncPayload {
  return (compareHlc(a.hlc, b.hlc) || compareCanonical(a, b)) >= 0 ? a : b
}

function withoutField(p: SyncPayload, field: string): SyncPayload {
  if (!p.body || !Object.hasOwn(p.body, field)) return p
  const { [field]: _, ...rest } = p.body
  if (Object.keys(rest).length > 0) return { ...p, body: rest }
  // field だけの本体は、本体がないのと同じに比べる
  const { body: __, ...noBody } = p
  return noBody as SyncPayload
}

const numberAt = (p: SyncPayload, field: string): number | undefined => {
  const v = p.body?.[field]
  return typeof v === 'number' ? v : undefined
}

/**
 * ほかは LWW、field だけ max にする。2 つの決まりの直積なので tombstone をまたいでも結合的でいられる。
 * 勝ち負けは field を除いて比べる(比べる値がマージで変わると結合的でなくなる)
 */
export function mergeWithMax(a: SyncPayload, b: SyncPayload, field: string): SyncPayload {
  const x = withoutField(a, field)
  const y = withoutField(b, field)
  const winner = (compareHlc(x.hlc, y.hlc) || compareCanonical(x, y)) >= 0 ? x : y
  const values = [numberAt(a, field), numberAt(b, field)].filter((n): n is number => n !== undefined)
  if (values.length === 0) return winner
  return { ...winner, body: { ...winner.body, [field]: Math.max(...values) } }
}

export const LAST_VIEWED_FIELD = 'last_viewed_at'

/** payload.kind に応じたマージ。知らない種類は LWW(新しい版の端末の値を消さない) */
export function mergePayloads(a: SyncPayload, b: SyncPayload): SyncPayload {
  return a.kind === 'last_view' || b.kind === 'last_view' ? mergeWithMax(a, b, LAST_VIEWED_FIELD) : mergeLww(a, b)
}

/** レコードの更新。知らないフィールドを残す。stamp は hlcStamp に existing.hlc を floor として渡して作る */
export function updateRecord(existing: SyncPayload | null, kind: string, changes: Record<string, unknown>, stamp: string, deviceId: string): SyncPayload {
  const { deleted: _, ...base } = existing ?? ({} as Partial<SyncPayload>)
  return { ...base, kind, hlc: stamp, device_id: deviceId, body: { ...existing?.body, ...changes } }
}

/** 外した項目の中身を残さない。keep は max で持ち続けるフィールド(残さないと tombstone をまたいで max が崩れる) */
export function makeTombstone(existing: SyncPayload, stamp: string, deviceId: string, keep: readonly string[] = []): SyncPayload {
  const { body, ...base } = existing
  const kept = Object.fromEntries(keep.flatMap((k) => (body && Object.hasOwn(body, k) ? [[k, body[k]]] : [])))
  return { ...base, hlc: stamp, device_id: deviceId, deleted: true, ...(Object.keys(kept).length > 0 && { body: kept }) }
}

const ORDER_KEY_RE = /^[0-9]*[1-9]$/
export const isOrderKey = (s: unknown): s is string => typeof s === 'string' && s.length <= 1024 && ORDER_KEY_RE.test(s)

/** a < b の 0.xxx の小数の桁を返す(b が null なら上限は 1)。a・b とも末尾は 0 でない */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while (n < b.length && (a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? Number(a[0]) : 0
  const db = b !== null ? Number(b[0]) : 10
  if (db - da > 1) return String(Math.round((da + db) / 2))
  if (b !== null && b.length > 1) return b[0]
  return String(da) + midpoint(a.slice(1), null)
}

/**
 * 順序キーは 0.xxx の小数の桁の文字列。文字列の比較がそのまま数の大小になり、浮動小数点と違って桁が尽きない。
 * 末尾へ足すときは 1 ずつ進め、続けて足しても桁が増えにくくする
 */
export function orderKeyBetween(a: string | null, b: string | null): string {
  if ((a !== null && !isOrderKey(a)) || (b !== null && !isOrderKey(b)) || (a !== null && b !== null && a >= b)) throw new SyncError('bad_order_key')
  if (a === null && b === null) return '5'
  if (b === null) {
    const k = a as string
    const i = [...k].findIndex((c) => c !== '9')
    return i < 0 ? `${k}1` : k.slice(0, i) + String(Number(k[i]) + 1)
  }
  return midpoint(a ?? '', b)
}

/** 順序キーで並べる。同じキーは ID で決める(2 台で同じ位置へ動かしたとき) */
export function compareOrdered(a: { key: string; id: string }, b: { key: string; id: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
