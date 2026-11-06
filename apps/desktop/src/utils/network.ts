// つながっている回線の種類。画像のサムネイルを「Wi-Fi のときだけ」読むかを決めるのに使う。
// Android のアプリでは、MainActivity の口(window.BbsAndroid.isWifi。ConnectivityManager を見る)に聞く。
// WebView の Network Information API(navigator.connection.type)は Android では取れないことが多い。
// PC で分からないときは Wi-Fi と同じに扱う

import { isMobile } from './platform'

interface NetworkInformation {
  type?: string
}

/** Wi-Fi(または有線)につながっているか */
export function onWifi(): boolean {
  const android = (window as unknown as { BbsAndroid?: { isWifi?: () => boolean } }).BbsAndroid
  if (android?.isWifi) {
    try {
      return android.isWifi()
    } catch {
      return false
    }
  }
  const type = (navigator as Navigator & { connection?: NetworkInformation }).connection?.type
  // スマホで回線が分からないときは、読まない側に倒す(通信量を使わないように)
  if (!type || type === 'unknown') return !isMobile
  return type === 'wifi' || type === 'ethernet'
}
