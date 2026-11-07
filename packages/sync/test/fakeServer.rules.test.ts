// 偽サーバーの決まり。後で実物のサーバーでも同じファイルを流す。スマホ版の FakeSyncServerTest.kt も同じファイルを読む
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ticketSpaceId, toBase64Url, toHex, utf8 } from '../src/index'
import { sha256 } from '@noble/hashes/sha2.js'
import { checkFakeTicket, FakeSyncServer, fakeSpaceIdOf } from './fakeServer'

const cases: { name: string; server?: Record<string, unknown>; steps: Record<string, any>[] }[] = JSON.parse(readFileSync(new URL('../../conformance/sync-server-rules.json', import.meta.url), 'utf-8'))

const ticketFile: { cases: { name: string; space_id: string; now_ms: number; ticket: string; result: string; form: boolean }[] } = JSON.parse(readFileSync(new URL('../../conformance/sync-ticket.json', import.meta.url), 'utf-8'))

const tokenOf = (name: string) => toHex(sha256(utf8(`token:${name}`)))
const recordIdOf = (name: string) => toHex(sha256(utf8(`record:${name}`)))
const cipher = (n: number) => toBase64Url(new Uint8Array(n))
const nonce = toBase64Url(new Uint8Array(24))

function recordBody(r: Record<string, any>): Record<string, unknown> {
  return {
    record_id: recordIdOf(String(r.id)),
    base_version: r.base_version ?? 0,
    kind_tag: 'h',
    schema_version: 1,
    deleted: r.deleted ?? false,
    nonce,
    ciphertext: cipher(r.cipher_bytes ?? 272),
    ...(r.extra_key && { extra_key: true }),
  }
}

/** 期待に書いたキーだけ比べる。配列は要素ごとに比べ、長さも見る */
function subset(actual: any, want: any, path: string): void {
  if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
    for (const k of Object.keys(want)) subset(actual?.[k], want[k], `${path}.${k}`)
  } else if (Array.isArray(want)) {
    expect(actual?.length, path).toBe(want.length)
    want.forEach((w, i) => subset(actual[i], w, `${path}[${i}]`))
  } else {
    expect(actual, path).toEqual(want)
  }
}

describe('sync-server-rules.json', () => {
  it.each(cases)('$name', (c) => {
    let now = 1_800_000_000_000
    const server = new FakeSyncServer({ now: () => now, rate_per_minute: null, full_pull_per_hour: null, ...c.server })
    const send = (method: string, path: string, token: string | null, body?: string, extra: Record<string, string> = {}) =>
      server.handle({ method, path, headers: { ...(token && { Authorization: `Bearer ${tokenOf(token)}` }), ...extra }, ...(body !== undefined && { body }) })
    const tickets = new Map<string, string>()
    const requestTicket = (name: string, turnstile: string) => server.handle({ method: 'POST', path: '/tickets', body: JSON.stringify({ turnstile, space_id: fakeSpaceIdOf(tokenOf(name)) }) })
    const issued = (name: string): string => {
      if (!tickets.has(name)) tickets.set(name, JSON.parse(requestTicket(name, 'test-pass').body).ticket)
      return tickets.get(name) as string
    }
    c.steps.forEach((s, i) => {
      if (s.issue !== undefined) {
        issued(s.issue)
        return
      }
      if (s.advance_ms !== undefined) {
        // keep_alive はこの間に領域を使い続ける(tombstone の片づけだけを見るため)
        if (s.keep_alive) {
          now += s.advance_ms - 1000
          send('GET', '/head', s.keep_alive)
          now += 1000
        } else now += s.advance_ms
        return
      }
      if (s.inject !== undefined) {
        const id = fakeSpaceIdOf(tokenOf(s.inject))
        for (let n = 0; n < s.count; n++) server.injectRecord(id, { record_id: recordIdOf(`inj${n}`), kind_tag: 'h', schema_version: 1, deleted: false, nonce, ciphertext: cipher(272) })
        return
      }
      let res
      if (s.request_ticket !== undefined) res = requestTicket(s.request_ticket, s.turnstile)
      else if (s.push !== undefined) {
        const records = s.repeat_records !== undefined ? Array.from({ length: s.repeat_records }, (_, n) => recordBody({ id: n })) : s.records.map(recordBody)
        res = send('POST', '/records', s.push, JSON.stringify({ request_id: s.request_id, records }))
      } else {
        const extra: Record<string, string> = {}
        if (s.raw_auth) extra.Authorization = s.raw_auth
        if (s.if_none_match) extra['If-None-Match'] = s.if_none_match
        let body = s.body
        if (s.method === 'POST' && s.path === '/spaces' && body === undefined) {
          const ticket = s.ticket !== undefined ? issued(s.ticket) : s.ticket_tampered !== undefined ? issued(s.ticket_tampered).replace(/.$/, (c) => (c === 'A' ? 'E' : 'A')) : s.ticket_raw
          body = JSON.stringify(ticket === undefined ? {} : { ticket })
        }
        res = send(s.method, s.path, s.token ?? null, body, extra)
      }
      const e = s.expect
      if (!e) return
      expect(res.status, `手順 ${i} の status`).toBe(e.status)
      if (e.etag) expect(res.headers.ETag).toBe(e.etag)
      const parsed = res.body === '' ? null : JSON.parse(res.body)
      if (e.body) subset(parsed, e.body, 'body')
      if (e.record_versions) expect(parsed.records.map((r: { version: number }) => r.version)).toEqual(e.record_versions)
      if (e.record_count !== undefined) expect(parsed.records.length).toBe(e.record_count)
    })
  })
})

describe('sync-ticket.json', () => {
  it.each(ticketFile.cases)('$name', (c) => {
    expect(checkFakeTicket(c.space_id, c.now_ms, c.ticket)).toBe(c.result)
    expect(ticketSpaceId(c.ticket) !== null).toBe(c.form)
  })
})
