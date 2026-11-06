// 最初から入れておく掲示板(板一覧ごと)と単独の板。スマホ版と同じ packages/presets/sites.json を読む。
// 起動したとき(DB と設定がそろったとき)に 1 回、まだ足していない id のものだけを足し、足した id を設定の presetsApplied に覚える。
// 板一覧は開いたときに取る
import raw from '../../../packages/presets/sites.json?raw'
import { allConnectors } from '@bbs-browser/connectors'
import type { LogStore } from '@bbs-browser/logstore'

interface Presets {
  sites: { id: string; name: string; menu: string }[]
  boards: { id: string; name: string; url: string }[]
}

const PRESETS = JSON.parse(raw) as Presets

/** 足したら、足し終えた id の並びを返す(何も足さなければ undefined) */
export async function applyPresets(store: LogStore, applied: string[]): Promise<string[] | undefined> {
  const done = new Set(applied)
  const before = done.size
  const sites = await store.listSites()
  for (const s of PRESETS.sites) {
    if (done.has(s.id)) continue
    if (!sites.some((x) => x.menuUrl === s.menu)) {
      // サイトの入口を受け持つコネクタ(hono-bbs の /boards など)があればそれ、なければ 2ch 互換(bbsmenu)。App の addSite と同じ
      const connectorId = allConnectors().find((c) => c.handlesSite?.(s.menu))?.id ?? '2ch-compat'
      await store.addSite({ connectorId, name: s.name, menuUrl: s.menu })
    }
    done.add(s.id)
  }
  const favs = await store.listFavorites()
  for (const b of PRESETS.boards) {
    if (done.has(b.id)) continue
    if (!favs.some((f) => f.url === b.url)) {
      const connectorId = allConnectors().find((c) => c.canHandle(b.url))?.id ?? '2ch-compat'
      await store.addFavorite({ connectorId, url: b.url, name: b.name })
    }
    done.add(b.id)
  }
  return done.size !== before ? [...done] : undefined
}
