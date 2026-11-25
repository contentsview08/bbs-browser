// スキンの一覧(カタログ)を取る・入れる・新しくする(ui/skinCatalog.ts の決まりで)。PC は Tauri の http で取る(CORS を気にしない)

import { fetch } from '@tauri-apps/plugin-http'
import { DEFAULT_SETTINGS, type AppSettings, type UpdateSetting } from '../ui/settings'
import { lookThemePatch, lookThemeName, withSavedTheme, type LookTheme } from '../ui/lookTheme'
import { SKIN_CATALOG_URL, parseSkinCatalog, skinKeyOf, skinUpdates, withSkinSource, type CatalogSkin } from '../ui/skinCatalog'

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`取れませんでした(${res.status})`)
  return res.text()
}

/** 一覧を取る。取れなければ理由の文 */
export async function fetchSkinCatalog(url = SKIN_CATALOG_URL): Promise<CatalogSkin[] | string> {
  try {
    return parseSkinCatalog(await getText(url), url)
  } catch (e) {
    return `スキンの一覧を取れませんでした(${e instanceof Error ? e.message : String(e)})`
  }
}

/** 一覧のスキンを取って保存し、当てる。入れたスキンの名前を返す(読めなければ理由の文を投げる) */
export async function installSkin(s: AppSettings, update: UpdateSetting, e: CatalogSkin): Promise<string> {
  const text = await getText(e.url)
  const r = lookThemePatch(text, DEFAULT_SETTINGS)
  if (typeof r === 'string' || !r.theme) throw new Error(typeof r === 'string' ? r : 'スキンではありません')
  const theme = withSkinSource(r.theme, e)
  // 同じ id の古いものは名前が違っても消す(名前が変わったとき)
  const list = withSavedTheme(s.lookThemes.filter((t) => t.source?.id !== e.id), theme)
  update('lookThemes', list)
  for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
  update('lookThemeKey', skinKeyOf(theme))
  return lookThemeName(theme)
}

/**
 * 入れたスキンのうち一覧の方が新しいものを取り直して入れ替える(使っていれば当て直す)。入れ替えたスキンの名前を返す。
 * catalog を渡さなければ一覧を取りに行く
 */
export async function updateInstalledSkins(s: AppSettings, update: UpdateSetting, catalog?: CatalogSkin[]): Promise<string[]> {
  const list = catalog ?? (await fetchSkinCatalog())
  if (typeof list === 'string') return []
  const todo = skinUpdates(s.lookThemes, list)
  if (todo.length === 0) return []
  let themes: LookTheme[] = s.lookThemes
  const done: string[] = []
  for (const { theme, entry } of todo) {
    try {
      const r = lookThemePatch(await getText(entry.url), DEFAULT_SETTINGS)
      if (typeof r === 'string' || !r.theme) continue
      const fresh = withSkinSource(r.theme, entry)
      themes = withSavedTheme(themes.filter((t) => t.source?.id !== entry.id), fresh)
      if (s.lookThemeKey === skinKeyOf(theme)) {
        for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
        update('lookThemeKey', skinKeyOf(fresh))
      }
      done.push(lookThemeName(fresh))
    } catch {
      // 1 つ取れなくても、ほかは入れ替える
    }
  }
  if (done.length > 0) update('lookThemes', themes)
  return done
}
