// つながっている回線の種類。画像のサムネイルを「Wi-Fi のときだけ」読むかを決めるのに使う。
// Network Information API(Android の Chrome・WebView にある)の type を見る。分からないとき(PC など)は Wi-Fi と同じに扱う

interface NetworkInformation {
  type?: string
}

/** Wi-Fi(または有線)につながっているか。分からなければ true */
export function onWifi(): boolean {
  const type = (navigator as Navigator & { connection?: NetworkInformation }).connection?.type
  if (!type || type === 'unknown') return true
  return type === 'wifi' || type === 'ethernet'
}
