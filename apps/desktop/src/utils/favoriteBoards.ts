import type { Board } from '@bbs-browser/connectors'

// お気に入り板に入っているかの判定と、☆ を押したときの変え方。
// 行は書いた端末・板一覧の URL のまま残る(同期で来た 5ch.net と、板一覧の 5ch.io など)ので、URL の文字のままでは比べない

/**
 * 同じ板かを決める鍵。同期の normalizeBoardUrl と同じ形(ホスト[:ポート]/道/)にし、
 * http と https・5ch.net と 5ch.io・ホストの大文字・末尾の /・既定のポートの違いで別の板にしない。道の大文字は板の名前なので変えない
 */
export function favoriteKey(url: string): string {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:@]+)(?::(\d*))?([^?#]*)/i.exec(url.trim())
  if (!m) return url
  const lower = m[1].toLowerCase().replace(/\.$/, '')
  const host = lower.replace(/^((?:[a-z0-9]+\.)?)5ch\.net$/, '$15ch.io')
  const port = m[2] && m[2] !== '80' && m[2] !== '443' ? `:${m[2]}` : ''
  return `${host}${port}/${m[3]}/`.replace(/\/{2,}/g, '/')
}

export const favoriteKeys = (favorites: readonly Board[]): Set<string> => new Set(favorites.map((b) => favoriteKey(b.url)))

export const isFavoriteIn = (favorites: readonly Board[], url: string): boolean => favoriteKeys(favorites).has(favoriteKey(url))

/**
 * on は押した後の状態(見えている印の逆)。足す板(すでにあれば undefined)と消す行の URL を返す。
 * 外すときは書き方の違う行もまとめて消す(1 つ残ると、☆ なのにお気に入りに残る)
 */
export function favoriteChange(favorites: readonly Board[], board: Board, on: boolean): { add?: Board; remove: string[] } {
  const key = favoriteKey(board.url)
  const rows = favorites.filter((f) => favoriteKey(f.url) === key)
  if (on) return { add: rows.length ? undefined : { connectorId: board.connectorId, url: board.url, name: board.name }, remove: [] }
  return { remove: rows.map((f) => f.url) }
}
