// 単体: 入力の検査・IP・PoW・設定
import { describe, expect, it } from 'vitest'
import { loadConfig, type Env } from '../../src/config'
import { base64UrlBytes } from '../../src/encoding'
import { ipKeys } from '../../src/ip'
import { issuePow, leadingZeroBits, verifyPow } from '../../src/pow'
import { BadInput, checkCreate, parseSince, parseStrict } from '../../src/validate'

describe('parseStrict', () => {
  it('普通の JSON を読む', () => {
    expect(parseStrict('{"a":[1,{"b":"}"}],"c":"\\"{"}')).toEqual({ a: [1, { b: '}' }], c: '"{' })
  })
  it.each(['{"a":1,"a":2}', '{"a":{"b":1,"\\u0062":2}}', '[[[[[[[[[1]]]]]]]]]', '{', '{"a":1', '"abc', '', '1 2'])('%s は断る', (t) => {
    expect(() => parseStrict(t)).toThrow(BadInput)
  })
  it('別の階層の同じキーは重複でない', () => {
    expect(parseStrict('{"a":{"a":1},"b":{"a":2}}')).toEqual({ a: { a: 1 }, b: { a: 2 } })
  })
})

describe('base64UrlBytes', () => {
  it.each([['', 0], ['AA', 1], ['AAA', 2], ['AAAA', 3]])('%s は %i バイト', (s, n) => expect(base64UrlBytes(s)).toBe(n))
  it.each(['A', 'AB', 'AAB', 'A=', 'A+', 'A/'])('%s は断る', (s) => expect(base64UrlBytes(s)).toBe(-1))
})

describe('parseSince', () => {
  it('形を確かめる', () => {
    expect(parseSince('since=0')).toBe(0)
    expect(parseSince('since=9007199254740991')).toBe(9007199254740991)
    for (const q of ['since=9007199254740992', 'since=00', 'since=-1', 'x=1', 'since=1&since=2']) expect(parseSince(q)).toBeNull()
  })
})

describe('checkCreate', () => {
  it('知らないキーを断る', () => {
    expect(checkCreate({})).toEqual({})
    expect(() => checkCreate({ x: 1 })).toThrow(BadInput)
    expect(() => checkCreate({ pow: { challenge: 'x' } })).toThrow(BadInput)
    expect(() => checkCreate({ pow: { challenge: 'x', nonce: 'a b' } })).toThrow(BadInput)
    expect(() => checkCreate([])).toThrow(BadInput)
    expect(() => checkCreate({ turnstile: 'x' })).toThrow(BadInput)
    expect(() => checkCreate({ ticket: '' })).toThrow(BadInput)
    expect(() => checkCreate({ ticket: 1 })).toThrow(BadInput)
    expect(() => checkCreate({ ticket: 'x'.repeat(257) })).toThrow(BadInput)
    expect(checkCreate({ ticket: 'x' })).toEqual({ ticket: 'x' })
  })
})

describe('ipKeys', () => {
  it('v4 はそのまま', () => expect(ipKeys('203.0.113.1')).toEqual({ narrow: '203.0.113.1', wide: null }))
  it('v6 の書き方の違いを同じ /64 にする', () => {
    const a = ipKeys('2001:db8:1:2::1')
    expect(a).toEqual({ narrow: '2001:0db8:0001:0002::/64', wide: '2001:0db8:0001::/48' })
    expect(ipKeys('2001:0DB8:0001:0002:0:0:0:ffff').narrow).toBe(a.narrow)
  })
  it('v4 射影', () => expect(ipKeys('::ffff:1.2.3.4').narrow).toBe('1.2.3.4'))
  it('読めないものは unknown', () => {
    for (const s of [null, '', 'x', '1.2.3', '999.1.1.1', '1::2::3', '1:2:3', 'g::1']) expect(ipKeys(s).narrow).toBe('unknown')
  })
})

describe('PoW', () => {
  it('先頭の 0 のビットを数える', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0x10]))).toBe(11)
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0)
    expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16)
  })
  it('0 ビットなら解かずに通るが、署名と期限は見る', async () => {
    const id = 'a'.repeat(64)
    const c = await issuePow('s', id, 0, 1000_000, 300)
    expect(await verifyPow('s', id, 0, 1000_000, c, 'x')).toBe(true)
    expect(await verifyPow('other', id, 0, 1000_000, c, 'x')).toBe(false)
    expect(await verifyPow('s', id, 0, 1000_000 + 300_000, c, 'x')).toBe(false)
    expect(await verifyPow('s', id, 1, 1000_000, c, 'x')).toBe(false)
  })
})

describe('loadConfig', () => {
  it('既定は設計の値', () => {
    const c = loadConfig({} as Env)
    expect([c.spaceLimit, c.evictIdleDays, c.idleDeleteDays, c.emptySpaceDays, c.tombGcDays, c.quotaBytes, c.quotaRecords, c.maxPushRecords, c.maxBodyBytes, c.maxCiphertextBytes, c.ratePerMinute, c.ratePerDay, c.fullPullPerHour, c.sourceLimit]).toEqual([100, 14, 90, 7, 90, 10485760, 50000, 100, 1048576, 16384, 20, 6000, 3, 5])
  })
  it('読めない値は既定に戻す。制限が外れない', () => {
    const c = loadConfig({ SPACE_LIMIT: 'abc', RATE_PER_MINUTE: '-1', QUOTA_BYTES: '1e9' } as unknown as Env)
    expect([c.spaceLimit, c.ratePerMinute, c.quotaBytes]).toEqual([100, 20, 10485760])
  })
  it('環境変数で変えられる', () => {
    const c = loadConfig({ SPACE_LIMIT: '2', CREATION_CLOSED: '1', READ_ONLY: 'true', ALLOWED_HOSTS: 'A.test, b.test' } as unknown as Env)
    expect([c.spaceLimit, c.creationClosed, c.readOnly, c.allowedHosts]).toEqual([2, true, true, ['a.test', 'b.test']])
  })
})
