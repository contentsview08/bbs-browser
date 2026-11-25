// 起動時に 1 回、入れたスキン(一覧から入れたもの)が新しくなっていないかを見て、新しければ入れ替える(使っていれば当て直す)。
// 一覧から入れたスキンが 1 つもなければ、取りに行かない

import { useEffect, useRef } from 'react'
import type { AppSettings, UpdateSetting } from '../ui/settings'
import { updateInstalledSkins } from '../host/skinCatalog'
import { SKIN_CATALOG_ENABLED } from '../ui/skinCatalog'

export function useSkinAutoUpdate(settings: AppSettings, update: UpdateSetting) {
  const ref = useRef({ settings, update })
  ref.current = { settings, update }
  useEffect(() => {
    if (!SKIN_CATALOG_ENABLED || !settings.lookThemes.some((t) => t.source)) return
    const t = setTimeout(() => void updateInstalledSkins(ref.current.settings, ref.current.update).catch(() => undefined), 8000)
    return () => clearTimeout(t)
    // 起動時だけ(入れたスキンが増えたときは、スキンの窓を開いたときに見る)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
