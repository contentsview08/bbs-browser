// 条件付きの取得。前に取った応答の ETag・Last-Modified を覚えておき、次は If-None-Match・If-Modified-Since を付けて取る。
// 変わっていなければ掲示板は 304 を返すだけで済み(スレ一覧は毎回 100KB 前後。裏の確認の大半がこれ)、こちらは覚えた本文をそのまま使う。
// 同じ URL を同時に取りに行ったときは、1 本の通信を共有する(お気に入りの確認・履歴の巡回・キーワードの見張りが重なったとき)

import type { ConnectorContext, HttpResponse } from './types'

interface Entry {
  etag?: string
  lastModified?: string
  res: HttpResponse
}

/** 覚える URL の数の上限(お気に入り板・履歴の板の数より十分多い。古いものから捨てる) */
const MAX_ENTRIES = 300
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<HttpResponse>>()

/** 試験用: 覚えたものを全部捨てる */
export function clearConditionalCache(): void {
  cache.clear()
  inflight.clear()
}

/**
 * GET。前の応答に ETag か Last-Modified があれば条件を付け、304 なら前の本文を返す(status は 200 にそろえる)。
 * 条件なしのときはふだんの GET(通信の層の短い使い回しが効く)
 */
export function getConditional(url: string, ctx: ConnectorContext): Promise<HttpResponse> {
  const running = inflight.get(url)
  if (running) return running
  const p = fetchConditional(url, ctx).finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}

async function fetchConditional(url: string, ctx: ConnectorContext): Promise<HttpResponse> {
  const prev = cache.get(url)
  const headers: Record<string, string> = {}
  if (prev?.etag) headers['If-None-Match'] = prev.etag
  if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified
  const res = await (Object.keys(headers).length > 0 ? ctx.http.get(url, { headers }) : ctx.http.get(url))
  if (res.status === 304 && prev) return prev.res
  if (res.status >= 200 && res.status < 300) {
    const etag = res.headers['etag']
    const lastModified = res.headers['last-modified']
    if (etag || lastModified) {
      // 入れ直して一番新しい位置へ(Map は入れた順なので、先頭が一番古い)
      cache.delete(url)
      cache.set(url, { etag, lastModified, res })
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
    } else cache.delete(url)
  }
  return res
}
