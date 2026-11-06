// 本文・ヘッダー・パスをランダムに崩して、500 が出ないこと。シードを固定して再現できるようにする
import { afterEach, describe, expect, it } from 'vitest'
import { call, freshIp, push, record, requestId, setup, teardown, tokenOf } from './support'

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

const SEEDS = [1, 7, 42]
const ROUNDS = 150
const PATHS = ['/spaces', '/changes', '/changes?since=0', '/changes?since=-1', '/changes?since=1e9&x=1', '/records', '/head', '/space', '/', '//', '/spaces/', '/SPACES', '/records?x', '/admin', '/admin/v1', '/admin/v1/spaces', `/admin/v1/spaces/${'a'.repeat(64)}`, '/admin/v1/spaces/delete-all', '/admin/v1/audit?limit=x', '/%2e%2e/head', '/head%00', '/constructor', '/__proto__', '/hasOwnProperty']
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
const JUNK = ['', '{', '[]', 'null', '0', '"x"', '{"__proto__":{"x":1}}', '{"constructor":1}', '{"request_id":null,"records":null}', '\u0000', '😀', '{"pow":{"challenge":"v1.x.y.z.w","nonce":"a"}}', '{"records":[{}],"request_id":"aaaaaaaaaaaaaaaaaaaaaa"}']

describe('ファズ', () => {
  afterEach(teardown)
  it.each(SEEDS)('シード %i', async (seed) => {
    setup()
    const r = rng(seed)
    const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]
    await call('POST', '/spaces', { token: 'F' })
    const valid = await record('v')
    const tok = await tokenOf('F')
    for (let i = 0; i < ROUNDS; i++) {
      const method = pick(METHODS)
      const path = pick(PATHS)
      const kind = r()
      let body: string | undefined
      if (method !== 'GET' && method !== 'HEAD' && r() < 0.8) {
        if (kind < 0.4) body = pick(JUNK)
        else if (kind < 0.8) {
          // 正しい本文の 1 文字を変える
          const base = JSON.stringify({ request_id: requestId(), records: [valid] })
          const at = Math.floor(r() * base.length)
          body = base.slice(0, at) + String.fromCharCode(Math.floor(r() * 128)) + base.slice(at + 1)
        } else body = 'x'.repeat(Math.floor(r() * 4096))
      }
      const headers: Record<string, string> = {}
      if (r() < 0.3) headers['Content-Type'] = pick(['text/plain', 'application/json;;', '', 'APPLICATION/JSON'])
      if (r() < 0.1) headers['If-None-Match'] = pick(['*', '"x"', ''])
      if (r() < 0.1) headers['X-OBB-Admin'] = pick(['', 'kid=a,ts=1,nonce=b,sig=c', 'x'.repeat(2000)])
      if (r() < 0.1) headers['Content-Encoding'] = pick(['gzip', 'identity', 'x'])
      const auth = r() < 0.6 ? `Bearer ${tok}` : pick(['', 'Bearer', 'Bearer  ', `Bearer ${tok}x`, 'Basic e30=', '\t'])
      const res = await call(method, path, { auth, ...(body !== undefined && { body }), headers, ip: pick([freshIp(), '', 'not-an-ip', '::1', '1:2:3:4:5:6:7:8:9']) })
      expect(res.status, `${seed}/${i}: ${method} ${path}`).toBeLessThan(500)
      const text = await res.text()
      if (text !== '') {
        const v = JSON.parse(text) as { error?: string }
        if (res.status >= 400) expect(typeof v.error).toBe('string')
      }
    }
    // 崩れた要求の後も普通に動く
    await call('POST', '/spaces', { token: 'F' })
    expect((await push('F', [await record('after', { base_version: 0 })])).status).toBe(200)
  })
})
