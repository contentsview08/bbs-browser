// 暗号文の中の JSON。同じ値は PC とスマホで同じ文字列になるように、キーを並べて書く
import { SyncError } from './errors'

export const MAX_JSON_DEPTH = 32

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

/** 深すぎる入れ子で解析や再帰が落ちないよう、解析の前に数える */
export function parseStrictJson(text: string): unknown {
  let depth = 0
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{' || c === '[') {
      if (++depth > MAX_JSON_DEPTH) throw new SyncError('bad_json')
    } else if (c === '}' || c === ']') depth--
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new SyncError('bad_json')
  }
}
