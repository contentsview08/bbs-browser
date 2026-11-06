import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fontNeedsDownload, fontPercent, fontStatesOf, localFontCss, reduceFontStates, type FontEvent } from '../src/utils/fontDownload'
import { FONT_FAMILIES } from '../src/ui/settings'

const ev = (e: Partial<FontEvent>): FontEvent => ({ key: 'noto', state: 'running', done: 0, total: 0, switchTo: true, ...e })

describe('書体の取得の状態', () => {
  it('取得中 → 完了で使えるようになる', () => {
    let st = reduceFontStates({}, ev({ done: 3, total: 10 }))
    expect(st.noto).toEqual({ kind: 'running', done: 3, total: 10, switchTo: true })
    st = reduceFontStates(st, ev({ state: 'done' }))
    expect(st.noto).toEqual({ kind: 'ready' })
  })

  it('失敗は理由を残し、ほかの書体に触らない', () => {
    const st = reduceFontStates({ 'biz-ud': { kind: 'ready' } }, ev({ state: 'failed', error: 'つながりません' }))
    expect(st.noto).toEqual({ kind: 'failed', error: 'つながりません' })
    expect(st['biz-ud']).toEqual({ kind: 'ready' })
  })

  it('やめたら未取得に戻る', () => {
    expect(reduceFontStates({}, ev({ state: 'canceled' })).noto).toEqual({ kind: 'none' })
  })

  it('開いたときの状態を読む', () => {
    const st = fontStatesOf({
      ready: ['noto'],
      running: [{ key: 'murecho', done: 1, total: 2, switchTo: false }],
      failed: [{ key: 'sawarabi', error: 'x' }],
    })
    expect(st.noto.kind).toBe('ready')
    expect(st.murecho).toEqual({ kind: 'running', done: 1, total: 2, switchTo: false })
    expect(st.sawarabi).toEqual({ kind: 'failed', error: 'x' })
  })

  it('進み具合は数が分かるまで出さず、100 を超えない', () => {
    expect(fontPercent(0, 0)).toBeUndefined()
    expect(fontPercent(1, 3)).toBe(33)
    expect(fontPercent(5, 3)).toBe(100)
  })

  it('OS の書体は取りに行かない', () => {
    expect(fontNeedsDownload('system')).toBe(false)
    expect(fontNeedsDownload('custom')).toBe(false)
    expect(fontNeedsDownload('noto')).toBe(true)
  })
})

describe('置き場の CSS', () => {
  it('Windows のパスで URL に置き換える', () => {
    const css = 'a{src:url("0.woff2") format(\'woff2\')}b{src:url("12.woff2")}'
    const out = localFontCss(css, 'C:\\app\\fonts\\noto', (p) => `asset:${p}`)
    expect(out).toBe('a{src:url("asset:C:\\app\\fonts\\noto\\0.woff2") format(\'woff2\')}b{src:url("asset:C:\\app\\fonts\\noto\\12.woff2")}')
  })

  it('Linux のパスで置き換え、連番のほかは変えない', () => {
    expect(localFontCss('url("1.woff2") url("x.png")', '/d/fonts/n', (p) => p)).toBe('url("/d/fonts/n/1.woff2") url("x.png")')
  })
})

describe('Rust の取得元の表', () => {
  const rust = readFileSync(new URL('../src-tauri/src/fonts.rs', import.meta.url), 'utf8')
  const table = rust.slice(rust.indexOf('const SOURCES'), rust.indexOf('fn sources_of'))
  const keys = [...table.matchAll(/\("([a-z0-9-]+)", &\[/g)].map((m) => m[1])

  it('用意した書体と同じ', () => {
    expect(keys.sort()).toEqual(FONT_FAMILIES.map((f) => f.key).filter(fontNeedsDownload).sort())
  })

  it('取得元は jsDelivr の fontsource だけ', () => {
    expect(rust).toContain('const CDN: &str = "https://cdn.jsdelivr.net/npm/"')
    for (const m of table.matchAll(/"(@[^"]+)"/g)) expect(m[1]).toMatch(/^@fontsource(-variable)?\/[a-z0-9-]+@5\/[a-z0-9]+\.css$/)
  })
})
