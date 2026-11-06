// テスト用の同期サーバー。決まりは docs/sync-design.md の API と packages/conformance/sync-server-rules.json。スマホ版の FakeSyncServer.kt と同じ規則
import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase64Url, fromHex, toHex } from '../src/index'

export interface FakeServerOptions {
  now: () => number
  space_limit?: number
  evict_idle_days?: number
  idle_delete_days?: number
  tomb_gc_days?: number
  quota_bytes?: number
  quota_records?: number
  creation_closed?: boolean
  /** null は数えない */
  rate_per_minute?: number | null
  full_pull_per_hour?: number | null
}

export interface FakeRequest {
  method: string
  /** クエリを含む */
  path: string
  headers?: Record<string, string>
  body?: string
}

export interface FakeResponse {
  status: number
  headers: Record<string, string>
  body: string
}

interface ServerRecord {
  record_id: string
  version: number
  kind_tag: string
  schema_version: number
  deleted: boolean
  nonce: string
  ciphertext: string
  updated_at: number
}

interface Space {
  id: string
  epoch: string
  records: Map<string, ServerRecord>
  next: number
  gc_floor: number
  last_used: number
  created_at: number
  requests: Map<string, string>
  minute: number
  minute_count: number
  full_pulls: number[]
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MAX_BODY = 1024 * 1024
const MAX_RECORDS = 100
const PAGE_RECORDS = 500
const PAGE_BYTES = 1024 * 1024
const MAX_CIPHERTEXT = 16 * 1024
const RECORD_KEYS = ['base_version', 'ciphertext', 'deleted', 'kind_tag', 'nonce', 'record_id', 'schema_version']
const KNOWN: Record<string, string[]> = { '/spaces': ['POST'], '/changes': ['GET'], '/records': ['POST'], '/head': ['GET'], '/space': ['GET', 'DELETE'] }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const json = (status: number, value: unknown, headers: Record<string, string> = {}): FakeResponse => ({ status, headers, body: JSON.stringify(value) })
const fail = (status: number, error: string) => json(status, { error })

function decoded(s: unknown): Uint8Array | null {
  if (typeof s !== 'string') return null
  try {
    return fromBase64Url(s)
  } catch {
    return null
  }
}

export function fakeSpaceIdOf(tokenHex: string): string {
  return toHex(sha256(fromHex(tokenHex)))
}

export class FakeSyncServer {
  readonly spaces = new Map<string, Space>()
  private epochs = 0
  readonly o: Required<FakeServerOptions>

  constructor(options: FakeServerOptions) {
    this.o = {
      space_limit: 100,
      evict_idle_days: 14,
      idle_delete_days: 90,
      tomb_gc_days: 90,
      quota_bytes: 10 * 1024 * 1024,
      quota_records: 50_000,
      creation_closed: false,
      rate_per_minute: 20,
      full_pull_per_hour: 3,
      ...options,
    }
  }

  // ── テストの操作。API にはない ──

  deleteSpace(id: string): void {
    this.spaces.delete(id)
  }

  bumpEpoch(id: string): void {
    const s = this.spaces.get(id)
    if (s) s.epoch = this.newEpoch()
  }

  injectRecord(id: string, r: Omit<ServerRecord, 'version' | 'updated_at'>): void {
    const s = this.spaces.get(id) as Space
    s.records.set(r.record_id, { ...r, version: ++s.next, updated_at: this.o.now() })
  }

  private newEpoch(): string {
    return `e${++this.epochs}`
  }

  private housekeeping(): void {
    const now = this.o.now()
    for (const [id, s] of this.spaces) {
      if (now - s.last_used >= this.o.idle_delete_days * DAY) {
        this.spaces.delete(id)
        continue
      }
      for (const [rid, r] of s.records) {
        if (r.deleted && now - r.updated_at >= this.o.tomb_gc_days * DAY) {
          s.records.delete(rid)
          s.gc_floor = Math.max(s.gc_floor, r.version)
        }
      }
    }
  }

  handle(req: FakeRequest): FakeResponse {
    this.housekeeping()
    const q = req.path.indexOf('?')
    const path = q < 0 ? req.path : req.path.slice(0, q)
    const query = q < 0 ? '' : req.path.slice(q + 1)
    const methods = Object.hasOwn(KNOWN, path) ? KNOWN[path] : undefined
    if (!methods) return fail(404, 'not_found')
    if (!methods.includes(req.method)) return fail(405, 'method_not_allowed')
    if ((req.body?.length ?? 0) > MAX_BODY) return fail(413, 'too_large')
    const auth = req.headers?.Authorization ?? ''
    const m = /^Bearer ([0-9a-f]{64})$/.exec(auth)
    if (!m) return fail(401, 'unauthorized')
    const id = fakeSpaceIdOf(m[1])
    if (path === '/spaces') return this.createSpace(id)
    const space = this.spaces.get(id)
    if (!space) return fail(404, 'space_not_found')
    const now = this.o.now()
    if (this.o.rate_per_minute !== null) {
      const minute = Math.floor(now / 60_000)
      if (space.minute !== minute) {
        space.minute = minute
        space.minute_count = 0
      }
      if (++space.minute_count > this.o.rate_per_minute) return fail(429, 'rate_limited')
    }
    space.last_used = now
    if (path === '/changes') return this.changes(space, query)
    if (path === '/records') return this.records(space, req.body ?? '')
    if (path === '/head') {
      const etag = `"${space.epoch}:${space.next}"`
      if (req.headers?.['If-None-Match'] === etag) return { status: 304, headers: { ETag: etag }, body: '' }
      return json(200, { version: space.next, epoch: space.epoch, gc_floor: space.gc_floor }, { ETag: etag })
    }
    if (req.method === 'DELETE') {
      this.spaces.delete(id)
      return json(200, { deleted: true })
    }
    return json(200, { used_bytes: this.usedBytes(space), record_count: space.records.size, quota_bytes: this.o.quota_bytes, quota_records: this.o.quota_records, epoch: space.epoch, gc_floor: space.gc_floor })
  }

  private usedBytes(s: Space): number {
    let n = 0
    for (const r of s.records.values()) n += r.ciphertext.length
    return n
  }

  private createSpace(id: string): FakeResponse {
    const now = this.o.now()
    const existing = this.spaces.get(id)
    if (existing) {
      existing.last_used = now
      return json(200, { epoch: existing.epoch, created: false })
    }
    if (this.o.creation_closed) return fail(403, 'creation_closed')
    if (this.spaces.size >= this.o.space_limit) {
      const idle = [...this.spaces.values()].filter((s) => now - s.last_used >= this.o.evict_idle_days * DAY).sort((a, b) => a.last_used - b.last_used || (a.id < b.id ? -1 : 1))
      if (idle.length === 0) return fail(403, 'capacity_full')
      this.spaces.delete(idle[0].id)
    }
    const space: Space = { id, epoch: this.newEpoch(), records: new Map(), next: 0, gc_floor: 0, last_used: now, created_at: now, requests: new Map(), minute: 0, minute_count: 0, full_pulls: [] }
    this.spaces.set(id, space)
    return json(201, { epoch: space.epoch, created: true })
  }

  private changes(s: Space, query: string): FakeResponse {
    const m = /^since=(0|[1-9][0-9]*)$/.exec(query)
    if (!m || !Number.isSafeInteger(Number(m[1]))) return fail(400, 'bad_request')
    const since = Number(m[1])
    const now = this.o.now()
    // 空の領域の全件は重くない。使い始めの端末を止めないよう数えない
    if (since === 0 && this.o.full_pull_per_hour !== null && s.records.size > 0) {
      s.full_pulls = s.full_pulls.filter((at) => now - at < HOUR)
      if (s.full_pulls.length >= this.o.full_pull_per_hour) return fail(429, 'rate_limited')
      s.full_pulls.push(now)
    }
    const all = [...s.records.values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version)
    const page: ServerRecord[] = []
    let bytes = 0
    for (const r of all) {
      bytes += r.ciphertext.length + r.nonce.length
      if (page.length > 0 && (page.length >= PAGE_RECORDS || bytes > PAGE_BYTES)) break
      page.push(r)
    }
    return json(200, { records: page, head: s.next, more: page.length < all.length, epoch: s.epoch, gc_floor: s.gc_floor })
  }

  private records(s: Space, text: string): FakeResponse {
    let v: unknown
    try {
      v = JSON.parse(text)
    } catch {
      return fail(400, 'bad_request')
    }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail(400, 'bad_request')
    const body = v as Record<string, unknown>
    if (Object.keys(body).sort().join() !== 'records,request_id') return fail(400, 'bad_request')
    if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.request_id)) return fail(400, 'bad_request')
    const list = body.records
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_RECORDS || !list.every(validRecord)) return fail(400, 'bad_request')
    const seen = s.requests.get(body.request_id)
    if (seen !== undefined) return { status: 200, headers: {}, body: seen }
    let bytes = this.usedBytes(s)
    let count = s.records.size
    for (const r of list as Record<string, unknown>[]) {
      const cur = s.records.get(r.record_id as string)
      if (cur && cur.version > (r.base_version as number)) continue
      bytes += (r.ciphertext as string).length - (cur?.ciphertext.length ?? 0)
      if (!cur) count++
    }
    if (bytes > this.o.quota_bytes || count > this.o.quota_records) return fail(413, 'quota_exceeded')
    const now = this.o.now()
    const results = (list as Record<string, unknown>[]).map((r) => {
      const id = r.record_id as string
      const cur = s.records.get(id)
      if (cur && cur.version > (r.base_version as number)) return { record_id: id, status: 409, record: cur }
      const version = ++s.next
      s.records.set(id, { record_id: id, version, kind_tag: r.kind_tag as string, schema_version: r.schema_version as number, deleted: r.deleted as boolean, nonce: r.nonce as string, ciphertext: r.ciphertext as string, updated_at: now })
      return { record_id: id, status: 200, version }
    })
    const out = JSON.stringify({ results, epoch: s.epoch, gc_floor: s.gc_floor })
    s.requests.set(body.request_id, out)
    return { status: 200, headers: {}, body: out }
  }
}

function validRecord(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  if (Object.keys(r).sort().join() !== RECORD_KEYS.join()) return false
  if (typeof r.record_id !== 'string' || !/^[0-9a-f]{64}$/.test(r.record_id)) return false
  if (!isCount(r.base_version) || !isCount(r.schema_version) || typeof r.deleted !== 'boolean') return false
  if (r.kind_tag !== 'h' && r.kind_tag !== 's') return false
  if (decoded(r.nonce)?.length !== 24) return false
  const c = decoded(r.ciphertext)
  return c !== null && c.length <= MAX_CIPHERTEXT && c.length >= 272 && (c.length - 16) % 256 === 0
}
