// 同梱をやめた Web フォント(Noto Sans JP・BIZ UDPゴシック など)を、設定で選んだときだけ jsDelivr の fontsource から読む。
// 2026-11-05 まで @fontsource を同梱していて、インストーラーが大きくなっていた(dist の assets が 150MB。ほぼフォント)。
// 既定の「Windows 標準」は OS のフォントなので、何も取りに行かない。つながらなければ、CSS の後ろの OS のフォントで出る。
// CSS が参照する字のファイルは CSS と同じ CDN から読む(tauri.conf.json の CSP で style-src・font-src に cdn.jsdelivr.net を許している)
const CDN = 'https://cdn.jsdelivr.net/npm'

/** 設定のキー(ui/settings.ts の FONT_FAMILIES)→ 読む CSS */
const CSS: Record<string, string[]> = {
  noto: [`${CDN}/@fontsource-variable/noto-sans-jp@5/index.css`],
  'biz-ud': [`${CDN}/@fontsource/biz-udpgothic@5/400.css`, `${CDN}/@fontsource/biz-udpgothic@5/700.css`],
  'm-plus-1p': [`${CDN}/@fontsource/m-plus-1p@5/400.css`, `${CDN}/@fontsource/m-plus-1p@5/700.css`],
  'm-plus-2': [`${CDN}/@fontsource-variable/m-plus-2@5/index.css`],
  'zen-kaku': [`${CDN}/@fontsource/zen-kaku-gothic-new@5/400.css`, `${CDN}/@fontsource/zen-kaku-gothic-new@5/700.css`],
  'ibm-plex': [`${CDN}/@fontsource/ibm-plex-sans-jp@5/400.css`, `${CDN}/@fontsource/ibm-plex-sans-jp@5/700.css`],
  murecho: [`${CDN}/@fontsource-variable/murecho@5/index.css`],
  sawarabi: [`${CDN}/@fontsource/sawarabi-gothic@5/400.css`],
  'm-plus-rounded': [`${CDN}/@fontsource/m-plus-rounded-1c@5/400.css`, `${CDN}/@fontsource/m-plus-rounded-1c@5/700.css`],
  'zen-maru': [`${CDN}/@fontsource/zen-maru-gothic@5/400.css`, `${CDN}/@fontsource/zen-maru-gothic@5/700.css`],
  'kosugi-maru': [`${CDN}/@fontsource/kosugi-maru@5/400.css`],
  'noto-serif': [`${CDN}/@fontsource-variable/noto-serif-jp@5/index.css`],
  'biz-ud-mincho': [`${CDN}/@fontsource/biz-udpmincho@5/400.css`, `${CDN}/@fontsource/biz-udpmincho@5/700.css`],
  'shippori-mincho': [`${CDN}/@fontsource/shippori-mincho@5/400.css`, `${CDN}/@fontsource/shippori-mincho@5/700.css`],
  'zen-old-mincho': [`${CDN}/@fontsource/zen-old-mincho@5/400.css`, `${CDN}/@fontsource/zen-old-mincho@5/700.css`],
}

const loaded = new Set<string>()

/** 選んだフォントの CSS を(まだなら)読み込む。同梱・OS のフォント(system)なら何もしない */
export function ensureFont(key: string): void {
  const urls = CSS[key]
  if (!urls || loaded.has(key) || typeof document === 'undefined') return
  loaded.add(key)
  for (const href of urls) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }
}
