// サイトの見分け(主ドメイン)。決まりは packages/conformance/site-domain.json。スマホ版は bbs/SiteDomain.kt

/**
 * 最後の 2 段までが誰でも取れる場所のもの。この下の 1 段までをサイトとする。
 * Public Suffix の全表は持たない小さな表なので、ここにない地域型(tokyo.jp など)は 2 段で切り、別のサイトが 1 つにまとまる
 */
const SHARED_SUFFIXES = new Set([
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'co.kr', 'or.kr', 'com.cn', 'net.cn', 'org.cn', 'com.tw', 'net.tw', 'org.tw', 'com.br', 'co.in',
  'github.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'web.app',
])

/** 移転して同じサイトになったもの */
const SAME_SITE: Record<string, string> = { '5ch.net': '5ch.io' }

/** URL の主ドメイン(サブドメインを除く)。読めなければ空。IP アドレスはそのまま */
export function siteDomain(url: string): string {
  const s = url.trim()
  const scheme = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.exec(s)
  const rest = scheme ? s.slice(scheme[0].length) : s
  const authority = rest.split(/[/?#\\]/, 1)[0]
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1).toLowerCase()
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']')
    return end > 0 ? hostPort.slice(0, end + 1) : ''
  }
  const host = hostPort.replace(/:\d*$/, '').replace(/\.+$/, '')
  if (!/^[\p{L}\p{N}._-]+$/u.test(host)) return ''
  if (!host.includes('.')) return scheme ? host : ''
  if (/^[\d.]+$/.test(host)) return host
  const labels = host.split('.')
  const lastTwo = labels.slice(-2).join('.')
  const domain = SHARED_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
  return SAME_SITE[domain] ?? domain
}

/** URL の並びから、主ドメインを 1 つずつ(最初に出た順)。読めない URL は除く */
export function uniqueSiteDomains(urls: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const u of urls) {
    const d = siteDomain(u)
    if (d) out.add(d)
  }
  return [...out]
}
