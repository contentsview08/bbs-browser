// 設定の許可リスト。JSON が正で、PC の既定値と揃っていること、秘密が入らないこと
import { describe, expect, it } from 'vitest'
import { ALLOWED_SETTINGS, BOARD_META_FIELDS, boardMetaToWire, NEVER_SYNC_SETTINGS, settingDefault, settingFromWire, settingOpsOf, settingToWire } from '@bbs-browser/sync'
import { DEFAULT_SETTINGS } from '../src/ui/settings'

const names = ALLOWED_SETTINGS.map((x) => x.name)

describe('設定の許可リスト', () => {
  it('どの項目も PC の設定にあり、既定値が同じ', () => {
    for (const item of ALLOWED_SETTINGS) expect((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[item.name], item.name).toEqual(settingDefault(item, 'pc'))
  })
  it('秘密の項目・端末ごとの項目は許可していない', () => {
    for (const n of NEVER_SYNC_SETTINGS) expect(names, n).not.toContain(n)
    for (const n of ['postName', 'postMail', 'postDeleteKey', 'catboxUserhash', 'imgbbApiKey', 'imgurClientId', 'postAccounts', 'honoUser', 'honoPassword', 'scheme', 'fontFamily', 'customFont']) {
      expect(names, n).not.toContain(n)
      expect(settingOpsOf(n, '秘密', undefined), n).toEqual([])
      expect(settingFromWire(n, '秘密'), n).toBeUndefined()
    }
    for (const n of names) expect(n, n).not.toMatch(/font|size|px|color|scheme|password|key$|token|secret|hash/i)
    for (const n of Object.keys(DEFAULT_SETTINGS)) if (/Px$|Font|Scale|scheme/.test(n)) expect(names, n).not.toContain(n)
  })
  it('板ごとの設定から名前欄の既定値を落とす', () => {
    expect(BOARD_META_FIELDS).toEqual(['alias', 'omitNoname', 'nonames'])
    expect(boardMetaToWire({ alias: 'x', defaultName: '名前#トリップ', defaultMail: 'sage', icon: 'https://x/', omitNoname: false, nonames: ['a'] })).toBe('{"alias":"x","nonames":["a"],"omitNoname":false}')
    expect(settingOpsOf('boardMeta', { 'https://a/x/': { defaultName: '変えた' } }, { 'https://a/x/': { defaultName: '前' } })).toEqual([])
  })
  it('範囲の外の値を通さない', () => {
    expect(settingToWire('idStyle', '爆発')).toBeNull()
    expect(settingToWire('omitNoname', 'true')).toBeNull()
    expect(settingToWire('keywords', 'x'.repeat(5000))).toBeNull()
    expect(settingToWire('keywords', ['x'.repeat(5000)])).toBeNull()
    expect(settingFromWire('keywords', '{"a":1}')).toBeUndefined()
    expect(settingFromWire('idStyle', 'color')).toBe('color')
  })
})
