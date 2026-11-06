// 署名する文の組み立て。サーバーと CLI で同じものを使う
export const ADMIN_HEADER = 'X-OBB-Admin'

/** クエリは生の文字列のまま並べる。復号すると同じ意味の別表記が同じ署名を通るため */
export function sortQuery(search) {
  const s = search.startsWith('?') ? search.slice(1) : search
  return s.split('&').filter(Boolean).sort().join('&')
}

export function signingString({ method, host, path, query, bodySha256, timestamp, nonce, keyId }) {
  return ['obb-sync-admin-v1', method, host, path, sortQuery(query), bodySha256, String(timestamp), nonce, keyId].join('\n')
}

export function formatHeader({ keyId, timestamp, nonce, signature }) {
  return `kid=${keyId},ts=${timestamp},nonce=${nonce},sig=${signature}`
}
