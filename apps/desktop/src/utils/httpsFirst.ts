// http の URL も先に https で取りに行き、取れなければ書いてあるとおり http に戻す。
// 掲示板に書かれる URL は http のままでも、今のサーバーは https だけのことが多い。https と書いてある URL は http に戻さない。スマホ版の data/HttpsFirst.kt と同じ考え方

/** https で届かなかったホスト(毎回つながるのを待たない) */
const httpOnlyHosts = new Set<string>()
const fallbacks = new Map<string, string>()
const MAX_FALLBACKS = 5000

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** http の URL の https 版。http でない・https で届かないと分かっているホストは undefined */
export function toHttps(url: string): string | undefined {
  if (!/^http:\/\//i.test(url)) return undefined
  const host = hostOf(url)
  if (!host || httpOnlyHosts.has(host)) return undefined
  return `https://${url.slice('http://'.length)}`
}

/**
 * 通信を https から試す。例外か ok が false なら、http で取り直す。
 * 例外のときはそのホストを覚え、次から http で直接つなぐ
 */
export async function fetchHttpsFirst<T>(url: string, send: (url: string) => Promise<T>, ok: (res: T) => boolean): Promise<T> {
  const https = toHttps(url)
  if (!https) return send(url)
  try {
    const res = await send(https)
    if (ok(res)) return res
  } catch {
    const host = hostOf(url)
    if (host) httpOnlyHosts.add(host)
  }
  return send(url)
}

/** <img>・<video> の src。読めなかったら、下の見張りが http に戻す */
export function mediaSrc(url: string): string
export function mediaSrc(url: string | undefined): string | undefined
export function mediaSrc(url: string | undefined): string | undefined {
  if (!url) return url
  const https = toHttps(url)
  if (!https) return url
  if (fallbacks.size >= MAX_FALLBACKS) fallbacks.clear()
  fallbacks.set(https, url)
  return https
}

// error は親へ伝わらないので、画面全体を capture で見張る。戻すときは、部品の「読めなかった」の処理まで届かせない
if (typeof document !== 'undefined') {
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target
      if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) return
      const original = fallbacks.get(el.getAttribute('src') ?? '')
      if (!original) return
      e.stopPropagation()
      el.src = original
    },
    true,
  )
}
