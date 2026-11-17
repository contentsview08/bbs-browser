import { describe, expect, it } from 'vitest'
import type { ThreadSummary } from '@bbs-browser/connectors'
import { isKeywordRule, keywordGroupsOf, keywordLabel, keywordMatcher, migrateLegacyKeywords, sameKeyword, type KeywordRule } from '../src/utils/keywords'
import { importableSettings } from '../src/utils/backup'
import { DEFAULT_SETTINGS } from '../src/ui/settings'

// スマホ版の KeywordRuleTest と同じ見本・同じ答え
const t = (key: string, title: string, authorId?: string, boardUrl = 'https://a/'): ThreadSummary => ({ connectorId: '2ch-compat', boardUrl, key, title, postCount: 10, order: 0, createdAt: undefined, authorId })
const rule = (p: Partial<KeywordRule> & { id: string; pattern: string }): KeywordRule => ({ kind: 'title', isRegex: false, label: '', enabled: true, createdAt: 0, ...p })

describe('キーワード(1 つの言葉か正規表現に 1 つの帯。別名・板ごと)', () => {
  it('言葉は揺れをそろえて含むか。正規表現はそのまま。立てた人は ID', () => {
    const m = keywordMatcher([rule({ id: '1', pattern: 'ＡＢＣ' }), rule({ id: '2', pattern: '絵|イラスト', isRegex: true, label: 'お絵描き' }), rule({ id: '3', kind: 'author', pattern: 'xyz' })], 'https://a/')
    expect(m.hit(t('k1', 'abc の話'))?.id).toBe('1')
    expect(m.hit(t('k2', 'イラスト置き場'))?.id).toBe('2')
    expect(keywordLabel(m.hit(t('k2', 'イラスト置き場'))!)).toBe('お絵描き')
    expect(m.hit(t('k3', '無題', 'xyz'))?.id).toBe('3')
    expect(m.hit(t('k4', '無題'))).toBeUndefined()
  })
  it('板限定と無効は効かない。別名がなければ言葉そのもの', () => {
    const rules = [rule({ id: '1', pattern: '実況', boardUrl: 'https://b/' }), rule({ id: '2', pattern: '雑談', enabled: false }), rule({ id: '3', kind: 'author', pattern: 'id1' })]
    const m = keywordMatcher(rules, 'https://a/')
    expect(m.hit(t('k1', '実況スレ'))).toBeUndefined()
    expect(m.hit(t('k2', '雑談スレ'))).toBeUndefined()
    expect(keywordLabel(rules[2])).toBe('立てた人 id1')
    expect(keywordLabel(rules[0])).toBe('実況')
    expect(keywordMatcher(rules, 'https://b/').hit(t('k1', '実況スレ', undefined, 'https://b/'))).toBeDefined()
  })
  it('まとまりは先のキーワードが勝ち。残りと運営のお知らせは最後', () => {
    const m = keywordMatcher([rule({ id: '1', pattern: 'A' }), rule({ id: '2', pattern: 'B' })])
    const list = [t('1', 'A と B'), t('2', 'B だけ'), t('3', 'ほか'), { ...t('4', '【運営】お知らせ A'), announcement: true }]
    const g = keywordGroupsOf(list, m, (x) => !!x.announcement)
    expect(g.groups.map((x) => [x.rule.id, x.threads.map((y) => y.key)])).toEqual([
      ['1', ['1']],
      ['2', ['2']],
    ])
    expect(g.rest.map((x) => x.key)).toEqual(['3', '4'])
  })
  it('前の形から写す。同じ中身の判定。形の検査。読めない正規表現は当たらないだけ', () => {
    const legacy = migrateLegacyKeywords(['実況', ' ', '実況', '雑談'], ['id1'], 1000)
    expect(legacy.map((r) => [r.kind, r.pattern])).toEqual([
      ['title', '実況'],
      ['title', '雑談'],
      ['author', 'id1'],
    ])
    expect(legacy.every(isKeywordRule)).toBe(true)
    expect(isKeywordRule({ id: 'x', kind: 'title', pattern: '', isRegex: false, label: '', enabled: true })).toBe(false)
    expect(sameKeyword(rule({ id: 'a', pattern: '実況 ' }), rule({ id: 'b', pattern: '実況', label: '別名' }))).toBe(true)
    expect(sameKeyword(rule({ id: 'a', pattern: '実況' }), rule({ id: 'b', pattern: '実況', isRegex: true }))).toBe(false)
    expect(keywordMatcher([rule({ id: '1', pattern: '(', isRegex: true })]).hit(t('k', '('))).toBeUndefined()
  })
  it('前の形のバックアップ(keywords だけ)を戻すと keywordRules に写る。今の形があればそのまま', () => {
    const legacy = importableSettings({ kind: 'settings', version: 1, settings: { keywords: ['実況'], keywordAuthors: ['id1'] } } as never, DEFAULT_SETTINGS)
    expect(legacy.keywordRules?.map((r) => [r.kind, r.pattern])).toEqual([
      ['title', '実況'],
      ['author', 'id1'],
    ])
    const now = importableSettings({ kind: 'settings', version: 1, settings: { keywords: ['実況'], keywordRules: [rule({ id: 'x', pattern: '雑談' })] } } as never, DEFAULT_SETTINGS)
    expect(now.keywordRules?.map((r) => r.pattern)).toEqual(['雑談'])
  })
})
