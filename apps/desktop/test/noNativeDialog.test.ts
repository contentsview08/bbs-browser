// PC 版では tauri-plugin-dialog が window.confirm を非同期に置き換えるので、戻り値がいつも真になり、確認なしで実行されてしまう
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('確かめるダイアログ', () => {
  it('confirm() を使わず ConfirmDialog を使う', () => {
    const used = sources(join(__dirname, '../src')).filter((path) => /(?<![\w.])confirm\(/.test(readFileSync(path, 'utf8')))
    expect(used).toEqual([])
  })
})
