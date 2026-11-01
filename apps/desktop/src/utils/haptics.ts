// 振動で知らせる(設定「振動で知らせる」。スマホのアプリの haptics と同じ):
// ジェスチャー・引っぱって更新が決まったとき、長押しのメニューで軽く振動する。振動できない端末(PC・iPhone)では何もしない
let enabled = true

/** 設定を変えたときに ui/settings.ts の apply から呼ぶ */
export function setHaptics(on: boolean) {
  enabled = on
}

/** 軽く振動する(ms はミリ秒) */
export function buzz(ms = 15) {
  if (enabled) navigator.vibrate?.(ms)
}
