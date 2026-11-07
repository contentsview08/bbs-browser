// 種類ごとのスイッチ。端末ごとの設定なので sync_state に置き、同期の許可リストに入れない
export const SYNC_GROUPS = [
  { id: 'history', default: true, kinds: ['last_view', 'read_dev', 'read_reset'] },
  { id: 'favorites', default: true, kinds: ['favorite', 'order'] },
  { id: 'sites', default: true, kinds: ['site'] },
  { id: 'posts', default: true, kinds: ['post', 'own_post'] },
  { id: 'images', default: true, kinds: ['image'] },
  { id: 'ng', default: true, kinds: ['ng'] },
  { id: 'settings', default: true, kinds: ['setting'] },
  { id: 'secret', default: false, kinds: ['secret'] },
] as const

export type SyncGroup = (typeof SYNC_GROUPS)[number]['id']
export type SyncSwitches = Record<SyncGroup, boolean>

export const SECRET_KIND = 'secret'

export const isSyncGroup = (g: string): g is SyncGroup => SYNC_GROUPS.some((x) => x.id === g)

/** 既定と違うものだけを保存する。読めない値は既定にする(権限系が勝手にオンにならないように) */
export function parseSwitches(raw: string | null): SyncSwitches {
  let saved: Record<string, unknown> = {}
  try {
    const v = raw === null ? null : (JSON.parse(raw) as unknown)
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) saved = v as Record<string, unknown>
  } catch {
    saved = {}
  }
  return Object.fromEntries(SYNC_GROUPS.map((g) => [g.id, typeof saved[g.id] === 'boolean' ? saved[g.id] : g.default])) as SyncSwitches
}

export function offKindsOf(sw: SyncSwitches): Set<string> {
  return new Set(SYNC_GROUPS.flatMap((g) => (sw[g.id] ? [] : [...g.kinds])))
}

export const kindsOfGroups = (groups: readonly string[]): string[] => SYNC_GROUPS.flatMap((g) => (groups.includes(g.id) ? [...g.kinds] : []))

/** 明示で切ったときだけ false。切り替えを持たない端末は、使っているならオンのまま続ける */
export const masterOn = (master: string | null, enabled: string | null): boolean => (master === null ? enabled === '1' : master === '1')
