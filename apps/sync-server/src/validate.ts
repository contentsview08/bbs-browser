// 入力の検査。ここを通った値だけが Durable Object へ渡る
import type { Config } from './config'
import { base64UrlBytes } from './encoding'

const MAX_DEPTH = 8
const RECORD_KEYS = ['base_version', 'ciphertext', 'deleted', 'kind_tag', 'nonce', 'record_id', 'schema_version'].join()

export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export class BadInput extends Error {}

/** JSON.parse は重複したキーを黙って後勝ちにし、深さも見ないので、解析の前に数える */
export function parseStrict(text: string): unknown {
  const stack: (Set<string> | null)[] = []
  let expectKey = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      let end = i + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      if (end >= text.length) throw new BadInput()
      const seen = stack[stack.length - 1]
      if (expectKey && seen) {
        let key: unknown
        try {
          key = JSON.parse(text.slice(i, end + 1))
        } catch {
          throw new BadInput()
        }
        if (seen.has(key as string)) throw new BadInput()
        seen.add(key as string)
        expectKey = false
      }
      i = end
    } else if (c === '{' || c === '[') {
      if (stack.length >= MAX_DEPTH) throw new BadInput()
      stack.push(c === '{' ? new Set() : null)
      expectKey = c === '{'
    } else if (c === '}' || c === ']') {
      stack.pop()
      expectKey = false
    } else if (c === ',') {
      expectKey = stack[stack.length - 1] !== null && stack.length > 0
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new BadInput()
  }
}

export interface InputRecord {
  record_id: string
  base_version: number
  kind_tag: 'h' | 's'
  schema_version: number
  deleted: boolean
  nonce: string
  ciphertext: string
}

export interface PushInput {
  request_id: string
  records: InputRecord[]
}

function validRecord(v: unknown, cfg: Config): v is InputRecord {
  if (!isObject(v)) return false
  if (Object.keys(v).sort().join() !== RECORD_KEYS) return false
  if (typeof v.record_id !== 'string' || !/^[0-9a-f]{64}$/.test(v.record_id)) return false
  if (!isCount(v.base_version) || !isCount(v.schema_version) || typeof v.deleted !== 'boolean') return false
  if (v.kind_tag !== 'h' && v.kind_tag !== 's') return false
  if (typeof v.nonce !== 'string' || base64UrlBytes(v.nonce) !== 24) return false
  if (typeof v.ciphertext !== 'string') return false
  const n = base64UrlBytes(v.ciphertext)
  return n >= 272 && n <= cfg.maxCiphertextBytes && (n - 16) % 256 === 0
}

export function checkPush(body: unknown, cfg: Config): PushInput {
  if (!isObject(body) || Object.keys(body).sort().join() !== 'records,request_id') throw new BadInput()
  if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.request_id)) throw new BadInput()
  const list = body.records
  if (!Array.isArray(list) || list.length === 0 || list.length > cfg.maxPushRecords) throw new BadInput()
  for (const r of list) if (!validRecord(r, cfg)) throw new BadInput()
  return { request_id: body.request_id, records: list as InputRecord[] }
}

export interface CreateInput {
  pow?: { challenge: string; nonce: string }
  ticket?: string
}

export function checkCreate(body: unknown): CreateInput {
  if (!isObject(body)) throw new BadInput()
  for (const k of Object.keys(body)) if (k !== 'pow' && k !== 'ticket') throw new BadInput()
  const out: CreateInput = {}
  if (body.pow !== undefined) {
    const p = body.pow
    if (!isObject(p) || Object.keys(p).sort().join() !== 'challenge,nonce') throw new BadInput()
    if (typeof p.challenge !== 'string' || p.challenge.length > 512) throw new BadInput()
    if (typeof p.nonce !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.nonce)) throw new BadInput()
    out.pow = { challenge: p.challenge, nonce: p.nonce }
  }
  if (body.ticket !== undefined) {
    if (typeof body.ticket !== 'string' || body.ticket.length === 0 || body.ticket.length > 256) throw new BadInput()
    out.ticket = body.ticket
  }
  return out
}

export interface TicketInput {
  turnstile: string
  space_id: string
}

export function checkTicketRequest(body: unknown): TicketInput {
  if (!isObject(body) || Object.keys(body).sort().join() !== 'space_id,turnstile') throw new BadInput()
  // トークンの長さの上限は Turnstile の文書のとおり
  if (typeof body.turnstile !== 'string' || body.turnstile.length === 0 || body.turnstile.length > 2048) throw new BadInput()
  if (typeof body.space_id !== 'string' || !/^[0-9a-f]{64}$/.test(body.space_id)) throw new BadInput()
  return { turnstile: body.turnstile, space_id: body.space_id }
}

/** Number で読むと巨大な値が丸まるので、桁の形で先に確かめる */
export function parseSince(query: string): number | null {
  const m = /^since=(0|[1-9][0-9]{0,15})$/.exec(query)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) ? n : null
}
