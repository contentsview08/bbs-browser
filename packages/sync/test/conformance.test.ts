// 同期の決まりは packages/conformance の sync-*.json が正。スマホ版のテスト(SyncConformanceTest.kt)も同じファイルを読む
import { readFileSync } from 'node:fs'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { to5chIo } from '../../connectors/src/twoch/connector'
import * as S from '../src/index'
import { recreateScript, simulate, simulateRecreate } from './sim'

interface Case {
  name: string
  input: Record<string, any>
  expected: any
  only?: 'android'
}

const load = (file: string): Case[] => JSON.parse(readFileSync(new URL(`../../conformance/${file}`, import.meta.url), 'utf-8'))
const hex = (s: string) => S.fromHex(s)
const REF = { board_url: 'https://a.example/b/', thread: '1' }
const errorCode = (f: () => unknown): unknown => {
  try {
    return f()
  } catch (e) {
    return { error: e instanceof S.SyncError ? e.code : 'other' }
  }
}

function crypto(i: Record<string, any>): unknown {
  switch (i.fn) {
    case 'sha256':
      return S.toHex(sha256(hex(i.data)))
    case 'hmac':
      return S.toHex(hmac(sha256, hex(i.key), hex(i.data)))
    case 'hkdf':
      return S.toHex(hkdf(sha256, hex(i.ikm), hex(i.salt), hex(i.info), i.length))
    case 'xchacha_open':
      return S.toHex(S.xchachaOpen(hex(i.key), hex(i.nonce), hex(i.ciphertext), hex(i.aad)))
    case 'pad':
      return S.pad(new Uint8Array(i.length).fill(0x41)).length
    case 'pad_bytes':
      return S.toHex(S.pad(hex(i.plain)))
    case 'unpad':
      return S.toHex(S.unpad(hex(i.padded)))
    case 'aad':
      return S.toHex(S.buildAad(i.ctx))
    case 'b64url_decode':
      return S.toHex(S.fromBase64Url(i.text))
    case 'b64url_encode':
      return S.toBase64Url(hex(i.data))
    case 'derive_keys': {
      const k = S.deriveKeys(hex(i.k))
      return { auth_token: S.toHex(k.auth_token), k_data: S.toHex(k.k_data), k_secret: S.toHex(k.k_secret), k_id: S.toHex(k.k_id), space_id: S.spaceId(k.auth_token) }
    }
    case 'open_record':
      return S.toHex(S.openRecord(hex(i.key), i.ctx, hex(i.nonce), hex(i.ciphertext)))
    case 'open_records': {
      const r = S.openRecords(S.deriveKeys(hex(i.k)), i.space_id, i.records)
      return { records: r.records, failed: r.failed }
    }
    default:
      throw new Error(`知らない fn: ${i.fn}`)
  }
}

describe('sync-crypto.json', () => {
  it.each(load('sync-crypto.json').filter((c) => c.only !== 'android'))('$name', (c) => {
    expect(errorCode(() => crypto(c.input))).toEqual(c.expected)
  })
})

describe('sync-id.json', () => {
  const cases = load('sync-id.json')
  it.each(cases)('$name', (c) => {
    const i = c.input
    const actual = errorCode(() => {
      if (i.fn === 'board') return S.normalizeBoardUrl(i.url)
      if (i.fn === 'record_input') return S.recordIdInput(i.kind, i.board, i.thread, i.detail)
      return S.recordId(hex(i.k_id), i.kind, i.board, i.thread, i.detail)
    })
    expect(actual).toEqual(c.expected)
  })
  it('コネクタの to5chIo を通しても同じ板になる', () => {
    for (const { input } of cases) {
      if (input.fn === 'board' && S.normalizeBoardUrl(input.url) !== null) expect(S.normalizeBoardUrl(to5chIo(input.url.trim()))).toBe(S.normalizeBoardUrl(input.url))
    }
  })
})

describe('sync-schema.json', () => {
  it.each(load('sync-schema.json'))('$name', (c) => {
    expect(S.checkPayload(c.input) !== null).toBe(c.expected)
  })
})

/** 既読の手順を順に動かす。expect は途中の、それぞれの端末から見た既読位置 */
function readScript(events: Record<string, any>[]): Record<string, number> {
  const devices = new Map<string, { clock: string; store: Map<string, S.SyncPayload> }>()
  const dev = (n: string) => {
    if (!devices.has(n)) devices.set(n, { clock: S.HLC_ZERO, store: new Map() })
    return devices.get(n)!
  }
  const devsOf = (n: string) => [...dev(n).store.entries()].filter(([k]) => k.startsWith('dev:')).map(([, v]) => v)
  const positionOf = (n: string) => S.readPosition(dev(n).store.get('reset') ?? null, devsOf(n))
  const deliver = (from: string, to: string, t: number) => {
    for (const [k, p] of dev(from).store) {
      const old = dev(to).store.get(k)
      dev(to).store.set(k, old ? S.mergePayloads(old, p) : p)
      dev(to).clock = S.hlcObserve(dev(to).clock, p.hlc, t)
    }
  }
  for (const e of events) {
    if (e.dev !== undefined) dev(e.dev)
    if (e.read !== undefined) {
      const d = dev(e.dev)
      const id = `dev:${e.dev}`
      const old = d.store.get(id) ?? null
      const s = S.hlcStamp(d.clock, e.t, e.dev, old?.hlc)
      d.clock = s.clock
      d.store.set(id, S.recordRead(old, d.store.get('reset') ?? null, REF, e.read, s.stamp, e.dev))
    } else if (e.reset !== undefined) {
      const d = dev(e.dev)
      const old = d.store.get('reset') ?? null
      const s = S.hlcStamp(d.clock, e.t, e.dev, S.resetFloor(old, devsOf(e.dev)))
      d.clock = s.clock
      d.store.set('reset', S.makeReset(old, REF, e.id, e.reset, s.stamp, e.dev))
    } else if (e.sync !== undefined) {
      deliver(e.sync[0], e.sync[1], e.t)
    } else if (e.sync_all !== undefined) {
      const names = [...devices.keys()]
      for (const a of names) for (const b of names) if (a !== b) deliver(a, b, e.sync_all)
      for (const a of names) for (const b of names) if (a !== b) deliver(a, b, e.sync_all)
    } else if (e.expect !== undefined) {
      for (const [n, v] of Object.entries(e.expect)) expect(positionOf(n), `途中の ${n}`).toBe(v)
    }
  }
  return Object.fromEntries([...devices.keys()].map((n) => [n, positionOf(n)]))
}

function merge(i: Record<string, any>): unknown {
  switch (i.fn) {
    case 'lww': {
      const ab = S.mergeLww(i.a, i.b)
      expect(S.canonicalJson(S.mergeLww(i.b, i.a))).toBe(S.canonicalJson(ab))
      return ab
    }
    case 'max': {
      const ab = S.mergePayloads(i.a, i.b)
      expect(S.canonicalJson(S.mergePayloads(i.b, i.a))).toBe(S.canonicalJson(ab))
      return ab
    }
    case 'update':
      return S.updateRecord(i.existing, i.kind, i.changes, i.stamp, i.device)
    case 'tombstone':
      return S.makeTombstone(i.existing, i.stamp, i.device, i.keep ?? [], i.trim === true)
    case 'order_between':
      return S.orderKeyBetween(i.a, i.b)
    case 'order_sort':
      return [...i.items].sort(S.compareOrdered).map((x: { id: string }) => x.id)
    case 'hlc_format':
      return S.formatHlc(i.wall, i.counter, i.device)
    case 'hlc_parse':
      return S.parseHlc(i.text)
    case 'hlc_compare':
      return S.compareHlc(i.a, i.b)
    case 'hlc_observe':
      return S.hlcObserve(i.clock, i.remote, i.now)
    case 'hlc_stamp':
      return S.hlcStamp(i.clock, i.now, i.device, i.floor ?? undefined)
    case 'push_step':
      return S.pushStep(i.steps, i.at, i.pos)
    case 'read_position':
      return S.readPosition(i.reset, i.devs)
    case 'record_read':
      return S.recordRead(i.dev, i.reset, i.ref, i.pos, i.stamp, i.device)
    case 'make_reset':
      return S.makeReset(i.existing, i.ref, i.id, i.target, i.stamp, i.device)
    case 'reset_floor':
      return S.resetFloor(i.reset, i.devs)
    case 'read_script':
      return readScript(i.events)
    case 'rebase':
      return S.planRebase({ local: i.local, pending: i.pending, full: i.full, complete: i.complete, nowMs: i.now })
    case 'recreate':
      return S.planRecreate({ local: i.local, full: i.full, nowMs: i.now })
    case 'recreate_script':
      return recreateScript(i.events, (who, actual, want) => expect(actual, `途中の ${who}`).toEqual(want))
    case 'tomb_expired':
      return S.isTombExpired(i.tomb_at ?? undefined, i.now)
    case 'check_device_id':
      return S.checkDeviceId(i.stored, i.db)
    case 'sim_recreate':
      return simulateRecreate({ seed: i.seed, devices: i.devices, ops: i.ops, skews: i.skews }).sha256
    case 'sim':
      return simulate({ seed: i.seed, devices: i.devices, ops: i.ops, skews: i.skews, max_reads: i.max_reads, decreasing_reads: i.decreasing_reads }).sha256
    default:
      throw new Error(`知らない fn: ${i.fn}`)
  }
}

describe('sync-merge.json', () => {
  it.each(load('sync-merge.json'))('$name', (c) => {
    expect(errorCode(() => merge(c.input))).toEqual(c.expected)
  })
})
