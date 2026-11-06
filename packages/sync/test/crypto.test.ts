// 乱数を使う処理と、固定のベクトルでは確かめられない性質
import { describe, expect, it } from 'vitest'
import { SyncError, deriveKeys, fromBase64Url, generateDeviceId, generateMasterKey, openRecords, sealPayload, spaceId, type KindTag } from '../src/index'
import type { SyncPayload } from '../src/index'

const keys = deriveKeys(generateMasterKey())
const space = spaceId(keys.auth_token)
const rid = 'a'.repeat(64)
const payload: SyncPayload = { kind: 'favorite', hlc: '000000000001.0000.d0', device_id: 'd0', body: { board_url: 'https://a.example/b/', title: 'ひみつのスレタイ', x: 1 } }
const ctx = (kind_tag: KindTag) => ({ space_id: space, record_id: rid, kind_tag, schema_version: 1 })
const raw = (kind_tag: KindTag, p = payload) => ({ record_id: rid, version: 1, kind_tag, schema_version: 1, deleted: false, ...sealPayload(keys, ctx(kind_tag), p) })

describe('暗号化', () => {
  it('毎回違うノンスで、暗号文の長さは 256 バイト単位 + タグ', () => {
    const a = raw('h')
    const b = raw('h')
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(fromBase64Url(a.nonce).length).toBe(24)
    expect(fromBase64Url(a.ciphertext).length).toBe(256 + 16)
  })
  it('開くと元に戻る。知らないフィールドも残る', () => {
    expect(openRecords(keys, space, [raw('h')]).records[0].payload).toEqual(payload)
  })
  it('権限系は k_secret で閉じる(履歴系の鍵だけでは開けない)', () => {
    const r = raw('s')
    const other = { ...keys, k_secret: keys.k_data }
    expect(openRecords(other, space, [r]).failed).toEqual([{ record_id: rid, reason: 'decrypt' }])
  })
  it('壊れたレコードはそれだけ捨てて数え、ほかは開く', () => {
    const good = raw('h')
    const moved = { ...raw('h'), record_id: 'b'.repeat(64) }
    const r = openRecords(keys, space, [moved, null, 3, { record_id: '<script>' }, good])
    expect(r.records.map((x) => x.record_id)).toEqual([rid])
    expect(r.failed.map((f) => f.reason)).toEqual(['decrypt', 'shape', 'shape', 'shape'])
  })
  it('別の領域の暗号文は開けない', () => {
    expect(openRecords(keys, 'c'.repeat(64), [raw('h')]).failed[0].reason).toBe('decrypt')
  })
  it('大きすぎる平文は送らない', () => {
    const big = { ...payload, body: { title: 'x'.repeat(20000) } }
    expect(() => sealPayload(keys, ctx('h'), big)).toThrow(SyncError)
  })
  it('例外の文に鍵も平文も入らない', () => {
    const secretText = 'ひみつのスレタイ'
    const big = { ...payload, body: { title: secretText.repeat(5000) } }
    try {
      sealPayload(keys, ctx('h'), big)
      expect.unreachable()
    } catch (e) {
      expect(String(e)).toBe('SyncError: too_large')
      expect(JSON.stringify(e)).not.toContain(secretText)
    }
    const r = raw('h')
    const tampered = { ...r, ciphertext: r.ciphertext.slice(0, -4) + (r.ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA') }
    expect(JSON.stringify(openRecords(keys, space, [tampered]))).not.toContain(secretText)
  })
  it('平文の deleted は結果に使わない', () => {
    const r = openRecords(keys, space, [{ ...raw('h'), deleted: true }])
    expect(r.records[0].payload.deleted).toBeUndefined()
  })
})

describe('端末 ID', () => {
  it('22 文字で、毎回違う', () => {
    const a = generateDeviceId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(generateDeviceId()).not.toBe(a)
  })
})

describe('書き込みの大きさ', () => {
  const post = (body: string) => ({ kind: 'post', hlc: '000000000001.0000.d0', device_id: 'd0', body: { post_id: 'a'.repeat(32), board_url: 'https://a.example/b/', thread: '1700000000', title: 'あ'.repeat(100), no: 1, body, posted_at: 1 } })
  it('本文が上限の日本語でも暗号文の上限に収まる', () => {
    expect(() => sealPayload(keys, ctx('h'), post('あ'.repeat(4096)))).not.toThrow()
  })
  it('上限の文字数でも、エスケープで膨らむ文字だけなら上限を超えて止まる', () => {
    expect(() => sealPayload(keys, ctx('h'), post('\u0001'.repeat(4096)))).toThrow(SyncError)
  })
})
