// 解析の決まりは packages/conformance の JSON が正。スマホ版のテスト(apps/android の ConformanceTest.kt)も同じファイルを読む
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Post } from '@bbs-browser/connectors'
import {
  anchorTargets,
  cardUrlsIn,
  countAnchors,
  hasLink,
  hasVideo,
  idsIn,
  imageUrlsIn,
  normalizeForSearch,
  urlSpansIn,
  urlsIn,
  youtubeLinksIn,
} from '../src/utils/postBody'
import { TLDS } from '../src/utils/urlFind'
import { favIncrease } from '../src/utils/watch'
import { threadUnread, unreadFirstOrder } from '../src/utils/unread'
import { matchRanges, newRule, patternError, postMatcher, type NgTarget } from '../src/utils/ng'
import { anchorTreeOf, buildPostTree } from '../src/utils/postTree'

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

describe('link.json', () => {
  it.each(load<string, Record<string, unknown>>('link.json'))('$name', (c) => {
    const expected = expectedOf(c)
    const actual = { spans: urlSpansIn(c.input), urls: urlsIn(c.input), anchors: anchorTargets(c.input) }
    expect(pick(actual, expected)).toEqual(expected)
  })
})

describe('tld.json', () => {
  it('ドメインとみなす TLD の一覧が同じ', () => {
    const json = JSON.parse(readFileSync(new URL('../../../packages/conformance/tld.json', import.meta.url), 'utf-8')) as { tlds: string[] }
    expect(TLDS).toEqual(json.tlds)
  })
})

describe('thread.json', () => {
  type Expected = { replyCount?: Record<string, number> }
  it.each(load<{ no: number; body: string }[], Expected>('thread.json'))('$name', (c) => {
    const posts = c.input.map((p): Post => ({ no: p.no, name: '', mail: '', date: '', body: p.body }))
    const expected = expectedOf(c)
    if (expected.replyCount) expect(Object.fromEntries(countAnchors(posts))).toEqual(expected.replyCount)
  })
})

describe('search.json', () => {
  it.each(load<string, string>('search.json'))('$name', (c) => {
    expect(normalizeForSearch(c.input)).toBe(expectedOf(c))
  })
})

describe('ng.json', () => {
  it.each(load<{ pattern: string; isRegex: boolean; target: NgTarget; text: string }, { valid: boolean; match: boolean; ranges?: [number, number][] }>('ng.json'))('$name', (c) => {
    const { pattern, isRegex, target, text } = c.input
    const expected = expectedOf(c)
    expect(patternError(pattern, isRegex) === undefined).toBe(expected.valid)
    const post: Post = { no: 1, name: target === 'posterName' ? text : '', mail: '', date: '', id: target === 'posterId' ? text : undefined, body: target === 'content' ? text : '' }
    expect(postMatcher([newRule(target, pattern, { isRegex })])(post)).toBe(expected.match)
    if (expected.ranges) expect(matchRanges({ pattern, isRegex, target }, text)).toEqual(expected.ranges)
  })
})

describe('unread-first.json', () => {
  it.each(load<{ key: string; postCount: number; readNo?: number }[], string[]>('unread-first.json'))('$name', (c) => {
    const unread = (t: (typeof c.input)[number]) => threadUnread(t.readNo === undefined ? undefined : { readNo: t.readNo }, t.postCount) > 0
    expect(unreadFirstOrder(c.input, unread).map((t) => t.key)).toEqual(expectedOf(c))
  })
})

describe('fav-new.json', () => {
  it.each(load<{ now: number; before?: number; localCount: number; readNo: number }, number>('fav-new.json'))('$name', (c) => {
    expect(favIncrease(c.input.now, c.input.before, c.input.localCount, c.input.readNo)).toBe(expectedOf(c))
  })
})

describe('tree.json(ツリー表示の並べ方)', () => {
  type Row = { no: number; depth: number; ghost?: boolean; last?: boolean; rails?: boolean[] }
  for (const c of load<{ posts: [number, string][]; aborn: number[]; maxDepth: number; start?: number }, Row[]>('tree.json')) {
    it(c.name, () => {
      const bodies = new Map(c.input.posts)
      const aborn = new Set(c.input.aborn)
      const t = buildPostTree(
        c.input.posts.map(([no]) => no),
        (no) => anchorTargets(bodies.get(no) ?? ''),
        { maxDepth: c.input.maxDepth, isGone: (no) => aborn.has(no) },
      )
      // start があれば、そのレスのアンカーツリー(根の部分木)。last は false のときだけ、rails は空でないときだけ書いてある
      if (c.input.start !== undefined)
        expect(
          anchorTreeOf(t, c.input.start).map((r) => ({ no: r.no, depth: r.depth, ...(r.dup && { ghost: true }), ...(!r.last && { last: false }), ...(r.rails.length > 0 && { rails: r.rails }) })),
        ).toEqual(expectedOf(c))
      else expect(t.rows.map((r) => ({ no: r.no, depth: r.depth, ...(r.dup && { ghost: true }) }))).toEqual(expectedOf(c))
    })
  }
})
