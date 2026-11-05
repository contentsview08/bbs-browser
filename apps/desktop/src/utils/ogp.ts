// リンクの埋め込みのカードに出す情報(OGP)を、ページの HTML から読む。通信はしない純粋な関数

export interface Ogp {
  title?: string
  description?: string
  image?: string
  siteName?: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** <meta> の property / name と content を集める(属性の並び順やクォートはばらばら) */
function metaTags(html: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {}
    for (const m of tag[0].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    }
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (key && attrs.content !== undefined && !map.has(key)) map.set(key, decodeEntities(attrs.content).trim())
  }
  return map
}

export function parseOgp(html: string, pageUrl: string): Ogp {
  // head だけ見れば足りる(本文が大きいページで正規表現を回しすぎないように)
  const head = html.slice(0, 200_000)
  const meta = metaTags(head)
  const title = meta.get('og:title') || meta.get('twitter:title') || decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? '').trim()
  const description = meta.get('og:description') || meta.get('twitter:description') || meta.get('description')
  const rawImage = meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image')
  let image: string | undefined
  if (rawImage) {
    try {
      image = new URL(rawImage, pageUrl).href
    } catch {
      image = undefined
    }
  }
  return {
    title: title || undefined,
    description: description || undefined,
    image,
    siteName: meta.get('og:site_name') || undefined,
  }
}
