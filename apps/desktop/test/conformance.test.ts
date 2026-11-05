// 解析の決まりは packages/conformance の JSON が正。スマホ版のテスト(apps/android の ConformanceTest.kt)も同じファイルを読む
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import {
  anchorTargets,
  anchorTree,
  cardUrlsIn,
  countAnchors,
  hasLink,
  hasVideo,
  idsIn,
  imageUrlsIn,
  normalizeForSearch,
  urlsIn,
  youtubeLinksIn,
} from '../src/utils/postBody'

interface Case<I, E> {
  name: string
  input: I
  expected: E
  knownDiff?: { pc?: E; android?: E; reason: string }
}

function load<I, E>(file: string): Case<I, E>[] {
  return JSON.parse(readFileSync(new URL(`../../../packages/conformance/${file}`, import.meta.url), 'utf-8'))
}

/** 差を残しているケースは、書いてある差の値と比べる(差がなくなれば落ちて分かる) */
const expectedOf = <I, E>(c: Case<I, E>): E => c.knownDiff?.pc ?? c.expected

const pick = (actual: Record<string, unknown>, expected: object) => Object.fromEntries(Object.keys(expected).map((k) => [k, actual[k]]))

describe('post-body.json', () => {
  it.each(load<string, Record<string, unknown>>('post-body.json'))('$name', (c) => {
    const text = c.input
    const images = imageUrlsIn(text)
    const expected = expectedOf(c)
    const actual = {
      anchors: anchorTargets(text),
      urls: urlsIn(text),
      ids: idsIn(text),
      images,
      image: images.length > 0,
      video: hasVideo(text),
      youtube: youtubeLinksIn(text).map((l) => l.id),
      link: hasLink(text),
      cards: cardUrlsIn(text),
    }
    expect(pick(actual, expected)).toEqual(expected)
  })
})

describe('thread.json', () => {
  type Expected = { replyCount?: Record<string, number>; tree?: Record<string, number[]> }
  it.each(load<{ no: number; body: string }[], Expected>('thread.json'))('$name', (c) => {
    const posts = c.input.map((p): Post => ({ no: p.no, name: '', mail: '', date: '', body: p.body }))
    const expected = expectedOf(c)
    if (expected.replyCount) expect(Object.fromEntries(countAnchors(posts))).toEqual(expected.replyCount)
    for (const [start, nos] of Object.entries(expected.tree ?? {})) expect(anchorTree(Number(start), posts)).toEqual(nos)
  })
})

describe('search.json', () => {
  it.each(load<string, string>('search.json'))('$name', (c) => {
    expect(normalizeForSearch(c.input)).toBe(expectedOf(c))
  })
})
