import { describe, expect, it } from 'vitest'
import { DEFAULT_UPLOAD_HOST } from '../src/host/uploader'
import { DEFAULT_SETTINGS, TREE_DEPTH_DEFAULT, TREE_DEPTH_MAX, migrateOld, migrateValues, styleOptionsOf, withStyleOption } from '../src/ui/settings'

describe('migrateOld: 古い設定を写す', () => {
  it('サムネイルを出さない設定は、読み込みの設定を決めていなければ「読み込まない」に写す', () => {
    expect(migrateOld({ showThumbnails: false }).thumbLoad).toBe('never')
  })

  it('読み込みの設定を決めたあとは、古い行で上書きしない', () => {
    expect(migrateOld({ showThumbnails: false, thumbLoad: 'always' })).not.toHaveProperty('thumbLoad')
  })
})

describe('migrateOld: 消した設定を写す', () => {
  it('文字の大きさの 5 段階は px に写す。範囲の外は写さない', () => {
    expect(migrateOld({ fontSize: 1 }).fontPx).toBe(13)
    expect(migrateOld({ fontSize: 5 }).fontPx).toBe(20)
    expect(migrateOld({ mobileFontSize: 3 }).mobileFontPx).toBe(14)
    expect(migrateOld({ fontSize: 0 })).not.toHaveProperty('fontPx')
    expect(migrateOld({ fontSize: 6 })).not.toHaveProperty('fontPx')
    expect(migrateOld({ fontSize: '3' })).not.toHaveProperty('fontPx')
  })

  it('px を決めたあとは、古い段階で上書きしない', () => {
    expect(migrateOld({ fontSize: 1, fontPx: 17 })).not.toHaveProperty('fontPx')
  })

  it('空行の整え方は、どちらかがオンならオン。どちらもなければ触らない', () => {
    expect(migrateOld({ collapseBlankLines: true, trimTrailingBlank: false }).tidyBlankLines).toBe(true)
    expect(migrateOld({ collapseBlankLines: false, trimTrailingBlank: false }).tidyBlankLines).toBe(false)
    expect(migrateOld({})).not.toHaveProperty('tidyBlankLines')
    expect(migrateOld({ collapseBlankLines: true, tidyBlankLines: false })).not.toHaveProperty('tidyBlankLines')
  })

  it('ID の見せ方は、模様を優先して 1 つにまとめる', () => {
    expect(migrateOld({ showIdenticon: true, idColor: true }).idStyle).toBe('icon')
    expect(migrateOld({ threadAuthorIcon: true }).idStyle).toBe('icon')
    expect(migrateOld({ idHeat: true }).idStyle).toBe('color')
    expect(migrateOld({ idColor: false })).not.toHaveProperty('idStyle')
    expect(migrateOld({ idColor: true, idStyle: 'none' })).not.toHaveProperty('idStyle')
  })

  it('人気のレス「示さない」は、左の印にする', () => {
    expect(migrateOld({ heatStyle: 'none' }).heatStyle).toBe('left')
    expect(migrateOld({ heatStyle: 'right' })).not.toHaveProperty('heatStyle')
  })

  it('今の形の設定は何も変えない', () => {
    expect(migrateOld({ ...DEFAULT_SETTINGS })).toEqual({})
  })
})

describe('migrateValues: やめた値を今の値に読み替える', () => {
  it('やめた配色は近い配色に。今の配色はそのまま', () => {
    for (const old of ['light', 'soft-light', 'sepia', 'discord-light', '2ch-classic']) {
      expect(migrateValues({ scheme: old as never }).scheme).toBe('light-gray')
    }
    expect(migrateValues({ darkScheme: 'night' as never }).darkScheme).toBe('soft-dark')
    expect(migrateValues({ lightScheme: 'line-light' }).lightScheme).toBe('line-light')
  })

  it('レスの見た目「タイムライン」は Discord 風に', () => {
    expect(migrateValues({ postStyle: 'timeline' as never }).postStyle).toBe('discord')
    expect(migrateValues({ postStyle: 'line' }).postStyle).toBe('line')
  })

  it('やめたアップロード先は既定に。今のものはそのまま', () => {
    expect(migrateValues({ uploadHost: '0x0' as never }).uploadHost).toBe(DEFAULT_UPLOAD_HOST)
    expect(migrateValues({ uploadHost: 'catbox' }).uploadHost).toBe('catbox')
  })

  it('スレ表示の ←↑「タブを閉じる」は「ログを削除して閉じる」に。ほかの割り当ては残す', () => {
    const got = migrateValues({ swipeGestures: { list: { right: 'drawer' }, thread: { right: 'back', 'left,up': 'closeTab' } } as never })
    expect(got.swipeGestures).toEqual({ list: { right: 'drawer' }, thread: { right: 'back', 'left,up': 'deleteLog' } })
  })

  it('マウスジェスチャーの古い並びは、1 つの向きだけ円盤に移し、折れ曲がる並びは捨てる', () => {
    expect(migrateValues({ mouseGestures: { up: 'top', right: 'next', 'right,up': 'x' } as never }).mouseGestures).toEqual({ n: 'top', e: 'next' })
  })

  it('移せるものがなければ既定に。円盤の形はそのまま(全部消した状態も)', () => {
    expect(migrateValues({ mouseGestures: { 'right,up': 'x' } as never }).mouseGestures).toEqual(DEFAULT_SETTINGS.mouseGestures)
    expect(migrateValues({ mouseGestures: { ne: 'refresh' } as never }).mouseGestures).toEqual({ ne: 'refresh' })
    expect(migrateValues({ mouseGestures: {} as never }).mouseGestures).toEqual({})
  })

  it('ない項目は足さない(書き出したファイルの一部だけを読むときに、既定で上書きしない)', () => {
    expect(migrateValues({ keywords: ['実況'] })).toEqual({})
  })

  it('既定の設定は読み替えても変わらない', () => {
    expect({ ...DEFAULT_SETTINGS, ...migrateValues(DEFAULT_SETTINGS) }).toEqual(DEFAULT_SETTINGS)
  })
})

describe('見た目ごとの設定(styleOptions)', () => {
  it('何も決めていなければ今までの動き(ツリーなし・引用 1 行・続けて書いたレスをまとめる)', () => {
    for (const style of ['card', 'discord', 'classic', 'line', 'matome'] as const) {
      const o = styleOptionsOf(DEFAULT_SETTINGS, style)
      expect(o).toMatchObject({ tree: false, quote: 'line', groupRuns: true })
      expect(o.treeDepth).toBe(TREE_DEPTH_DEFAULT)
    }
  })
  it('見た目ごとに別々に覚える', () => {
    const s = { styleOptions: withStyleOption({ styleOptions: {} }, 'line', 'quote', 'full') }
    expect(styleOptionsOf(s, 'line').quote).toBe('full')
    expect(styleOptionsOf(s, 'discord').quote).toBe('line')
  })
  it('ツリーはカード・専ブラ風・まとめ風だけ(Discord 風・LINE 風に入っていても使わない)', () => {
    const s = { styleOptions: { line: { tree: true }, card: { tree: true } } }
    expect(styleOptionsOf(s, 'line').tree).toBe(false)
    expect(styleOptionsOf(s, 'card').tree).toBe(true)
  })
  it('読み込みで、知らない見た目・項目・壊れた値を捨て、深さは幅に収める', () => {
    const out = migrateValues({
      styleOptions: { card: { tree: true, treeDepth: 99, extra: 1 }, line: { quote: 'big', groupRuns: false }, timeline: { tree: true } } as never,
    })
    expect(out.styleOptions).toEqual({ card: { tree: true, treeDepth: TREE_DEPTH_MAX }, line: { groupRuns: false } })
    expect(migrateValues({ styleOptions: 'x' as never }).styleOptions).toEqual({})
  })
  it('保存のない古い設定では styleOptions に触らない', () => {
    expect(migrateValues({ postStyle: 'card' })).not.toHaveProperty('styleOptions')
  })
})
