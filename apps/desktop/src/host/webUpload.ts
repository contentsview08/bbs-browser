// 置き場のアップロードの画面を別のウィンドウで開き(Rust の web_upload.rs)、拾った共有リンクを受け取る
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { WebUploadSite } from '../utils/webUpload'

/** 開けるか(アプリだけ。web 版は別のページの中を読めないので使えない) */
export const webUploadAvailable = true

/** 画面を開き、リンクを拾うたびに onLink を呼ぶ。返す関数で受け取りをやめる */
export async function openWebUpload(site: WebUploadSite, onLink: (url: string) => void): Promise<() => void> {
  const off = await listen<string>('web-upload-link', (e) => onLink(e.payload))
  try {
    await invoke('open_web_upload', { url: site.url, pattern: site.pattern, title: `${site.name}に上げる(上げたら、リンクを本文に入れます)` })
  } catch (e) {
    off()
    throw e
  }
  return off
}
