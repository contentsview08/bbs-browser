// OS の通知。お気に入りのスレの新着・キーワードに合うスレ・自分への返信・新しい版を知らせる。
// - Windows(PC): Rust 側の os_notify でトーストを直に出す(アプリの名前とアイコンで出て、押すとそのスレを開く。utils/osNotify の onOsNotifyClick)
// - ほかの OS・スマホ: tauri-plugin-notification。Android は許可をもらう(設定で通知をオンにしたとき、最初の 1 回だけ聞く)
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import type { StoredNotification } from '../ui/settings'
import { isMobile } from './platform'

/** Windows の PC か(トーストを Rust で出す) */
const WINDOWS_DESKTOP = !isMobile && typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** 通知の許可をもらう(もうもらっていれば聞かない)。もらえたら true。Windows の PC は OS の設定で決まるので、いつも true */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (WINDOWS_DESKTOP) return true
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

/**
 * OS の通知を出す。link は押したときに開くスレ(とレス)。silent なら OS の音を鳴らさない(アプリの通知音を鳴らすとき)。
 * Windows 以外では、押しても開けない(プラグインが押したことを伝えてこない)
 */
export async function sendOsNotification(title: string, body?: string, link?: StoredNotification['link'], silent = false): Promise<void> {
  if (WINDOWS_DESKTOP) {
    try {
      await invoke('os_notify', { title, body: body ?? null, link: link ? JSON.stringify(link) : null, silent })
      return
    } catch {
      // Rust 側で出せなければプラグインで(名前は PowerShell になる)
    }
  }
  if (!(await isPermissionGranted())) return
  sendNotification({ title, ...(body && { body }) })
}

/** OS の通知を押した(Windows)。link は sendOsNotification に渡したもの(なければ null)。外す関数を返す */
export function onOsNotifyClick(cb: (link: StoredNotification['link'] | undefined) => void): () => void {
  if (!WINDOWS_DESKTOP) return () => undefined
  const un = listen<string | null>('os-notify-click', (e) => {
    let link: StoredNotification['link'] | undefined
    try {
      link = e.payload ? (JSON.parse(e.payload) as StoredNotification['link']) : undefined
    } catch {
      link = undefined
    }
    cb(link)
  })
  return () => void un.then((f) => f())
}
