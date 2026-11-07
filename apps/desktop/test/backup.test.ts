import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/ui/settings'
import { backupFileName, importableSettings, mergeNgRules, ngFile, parseBackup, settingsFile } from '../src/utils/backup'
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

  it.each(['postDeleteKey', 'notificationLog', 'boardVisits', 'keywordWatchSince', 'lastUpdateCheckAt', 'lastLogPruneAt'] as const)('%s は書き出さず、読み込みもしない', (k) => {
    expect(settingsFile(DEFAULT_SETTINGS).settings).not.toHaveProperty(k)
    const file = { ...settingsFile(DEFAULT_SETTINGS), settings: { [k]: DEFAULT_SETTINGS[k] } }
    expect(importableSettings(file, DEFAULT_SETTINGS)).not.toHaveProperty(k)
  })

  it('書き出したものを読み戻せる', () => {
    const text = JSON.stringify(settingsFile({ ...DEFAULT_SETTINGS, autoRefreshSec: 10 }))
    const parsed = parseBackup(text)
    expect(parsed.kind).toBe('settings')
    if (parsed.kind !== 'settings') return
    expect(importableSettings(parsed, DEFAULT_SETTINGS).autoRefreshSec).toBe(10)
  })

  it('未読を上にの設定も書き出して戻せる', () => {
    const parsed = parseBackup(JSON.stringify(settingsFile({ ...DEFAULT_SETTINGS, unreadFirst: true })))
    if (parsed.kind !== 'settings') throw new Error(parsed.kind)
    expect(importableSettings(parsed, DEFAULT_SETTINGS).unreadFirst).toBe(true)
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

describe('設定の読み込み: 壊れたファイルでアプリを壊さない', () => {
  const file = (settings: Record<string, unknown>) => ({ ...settingsFile(DEFAULT_SETTINGS), settings }) as ReturnType<typeof settingsFile>
  const read = (settings: Record<string, unknown>) => importableSettings(file(settings), DEFAULT_SETTINGS)

  it('文字の配列に文字以外が混ざっていても捨てて読む', () => {
    expect(read({ keywords: ['実況', 1, null], grossWords: [{}], quickPhrases: ['a'], postToolbar: [true, 'copy'], listTabs: [0, 'unread'] })).toEqual({
      keywords: ['実況'],
      grossWords: [],
      quickPhrases: ['a'],
      postToolbar: ['copy'],
      listTabs: ['unread'],
    })
  })

  it('設定の中の NG の壊れた行は捨て、id と有効かを補う(判定で落ちない)', () => {
    const got = read({ ngRules: [{ target: 'content', isRegex: false, enabled: true }, { pattern: '', target: 'content', isRegex: false }, { pattern: 'a', target: 'content', isRegex: false }] })
    expect(got.ngRules).toHaveLength(1)
    expect(got.ngRules?.[0]).toMatchObject({ pattern: 'a', enabled: true })
    expect(got.ngRules?.[0].id).toBeTruthy()
  })

  it('設定の中の NG の id と切ってあることは保つ', () => {
    const got = read({ ngRules: [{ id: 'x', pattern: 'a', target: 'content', isRegex: false, enabled: false }] })
    expect(got.ngRules?.[0]).toMatchObject({ id: 'x', enabled: false })
  })

  it('AI NG の壊れた行は捨てる', () => {
    const good = { id: 'a', name: 'n', prompt: 'p', enabled: true }
    expect(read({ aiNgRules: [good, { id: 'b' }, null] }).aiNgRules).toEqual([good])
  })

  it('確かめる間隔は、画面で選べる範囲に収める(タイマーがすぐ回り続けないように)', () => {
    const got = read({ autoRefreshSec: 0.001, favCheckMin: 3_000_000, keywordWatchMin: -5, historyCheckMin: 30 })
    expect(got).toEqual({ autoRefreshSec: 0, favCheckMin: 1440, keywordWatchMin: 0, historyCheckMin: 30 })
  })

  it('無限大の数は読まない(JSON の 1e999)', () => {
    const parsed = parseBackup('{"app":"bbs-browser","kind":"settings","version":1,"exportedAt":"","settings":{"autoRefreshSec":1e999,"fontPx":-1e999,"listPageSize":50}}')
    if (parsed.kind !== 'settings') throw new Error(parsed.kind)
    expect(importableSettings(parsed, DEFAULT_SETTINGS)).toEqual({ listPageSize: 50 })
  })

  it('__proto__ などの名前の項目を読まない', () => {
    const parsed = parseBackup('{"app":"bbs-browser","kind":"settings","version":1,"exportedAt":"","settings":{"__proto__":{"autoNg":false},"constructor":{"a":1},"toString":"x"}}')
    if (parsed.kind !== 'settings') throw new Error(parsed.kind)
    const got = importableSettings(parsed, DEFAULT_SETTINGS)
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype)
    expect(Object.keys(got)).toEqual([])
    expect(got).not.toHaveProperty('autoNg')
  })

  it('古い版のファイルも、今の設定に読み替えて読む', () => {
    expect(read({ scheme: 'sepia', postStyle: 'timeline', uploadHost: '0x0', mouseGestures: { up: 'top' } })).toEqual({
      scheme: 'light-gray',
      postStyle: 'discord',
      uploadHost: DEFAULT_SETTINGS.uploadHost,
      mouseGestures: { n: 'top' },
    })
    expect(read({ fontSize: 5, showThumbnails: false })).toEqual({ fontPx: 20, thumbLoad: 'never' })
  })

  it('書き出したものを読むと、書き出した設定に戻る', () => {
    const s = { ...DEFAULT_SETTINGS, autoRefreshSec: 30, scheme: 'oled' as const, keywords: ['実況'], ngRules: [rule('a')] }
    const parsed = parseBackup(JSON.stringify(settingsFile(s)))
    if (parsed.kind !== 'settings') throw new Error(parsed.kind)
    expect({ ...settingsFile(DEFAULT_SETTINGS).settings, ...importableSettings(parsed, DEFAULT_SETTINGS) }).toEqual(settingsFile(s).settings)
  })

  it('秘密らしい名前の項目を、書き出しに入れない(項目を足したときの見落とし)', () => {
    const names = Object.keys(settingsFile(DEFAULT_SETTINGS).settings)
    expect(names.filter((k) => /secret|token|password|passwd|userhash|apikey|clientid|deletekey|cookie/i.test(k))).toEqual([])
  })
})

describe('parseBackup: ファイルの形', () => {
  it.each(['null', '1', '"x"', '[]'])('設定でも NG でもない JSON は断る: %s', (text) => {
    expect(parseBackup(text)).toMatchObject({ kind: 'error' })
  })

  it('版のないファイル・中身のないファイルは断る', () => {
    expect(parseBackup('{"app":"bbs-browser","kind":"settings","settings":{}}')).toMatchObject({ kind: 'error' })
    expect(parseBackup('{"app":"bbs-browser","kind":"settings","version":1}')).toMatchObject({ kind: 'error' })
    expect(parseBackup('{"app":"bbs-browser","kind":"ng","version":1,"rules":{}}')).toMatchObject({ kind: 'error' })
    expect(parseBackup('{"app":"bbs-browser","kind":"other","version":1}')).toMatchObject({ kind: 'error' })
  })

  it('NG の期限・効く板の型が合わない行は捨てる', () => {
    const parsed = parseBackup(JSON.stringify({ ...ngFile([]), rules: [{ ...rule('a'), expiresOnDate: 1 }, { ...rule('b'), boardUrl: {} }, { ...rule('c'), target: 'nanika' }, rule('d')] }))
    expect(parsed.kind === 'ng' && parsed.rules.map((r) => r.pattern)).toEqual(['d'])
  })
})

describe('mergeNgRules: 読み込む NG の足し方', () => {
  const ids = () => {
    let n = 0
    return () => `new${++n}`
  }

  it('正規表現か・効く板が違えば別のものとして足す', () => {
    const { added } = mergeNgRules([rule('a')], [{ ...rule('a'), isRegex: true }, { ...rule('a'), boardUrl: 'https://x.test/a/' }], ids())
    expect(added).toBe(2)
  })

  it('読み込むものの中の重なりも 1 つにする', () => {
    expect(mergeNgRules([], [rule('a'), rule('a')], ids()).added).toBe(1)
  })

  it('切ってある NG は切ったまま、有効かの項目がなければ有効で足す', () => {
    const { enabled: _, ...noEnabled } = rule('b')
    const { rules } = mergeNgRules([], [{ ...rule('a'), enabled: false }, noEnabled as NgRule], ids())
    expect(rules.map((r) => r.enabled)).toEqual([false, true])
  })

  it('今の NG の並びと中身は変えない', () => {
    const current = [{ ...rule('a'), enabled: false }]
    expect(mergeNgRules(current, [rule('a')], ids()).rules).toEqual(current)
  })
})

describe('backupFileName', () => {
  it('日付の桁をそろえ、種類で拡張子を分ける', () => {
    const d = new Date(2026, 0, 2)
    expect(backupFileName('settings', d)).toBe('OBB-settings-20260102.json')
    expect(backupFileName('ng', d)).toBe('OBB-ng-20260102.json')
    expect(backupFileName('db', d)).toBe('OBB-20260102.db')
  })
})
