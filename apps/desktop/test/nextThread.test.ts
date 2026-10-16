import { describe, expect, it } from 'vitest'
import type { ThreadSummary } from '@bbs-browser/connectors'
import { findNextThreads, normalizeTitle, titleNumber, titleSimilarity } from '../src/utils/nextThread'

const t = (key: string, title: string, createdSec = Number(key)): ThreadSummary => ({
  connectorId: '2ch-compat',
  boardUrl: 'https://x.5ch.io/test/',
  key,
  title,
  postCount: 10,
  order: 0,
  createdAt: new Date(createdSec * 1000),
})

describe('titleNumber', () => {
  it.each([
    ['プログラミング言語 Rust Part12', 12],
    ['【実況】なんでも雑談スレ その34', 34],
    ['ゲーム総合 ★5', 5],
    ['ｐａｒｔ７ 全角のスレ', 7],
    ['雑談スレ 101', 101],
    ['雑談スレ 101【ワッチョイ】', 101],
    ['番号のないスレ', undefined],
  ])('%s → %s', (title, n) => {
    expect(titleNumber(title)).toBe(n)
  })
})

describe('titleSimilarity', () => {
  it('番号だけ違うスレタイはほぼ同じ', () => {
    expect(normalizeTitle('プログラミング言語 Rust Part12')).toBe(normalizeTitle('プログラミング言語 Rust Part13'))
    expect(titleSimilarity('プログラミング言語 Rust Part12', 'プログラミング言語 Rust Part13')).toBe(1)
  })

  it('関係のないスレタイは似ていない', () => {
    expect(titleSimilarity('プログラミング言語 Rust Part12', '今日の晩ごはん')).toBeLessThan(0.2)
  })
})

describe('findNextThreads', () => {
  const current = { key: '1000', title: 'プログラミング言語 Rust Part12', createdAt: new Date(1000 * 1000) }

  it('番号がちょうど次のスレを一番上に出し、前に立ったスレと自分は除く', () => {
    const list = [
      t('1000', 'プログラミング言語 Rust Part12'),
      t('900', 'プログラミング言語 Rust Part11'),
      t('1200', 'プログラミング言語 Rust Part14'),
      t('1100', 'プログラミング言語 Rust Part13'),
      t('1150', '今日の晩ごはん'),
      t('1300', 'プログラミング言語 Go Part3'),
    ]
    const found = findNextThreads(current, list)
    // 番号が次(Part13)→ 番号違いの同じシリーズ(Part14)→ 言語だけ違うよく似たスレ
    expect(found.map((c) => c.thread.key)).toEqual(['1100', '1200', '1300'])
    expect(found[0]).toMatchObject({ isNextNumber: true })
  })

  it('番号がなければ、似ている順、同じくらいなら新しい順', () => {
    const found = findNextThreads({ key: '1', title: '【悲報】なんでも雑談' }, [
      t('5', '【悲報】なんでも雑談'),
      t('9', '【悲報】なんでも雑談'),
      t('7', 'なんでも雑談【悲報】'),
    ])
    expect(found.map((c) => c.thread.key)).toEqual(['9', '5', '7'])
  })
})
