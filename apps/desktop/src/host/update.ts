// 更新の確かめと取り込み(PC)。GitHub の最新のリリースを見て版を比べ、インストーラーを落として実行する。
// リポジトリは公開(2026-11-04 から)なので、トークンなしで GitHub の API を読む。
// 落とすのは Rust 側(update.rs。一時フォルダに置いて開く)。web 版は host/update.ts が何もしない
import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'

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
  const asset = (j.assets ?? []).find((a) => /-setup\.exe$/i.test(a.name)) ?? (j.assets ?? []).find((a) => /\.(exe|msi)$/i.test(a.name))
  return {
    version: j.tag_name.replace(/^v/i, ''),
    notes: j.body ?? '',
    url: j.html_url,
    // private のリポジトリの asset は API の URL(Accept: application/octet-stream)で落とす
    asset: asset ? { name: asset.name, url: asset.url, size: asset.size } : undefined,
  }
}

/** インストーラーを落として開く(インストーラーが立ち上がる。アプリは本人が閉じる) */
export function installUpdate(asset: NonNullable<ReleaseInfo['asset']>): Promise<string> {
  // Rust 側(update.rs)の token は、private だったころの名残。空で渡す
  return invoke<string>('download_update', { url: asset.url, name: asset.name, token: '' })
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
