// IP は数えるためだけに使う。保存するのは台帳の HMAC だけ
export interface IpKeys {
  /** v4 はそのまま、v6 は /64 */
  narrow: string
  /** v6 の /48。v4 は null */
  wide: string | null
}

function expandV6(ip: string): string[] | null {
  if (!/^[0-9a-f:.]+$/.test(ip)) return null
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  let s = ip
  if (v4Tail) {
    const p = v4Tail[1].split('.').map(Number)
    if (p.some((x) => x > 255)) return null
    s = ip.slice(0, -v4Tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const parts = s.split('::')
  if (parts.length > 2) return null
  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (parts.length === 1 ? missing !== 0 : missing < 1) return null
  const all = [...head, ...Array<string>(missing).fill('0'), ...tail]
  if (all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null
  return all.map((h) => h.padStart(4, '0'))
}

export function ipKeys(raw: string | null): IpKeys {
  const ip = (raw ?? '').trim().toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((x) => Number(x) <= 255)) return { narrow: ip, wide: null }
  const h = expandV6(ip)
  if (!h) return { narrow: 'unknown', wide: null }
  // v4 射影のアドレスは v4 として数える
  if (h.slice(0, 5).every((x) => x === '0000') && h[5] === 'ffff') {
    const a = parseInt(h[6], 16)
    const b = parseInt(h[7], 16)
    return { narrow: `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`, wide: null }
  }
  return { narrow: `${h.slice(0, 4).join(':')}::/64`, wide: `${h.slice(0, 3).join(':')}::/48` }
}
