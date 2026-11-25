// スキンの一覧(カタログ)。GitHub Pages の obb-skins(index.json)から取って、設定 → スキン の「もっと探す」に札で並べる。
// 入れたスキンには source(id・url・revision)を付けて覚え、一覧の revision が上がっていたら自動で入れ替える(配る側を直せば、入れている人のアプリも新しくなる)。
// スマホのアプリの data/SkinCatalog.kt と同じ決まり

import { lookThemeName, type LookTheme } from './lookTheme'

/** 一覧の置き場(obb-skins の GitHub Pages)。中身は tools/build_index.py が作る */
export const SKIN_CATALOG_URL = 'https://contentsview08.github.io/obb-skins/index.json'
/** 一覧(もっと探す)を出すか。配り場(obb-skins の Pages)がまだないので、整うまで UI から外しておく(2026-11-26)。取りにも行かない */
export const SKIN_CATALOG_ENABLED = false

/** 一覧の 1 つ(スキン 1 つ分の案内。scheme・settings は札を描くための写し) */
export interface CatalogSkin {
  id: string
  name: string
  note: string
  revision: number
  /** スキンの JSON の URL(絶対) */
  url: string
  scheme?: Record<string, unknown>
  settings?: Record<string, unknown>
}

/** 入れたスキンの出どころ(保存したスキンの source) */
export interface SkinSource {
  id: string
  url: string
  revision: number
}

/** index.json を読む。読めなければ理由の文 */
export function parseSkinCatalog(text: string, indexUrl: string): CatalogSkin[] | string {
  let o: { format?: string; skins?: unknown }
  try {
    o = JSON.parse(text) as typeof o
  } catch {
    return 'スキンの一覧が読めませんでした'
  }
  if (!o || o.format !== 'obb-skins' || !Array.isArray(o.skins)) return 'スキンの一覧ではありません'
  const out: CatalogSkin[] = []
  for (const e of o.skins as Record<string, unknown>[]) {
    if (!e || typeof e.id !== 'string' || typeof e.url !== 'string') continue
    let url: string
    try {
      url = new URL(e.url, indexUrl).toString()
    } catch {
      continue
    }
    out.push({
      id: e.id,
      name: typeof e.name === 'string' && e.name ? e.name : e.id,
      note: typeof e.note === 'string' ? e.note : '',
      revision: typeof e.revision === 'number' ? e.revision : 1,
      url,
      scheme: e.scheme && typeof e.scheme === 'object' ? (e.scheme as Record<string, unknown>) : undefined,
      settings: e.settings && typeof e.settings === 'object' ? (e.settings as Record<string, unknown>) : undefined,
    })
  }
  return out
}

/** 一覧から入れたスキンに出どころを付ける(名前は一覧の名前に。同じ id は名前が変わっても同じスキン) */
export function withSkinSource(theme: LookTheme, e: CatalogSkin): LookTheme {
  return { ...theme, name: e.name, source: { id: e.id, url: e.url, revision: e.revision } }
}

/** 一覧の id で、入れているスキンを探す */
export const installedSkin = (list: LookTheme[], id: string): LookTheme | undefined => list.find((t) => t.source?.id === id)

/** 入れているスキンのうち、一覧の方が新しいもの(入れ替えるべきもの) */
export function skinUpdates(list: LookTheme[], catalog: CatalogSkin[]): { theme: LookTheme; entry: CatalogSkin }[] {
  const out: { theme: LookTheme; entry: CatalogSkin }[] = []
  for (const theme of list) {
    const src = theme.source
    if (!src) continue
    const entry = catalog.find((e) => e.id === src.id)
    if (entry && entry.revision > src.revision) out.push({ theme, entry })
  }
  return out
}

/** 入れたスキンの「使っています」のキー */
export const skinKeyOf = (theme: LookTheme) => `saved:${lookThemeName(theme)}`
