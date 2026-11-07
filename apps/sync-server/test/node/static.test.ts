// CI で止める静的な決まり: SQL に値を連結しない。秘密や CORS を出さない。配布物に入らない
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|mjs)$/.test(f) ? [p] : []
  })
}

const src = sources(join(root, 'src')).map((p) => ({ p, text: readFileSync(p, 'utf-8') }))

/** exec( と書き込みの包み write( の最初の引数(閉じるまでの文字列)を取り出す */
function sqlArgs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(?:sql\.exec|this\.write)(?:<[^(]*>)?\(\s*/g)) {
    const start = (m.index as number) + m[0].length
    const q = text[start]
    if (q !== "'" && q !== '"' && q !== '`') {
      // 包みの中の exec(sql, ...args) は引数をそのまま渡すだけ。文は包みの呼び出し側で見る
      if (text.startsWith('sql, ...args)', start)) continue
      out.push(text.slice(start, start + 40))
      continue
    }
    let end = start + 1
    while (text[end] !== q) end += text[end] === '\\' ? 2 : 1
    out.push(text.slice(start, end + 1))
    const after = text.slice(end + 1).trimStart()
    if (after.startsWith('+')) out.push(`${text.slice(start, end + 1)} + 連結`)
  }
  return out
}

describe('静的な決まり', () => {
  it('SQL はすべてプレースホルダー。文字列の連結も埋め込みもない', () => {
    const bad: string[] = []
    let total = 0
    for (const { p, text } of src) {
      for (const a of sqlArgs(text)) {
        total++
        // 固定の DDL を定数で渡すのは値を含まないので許す
        if (a === 'SCHEMA') continue
        if (a.startsWith('SCHEMA')) continue
        if (a.includes('${') || a.includes('連結') || !/^['"`]/.test(a)) bad.push(`${p}: ${a}`)
      }
    }
    expect(total).toBeGreaterThan(30)
    expect(bad).toEqual([])
  })
  it('CORS のヘッダーを書かない。ログに token・ip を渡さない', () => {
    for (const { p, text } of src) {
      expect(/access-control/i.test(text), p).toBe(false)
      for (const m of text.matchAll(/console\.\w+\(([^\n]*)\)/g)) expect(/(token|authorization|\bip\b|space_?id)/i.test(m[1]), `${p}: ${m[0]}`).toBe(false)
    }
  })
  it('X-Forwarded-For を信用しない', () => {
    for (const { p, text } of src) expect(/x-forwarded-for/i.test(text), p).toBe(false)
  })
  it('例の設定にアカウント ID と秘密がない', () => {
    const t = readFileSync(join(root, 'wrangler.example.toml'), 'utf-8')
    const live = t.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    expect(live).not.toMatch(/account_id/)
    expect(live).not.toMatch(/POW_SECRET|TURNSTILE_SECRET|ADMIN_KEYS|TICKET_KEYS/)
    expect(live).not.toMatch(/\b[0-9a-f]{32}\b/)
  })
  it('テスト用の Turnstile のキーは検証用の環境だけに置く', () => {
    const t = readFileSync(join(root, 'wrangler.example.toml'), 'utf-8')
    const lines = t.split('\n').filter((l) => !l.trim().startsWith('#'))
    const head = lines.slice(0, lines.findIndex((l) => l.startsWith('[env.verify]'))).join('\n')
    expect(head).not.toMatch(/TURNSTILE_TEST_KEYS|[123]x0000/)
    expect(lines.join('\n')).toMatch(/TURNSTILE_TEST_KEYS = "1"/)
  })
  it('サーバーのテストの口は入口から参照しない', () => {
    for (const { p, text } of src) expect(/harness-worker|__test/.test(text), p).toBe(false)
  })
})
