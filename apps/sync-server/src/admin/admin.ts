// 管理 API の入口。署名を確かめ、台帳へ渡す。失敗はどれも定義のないパスと同じ 404
import type { Config, Env } from '../config'
import { fromBase64Url, sha256, toHex, utf8 } from '../encoding'
import { logLine, notFound, toResponse } from '../http'
import { ipKeys } from '../ip'
import { runtime } from '../runtime'
import { isObject, parseStrict } from '../validate'
import { ADMIN_HEADER, signingString } from './canonical.mjs'

const HEX64 = '[0-9a-f]{64}'

interface Route {
  method: string
  pattern: RegExp
  action: string
}

const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/admin\/v1\/spaces$/, action: 'spaces.list' },
  { method: 'POST', pattern: /^\/admin\/v1\/spaces\/delete$/, action: 'spaces.delete_many' },
  { method: 'POST', pattern: /^\/admin\/v1\/spaces\/delete-all$/, action: 'spaces.delete_all' },
  { method: 'GET', pattern: new RegExp(`^/admin/v1/spaces/(${HEX64})$`), action: 'spaces.get' },
  { method: 'DELETE', pattern: new RegExp(`^/admin/v1/spaces/(${HEX64})$`), action: 'spaces.delete' },
  { method: 'GET', pattern: /^\/admin\/v1\/jobs\/([0-9a-f-]{36})$/, action: 'jobs.get' },
  { method: 'GET', pattern: /^\/admin\/v1\/capacity$/, action: 'capacity' },
  { method: 'POST', pattern: /^\/admin\/v1\/creation$/, action: 'creation' },
  { method: 'GET', pattern: /^\/admin\/v1\/signals$/, action: 'signals' },
  { method: 'POST', pattern: /^\/admin\/v1\/sources\/block$/, action: 'sources.block' },
  { method: 'DELETE', pattern: new RegExp(`^/admin/v1/sources/block/(${HEX64})$`), action: 'sources.unblock' },
  { method: 'GET', pattern: /^\/admin\/v1\/audit$/, action: 'audit' },
]

interface Signature {
  keyId: string
  timestamp: number
  nonce: string
  sig: Uint8Array
}

function parseHeader(raw: string | null): Signature | null {
  if (!raw) return null
  const m = /^kid=([A-Za-z0-9_-]{1,64}),ts=([0-9]{1,12}),nonce=([A-Za-z0-9_-]{22,128}),sig=([A-Za-z0-9_-]{86})$/.exec(raw)
  if (!m) return null
  const sig = fromBase64Url(m[4])
  if (!sig || sig.length !== 64) return null
  return { keyId: m[1], timestamp: Number(m[2]), nonce: m[3], sig }
}

function adminKey(env: Env, keyId: string): Uint8Array | null {
  const raw = (runtime.overrides?.ADMIN_KEYS ?? env.ADMIN_KEYS) as string | undefined
  if (!raw) return null
  try {
    const keys: unknown = JSON.parse(raw)
    if (!isObject(keys) || !Object.hasOwn(keys, keyId)) return null
    const v = keys[keyId]
    if (typeof v !== 'string') return null
    const b = fromBase64Url(v)
    return b && b.length === 32 ? b : null
  } catch {
    return null
  }
}

async function readAdminBody(req: Request, cfg: Config): Promise<Uint8Array | null> {
  const declared = req.headers.get('Content-Length')
  if (req.method !== 'POST') {
    if (declared !== null && declared !== '0') return null
    return new Uint8Array(0)
  }
  if (declared === null || !/^[0-9]{1,9}$/.test(declared) || Number(declared) > cfg.adminMaxBodyBytes) return null
  if (req.headers.has('Content-Encoding')) return null
  const buf = new Uint8Array(await req.arrayBuffer())
  return buf.length > cfg.adminMaxBodyBytes ? null : buf
}

export async function handleAdmin(req: Request, url: URL, env: Env, cfg: Config): Promise<Response> {
  if (cfg.requireHttps && url.protocol !== 'https:') return notFound()
  const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(url.pathname))
  if (env.RL_ADMIN) {
    const { success } = await env.RL_ADMIN.limit({ key: ipKeys(req.headers.get('CF-Connecting-IP')).narrow })
    if (!success) return notFound()
  }
  const sig = parseHeader(req.headers.get(ADMIN_HEADER))
  if (!sig || !route) return notFound()
  // 署名の検証より先に時刻と鍵を確かめる
  if (Math.abs(sig.timestamp - Math.floor(runtime.now() / 1000)) > cfg.adminSkewSec) return notFound()
  const pub = adminKey(env, sig.keyId)
  if (!pub) return notFound()
  let body: Uint8Array | null
  try {
    body = await readAdminBody(req, cfg)
  } catch {
    return notFound()
  }
  if (!body) return notFound()
  const text = signingString({
    method: req.method,
    host: url.host,
    path: url.pathname,
    query: url.search,
    bodySha256: toHex(await sha256(body)),
    timestamp: sig.timestamp,
    nonce: sig.nonce,
    keyId: sig.keyId,
  })
  let ok = false
  try {
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify'])
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig.sig, utf8(text))
  } catch {
    ok = false
  }
  if (!ok) return notFound()
  let parsed: unknown = null
  if (req.method === 'POST') {
    try {
      parsed = parseStrict(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body))
    } catch {
      parsed = null
    }
  }
  const param = route.pattern.exec(url.pathname)?.[1] ?? ''
  const out = await env.LEDGER.getByName('ledger').admin({
    keyId: sig.keyId,
    nonce: sig.nonce,
    action: route.action,
    param,
    query: Object.fromEntries(url.searchParams),
    body: parsed as never,
  })
  if (!out) return notFound()
  logLine(`admin.${route.action}`, out.status)
  return toResponse(out)
}
