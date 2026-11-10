// 解析の決まりは packages/conformance の JSON が正。スマホ版のテスト(apps/android の ConformanceTest.kt)も同じファイルを読む
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allConnectors, postNoInUrl } from '../src/index'
import { detectEncoding, encodeUtf8Form } from '../src/encoding'
import { encodeEucJpForm } from '../src/eucjp'
import { encodeShiftJisForm } from '../src/sjis'
import type { Encoding } from '../src/types'
import { boardPathOf, createdAtOf, kakoDatUrls, looksLikeSubject, routeTwoChUrl } from '../src/twoch/connector'
import { splitAuthorId } from '../src/twoch/parse'
import { isAccountSite, shouldRelogin } from '../src/honobbs/connector'
import { siteDomain } from '../src/siteDomain'

interface Case<I, E> {
  name: string
  input: I
  expected: E
  knownDiff?: { pc?: E; android?: E; reason: string }
}

function load<I, E>(file: string): Case<I, E>[] {
  return JSON.parse(readFileSync(new URL(`../../conformance/${file}`, import.meta.url), 'utf-8'))
}

/** 差を残しているケースは、書いてある差の値と比べる(差がなくなれば落ちて分かる) */
const expectedOf = <I, E>(c: Case<I, E>): E => c.knownDiff?.pc ?? c.expected

const SITES: Record<string, string> = { '2ch-compat': '2ch', honobbs: 'hono', shitaraba: 'shitaraba', machi: 'machi', futaba: 'futaba' }

/** URL の形の解釈。2ch 互換は通信なしの関数で全部を、ほかの掲示板はどのコネクタが受けるかと、スレか板かを見る */
function routeOf(url: string): Record<string, unknown> {
  const c = allConnectors().find((x) => x.canHandle(url.trim()))
  if (!c) return { kind: 'none' }
  const site = SITES[c.id] ?? c.id
  if (c.id !== '2ch-compat') return { kind: c.isThreadUrl?.(url.trim()) ? 'thread' : 'board', site }
  const r = routeTwoChUrl(url)
  if (!r) return { kind: 'none' }
  return { ...r, site, ...(r.kind === 'thread' && { createdAtKnown: createdAtOf(r.key) !== undefined }) }
}

describe('url.json', () => {
  it.each(load<string, Record<string, unknown>>('url.json'))('$name', (c) => {
    const actual: Record<string, unknown> = { ...routeOf(c.input), no: postNoInUrl(c.input) ?? null }
    const expected = expectedOf(c)
    // 2ch 互換でないコネクタは、PC では形の解釈が通信といっしょになっているので、スレか板かまでを比べる(レス番号は URL だけで読める)
    const keys = actual.site !== undefined && actual.site !== '2ch' ? Object.keys(expected).filter((k) => k === 'kind' || k === 'site' || k === 'no') : Object.keys(expected)
    expect(Object.fromEntries(keys.map((k) => [k, actual[k]]))).toEqual(Object.fromEntries(keys.map((k) => [k, expected[k]])))
  })
})

describe('post-target.json', () => {
  it.each(load<{ boardUrl: string; key: string }, Record<string, string>>('post-target.json'))('$name', (c) => {
    const path = boardPathOf(c.input.boardUrl)
    expect({ bbs: path.bbs, postUrl: path.postUrl, threadUrl: path.threadUrl(c.input.key) }).toEqual(expectedOf(c))
  })
})

describe('subject-shape.json', () => {
  it.each(load<string, boolean>('subject-shape.json'))('$name', (c) => {
    expect(looksLikeSubject(c.input)).toBe(expectedOf(c))
  })
})

describe('subject-author.json', () => {
  it.each(load<string, { title: string; authorId: string | null }>('subject-author.json'))('$name', (c) => {
    const r = splitAuthorId(c.input)
    expect({ title: r.title, authorId: r.authorId ?? null }).toEqual(expectedOf(c))
  })
})

describe('encode.json', () => {
  it.each(load<{ encoding: string; value: string }, string>('encode.json'))('$name', (c) => {
    const encode = c.input.encoding === 'euc-jp' ? encodeEucJpForm : c.input.encoding === 'utf-8' ? encodeUtf8Form : encodeShiftJisForm
    expect(encode({ v: c.input.value })).toBe(expectedOf(c))
  })
})

describe('charset.json', () => {
  const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16))
  it.each(load<{ hex: string; contentType?: string; fallback?: Encoding }, string>('charset.json'))('$name', (c) => {
    expect(detectEncoding(fromHex(c.input.hex), c.input.contentType, c.input.fallback)).toBe(expectedOf(c))
  })
})

it('残した差にはどれも理由がある', () => {
  for (const file of ['url.json', 'subject-shape.json', 'subject-author.json', 'encode.json']) {
    for (const c of load<unknown, unknown>(file)) if (c.knownDiff) expect(c.knownDiff.reason, c.name).toBeTruthy()
  }
})

describe('hono-account-site.json', () => {
  it.each(load<string, boolean>('hono-account-site.json'))('$name', (c) => {
    expect(isAccountSite(c.input)).toBe(expectedOf(c))
  })
})

describe('site-domain.json', () => {
  it.each(load<string, string>('site-domain.json'))('$name', (c) => {
    expect(siteDomain(c.input)).toBe(expectedOf(c))
  })
})

describe('kako-url.json', () => {
  it.each(load<{ boardUrl: string; key: string }, string[]>('kako-url.json'))('$name', (c) => {
    expect(kakoDatUrls(c.input.boardUrl, c.input.key)).toEqual(expectedOf(c))
  })
})

describe('hono-relogin.json', () => {
  it.each(load<{ status: number; sentAuth: boolean }, boolean>('hono-relogin.json'))('$name', (c) => {
    expect(shouldRelogin(c.input.status, c.input.sentAuth)).toBe(expectedOf(c))
  })
})
