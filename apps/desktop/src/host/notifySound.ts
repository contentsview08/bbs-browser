// 通知音(PC)。既定の音はアプリに入っている /sounds/notify.wav。自分の音を選ぶと、アプリのデータフォルダにコピーして
// (Rust 側の set_notify_sound。背景画像と同じ考え方)アセットとして読む。読めなければ既定の音で鳴らす

import { convertFileSrc, invoke } from '@tauri-apps/api/core'

export const DEFAULT_NOTIFY_SOUND = '/sounds/notify.wav'

/** 選んだ音のファイルをコピーして、そのパスを返す(設定にはこのパスを保存する) */
export function importNotifySound(source: string): Promise<string> {
  return invoke<string>('set_notify_sound', { source })
}

/** 画面から読むための URL(空なら既定の音) */
export function notifySoundUrl(path: string): string {
  return path ? convertFileSrc(path) : DEFAULT_NOTIFY_SOUND
}

let playing: HTMLAudioElement | undefined

/** 通知音を鳴らす。前の音が鳴っている途中なら止めて鳴らし直す。選んだ音が読めなければ既定の音 */
export function playNotifySound(path: string): Promise<void> {
  return new Promise((resolve) => {
    const start = (url: string, fallback: boolean) => {
      playing?.pause()
      const a = new Audio(url)
      playing = a
      a.onended = () => resolve()
      a.onerror = () => (fallback ? start(DEFAULT_NOTIFY_SOUND, false) : resolve())
      a.play().catch(() => (fallback ? start(DEFAULT_NOTIFY_SOUND, false) : resolve()))
    }
    start(notifySoundUrl(path), !!path)
  })
}
