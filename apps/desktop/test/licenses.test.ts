import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { filterLicenses, spdxLinks, type LicensePackage, type LicensesFile } from '../src/utils/licenses'

const pkg = (name: string, license: string, version = '1.0.0'): LicensePackage => ({ name, version, license, url: '', kind: 'npm', texts: [] })

describe('filterLicenses', () => {
  const all = [pkg('react', 'MIT', '19.0.0'), pkg('tauri', 'Apache-2.0 OR MIT'), pkg('option-ext', 'MPL-2.0')]
  it('空なら全部', () => expect(filterLicenses(all, '  ')).toHaveLength(3))
  it('名前とライセンスで探し、大文字小文字を区別しない', () => {
    expect(filterLicenses(all, 'REACT').map((p) => p.name)).toEqual(['react'])
    expect(filterLicenses(all, 'mit').map((p) => p.name)).toEqual(['react', 'tauri'])
  })
  it('全角の空白でも区切り、すべてを含むものだけ残す', () => expect(filterLicenses(all, 'tauri　apache').map((p) => p.name)).toEqual(['tauri']))
  it('版でも探せる', () => expect(filterLicenses(all, '19.0').map((p) => p.name)).toEqual(['react']))
})

describe('spdxLinks', () => {
  it('OR・括弧・斜線で分け、重ねない', () => {
    expect(spdxLinks('(MIT OR Apache-2.0) AND MIT').map((l) => l.id)).toEqual(['MIT', 'Apache-2.0'])
    expect(spdxLinks('MIT/Apache-2.0').map((l) => l.id)).toEqual(['MIT', 'Apache-2.0'])
  })
  it('SPDX でない表記はリンクにしない', () => {
    expect(spdxLinks('不明')).toEqual([])
    expect(spdxLinks('Microsoft の使用条件')).toEqual([])
  })
})

describe('public/licenses.json', () => {
  const file = JSON.parse(readFileSync(new URL('../public/licenses.json', import.meta.url), 'utf8')) as LicensesFile
  it('全文の番号がすべて指せる', () => {
    for (const p of file.packages) for (const t of p.texts) expect(typeof file.texts[t.text]).toBe('string')
  })
  it('開発にだけ使うものが入らず、配布物の中心は入る', () => {
    const names = new Set(file.packages.map((p) => p.name))
    for (const dev of ['vite', 'typescript', 'vitest', 'tailwindcss', '@types/node', 'sharp', 'onnxruntime-node', 'tauri-build', 'serde_derive']) expect(names.has(dev)).toBe(false)
    for (const main of ['react', 'tauri', 'wry', 'webkit2gtk', 'webview2-com', 'material-symbols', 'aahub_light']) expect(names.has(main)).toBe(true)
  })
})
