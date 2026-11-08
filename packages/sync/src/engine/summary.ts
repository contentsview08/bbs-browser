// 同期の状態の要約。「今すぐ同期」のあとで端末どうしを見比べるための値で、本文や URL は出さない
import type { AdapterContext, SyncAdapter } from '../adapters/types'
import { toHex, utf8 } from '../bytes'
import { sha256 } from '@noble/hashes/sha2.js'
import { SyncTables, type SyncSqlDb } from './tables'

const HASH_HEX = 12
const IDS_SHOWN = 20

export interface KindSummary {
  kind: string
  live: number
  tombstones: number
  pending: number
  needs_apply: number
  /** 同期の表の中身のハッシュ。全端末で一致する */
  hash: string
}

export interface LocalSummary {
  area: string
  count: number
  /** 手元の表のハッシュ。同じ行を持つ端末で一致する */
  hash: string
}

export interface SyncSummary {
  kinds: KindSummary[]
  local: LocalSummary[]
  /** 手元の件数が合わない理由ごとの数。0 は入れない */
  notes: Record<string, number>
  /** 種類ごとの件数とハッシュを 1 行にしたもの。貼って見比べる */
  text: string
}

export interface MismatchSummary {
  /** 手元が同期の表と違うレコードの数 */
  differs: Record<string, number>
  /** 手元にあるのにレコードのない行の数 */
  missing: Record<string, number>
  /** 確かめるためのレコード ID の先頭。ID は片道の HMAC なので中身は分からない */
  samples: string[]
}

export const hashLines = (lines: readonly string[]): string => toHex(sha256(utf8([...lines].sort().join('\n')))).slice(0, HASH_HEX)

export async function syncSummary(db: SyncSqlDb, adapters: readonly SyncAdapter[], ctx: AdapterContext): Promise<SyncSummary> {
  const groups = new Map<string, { live: number; tombstones: number; pending: number; needs_apply: number; lines: string[] }>()
  // 既読の送信待ちなど、手元だけで変わるものを除いて比べる値を作る
  const rows = await db.select<{ record_id: string; kind: string; payload: string; deleted: number; pending: number; needs_apply: number }>('SELECT record_id, kind, payload, deleted, pending, needs_apply FROM sync_records')
  for (const r of rows) {
    const g = groups.get(r.kind) ?? { live: 0, tombstones: 0, pending: 0, needs_apply: 0, lines: [] }
    if (Number(r.deleted) === 1) g.tombstones++
    else g.live++
    g.pending += Number(r.pending)
    g.needs_apply += Number(r.needs_apply)
    g.lines.push(`${r.record_id}\t${r.payload}`)
    groups.set(r.kind, g)
  }
  const kinds = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([kind, g]) => ({ kind, live: g.live, tombstones: g.tombstones, pending: g.pending, needs_apply: g.needs_apply, hash: hashLines(g.lines) }))
  const areas = new Map<string, string[]>()
  for (const a of adapters) {
    const lines = await a.localLines?.(ctx)
    if (lines === undefined) continue
    const key = a.localArea ?? a.area
    areas.set(key, [...(areas.get(key) ?? []), ...lines])
  }
  const local = [...areas.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([area, lines]) => ({ area, count: lines.length, hash: hashLines(lines) }))
  const notes: Record<string, number> = {}
  const note = (k: string, n: number) => {
    if (n > 0) notes[k] = (notes[k] ?? 0) + n
  }
  for (const a of adapters) for (const [k, n] of Object.entries((await a.explain?.(ctx)) ?? {})) note(k, n)
  // この版で処理できる操作だけを数える(送信待ちの数と同じ決まり。知らない操作は永久に残るので数えない)
  const opNames = [...new Set(adapters.flatMap((a) => a.ops))]
  const [ops] = opNames.length === 0 ? [{ n: 0 }] : await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_ops WHERE op IN (${opNames.map((_, i) => `$${i + 1}`).join(', ')})`, opNames)
  note('ops_waiting', Number(ops?.n ?? 0))
  const [bad] = await db.select<{ value: string }>("SELECT value FROM sync_state WHERE key = 'bad_counts'")
  if (bad) for (const [k, n] of Object.entries(JSON.parse(bad.value) as Record<string, number>)) note(`bad_${k}`, n)
  const sorted = Object.keys(notes).sort()
  const text = [...kinds.map((k) => `${k.kind}=${k.live}+${k.tombstones}:${k.hash}`), ...local.map((l) => `@${l.area}=${l.count}:${l.hash}`), ...sorted.map((k) => `?${k}=${notes[k]}`)].join(' ')
  return { kinds, local, notes, text }
}

/** 重いので押したときだけ。apply は文を作るだけで書かないので、手元と表の違いをそのまま数えられる */
export async function syncMismatches(db: SyncSqlDb, adapters: readonly SyncAdapter[], ctx: AdapterContext): Promise<MismatchSummary> {
  const t = new SyncTables(db)
  const out: MismatchSummary = { differs: {}, missing: {}, samples: [] }
  const add = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1
  }
  const kinds = new Set(adapters.map((a) => a.kind))
  for (const kind of kinds) {
    const owners = adapters.filter((a) => a.kind === kind)
    for (const r of await t.recordsOfKind(kind)) {
      if (r.needs_apply || r.payload.trim === true) continue
      const a = owners.find((x) => x.owns(r))
      if (!a) continue
      const differs = a.differs ? await a.differs(r, ctx) : (await a.apply(r, ctx)).changed
      if (!differs) continue
      add(out.differs, kind)
      if (out.samples.length < IDS_SHOWN) out.samples.push(r.record_id.slice(0, HASH_HEX))
    }
  }
  for (const a of adapters) {
    if (a.seedsAll === false) continue
    for (const row of await a.seed(ctx)) {
      if ((await t.record(row.record_id)) === null) add(out.missing, a.kind)
    }
  }
  return out
}

