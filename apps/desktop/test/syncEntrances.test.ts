// 同期の対象の関数を画面から直接呼ばない。取りこぼしは静かにずれるので、呼び出しの一覧を固定する
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

const files = sources(SRC).map((p) => ({ name: p.slice(SRC.length).replaceAll('\\', '/'), text: readFileSync(p, 'utf-8') }))

describe('同期の入口', () => {
  it('プリセットの追加だけが、板とサイトの関数を直接呼ぶ', () => {
    const direct = /\bstore\??\.(addFavorite|removeFavorite|reorderFavorites|addSite|removeSite|addUpload|removeUpload)\(/g
    const found = files.flatMap((f) => [...f.text.matchAll(direct)].map((m) => `${f.name}:${m[1]}`)).sort()
    expect(found).toEqual(['presets.ts:addFavorite', 'presets.ts:addSite'])
  })

  it('NG の配列の保存は、もとにした配列を渡す(設定の読み込みの一括の保存を除く)', () => {
    const calls = files.flatMap((f) => [...f.text.matchAll(/(?:update|updateSetting)\('ngRules',/g)].map((m) => ({ name: f.name, tail: f.text.slice(m.index, f.text.indexOf('\n', m.index)) })))
    expect(calls.length).toBeGreaterThan(5)
    for (const c of calls) expect(c.tail, c.name).toMatch(/, (settings\.ngRules|rules|s\.ngRules)\)/)
  })

  it('同期の SQL に、スマホの古い SQLite で通らない文がない', () => {
    const dirs = [fileURLToPath(new URL('../../../packages/sync/src/', import.meta.url)), fileURLToPath(new URL('../../../packages/logstore/src/', import.meta.url))]
    for (const d of dirs) for (const p of sources(d)) expect(readFileSync(p, 'utf-8'), p).not.toMatch(/ON CONFLICT|RETURNING\b|OVER\s*\(/)
  })
})
