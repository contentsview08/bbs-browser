// 端末の動きをまねて、順番と重複を変えても同じ状態になるかを見る。スマホ版の SyncSim.kt と同じ手順で乱数を使う(同じシードで同じ結果になるか比べるため)
import { sha256 } from '@noble/hashes/sha2.js'
import { HLC_ZERO, LAST_VIEWED_FIELD, canonicalJson, checkPayload, compareHlc, hlcObserve, hlcStamp, makeReset, makeTombstone, mergePayloads, planRecreate, readPosition, recordRead, resetFloor, settleRecord, toHex, updateRecord, utf8, type LocalRecord, type SyncPayload, type ThreadRef } from '../src/index'

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

const BOARD = 'https://a.example/b/'
const refOf = (thread: string): ThreadRef => ({ board_url: BOARD, thread })

/** シミュレーションで作る値は、受け取る側の検査を必ず通る */
function checked(p: SyncPayload): SyncPayload {
  if (checkPayload(p) === null) throw new Error(`検査に通らない: ${canonicalJson(p)}`)
  return p
}

function stateOf(s: Store, threads: readonly string[] = ['t0', 't1']): string {
  const records: Record<string, SyncPayload> = {}
  for (const k of [...s.keys()].sort()) records[k] = s.get(k) as SyncPayload
  const positions: Record<string, number> = {}
  for (const t of threads) positions[t] = readPosition(s.get(`reset:${t}`) ?? null, devsOf(s, t))
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
    apply(stores[d], id, checked(p))
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
      write(d, id, recordRead(dev, latest, refOf(t), pos, at, names[d]))
    } else if (r < 45) {
      const target = rng.int(3) === 0 ? rng.int(100) : 0
      const latest = s.get(`reset:${t}`) ?? null
      const at = stamp(d, wall, resetFloor(latest, devsOf(s, t)))
      seq++
      write(d, `reset:${t}`, makeReset(latest, refOf(t), `r${seq}`, target, at, names[d]))
    } else if (r < 60) {
      const id = `fav:${t}`
      const old = s.get(id) ?? null
      const title = `title${rng.int(3)}`
      write(d, id, updateRecord(old, 'favorite', { board_url: BOARD, thread: t, title }, stamp(d, wall, old?.hlc), names[d]))
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
      write(d, id, updateRecord(old, 'last_view', { board_url: BOARD, thread: t, last_viewed_at: viewed }, stamp(d, wall, old?.hlc), names[d]))
    } else if (r < 90) {
      const id = `ord:${t}`
      const old = s.get(id) ?? null
      const key = String(1 + rng.int(9))
      write(d, id, updateRecord(old, 'order', { board_url: BOARD, thread: t, key }, stamp(d, wall, old?.hlc), names[d]))
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
  const states = replicas.map((r) => stateOf(r))
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

// ここから下は領域が消えたときの動き。偽のサーバーと端末で、ふつうの同期と作り直しを通す

class RecreateDevice {
  clock = HLC_ZERO
  records = new Map<string, LocalRecord>()
  pending = new Set<string>()
  since = 0
  epoch = 0
  constructor(readonly name: string) {}
}

class RecreateServer {
  records = new Map<string, { payload: SyncPayload; version: number }>()
  next = 0
  epoch = 0
  ordered() {
    return [...this.records.entries()].sort((a, b) => a[1].version - b[1].version)
  }
}

function writeLocal(dev: RecreateDevice, id: string, p: SyncPayload, nowMs: number): void {
  const old = dev.records.get(id)
  dev.records.set(id, settleRecord(old ? mergePayloads(old.payload, checked(p)) : checked(p), old?.version ?? 0, old, nowMs))
  dev.pending.add(id)
}

function receive(dev: RecreateDevice, id: string, server: { payload: SyncPayload; version: number }, nowMs: number): void {
  const old = dev.records.get(id)
  const merged = old ? mergePayloads(old.payload, server.payload) : server.payload
  dev.records.set(id, settleRecord(merged, server.version, old, nowMs))
  if (canonicalJson(merged) === canonicalJson(server.payload)) dev.pending.delete(id)
  else dev.pending.add(id)
  dev.clock = hlcObserve(dev.clock, server.payload.hlc, nowMs)
}

function pullFrom(dev: RecreateDevice, srv: RecreateServer, nowMs: number): void {
  for (const [id, r] of srv.ordered()) {
    if (r.version <= dev.since) continue
    receive(dev, id, r, nowMs)
    dev.since = r.version
  }
}

/** tombstone を先に送る。先のものが 409 なら手元でマージし、次の周でまた送る */
function pushTo(dev: RecreateDevice, srv: RecreateServer, nowMs: number, limit = Number.MAX_SAFE_INTEGER): void {
  const isDead = (id: string) => (dev.records.get(id) as LocalRecord).payload.deleted === true
  const ids = [...dev.pending].sort((a, b) => Number(isDead(b)) - Number(isDead(a)) || (a < b ? -1 : a > b ? 1 : 0))
  for (const id of ids.slice(0, limit)) {
    const rec = dev.records.get(id) as LocalRecord
    const cur = srv.records.get(id)
    if (cur && cur.version > rec.version) {
      receive(dev, id, cur, nowMs)
      continue
    }
    const version = ++srv.next
    srv.records.set(id, { payload: rec.payload, version })
    dev.records.set(id, { ...rec, version })
    dev.pending.delete(id)
  }
}

function recreateOn(dev: RecreateDevice, srv: RecreateServer, nowMs: number, deliver = Number.MAX_SAFE_INTEGER): void {
  const delivered = srv.ordered().slice(0, deliver)
  const plan = planRecreate({ local: Object.fromEntries(dev.records), full: Object.fromEntries(delivered), nowMs })
  dev.records = new Map(Object.entries(plan.records))
  dev.pending = new Set(Object.keys(plan.pending))
  dev.since = delivered.length > 0 ? delivered[delivered.length - 1][1].version : 0
  dev.epoch = srv.epoch
  for (const [, r] of delivered) dev.clock = hlcObserve(dev.clock, r.payload.hlc, nowMs)
}

/** 周の順は pull → push。epoch が変わっていれば、先に作り直す */
function syncWith(dev: RecreateDevice, srv: RecreateServer, nowMs: number, pushLimit?: number): void {
  if (dev.epoch !== srv.epoch) recreateOn(dev, srv, nowMs)
  pullFrom(dev, srv, nowMs)
  pushTo(dev, srv, nowMs, pushLimit)
}

function deleteSpace(srv: RecreateServer): void {
  srv.records.clear()
  srv.epoch++
}

const payloadsOf = (dev: RecreateDevice): Store => new Map([...dev.records.entries()].map(([k, v]) => [k, v.payload]))

export interface RecreateOptions {
  seed: number
  devices: number
  ops: number
  skews: number[]
}

export interface RecreateResult {
  state: string
  sha256: string
  /** 全端末とサーバーの状態が同じか */
  converged: boolean
  /** 全部の変更をマージした結果と同じか(失ったものも、戻ったものもない) */
  matches_log: boolean
  /** 変更の結果は tombstone なのに生きているレコードの数 */
  revived: number
  /** 領域が消える前に tombstone になり、そのあと書かれなかったレコードの数(確かめた場面の数) */
  survived_tombstones: number
}

const THREADS = ['t0', 't1', 't2', 't3']

export function simulateRecreate(o: RecreateOptions): RecreateResult {
  const rng = new Rng(o.seed)
  const devices = Array.from({ length: o.devices }, (_, i) => new RecreateDevice(`d${i}`))
  const srv = new RecreateServer()
  const log: [string, SyncPayload][] = []
  let now = 1_700_000_000_000
  let seq = 0
  let deletedAt = new Map<string, string>()
  const stamp = (dev: RecreateDevice, wall: number, floor?: string) => {
    const r = hlcStamp(dev.clock, wall, dev.name, floor)
    dev.clock = r.clock
    return r.stamp
  }
  const write = (dev: RecreateDevice, id: string, p: SyncPayload, wall: number) => {
    writeLocal(dev, id, p, wall)
    log.push([id, p])
  }
  for (let round = 0; round < 2; round++) {
    for (let op = 0; op < o.ops; op++) {
      now += 1 + rng.int(5000)
      const d = rng.int(o.devices)
      const dev = devices[d]
      // 後半は半分のスレだけを書き、領域が消える前の tombstone を最後まで残す
      const t = THREADS[rng.int(round === 0 ? THREADS.length : THREADS.length / 2)]
      const r = rng.int(100)
      const wall = now + o.skews[d % o.skews.length]
      const get = (id: string) => dev.records.get(id)?.payload ?? null
      if (r < 25) {
        const pos = rng.int(1000)
        const id = `dev:${t}:${dev.name}`
        const old = get(id)
        write(dev, id, recordRead(old, get(`reset:${t}`), refOf(t), pos, stamp(dev, wall, old?.hlc), dev.name), wall)
      } else if (r < 35) {
        const target = rng.int(3) === 0 ? rng.int(100) : 0
        const latest = get(`reset:${t}`)
        const at = stamp(dev, wall, resetFloor(latest, devsOf(payloadsOf(dev), t)))
        seq++
        write(dev, `reset:${t}`, makeReset(latest, refOf(t), `r${seq}`, target, at, dev.name), wall)
      } else if (r < 50) {
        const id = `fav:${t}`
        const old = get(id)
        const title = `title${rng.int(3)}`
        write(dev, id, updateRecord(old, 'favorite', { board_url: BOARD, thread: t, title }, stamp(dev, wall, old?.hlc), dev.name), wall)
      } else if (r < 65) {
        const id = `fav:${t}`
        const old = get(id)
        if (old) write(dev, id, makeTombstone(old, stamp(dev, wall, old.hlc), dev.name), wall)
      } else if (r < 72) {
        const id = `lv:${t}`
        const old = get(id)
        if (old) write(dev, id, makeTombstone(old, stamp(dev, wall, old.hlc), dev.name, [LAST_VIEWED_FIELD]), wall)
      } else if (r < 85) {
        const id = `lv:${t}`
        const old = get(id)
        const viewed = rng.int(1_000_000)
        write(dev, id, updateRecord(old, 'last_view', { board_url: BOARD, thread: t, last_viewed_at: viewed }, stamp(dev, wall, old?.hlc), dev.name), wall)
      } else if (r < 90) {
        const id = `ord:${t}`
        const old = get(id)
        const key = String(1 + rng.int(9))
        write(dev, id, updateRecord(old, 'order', { board_url: BOARD, thread: t, key }, stamp(dev, wall, old?.hlc), dev.name), wall)
      } else {
        syncWith(dev, srv, wall, rng.int(dev.pending.size + 1))
      }
    }
    if (round === 0) {
      deletedAt = new Map()
      for (const dev of devices) for (const [id, r] of dev.records) if (r.payload.deleted === true) deletedAt.set(id, r.payload.hlc)
      deleteSpace(srv)
      // 一部の端末だけが先に気づき、途中までしか受け取らず、途中までしか送らない
      const first = shuffled(rng, devices).slice(0, 1 + rng.int(o.devices))
      for (const dev of first) {
        now += 1 + rng.int(5000)
        recreateOn(dev, srv, now, rng.int(srv.records.size + 1))
        pushTo(dev, srv, now, rng.int(dev.pending.size + 1))
      }
    }
  }
  for (let pass = 0; pass < 6; pass++) for (const dev of devices) syncWith(dev, srv, now)
  const oracle: Store = new Map()
  for (const [id, p] of log) apply(oracle, id, p)
  const states = devices.map((dev) => stateOf(payloadsOf(dev), THREADS))
  const serverState = stateOf(new Map([...srv.records.entries()].map(([k, v]) => [k, v.payload])), THREADS)
  const oracleState = stateOf(oracle, THREADS)
  const finalStore = payloadsOf(devices[0])
  let revived = 0
  let survived = 0
  for (const [id, p] of oracle) {
    if (p.deleted === true && finalStore.get(id)?.deleted !== true) revived++
    if (p.deleted === true && deletedAt.get(id) === p.hlc) survived++
  }
  return {
    state: states[0],
    sha256: toHex(sha256(utf8(states[0]))),
    converged: states.every((x) => x === states[0]) && serverState === states[0],
    matches_log: states[0] === oracleState,
    revived,
    survived_tombstones: survived,
  }
}

/** 手順を順に動かす。結果は端末とサーバーごとの { ID: スレタイ }。tombstone は null、レコードがなければキーなし */
export function recreateScript(events: Record<string, any>[], onExpect: (who: string, actual: unknown, expected: unknown) => void): Record<string, unknown> {
  const srv = new RecreateServer()
  const devices = new Map<string, RecreateDevice>()
  const dev = (n: string) => {
    if (!devices.has(n)) devices.set(n, new RecreateDevice(n))
    return devices.get(n) as RecreateDevice
  }
  const view = (recs: Iterable<[string, { payload: SyncPayload }]>) => {
    const out: Record<string, unknown> = {}
    for (const [id, r] of [...recs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out[id] = r.payload.deleted === true ? null : (r.payload.body?.title ?? '')
    return out
  }
  const viewOf = (n: string) => (n === 'server' ? view(srv.records) : view(dev(n).records))
  for (const e of events) {
    if (e.dev !== undefined) {
      const d = dev(e.dev)
      if (e.add !== undefined) {
        const old = d.records.get(e.add)?.payload ?? null
        const r = hlcStamp(d.clock, e.t, d.name, old?.hlc)
        d.clock = r.clock
        writeLocal(d, e.add, updateRecord(old, 'favorite', { board_url: BOARD, thread: e.add, title: e.title }, r.stamp, d.name), e.t)
      } else if (e.remove !== undefined) {
        const old = d.records.get(e.remove)?.payload as SyncPayload
        const r = hlcStamp(d.clock, e.t, d.name, old.hlc)
        d.clock = r.clock
        writeLocal(d, e.remove, makeTombstone(old, r.stamp, d.name), e.t)
      } else if (e.sync === true) {
        syncWith(d, srv, e.t)
      } else if (e.recreate === true) {
        recreateOn(d, srv, e.t, e.deliver ?? undefined)
        pushTo(d, srv, e.t, e.push ?? undefined)
      }
    } else if (e.delete_space === true) {
      deleteSpace(srv)
    } else if (e.expect !== undefined) {
      for (const [n, v] of Object.entries(e.expect)) onExpect(n, viewOf(n), v)
    }
  }
  return Object.fromEntries([...[...devices.keys()], 'server'].map((n) => [n, viewOf(n)]))
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
