// 設定の許可リスト。載っている項目だけを送り、受ける。新しい項目は既定で同期しない。ID は setting:::<名前>
import allowlist from '../../settings-allowlist.json'
import type { SqlStatement, StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const SETTING_KIND = 'setting'
export const OP_SETTING = 'setting'
export const AREA_SETTINGS = 'settings'
const SEED_PRIORITY = 2
const SEED_WALL = 1
const WORDS_MAX = 4096
export const BOARD_META_PREFIX = allowlist.board_meta.prefix
export const BOARD_META_KEY = 'boardMeta'
export const BOARD_META_FIELDS: readonly string[] = allowlist.board_meta.fields

export type SettingValue = string | boolean | number
export type SyncDevice = 'pc' | 'phone'

export interface AllowedSetting {
  name: string
  type: 'bool' | 'enum' | 'words'
  values?: string[]
  default: unknown
}

export const ALLOWED_SETTINGS = allowlist.items as AllowedSetting[]
export const NEVER_SYNC_SETTINGS: readonly string[] = allowlist.never
const byName = new Map(ALLOWED_SETTINGS.map((x) => [x.name, x]))

export function settingDefault(item: AllowedSetting, device: SyncDevice): unknown {
  const d = item.default
  return d !== null && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>)[device] : d
}

const wordsValue = (v: unknown): string | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? canonicalJson(v) : null)

/** 手元の値 → レコードの値。配列は JSON の文字列にする(scalar は真偽・整数・文字列だけ)。許可リストにない項目と範囲の外は null */
export function settingToWire(name: string, value: unknown): SettingValue | null {
  if (name.startsWith(BOARD_META_PREFIX)) return boardMetaToWire(value)
  const item = byName.get(name)
  if (!item) return null
  switch (item.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : null
    case 'enum':
      return typeof value === 'string' && item.values?.includes(value) ? value : null
    case 'words': {
      const s = wordsValue(value)
      return s !== null && s.length <= WORDS_MAX ? s : null
    }
  }
}

/** 板ごとの設定は許可された項目だけを送る。名前欄・メール欄の既定値とファビコンは手元に残す */
export function boardMetaToWire(meta: unknown): string | null {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
  const m = meta as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  if (typeof m.alias === 'string' && m.alias !== '') picked.alias = m.alias
  if (typeof m.omitNoname === 'boolean') picked.omitNoname = m.omitNoname
  if (Array.isArray(m.nonames) && m.nonames.length > 0 && m.nonames.every((x) => typeof x === 'string')) picked.nonames = m.nonames
  const s = canonicalJson(picked)
  return s.length <= WORDS_MAX ? s : null
}

/** レコードの値 → 手元の値。読めない値は undefined(手元に入れず、同期の表には残す) */
export function settingFromWire(name: string, wire: unknown): unknown {
  if (name.startsWith(BOARD_META_PREFIX)) {
    if (normalizeBoardUrl(name.slice(BOARD_META_PREFIX.length)) === null || typeof wire !== 'string') return undefined
    try {
      const o = parseStrictJson(wire)
      return o !== null && typeof o === 'object' && !Array.isArray(o) && boardMetaToWire(o) !== null ? JSON.parse(boardMetaToWire(o) as string) : undefined
    } catch {
      return undefined
    }
  }
  const item = byName.get(name)
  if (!item) return undefined
  if (item.type === 'words') {
    if (typeof wire !== 'string') return undefined
    try {
      const v = parseStrictJson(wire)
      return wordsValue(v) === null ? undefined : v
    } catch {
      return undefined
    }
  }
  return settingToWire(name, wire) === null ? undefined : wire
}

/** 今の設定の置き場は端末で違う(PC は settings 表、スマホは Prefs)。値はレコードの形で受け渡す */
export interface SettingsHost {
  device: SyncDevice
  /** 許可リストの項目の今の値(手元の値)。板ごとの設定は boardMeta/<板 URL> */
  read(): Promise<Map<string, unknown>>
  /** 周の中の変更を 1 回で書く。板ごとの設定は許可された項目だけを手元の値に重ねる */
  apply(changes: ReadonlyMap<string, unknown>): Promise<void>
}

/** 設定の書き込みから、送る操作を作る。許可リストにない項目は何も作らない。板ごとの設定は変わった板だけ */
export function settingOpsOf(key: string, value: unknown, before: unknown): { name: string; value: SettingValue }[] {
  if (key === BOARD_META_KEY) {
    const now = (value ?? {}) as Record<string, unknown>
    const old = (before ?? {}) as Record<string, unknown>
    return [...new Set([...Object.keys(old), ...Object.keys(now)])].sort().flatMap((url) => {
      const wire = boardMetaToWire(now[url] ?? {})
      return wire === null || wire === boardMetaToWire(old[url] ?? {}) ? [] : [{ name: BOARD_META_PREFIX + url, value: wire }]
    })
  }
  const wire = settingToWire(key, value)
  return wire === null || !byName.has(key) ? [] : [{ name: key, value: wire }]
}

/** settings 表の置き場。PC の今の設定と共通テストが使う。表の値は JSON */
export function settingsTableHost(db: SyncSqlDb, device: SyncDevice, onApplied?: (patch: Record<string, unknown>) => void): SettingsHost {
  const rows = async () => {
    const names = [...ALLOWED_SETTINGS.map((x) => x.name), BOARD_META_KEY]
    const marks = names.map((_, i) => `$${i + 1}`).join(', ')
    const out = new Map<string, unknown>()
    for (const r of await db.select<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN (${marks})`, names)) {
      try {
        out.set(r.key, JSON.parse(r.value))
      } catch {
        // 読めない値は無いものとして扱う
      }
    }
    return out
  }
  return {
    device,
    async read() {
      const all = await rows()
      const meta = (all.get(BOARD_META_KEY) ?? {}) as Record<string, unknown>
      all.delete(BOARD_META_KEY)
      for (const [url, m] of Object.entries(meta)) all.set(BOARD_META_PREFIX + url, m)
      return all
    },
    async apply(changes) {
      const meta = { ...(((await rows()).get(BOARD_META_KEY) ?? {}) as Record<string, Record<string, unknown>>) }
      let metaChanged = false
      const patch: Record<string, unknown> = {}
      const stmts: SqlStatement[] = []
      for (const [name, value] of changes) {
        if (name.startsWith(BOARD_META_PREFIX)) {
          const url = name.slice(BOARD_META_PREFIX.length)
          const merged = mergeBoardMeta(meta[url], value as Record<string, unknown>)
          if (merged === null) delete meta[url]
          else meta[url] = merged
          metaChanged = true
        } else {
          patch[name] = value
          stmts.push({ sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', params: [name, JSON.stringify(value)] })
        }
      }
      if (metaChanged) {
        patch[BOARD_META_KEY] = meta
        stmts.push({ sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', params: [BOARD_META_KEY, JSON.stringify(meta)] })
      }
      await db.batch(stmts)
      onApplied?.(patch)
    },
  }
}

/** 許可された項目だけを差し替える。手元だけの項目(名前欄の既定値など)は残す。何もなくなれば null */
export function mergeBoardMeta(local: Record<string, unknown> | undefined, remote: Record<string, unknown>): Record<string, unknown> | null {
  const kept = Object.fromEntries(Object.entries(local ?? {}).filter(([k]) => !BOARD_META_FIELDS.includes(k)))
  const next = { ...kept, ...remote }
  return Object.keys(next).length === 0 ? null : next
}

const idName = (name: string): string => {
  if (!name.startsWith(BOARD_META_PREFIX)) return name
  return BOARD_META_PREFIX + (normalizeBoardUrl(name.slice(BOARD_META_PREFIX.length)) ?? name.slice(BOARD_META_PREFIX.length))
}

const targetOf = (ctx: AdapterContext, name: string): OpTarget => ({
  record_id: recordId(ctx.keys.k_id, SETTING_KIND, null, '', idName(name)),
  refs: { ref_board: null, ref_thread: null, ref_detail: name, ref_local: null },
})

export class SettingAdapter implements SyncAdapter {
  readonly kind = SETTING_KIND
  readonly area = AREA_SETTINGS
  readonly ops = [OP_SETTING]
  private readonly changes = new Map<string, unknown>()

  constructor(private readonly host: SettingsHost, private readonly db: SyncSqlDb) {}

  private argsOf(op: SyncOpRow): { name: string; value: SettingValue } | null {
    try {
      const a = parseStrictJson(op.args ?? '') as { name?: unknown; value?: unknown }
      if (typeof a?.name !== 'string' || (typeof a.value !== 'string' && typeof a.value !== 'boolean' && typeof a.value !== 'number')) return null
      return settingFromWire(a.name, a.value) === undefined ? null : { name: a.name, value: a.value }
    } catch {
      return null
    }
  }

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const a = this.argsOf(op)
    return a && targetOf(ctx, a.name)
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    const a = this.argsOf(op)
    return a && updateRecord(existing, SETTING_KIND, { key: a.name, value: a.value }, stamp, ctx.deviceId)
  }

  /** 領域に設定があれば手元の値をレコードにしない(合流は領域の値を使う)。1 台目は既定と違うものだけ */
  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const [row] = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM sync_records WHERE kind = $1', [SETTING_KIND])
    if (Number(row?.n ?? 0) > 0) return []
    const hlc = formatHlc(SEED_WALL, 0, ctx.deviceId)
    const out: SeedRow[] = []
    for (const [name, value] of await this.host.read()) {
      const item = byName.get(name)
      const wire = settingToWire(name, value)
      if (wire === null) continue
      if (item && wire === settingToWire(name, settingDefault(item, this.host.device))) continue
      if (!item && wire === '{}') continue
      const payload = { kind: SETTING_KIND, hlc, device_id: ctx.deviceId, body: { key: name, value: wire } }
      if (checkPayload(payload) !== null) out.push({ ...targetOf(ctx, name), priority: SEED_PRIORITY, payload })
    }
    return out
  }

  detailOf(p: SyncPayload): string | null {
    return typeof p.body?.key === 'string' ? p.body.key : null
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  /** 手元の URL は端末で違うことがあるので、板ごとの設定は正規化して探す */
  private localOf(all: Map<string, unknown>, name: string): { name: string; value: unknown } {
    if (!name.startsWith(BOARD_META_PREFIX)) return { name, value: all.get(name) }
    const want = idName(name)
    for (const [k, v] of all) if (k.startsWith(BOARD_META_PREFIX) && idName(k) === want) return { name: k, value: v }
    return { name, value: undefined }
  }

  private async same(r: StoredRecord): Promise<boolean> {
    const name = r.ref_detail as string
    if (settingFromWire(name, r.payload.body?.value) === undefined) return true
    return settingToWire(name, this.localOf(await this.host.read(), name).value) === r.payload.body?.value
  }

  /** 値まで比べる(表の値が正)。手元に入れないと決めたものは、あることにする */
  async exists(r: StoredRecord): Promise<boolean> {
    return this.same(r)
  }

  async differs(r: StoredRecord): Promise<boolean> {
    return !(await this.same(r))
  }

  async remove(): Promise<ApplyPlan> {
    return { statements: [], changed: false }
  }

  async apply(r: StoredRecord): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return { statements: [], changed: false }
    const name = r.ref_detail as string
    const value = settingFromWire(name, r.payload.body?.value)
    if (value === undefined) return { statements: [], changed: false, bad: 'setting_value' }
    if (await this.same(r)) {
      this.changes.delete(name)
      return { statements: [], changed: false }
    }
    this.changes.set(this.localOf(await this.host.read(), name).name, value)
    return { statements: [], changed: false }
  }

  async afterApply(): Promise<ApplyPlan> {
    if (this.changes.size === 0) return { statements: [], changed: false }
    await this.host.apply(new Map(this.changes))
    this.changes.clear()
    return { statements: [], changed: true }
  }

  async localLines(): Promise<string[]> {
    const lines: string[] = []
    for (const [name, value] of await this.host.read()) {
      const wire = settingToWire(name, value)
      if (wire !== null) lines.push(canonicalJson([idName(name), wire]))
    }
    return lines
  }
}
