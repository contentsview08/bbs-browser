// スレとレスの共有。投稿は外部サイトの共有画面を開くだけで、アプリからは送らない

export interface ShareItem {
  id: string
  label: string
  icon: string
  onClick: () => void
}

/** レスの番号付きの URL。番号で開けない掲示板(ふたばなど)はスレの URL のまま */
export function postWebUrl(threadUrl: string, no: number): string {
  const path = threadUrl.split(/[?#]/)[0]
  if (!/\/read\.cgi\//.test(path) && !/\/boards\/[^/]+\/[^/]+\/?$/.test(path)) return threadUrl
  return `${path.replace(/\/+$/, '')}/${no}`
}

export function titleAndUrl(title: string, url: string): string {
  return title ? `${title}\n${url}` : url
}

export function xShareUrl(title: string, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`
}

/** PC のブラウザでも開ける共有画面(line.me/R/share はアプリが入った端末向け) */
export function lineShareUrl(title: string, url: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`
}

export function shareItems(o: { title: string; url: string; copy: (text: string, done: string) => void; open: (url: string) => void }): ShareItem[] {
  return [
    { id: 'shareCopy', label: 'リンクをコピー', icon: 'link', onClick: () => o.copy(o.url, 'リンクをコピーしました') },
    { id: 'shareCopyTitle', label: 'スレタイとリンクをコピー', icon: 'content_paste', onClick: () => o.copy(titleAndUrl(o.title, o.url), 'スレタイとリンクをコピーしました') },
    { id: 'shareX', label: 'X に投稿', icon: 'send', onClick: () => o.open(xShareUrl(o.title, o.url)) },
    { id: 'shareLine', label: 'LINE で送る', icon: 'chat', onClick: () => o.open(lineShareUrl(o.title, o.url)) },
    { id: 'shareBrowser', label: 'ブラウザで開く', icon: 'open_in_new', onClick: () => o.open(o.url) },
  ]
}
