// 入口。順番はメソッド → パス → Content-Length → レート制限 → 認証 → 本文 → スキーマ(docs/sync-security.md)
import { handleAdmin } from './admin/admin'
import { loadConfig, type Config, type Env } from './config'
import { fromHex, sha256, toHex } from './encoding'
import { fail, jsonText, logLine, notFound, result, toResponse, type ApiResult } from './http'
import { ipKeys } from './ip'
import { issuePow, verifyPow } from './pow'
import { runtime } from './runtime'
import { verifyTurnstile } from './turnstile'
import { BadInput, checkCreate, checkPush, parseSince, parseStrict } from './validate'

export { LedgerDO } from './ledger'
export { SpaceDO } from './space'

const KNOWN: Record<string, string[]> = { '/spaces': ['POST'], '/changes': ['GET'], '/records': ['POST'], '/head': ['GET'], '/space': ['GET', 'DELETE'] }
const TOKEN = /^Bearer ([0-9a-f]{64})$/

class BodyError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

/** 宣言の長さを信用せず、読みながら数える */
async function readBody(req: Request, declared: number): Promise<string> {
  const body = req.body
  if (!body) {
    if (declared !== 0) throw new BodyError(400, 'bad_request')
    return ''
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > declared) {
        await reader.cancel()
        throw new BodyError(413, 'too_large')
      }
      chunks.push(value)
    }
  } catch (e) {
    if (e instanceof BodyError) throw e
    throw new BodyError(400, 'bad_request')
  }
  if (total !== declared) throw new BodyError(400, 'bad_request')
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(out)
  } catch {
    throw new BodyError(400, 'bad_request')
  }
}

async function overLimit(binding: RateLimit | undefined, key: string): Promise<boolean> {
  if (!binding) return false
  try {
    return !(await binding.limit({ key })).success
  } catch {
    // 数える仕組みの障害で同期を止めない。領域ごとの回数は Durable Object が数える
    return false
  }
}

async function createSpace(body: string, spaceId: string, ip: string, env: Env, cfg: Config, host: string): Promise<ApiResult> {
  if (await overLimit(env.RL_CREATE, ip)) return { status: 429, body: JSON.stringify({ error: 'rate_limited' }) }
  const input = checkCreate(parseStrict(body))
  if (cfg.powBits > 0) {
    if (!env.POW_SECRET) return { status: 503, body: JSON.stringify({ error: 'unavailable' }) }
    if (!input.pow) {
      const challenge = await issuePow(env.POW_SECRET, spaceId, cfg.powBits, runtime.now(), cfg.powTtlSec)
      return result(403, { error: 'pow_required', pow: { challenge, bits: cfg.powBits } })
    }
    if (!(await verifyPow(env.POW_SECRET, spaceId, cfg.powBits, runtime.now(), input.pow.challenge, input.pow.nonce))) return result(403, { error: 'pow_invalid' })
  }
  if (env.TURNSTILE_SECRET) {
    if (!input.turnstile) return result(403, { error: 'turnstile_required' })
    const v = await verifyTurnstile(env.TURNSTILE_SECRET, input.turnstile, { ...cfg, turnstileHostname: cfg.turnstileHostname || host })
    // 検証サービスの障害では作成だけを止める。既存の同期は通らない経路なので動き続ける
    if (v === 'unavailable') return result(503, { error: 'turnstile_unavailable' })
    if (v === 'invalid') return result(403, { error: 'turnstile_invalid' })
  }
  const stub = env.SPACE.getByName(spaceId)
  const cur = await stub.existing()
  if (cur) return result(200, { epoch: cur.epoch, created: false })
  const ledger = env.LEDGER.getByName('ledger')
  const r = await ledger.reserve(spaceId, ip)
  if (!r.ok) return result(403, { error: r.error })
  let made: { epoch: string; created: boolean }
  try {
    made = await stub.create(spaceId)
  } catch (e) {
    await ledger.cancel(spaceId).catch(() => undefined)
    throw e
  }
  await ledger.confirm(spaceId, made.epoch)
  return result(made.created ? 201 : 200, { epoch: made.epoch, created: made.created })
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const cfg = loadConfig(env)
  const path = url.pathname
  if (cfg.allowedHosts.length > 0 && !cfg.allowedHosts.includes(url.hostname.toLowerCase())) return notFound()
  if (path === '/admin' || path.startsWith('/admin/')) return await handleAdmin(req, url, env, cfg)
  const methods = Object.hasOwn(KNOWN, path) ? KNOWN[path] : undefined
  if (!methods) return notFound()
  if (!methods.includes(req.method)) return fail(405, 'method_not_allowed')
  // リダイレクトしない。端末は 3xx をたどらず、トークンを http で送らせ続けないため
  if (cfg.requireHttps && url.protocol !== 'https:') return fail(400, 'https_required')

  let declared = 0
  const rawLength = req.headers.get('Content-Length')
  if (req.method === 'POST') {
    if (rawLength === null || !/^[0-9]{1,12}$/.test(rawLength) || Number(rawLength) > cfg.maxBodyBytes) return fail(413, 'too_large')
    declared = Number(rawLength)
  } else if (rawLength !== null && rawLength !== '0') {
    return Number(rawLength) > cfg.maxBodyBytes ? fail(413, 'too_large') : fail(400, 'bad_request')
  }

  const ip = ipKeys(req.headers.get('CF-Connecting-IP'))
  if (await overLimit(env.RL_IP, ip.narrow)) return fail(429, 'rate_limited')
  if (ip.wide && (await overLimit(env.RL_WIDE, ip.wide))) return fail(429, 'rate_limited')

  const m = TOKEN.exec(req.headers.get('Authorization') ?? '')
  if (!m) {
    if (await overLimit(env.RL_AUTH, ip.narrow)) return fail(429, 'rate_limited')
    return fail(401, 'unauthorized')
  }
  const spaceId = toHex(await sha256(fromHex(m[1])))

  const isWrite = req.method !== 'GET'
  if (cfg.readOnly && isWrite) return fail(503, 'read_only')

  if (req.method === 'POST') {
    // 圧縮された本文は展開しない。展開後の大きさを数えられないため
    const encoding = req.headers.get('Content-Encoding')
    if (encoding !== null && encoding.toLowerCase() !== 'identity') return fail(415, 'unsupported_media_type')
    const type = (req.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') return fail(415, 'unsupported_media_type')
  }

  let r: ApiResult
  try {
    const text = req.method === 'POST' ? await readBody(req, declared) : ''
    const stub = env.SPACE.getByName(spaceId)
    if (path === '/spaces') r = await createSpace(text, spaceId, ip.narrow, env, cfg, url.hostname)
    else if (path === '/records') r = await stub.records(checkPush(parseStrict(text), cfg))
    else if (path === '/changes') {
      const since = parseSince(url.search.slice(1))
      if (since === null) return fail(400, 'bad_request')
      r = await stub.changes(since)
    } else if (path === '/head') r = await stub.head(req.headers.get('If-None-Match'))
    else if (req.method === 'DELETE') r = await stub.remove()
    else r = await stub.usage()
  } catch (e) {
    if (e instanceof BadInput) return fail(400, 'bad_request')
    if (e instanceof BodyError) return fail(e.status, e.code)
    throw e
  }
  // 無い領域への要求も認証の失敗と同じく数える。ランダムなトークンで Durable Object を起こし続けられないように
  if (r.status === 404 && (await overLimit(env.RL_AUTH, ip.narrow))) return fail(429, 'rate_limited')
  logLine(path, r.status, r.body.length)
  return toResponse(r)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handle(req, env)
    } catch (e) {
      // 例外の文には何が入るか分からないので、種類だけを残す
      console.error(JSON.stringify({ error: e instanceof Error ? e.name : 'unknown' }))
      return jsonText(500, JSON.stringify({ error: 'internal' }))
    }
  },
} satisfies ExportedHandler<Env>
