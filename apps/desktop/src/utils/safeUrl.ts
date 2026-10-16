// レスに書かれた URL を、画面に出しただけで(押さずに)読みに行ってよいか。
// サムネイル・動画の最初のコマ・リンクのプレビューは、レスを表示しただけで読み込みが起きる。
// 家の中のネットワークや自分の PC のアドレスを書かれると、ルーターなどの機器を勝手に叩いてしまうので、
// そういう URL は自動では読まない(押したときだけ開く)。

/** IPv4 の数字 4 つ。省略形や 16 進・8 進の書き方(0x7f.1 など)は、そもそも自動では読まない */
function ipv4(host: string): number[] | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return undefined
  const n = m.slice(1).map(Number)
  return n.every((x) => x <= 255) ? n : undefined
}

/** 家の中・自分の PC・特別な用途の IPv4 */
function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // キャリアの中のアドレス
    (a === 169 && b === 254) || // リンクローカル
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // マルチキャスト・予約
  )
}

/** 家の中の名前の終わり */
const LOCAL_SUFFIX = /\.(?:local|localhost|lan|home|internal|intranet|corp|home\.arpa)$/i

export function isAutoLoadable(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  // 標準以外のポートは、家の中の機器の管理画面などのことが多いので読まない
  if (u.port !== '') return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || LOCAL_SUFFIX.test(host)) return false
  // IPv6 は [ ] で囲まれる。自分の PC・家の中・リンクローカルなどを読まない(ふつうのサイトは名前で書かれる)
  if (host.startsWith('[')) return false
  const v4 = ipv4(host)
  if (v4) return !isPrivateIpv4(v4)
  // 数字と点だけ・16 進などで書いた IP アドレスの変わった書き方は読まない
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host) || /\.0x/i.test(host)) return false
  // 点のない名前(家の中の機器の名前)は読まない
  return host.includes('.')
}
