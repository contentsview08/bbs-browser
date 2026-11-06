// 置き場のアップロードの画面を別のウィンドウで開き(Rust の web_upload.rs)、拾った共有リンクを受け取る
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toBase64 } from '../utils/base64'
import type { WebUploadSite } from '../utils/webUpload'

/** 画面に渡す画像(貼り付け・ドラッグしたもの。開いたページに貼り付けたことにして、そのまま上げてもらう) */
async function encodeFiles(files: File[]): Promise<{ name: string; type: string; data: string }[]> {
  return Promise.all(
    files.map(async (f) => {
      return { name: f.name || 'image', type: f.type, data: toBase64(new Uint8Array(await f.arrayBuffer())) }
    }),
  )
}

/**
 * 画面を開き、リンクを拾うたびに onLink を呼ぶ。返す関数で受け取りをやめる。
 * files を渡すと、開いたページに貼り付けたことにして(paste と drop を起こす)、利用者が選び直さなくても上がる
 */
export async function openWebUpload(site: WebUploadSite, onLink: (url: string) => void, files: File[] = []): Promise<() => void> {
  const off = await listen<string>('web-upload-link', (e) => onLink(e.payload))
  try {
    await invoke('open_web_upload', {
      url: site.url,
      pattern: site.pattern,
      title: `${site.name}に上げる(上げたら、リンクを本文に入れます)`,
      files: files.length > 0 ? await encodeFiles(files) : null,
    })
  } catch (e) {
    off()
    throw e
  }
  return off
}

/** 画面を閉じる(上げ終わったとき) */
export async function closeWebUpload(): Promise<void> {
  await invoke('close_web_upload').catch(() => undefined)
}
