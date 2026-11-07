// NG。配列の 1 要素が 1 レコードで、ID は ng:::<rule.id>。tombstone は利用者の操作(ng_diff)からしか作らない
import type { StoredRecord, SyncOpRow } from '../engine/tables'
import { formatHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { recordId } from '../keys'
import { makeTombstone, updateRecord, withoutTombstone, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const NG_KIND = 'ng'
export const NG_DIFF = 'ng_diff'
export const AREA_NG = 'ng'
const SEED_PRIORITY = 2
const NG_TYPES = ['content', 'posterName', 'posterId', 'threadTitle']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 手元に入れる件数の上限。レスごとに全部を当てるので、増やされると画面が固まる */
export const NG_APPLY_MAX = 5000
const KNOWN_FIELDS = ['id', 'type', 'value', 'is_regex', 'enabled', 'expires_on', 'board_url', 'board_name', 'note', 'created_at']

export type NgBody = Record<string, unknown>

/** 今の NG の置き場は端末で違う(PC は settings 表、スマホは Prefs)。値は本文の形で受け渡す */
export interface NgHost {
  read(): Promise<NgBody[]>
  /** id → 新しい本文(null は消す)を今の値に重ねて書く。古い配列で上書きしないため、ここで読み直す */
  apply(changes: ReadonlyMap<string, NgBody | null>): Promise<void>
  /** 既存の検査と、固まる式の検査 */
  patternOk(pattern: string, isRegex: boolean): boolean
  /** 端末の日付 YYYY-MM-DD */
  today(nowMs: number): string
}

const targetOf = (ctx: AdapterContext, id: string): OpTarget => ({
  record_id: recordId(ctx.keys.k_id, NG_KIND, null, '', id),
  refs: { ref_board: null, ref_thread: null, ref_detail: id, ref_local: null },
})

/** 比べるのは知っている項目だけ。新しい版の端末が足した項目で、毎回写し直さない */
const known = (body: NgBody): string => canonicalJson(Object.fromEntries(KNOWN_FIELDS.flatMap((k) => (Object.hasOwn(body, k) ? [[k, body[k]]] : []))))

const isExpired = (body: NgBody, today: string) => typeof body.expires_on === 'string' && body.expires_on < today

export class NgAdapter implements SyncAdapter {
  readonly kind = NG_KIND
  readonly area = AREA_NG
  readonly ops = [NG_DIFF]
  private readonly changes = new Map<string, NgBody | null>()
  /** 1 件ごとに読むと PC では窓をまたぐ呼び出しが件数だけ増える。照合と適用の間だけ持つ */
  private snapshot: Map<string, NgBody> | null = null
  private snapshotFor: AdapterContext | null = null
  private today = ''

  constructor(private readonly host: NgHost) {}

  private argsOf(op: SyncOpRow): { id: string; rule: NgBody | null } | null {
    try {
      const a = parseStrictJson(op.args ?? '') as { id?: unknown; rule?: unknown }
      if (typeof a?.id !== 'string' || a.id === '') return null
      return { id: a.id, rule: a.rule === null || a.rule === undefined ? null : (a.rule as NgBody) }
    } catch {
      return null
    }
  }

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const a = this.argsOf(op)
    return a && targetOf(ctx, a.id)
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    const a = this.argsOf(op) as { id: string; rule: NgBody | null }
    if (a.rule === null) return makeTombstone(existing ?? { kind: NG_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
    // 消した項目(期限など)を残さない。知らない項目だけ持ち続ける
    const kept = Object.fromEntries(Object.entries(existing?.body ?? {}).filter(([k]) => !KNOWN_FIELDS.includes(k)))
    return updateRecord(existing && { ...withoutTombstone(existing), body: kept } as SyncPayload, NG_KIND, a.rule, stamp, ctx.deviceId)
  }

  private async load(): Promise<Map<string, NgBody>> {
    return new Map((await this.host.read()).map((x) => [x.id as string, x]))
  }

  /** 期限の切れたものは送らない。受け取る端末でも手元に入らない */
  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    this.today = this.host.today(ctx.now)
    this.snapshot = await this.load()
    this.snapshotFor = ctx
    return [...this.snapshot.values()].flatMap((body) => {
      if (typeof body.id !== 'string' || body.id === '' || isExpired(body, this.today)) return []
      const wall = typeof body.created_at === 'number' ? body.created_at : 1
      const payload = { kind: NG_KIND, hlc: formatHlc(Math.max(1, Math.min(wall, ctx.now)), 0, ctx.deviceId), device_id: ctx.deviceId, body }
      return checkPayload(payload) === null ? [] : [{ ...targetOf(ctx, body.id), priority: SEED_PRIORITY, payload }]
    })
  }

  detailOf(p: SyncPayload): string | null {
    return typeof p.body?.id === 'string' ? p.body.id : null
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  private usable(body: NgBody): boolean {
    if (typeof body.value !== 'string' || body.value === '' || !NG_TYPES.includes(body.type as string)) return false
    if (body.expires_on !== undefined && !DATE_RE.test(body.expires_on as string)) return false
    return this.host.patternOk(body.value, body.is_regex === true)
  }

  /** 値まで比べる(表の値が正)。手元に入れないと決めたものは、あることにして照合のたびに数え直さない */
  async exists(r: StoredRecord): Promise<boolean> {
    const local = (this.snapshot ?? (await this.load())).get(r.ref_detail as string)
    if (r.payload.deleted === true) return local !== undefined
    const body = r.payload.body ?? {}
    if (!this.usable(body)) return true
    if (!local) return isExpired(body, this.today)
    return known(local) === known(body)
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    if (r.ref_detail !== null) this.changes.set(r.ref_detail, null)
    return { statements: [], changed: false }
  }

  async apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    // 読めない式は同期の表に残し、手元に入れない。止めない
    if (!this.usable(body)) return { statements: [], changed: false, bad: 'ng_rule' }
    const id = body.id as string
    if (this.snapshot === null || this.snapshotFor !== ctx) {
      this.snapshot = await this.load()
      this.snapshotFor = ctx
    }
    const local = this.snapshot.get(id)
    if (!local && isExpired(body, this.host.today(ctx.now))) return { statements: [], changed: false }
    const rule = Object.fromEntries(KNOWN_FIELDS.flatMap((k) => (Object.hasOwn(body, k) ? [[k, body[k]]] : [])))
    if (local && known(local) === known(rule)) {
      this.changes.delete(id)
      return { statements: [], changed: false }
    }
    this.changes.set(id, rule)
    return { statements: [], changed: false }
  }

  /** apply は周の最後にまとめて書くので、溜まった変更を見て捨てる */
  async differs(r: StoredRecord, ctx: AdapterContext): Promise<boolean> {
    if (r.payload.deleted === true) return (await this.load()).has(r.ref_detail as string)
    await this.apply(r, ctx)
    const pending = this.changes.size > 0
    this.changes.clear()
    this.snapshot = null
    this.snapshotFor = null
    return pending
  }

  async localLines(ctx: AdapterContext): Promise<string[]> {
    void ctx
    return [...(await this.load()).values()].map(known)
  }

  /** 周の中の変更を 1 回で書く。needs_apply は先に消えるが、落ちても起動時の照合で値の違いから写し直す */
  async afterApply(): Promise<ApplyPlan> {
    this.snapshot = null
    this.snapshotFor = null
    if (this.changes.size === 0) return { statements: [], changed: false }
    const ids = new Set((await this.load()).keys())
    let room = NG_APPLY_MAX - ids.size
    let over = false
    const writes = new Map<string, NgBody | null>()
    for (const [id, rule] of this.changes) {
      if (rule !== null && !ids.has(id)) {
        if (room <= 0) {
          over = true
          continue
        }
        room--
      }
      if (rule !== null || ids.has(id)) writes.set(id, rule)
    }
    this.changes.clear()
    if (writes.size > 0) await this.host.apply(writes)
    return { statements: [], changed: writes.size > 0, ...(over && { bad: 'ng_too_many' }) }
  }
}
