// 端末の動きをまねて、順番と重複を変えても同じ状態になるかを見る。スマホ版の SyncSim.kt と同じ手順で乱数を使う(同じシードで同じ結果になるか比べるため)
import { sha256 } from '@noble/hashes/sha2.js'
import { HLC_ZERO, LAST_VIEWED_FIELD, canonicalJson, compareHlc, hlcObserve, hlcStamp, makeReset, makeTombstone, mergePayloads, readPosition, recordRead, resetFloor, toHex, updateRecord, utf8, type SyncPayload } from '../src/index'

export class Rng {
  private a: number
  constructor(seed: number) {
    this.a = seed | 0
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
  int(n: number): number {
    return this.next() % n
  }
}

type Store = Map<string, SyncPayload>

export interface SimOptions {
  seed: number
  devices: number
  ops: number
  skews: number[]
  /** スレ×端末ごとの読む回数の上限。8 以下なら steps から溢れない */
  max_reads?: number
  /** 読むたびに位置を小さくして、steps を溢れさせる */
  decreasing_reads?: boolean
}

export interface SimResult {
  state: string
  sha256: string
  /** 全端末・全順序の状態が同じか */
  converged: boolean
  /** 読みの記録だけから求めた既読位置との比較 */
  positions: Record<string, number>
  oracle: Record<string, number>
  resets: Record<string, number>
}

function shuffled<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const devsOf = (s: Store, thread: string): SyncPayload[] =>
  [...s.keys()].filter((k) => k.startsWith(`dev:${thread}:`)).sort().map((k) => s.get(k) as SyncPayload)

function apply(s: Store, id: string, p: SyncPayload): void {
  const old = s.get(id)
  s.set(id, old ? mergePayloads(old, p) : p)
}

function stateOf(s: Store): string {
  const records: Record<string, SyncPayload> = {}
  for (const k of [...s.keys()].sort()) records[k] = s.get(k) as SyncPayload
  const positions: Record<string, number> = {}
  for (const t of ['t0', 't1']) positions[t] = readPosition(s.get(`reset:${t}`) ?? null, devsOf(s, t))
  return canonicalJson({ positions, records })
}

export function simulate(o: SimOptions): SimResult {
  const rng = new Rng(o.seed)
  const names = Array.from({ length: o.devices }, (_, i) => `d${i}`)
  const stores: Store[] = names.map(() => new Map())
  const clocks = names.map(() => HLC_ZERO)
  const log: [string, SyncPayload][] = []
  const reads: { thread: string; at: string; pos: number; known: string | null }[] = []
  const readCount = new Map<string, number>()
  let now = 1_700_000_000_000
  let seq = 0
  const stamp = (d: number, wall: number, floor?: string) => {
    const r = hlcStamp(clocks[d], wall, names[d], floor)
    clocks[d] = r.clock
    return r.stamp
  }
  const write = (d: number, id: string, p: SyncPayload) => {
    apply(stores[d], id, p)
    log.push([id, p])
  }
  for (let op = 0; op < o.ops; op++) {
    now += 1 + rng.int(5000)
    const d = rng.int(o.devices)
    const t = `t${rng.int(2)}`
    const r = rng.int(100)
    const wall = now + o.skews[d % o.skews.length]
    const s = stores[d]
    if (r < 35) {
      const random = rng.int(1000)
      const key = `${t}:${d}`
      const n = readCount.get(key) ?? 0
      const pos = o.decreasing_reads ? Math.max(0, 10000 - n * 7) : random
      if (o.max_reads !== undefined && n >= o.max_reads) continue
      readCount.set(key, n + 1)
      const id = `dev:${t}:${names[d]}`
      const dev = s.get(id) ?? null
      const latest = s.get(`reset:${t}`) ?? null
      const at = stamp(d, wall, dev?.hlc)
      reads.push({ thread: t, at, pos, known: (latest?.body?.id as string | undefined) ?? null })
      write(d, id, recordRead(dev, latest, pos, at, names[d]))
    } else if (r < 45) {
      const target = rng.int(3) === 0 ? rng.int(100) : 0
      const latest = s.get(`reset:${t}`) ?? null
      const at = stamp(d, wall, resetFloor(latest, devsOf(s, t)))
      seq++
      write(d, `reset:${t}`, makeReset(latest, `r${seq}`, target, at, names[d]))
    } else if (r < 60) {
      const id = `fav:${t}`
      const old = s.get(id) ?? null
      const title = `title${rng.int(3)}`
      write(d, id, updateRecord(old, 'favorite', { board_url: 'https://a.example/b/', thread: t, title }, stamp(d, wall, old?.hlc), names[d]))
    } else if (r < 65) {
      const id = `fav:${t}`
      const old = s.get(id)
      if (old) write(d, id, makeTombstone(old, stamp(d, wall, old.hlc), names[d]))
    } else if (r < 70) {
      const id = `lv:${t}`
      const old = s.get(id)
      if (old) write(d, id, makeTombstone(old, stamp(d, wall, old.hlc), names[d], [LAST_VIEWED_FIELD]))
    } else if (r < 80) {
      const id = `lv:${t}`
      const old = s.get(id) ?? null
      const viewed = rng.int(1_000_000)
      write(d, id, updateRecord(old, 'last_view', { board_url: 'https://a.example/b/', thread: t, last_viewed_at: viewed }, stamp(d, wall, old?.hlc), names[d]))
    } else if (r < 90) {
      const id = `ord:${t}`
      const old = s.get(id) ?? null
      const key = String(1 + rng.int(9))
      write(d, id, updateRecord(old, 'order', { key }, stamp(d, wall, old?.hlc), names[d]))
    } else {
      const from = rng.int(o.devices)
      if (from === d) continue
      for (const k of [...stores[from].keys()].sort()) {
        const p = stores[from].get(k) as SyncPayload
        apply(s, k, p)
        clocks[d] = hlcObserve(clocks[d], p.hlc, wall)
      }
    }
  }
  // 元の端末も新しい端末も、全部の変更を順番を変えて重複ありで受け取る
  const replicas: Store[] = [...stores, new Map(), new Map(), new Map()]
  for (const rep of replicas) {
    const dupes = Array.from({ length: Math.floor(log.length / 3) }, () => log[rng.int(Math.max(log.length, 1))]).filter(Boolean)
    for (const [id, p] of shuffled(rng, [...log, ...dupes])) apply(rep, id, p)
  }
  const states = replicas.map(stateOf)
  const final = replicas[0]
  const positions: Record<string, number> = {}
  const oracle: Record<string, number> = {}
  const resets: Record<string, number> = {}
  for (const t of ['t0', 't1']) {
    const latest = final.get(`reset:${t}`) ?? null
    const id = (latest?.body?.id as string | undefined) ?? null
    const after = latest?.hlc ?? HLC_ZERO
    resets[t] = (latest?.body?.target_res as number | undefined) ?? 0
    positions[t] = readPosition(latest, devsOf(final, t))
    oracle[t] = reads.filter((x) => x.thread === t && (compareHlc(x.at, after) > 0 || x.known === id)).reduce((m, x) => Math.max(m, x.pos), resets[t])
  }
  return { state: states[0], sha256: toHex(sha256(utf8(states[0]))), converged: states.every((x) => x === states[0]), positions, oracle, resets }
}

/** マージの法則を確かめるための、同じ HLC や同じ値がよくぶつかる値 */
export function randomPayload(rng: Rng, kind: string): SyncPayload {
  const device = `d${rng.int(2)}`
  const p: SyncPayload = { kind, hlc: `00000000000${1 + rng.int(3)}.000${rng.int(2)}.${device}`, device_id: device }
  if (rng.int(5) === 0) p.deleted = true
  if (rng.int(4) === 0) p.x_future = rng.int(2)
  if (p.deleted !== true || rng.int(2) === 0) {
    const body: Record<string, unknown> = {}
    if (rng.int(2) === 0) body.title = `t${rng.int(2)}`
    if (rng.int(3) !== 0) body[LAST_VIEWED_FIELD] = rng.int(4)
    if (Object.keys(body).length > 0) p.body = body
  }
  return p
}
