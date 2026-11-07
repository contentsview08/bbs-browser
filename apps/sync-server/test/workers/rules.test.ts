// 偽サーバーと同じ決まりのファイルを本物のサーバーへ当てる
import { runInDurableObject } from 'cloudflare:test'
import rulesJson from '../../../../packages/conformance/sync-server-rules.json'
import { afterEach, describe, expect, it } from 'vitest'
import { advance, call, cipher, NONCE, recordIdOf, setup, spaceIdOf, spaceStub, teardown } from './support'

type Step = Record<string, any>
const cases = rulesJson as unknown as { name: string; server?: Record<string, unknown>; steps: Step[] }[]


function overrides(server: Record<string, unknown> = {}): Record<string, string> {
  const map: Record<string, string> = { space_limit: 'SPACE_LIMIT', quota_bytes: 'QUOTA_BYTES', quota_records: 'QUOTA_RECORDS', rate_per_minute: 'RATE_PER_MINUTE', full_pull_per_hour: 'FULL_PULL_PER_HOUR', evict_idle_days: 'EVICT_IDLE_DAYS', idle_delete_days: 'IDLE_DELETE_DAYS', ticket_ttl_days: 'TICKET_TTL_DAYS', pow_bits: 'POW_BITS' }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(server)) {
    if (k === 'creation_closed') out.CREATION_CLOSED = v ? '1' : '0'
    else if (map[k]) out[map[k]] = v === null ? '0' : String(v)
  }
  return out
}

async function recordBody(r: Record<string, any>) {
  return {
    record_id: await recordIdOf(String(r.id)),
    base_version: r.base_version ?? 0,
    kind_tag: 'h',
    schema_version: 1,
    deleted: r.deleted ?? false,
    nonce: NONCE,
    ciphertext: cipher(r.cipher_bytes ?? 272),
    ...(r.extra_key && { extra_key: true }),
  }
}

/** 期待に書いたキーだけ比べる。epoch はランダムなので、現れた順に e1・e2 と読み替える */
function subset(actual: any, want: any, path: string, epochs: Map<string, string>): void {
  if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
    for (const k of Object.keys(want)) subset(actual?.[k], want[k], `${path}.${k}`, epochs)
  } else if (Array.isArray(want)) {
    expect(actual?.length, path).toBe(want.length)
    want.forEach((w, i) => subset(actual[i], w, `${path}[${i}]`, epochs))
  } else if (path.endsWith('.epoch')) {
    expect(epochs.get(actual), path).toBe(want)
  } else {
    expect(actual, path).toEqual(want)
  }
}

function noteEpochs(v: any, epochs: Map<string, string>): void {
  if (typeof v?.epoch === 'string' && !epochs.has(v.epoch)) epochs.set(v.epoch, `e${epochs.size + 1}`)
}

async function injectMany(token: string, count: number): Promise<void> {
  const id = await spaceIdOf(token)
  const ids: string[] = []
  for (let n = 0; n < count; n++) ids.push(await recordIdOf(`inj${n}`))
  await runInDurableObject(spaceStub(id) as unknown as DurableObjectStub, (_o, state) => {
    state.storage.transactionSync(() => {
      ids.forEach((rid, n) => state.storage.sql.exec("INSERT INTO records (record_id, version, kind_tag, schema_version, deleted, nonce, ciphertext, updated_at) VALUES (?, ?, 'h', 1, 0, ?, ?, 0)", rid, n + 1, NONCE, cipher(272)))
      state.storage.sql.exec('UPDATE meta SET next = ?, record_count = ?, ever_written = 1 WHERE id = 1', ids.length, ids.length)
    })
  })
}

describe('sync-server-rules.json', () => {
  afterEach(teardown)
  it.each(cases)('$name', async (c) => {
    setup(overrides(c.server))
    const epochs = new Map<string, string>()
    const seen = new Set<string>()
    const remember = async (t: unknown) => {
      if (typeof t === 'string') seen.add(await spaceIdOf(t))
    }
    const tickets = new Map<string, string>()
    const requestTicket = async (name: string, turnstile: string) => await call('POST', '/tickets', { body: JSON.stringify({ turnstile, space_id: await spaceIdOf(name) }) })
    const issued = async (name: string): Promise<string> => {
      if (!tickets.has(name)) tickets.set(name, ((await (await requestTicket(name, 'test-pass')).json()) as { ticket: string }).ticket)
      return tickets.get(name) as string
    }
    for (const [i, s] of c.steps.entries()) {
      if (s.issue !== undefined) {
        await issued(s.issue)
        continue
      }
      if (s.advance_ms !== undefined) {
        // keep_alive はこの間に領域を使い続ける(tombstone の片づけだけを見るため)
        if (s.keep_alive) {
          await advance(s.advance_ms - 1000, [...seen])
          await call('GET', '/head', { token: s.keep_alive })
          await advance(1000, [...seen])
        } else await advance(s.advance_ms, [...seen])
        continue
      }
      if (s.inject !== undefined) {
        await injectMany(s.inject, s.count)
        continue
      }
      await remember(s.push ?? s.token)
      let res: Response
      if (s.request_ticket !== undefined) res = await requestTicket(s.request_ticket, s.turnstile)
      else if (s.push !== undefined) {
        const records = s.repeat_records !== undefined ? await Promise.all(Array.from({ length: s.repeat_records }, (_, n) => recordBody({ id: n }))) : await Promise.all(s.records.map(recordBody))
        res = await call('POST', '/records', { token: s.push, body: JSON.stringify({ request_id: s.request_id, records }) })
      } else {
        const headers: Record<string, string> = {}
        // 実際の端末は ETag の epoch を覚えて送る
        if (s.if_none_match) {
          const real = [...epochs].find(([, alias]) => s.if_none_match.includes(alias))?.[0] as string
          headers['If-None-Match'] = `"${real}:${/:(\d+)"/.exec(s.if_none_match)?.[1]}"`
        }
        let body = s.body
        if (s.method === 'POST' && s.path === '/spaces' && body === undefined) {
          const ticket = s.ticket !== undefined ? await issued(s.ticket) : s.ticket_tampered !== undefined ? (await issued(s.ticket_tampered)).replace(/.$/, (x) => (x === 'A' ? 'E' : 'A')) : s.ticket_raw
          body = JSON.stringify(ticket === undefined ? {} : { ticket })
        }
        res = await call(s.method, s.path, { ...(s.raw_auth ? { auth: s.raw_auth } : s.token ? { token: s.token } : {}), ...(body !== undefined && { body }), headers })
      }
      const text = await res.text()
      const parsed = text === '' ? null : JSON.parse(text)
      noteEpochs(parsed, epochs)
      const e = s.expect
      if (!e) continue
      expect(res.status, `手順 ${i} の status`).toBe(e.status)
      if (e.etag) expect(res.headers.get('ETag')).toBe(`"${[...epochs].find(([, a]) => e.etag.includes(a))?.[0]}:${/:(\d+)"/.exec(e.etag)?.[1]}"`)
      if (e.body) subset(parsed, e.body, 'body', epochs)
      if (e.record_versions) expect(parsed.records.map((r: { version: number }) => r.version)).toEqual(e.record_versions)
      if (e.record_count !== undefined) expect(parsed.records.length).toBe(e.record_count)
    }
  })
})
