import { describe, expect, it } from 'vitest'
import { migrateOld } from '../src/ui/settings'

describe('migrateOld: 古い設定を写す', () => {
  it('サムネイルを出さない設定は、読み込みの設定を決めていなければ「読み込まない」に写す', () => {
    expect(migrateOld({ showThumbnails: false }).thumbLoad).toBe('never')
  })

  it('読み込みの設定を決めたあとは、古い行で上書きしない', () => {
    expect(migrateOld({ showThumbnails: false, thumbLoad: 'always' })).not.toHaveProperty('thumbLoad')
  })
})
