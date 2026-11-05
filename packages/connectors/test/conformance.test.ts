// 解析の決まりは packages/conformance の JSON が正。スマホ版のテスト(apps/android の ConformanceTest.kt)も同じファイルを読む
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allConnectors } from '../src/index'
import { encodeEucJpForm } from '../src/eucjp'
import { encodeShiftJisForm } from '../src/sjis'
import { createdAtOf, looksLikeSubject, routeTwoChUrl } from '../src/twoch/connector'

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
    const actual = routeOf(c.input)
    const expected = expectedOf(c)
    // 2ch 互換でないコネクタは、PC では形の解釈が通信といっしょになっているので、スレか板かまでを比べる
    const keys = actual.site !== undefined && actual.site !== '2ch' ? Object.keys(expected).filter((k) => k === 'kind' || k === 'site') : Object.keys(expected)
    expect(Object.fromEntries(keys.map((k) => [k, actual[k]]))).toEqual(Object.fromEntries(keys.map((k) => [k, expected[k]])))
  })
})

describe('subject-shape.json', () => {
  it.each(load<string, boolean>('subject-shape.json'))('$name', (c) => {
    expect(looksLikeSubject(c.input)).toBe(expectedOf(c))
  })
})

describe('encode.json', () => {
  it.each(load<{ encoding: string; value: string }, string>('encode.json'))('$name', (c) => {
    const encode = c.input.encoding === 'euc-jp' ? encodeEucJpForm : encodeShiftJisForm
    expect(encode({ v: c.input.value })).toBe(expectedOf(c))
  })
})

it('残した差にはどれも理由がある', () => {
  for (const file of ['url.json', 'subject-shape.json', 'encode.json']) {
    for (const c of load<unknown, unknown>(file)) if (c.knownDiff) expect(c.knownDiff.reason, c.name).toBeTruthy()
  }
})
