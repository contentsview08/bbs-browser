import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/ui/settings'
import { importableSettings, mergeNgRules, ngFile, parseBackup, settingsFile } from '../src/utils/backup'
import type { NgRule } from '../src/utils/ng'

const rule = (pattern: string, target: NgRule['target'] = 'content'): NgRule => ({
  id: pattern,
  target,
  pattern,
  isRegex: false,
  enabled: true,
})

describe('設定の書き出しと読み込み', () => {
  it('秘密の値と、その端末だけの状態は書き出さない', () => {
    const f = settingsFile({ ...DEFAULT_SETTINGS, catboxUserhash: 'ひみつ', openTabs: [], scheme: 'rose' as never })
    expect(f.settings).not.toHaveProperty('catboxUserhash')
    expect(f.settings).not.toHaveProperty('openTabs')
    expect(f.settings.scheme).toBe('rose')
  })

  it('書き出したものを読み戻せる', () => {
    const text = JSON.stringify(settingsFile({ ...DEFAULT_SETTINGS, autoRefreshSec: 10 }))
    const parsed = parseBackup(text)
    expect(parsed.kind).toBe('settings')
    if (parsed.kind !== 'settings') return
    expect(importableSettings(parsed, DEFAULT_SETTINGS).autoRefreshSec).toBe(10)
  })

  it('知らない項目・型の合わない値・書き出さない項目は読み込まない', () => {
    const parsed = parseBackup(
      JSON.stringify({
        app: 'bbs-browser',
        kind: 'settings',
        version: 1,
        exportedAt: '',
        settings: { autoRefreshSec: 'たくさん', nanika: 1, catboxUserhash: 'x', keywords: ['実況'], panelAlpha: null },
      }),
    )
    if (parsed.kind !== 'settings') throw new Error(parsed.kind)
    expect(importableSettings(parsed, DEFAULT_SETTINGS)).toEqual({ keywords: ['実況'] })
  })

  it('ほかのファイルは断る', () => {
    expect(parseBackup('{')).toMatchObject({ kind: 'error' })
    expect(parseBackup('{"app":"other","kind":"ng","version":1}')).toMatchObject({ kind: 'error' })
    expect(parseBackup('{"app":"bbs-browser","kind":"ng","version":99,"rules":[]}')).toMatchObject({ kind: 'error' })
  })
})

describe('NG の書き出しと読み込み', () => {
  it('壊れた行は捨てて読む', () => {
    const text = JSON.stringify({ ...ngFile([rule('a')]), rules: [rule('a'), { pattern: '', target: 'content', isRegex: false }, { x: 1 }] })
    const parsed = parseBackup(text)
    expect(parsed.kind === 'ng' && parsed.rules.map((r) => r.pattern)).toEqual(['a'])
  })

  it('今のものに足し、同じものは重ねない', () => {
    let n = 0
    const { rules, added } = mergeNgRules([rule('a'), rule('b', 'posterId')], [rule('a'), rule('b'), rule('c')], () => `new${++n}`)
    expect(added).toBe(2)
    expect(rules.map((r) => `${r.target}:${r.pattern}:${r.id}`)).toEqual([
      'content:a:a',
      'posterId:b:b',
      'content:b:new1',
      'content:c:new2',
    ])
  })
})
