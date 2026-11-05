// 更新の確かめと取り込み(PC)。手動の確認は、GitHub の最新のリリースを見て版を比べ、インストーラーを落として開く。
// 起動時の自動更新(runAutoUpdate)は、リリースの latest.json を見て、署名を確かめてから入れ替える。
// リポジトリは公開(2026-11-04 から)なので、トークンなしで GitHub の API を読む。
// 落とすのは Rust 側(update.rs。一時フォルダに置いて開く)。web 版は host/update.ts が何もしない
import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

export const canCheckUpdate = true

/** 見に行くリポジトリ */
const REPO = 'contentsview08/bbs-browser'

export interface ReleaseInfo {
  /** タグから v を除いた版(0.2.0 など) */
  version: string
  /** リリースの説明(Markdown のまま) */
  notes: string
  /** リリースのページ */
  url: string
  /** Windows のインストーラー(.exe か .msi)。なければ undefined */
  asset?: { name: string; url: string; size: number }
}

function headers(): Record<string, string> {
  return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bbs-browser' }
}

/** 最新のリリースを取る。見つからない・権限がないときは Error */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: headers() })
  if (res.status === 404) throw new Error('リリースが見つかりません(まだ 1 つも公開していません)')
  if (res.status === 401) throw new Error('GitHub のトークンが受け付けられませんでした')
  if (!res.ok) throw new Error(`GitHub から取れませんでした(${res.status})`)
  const j = (await res.json()) as { tag_name: string; body?: string; html_url: string; assets?: { name: string; url: string; size: number; browser_download_url: string }[] }
  // インストーラーを落として開くのは Windows だけ。Linux はリリースのページを開く
  const assets = /windows/i.test(navigator.userAgent) ? (j.assets ?? []) : []
  const asset = assets.find((a) => /-setup\.exe$/i.test(a.name)) ?? assets.find((a) => /\.(exe|msi)$/i.test(a.name))
  return {
    version: j.tag_name.replace(/^v/i, ''),
    notes: j.body ?? '',
    url: j.html_url,
    asset: asset ? { name: asset.name, url: asset.url, size: asset.size } : undefined,
  }
}

/** インストーラーを落として開く(インストーラーが立ち上がる。アプリは利用者が閉じる) */
export function installUpdate(asset: NonNullable<ReleaseInfo['asset']>): Promise<string> {
  return invoke<string>('download_update', { url: asset.url, name: asset.name })
}

/** 自動更新の進み具合 */
export interface AutoUpdateProgress {
  /** 入れる版 */
  version: string
  /** 落とした割合(0〜100)。大きさが分からないあいだは undefined */
  percent?: number
}

/**
 * 新しい版があるかの確かめを待つ長さ。確かめている間も画面は使えるので長めに待つ
 * (latest.json は GitHub の転送を 2 回はさみ、混んでいると 10 秒近くかかることがある)
 */
const CHECK_TIMEOUT_MS = 20000
/** 落としている途中で、これだけ何も届かなければやめる */
const DOWNLOAD_STALL_MS = 30000

/** 自動で入れ替えられる入れ方か(Windows のインストーラー版と Linux の AppImage) */
export const canSelfUpdate = () => invoke<boolean>('can_self_update')

/**
 * 起動時の自動更新。新しい版があれば落として入れ替え、起動し直す(Windows は入れ替えの時点でこのアプリが終わり、インストーラーが起動し直す)。
 * 入れ替えられない入れ方(ZIP 版・.deb)では何もしない。つながらない・失敗したときは Error で返すので、呼ぶ側はそのまま使い続ける
 */
export async function runAutoUpdate(onProgress: (p: AutoUpdateProgress) => void): Promise<void> {
  if (!(await canSelfUpdate())) return
  const update = await check({ timeout: CHECK_TIMEOUT_MS })
  if (!update) return
  const version = update.version
  onProgress({ version })
  await new Promise<void>((resolve, reject) => {
    let total = 0
    let got = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const watch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => reject(new Error('更新の取得が止まりました')), DOWNLOAD_STALL_MS)
    }
    watch()
    update
      .download((e) => {
        watch()
        if (e.event === 'Started') total = e.data.contentLength ?? 0
        else if (e.event === 'Progress') {
          got += e.data.chunkLength
          if (total > 0) onProgress({ version, percent: Math.min(100, Math.floor((got / total) * 100)) })
        }
      })
      .then(resolve, reject)
      .finally(() => clearTimeout(timer))
  })
  await update.install()
  await relaunch()
}

/** 版の比べ(1.2.3 の形。a が b より新しければ 1) */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}
