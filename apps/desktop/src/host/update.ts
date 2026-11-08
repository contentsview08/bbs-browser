// 更新の確かめと取り込み(PC)。版の比べと説明は、GitHub の最新のリリースを見る(公開リポジトリなので、トークンなしで API を読む)。
// 入れ替えは手動でも起動時でも plugin-updater だけで行う(latest.json の URL を落とし、minisign の署名を確かめてから入れる)。
// 画面から好きな URL のインストーラーを落として開ける口を作らないため
import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

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
}

const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bbs-browser' }

/** 最新のリリースを取る。見つからない・取れないときは Error */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS })
  if (res.status === 404) throw new Error('リリースが見つかりません(まだ 1 つも公開していません)')
  if (!res.ok) throw new Error(`GitHub から取れませんでした(${res.status})`)
  const j = (await res.json()) as { tag_name: string; body?: string; html_url: string }
  return { version: j.tag_name.replace(/^v/i, ''), notes: j.body ?? '', url: j.html_url }
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
 * 署名を確かめながら落として入れ替え、起動し直す(Windows は入れ替えの時点でこのアプリが終わり、インストーラーが起動し直す)。
 * 落とすのが止まったら Error
 */
async function install(update: Update, onProgress: (p: AutoUpdateProgress) => void): Promise<void> {
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

/**
 * 起動時の自動更新。新しい版があれば落として入れ替え、起動し直す。
 * 入れ替えられない入れ方(ZIP 版・.deb)では何もしない。つながらない・失敗したときは Error で返すので、呼ぶ側はそのまま使い続ける
 */
export async function runAutoUpdate(onProgress: (p: AutoUpdateProgress) => void): Promise<void> {
  if (!(await canSelfUpdate())) return
  const update = await check({ timeout: CHECK_TIMEOUT_MS })
  if (update) await install(update, onProgress)
}

/**
 * 手動の更新(設定 → このアプリについて)。自動更新と同じ道で、署名を確かめてから入れ替える。
 * 入れ替えられない入れ方では呼ばない(画面はリリースのページを開く)
 */
export async function installUpdate(onProgress: (p: AutoUpdateProgress) => void): Promise<void> {
  if (!(await canSelfUpdate())) throw new Error('この入れ方は自動で入れ替えられません。リリースのページから入れてください')
  const update = await check({ timeout: CHECK_TIMEOUT_MS })
  // リリースの公開から latest.json が読めるまでに少し間がある
  if (!update) throw new Error('入れ替えられる新しい版がまだありません。少し待ってからもう一度試してください')
  await install(update, onProgress)
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
