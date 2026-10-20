// スマホ: OS の通知(Android の通知の欄に出る)。お気に入りのスレの新着・キーワードに合うスレ・自分への返信を知らせる。
// アプリを見ているあいだは、アプリの中の通知(右下)で足りるので、OS の通知はアプリを裏に回しているときだけ出す。
// 通知を出すには、Android に許可をもらう(設定で通知をオンにしたとき、最初の 1 回だけ聞く)
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

/** 通知の許可をもらう(もうもらっていれば聞かない)。もらえたら true */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

/** OS の通知を出す。許可がなければ何もしない */
export async function sendOsNotification(title: string, body?: string): Promise<void> {
  if (!(await isPermissionGranted())) return
  sendNotification({ title, ...(body && { body }) })
}
