// 応答はここだけで作る。CORS のヘッダーと内部の情報を出さないため
const BASE: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
}

export function jsonText(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...BASE, 'Content-Type': 'application/json', ...extra } })
}

export const fail = (status: number, error: string): Response => jsonText(status, JSON.stringify({ error }))

/** 定義のないパスと管理 API の失敗で同じ応答にする */
export const notFound = (): Response => fail(404, 'not_found')

export const notModified = (etag: string): Response => new Response(null, { status: 304, headers: { ...BASE, ETag: etag } })

/** Durable Object から Worker へ返す形。本文は JSON の文字列のまま渡す */
export interface ApiResult {
  status: number
  body: string
  etag?: string
}

export const result = (status: number, value: unknown, etag?: string): ApiResult => ({ status, body: JSON.stringify(value), ...(etag && { etag }) })
export const failure = (status: number, error: string): ApiResult => result(status, { error })

export function toResponse(r: ApiResult): Response {
  if (r.status === 304) return notModified(r.etag ?? '')
  return jsonText(r.status, r.body, r.etag ? { ETag: r.etag } : {})
}

/** 種類と状態だけを残す。トークン・IP・space_id を渡さない */
export function logLine(route: string, status: number, bytes = 0): void {
  console.log(JSON.stringify({ route, status, bytes }))
}
