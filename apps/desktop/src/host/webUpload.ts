// 置き場のアップロードの画面を別のウィンドウで開き(Rust の web_upload.rs)、拾った共有リンクを受け取る
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { WebUploadSite } from '../utils/webUpload'

/** 開けるか(アプリだけ。web 版は別のページの中を読めないので使えない) */
export const webUploadAvailable = true

/** 画面に渡す画像(貼り付け・ドラッグしたもの。開いたページに貼り付けたことにして、そのまま上げてもらう) */
async function encodeFiles(files: File[]): Promise<{ name: string; type: string; data: string }[]> {
  return Promise.all(
    files.map(async (f) => {
      const buf = new Uint8Array(await f.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { name: f.name || 'image', type: f.type, data: btoa(bin) }
    }),
  )
}

/**
 * 画面を開き、リンクを拾うたびに onLink を呼ぶ。返す関数で受け取りをやめる。
 * files を渡すと、開いたページに貼り付けたことにして(paste と drop を起こす)、本人が選び直さなくても上がる
 */
export async function openWebUpload(site: WebUploadSite, onLink: (url: string) => void, files: File[] = [], o: { background?: boolean } = {}): Promise<() => void> {
  const off = await listen<string>('web-upload-link', (e) => onLink(e.payload))
  try {
    await invoke('open_web_upload', {
      url: site.url,
      pattern: site.pattern,
      title: `${site.name}に上げる(上げたら、リンクを本文に入れます)`,
      files: files.length > 0 ? await encodeFiles(files) : null,
      // 画像を渡すときは画面を見せずに裏で上げる(本人の手が要るときだけ showWebUpload で見せる)
      background: o.background ?? false,
    })
  } catch (e) {
    off()
    throw e
  }
  return off
}

/** 裏で開いていた画面を見せる(しばらく経ってもリンクが来ない = 本人の手が要るとき) */
export async function showWebUpload(): Promise<void> {
  await invoke('show_web_upload').catch(() => undefined)
}

/** 画面を閉じる(上げ終わったとき) */
export async function closeWebUpload(): Promise<void> {
  await invoke('close_web_upload').catch(() => undefined)
}
