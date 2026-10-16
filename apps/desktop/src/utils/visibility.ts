// アプリが見えているか。最小化しているときなどは、自動更新や新着の見張りを休む
// (見ていないのにサーバーへ読み込みを送り続けないため)

export function isAppVisible(): boolean {
  return document.visibilityState === 'visible'
}
