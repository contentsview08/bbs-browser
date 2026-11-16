// ChMate(Android の専ブラ)のバックアップ(ZIP)の中身を、OBB に取り込める形に読み替える。
// ZIP をほどく・Shift_JIS を直す・SQLite を読むのはホスト(PC は src-tauri/src/chmate.rs)。ここは文字になったものの意味づけだけ。
// 取り込むもの: スレのログ(dat)と既読・自分の書き込みの印、お気に入りの板とスレ(★ の付いたもの。bookmarks 表は見たスレ全部なので flag で見分ける)、
// NG、書き込みの履歴、スレタイのキーワード。
// 取り込まないもの: アプリの設定(prefs。見た目の好みは別のアプリなので)、BE の NG(OBB に BE の NG はない)

import { parseDat, to5chIo, type Post } from '@bbs-browser/connectors'
import type { NgRule, NgTarget } from './ng'

/** ホストから受け取る、ほどいたままの中身 */
export interface ChmateRaw {
  /** `ng/_id.json` などの文字のファイル(名前 → 中身) */
  texts: Record<string, string>
  /** dat(Shift_JIS から直した本文)と、同じ名前の idx */
  dats: { name: string; text: string; idx?: string | null }[]
  /** bookmarks 表(見たスレ。flag の 1 のビットが ★ = お気に入り) */
  bookmarks: { name: string; created: number; title: string; res_count: number; read_count: number; read_state: string; access: number; posted: number; flag?: number }[]
  /** boards 表(板一覧。ディレクトリ名 → サーバー。flag の 1 のビットがお気に入りの板) */
  boards: { name: string; server: string; title: string; flag?: number }[]
  skipped?: string[]
}

export interface ChmateThread {
  boardUrl: string
  key: string
  title: string
  posts: Post[]
  /** 既読の番号。ChMate の読んだ位置は使わず、持ってきたレスは全部読んだことにする(何百スレもの未読が一度に出ないように) */
  readNo: number
  /** 自分の書き込みのレス番号(idx の 2 行目) */
  ownNos: number[]
  favorite: boolean
  /** 最後に見た時刻(ms)。idx の最終更新か、お気に入りの access */
  viewedAt: number
}

export interface ChmatePost {
  boardUrl: string
  key: string
  title: string
  no?: number
  name: string
  mail: string
  body: string
  /** 書き込んだ時刻(ms) */
  at: number
}

export interface ChmateImport {
  threads: ChmateThread[]
  /** お気に入りの板(boards 表の flag) */
  favoriteBoards: { url: string; name: string }[]
  ngRules: Omit<NgRule, 'id'>[]
  posts: ChmatePost[]
  keywords: string[]
  /** 読めなかったもの・読まなかったものの理由 */
  notes: string[]
}

/** ChMate の NG のファイル名 → OBB の NG の種類(BE は OBB にない) */
const NG_FILES: Record<string, NgTarget | undefined> = {
  'ng/_id.json': 'posterId',
  'ng/_word.json': 'content',
  'ng/_name.json': 'posterName',
  'ng/_title.json': 'threadTitle',
  'ng/_be.json': undefined,
}
/** ChMate の NG の旗: 32 が正規表現 */
const NG_FLAG_REGEX = 32
/** bookmarks・boards の flag: 1 のビットが ★(お気に入り) */
const FLAG_FAVORITE = 1
const isFavoriteFlag = (flag: number | undefined) => ((flag ?? 0) & FLAG_FAVORITE) !== 0

/**
 * ChMate の板の名前を板の URL にする。`host%2Fboard`(外部の板)はそのまま、ディレクトリ名だけ(5ch の板)は boards 表のサーバーを引く。
 * 分からなければ undefined
 */
export function chmateBoardUrl(name: string, servers: Map<string, string>): string | undefined {
  if (!name) return undefined
  // 5ch.net は OBB の書き方(5ch.io)にそろえる(そろえないと、同じスレがお気に入り・履歴に 2 つ並ぶ)
  if (name.includes('%2F')) {
    const decoded = decodeURIComponent(name).replace(/^\/+|\/+$/g, '')
    return decoded.includes('/') ? to5chIo(`https://${decoded}/`) : undefined
  }
  const server = servers.get(name)
  return server ? to5chIo(`https://${server}/${name}/`) : undefined
}

/**
 * dat として読めるか。ChMate のバックアップには、中身が全部 NUL(書きかけのまま壊れた)・「Code = 404」だけ(dat 落ちの返事)の
 * ファイルが混ざる。そういうものはレスにならないので、スレとして入れない(入れると、スレタイがキーのままの空のスレが履歴に並ぶ)
 */
export function looksLikeDat(text: string): boolean {
  const first = text.split('\n').find((l) => l.trim() !== '')
  return first !== undefined && !first.startsWith('\u0000') && first.includes('<>')
}

/** dat のファイル名 `<板>_<キー>.dat` → 板とキー */
export function splitDatName(name: string): { board: string; key: string } | undefined {
  const m = /^(.+)_(\d+)\.(?:dat|idx)$/.exec(name)
  return m ? { board: m[1], key: m[2] } : undefined
}

/** idx の中身 → 最終更新(ms)と自分の書き込みのレス番号 */
export function parseIdx(idx: string | null | undefined): { lastModified: number; ownNos: number[] } {
  const lines = (idx ?? '').split('\n')
  const lastModified = Number(lines[0]?.split('\t')[0]) || 0
  const ownNos = (lines[1] ?? '')
    .split(',')
    .map((x) => Number(x.split(':')[0]))
    .filter((n) => Number.isInteger(n) && n > 0)
  return { lastModified, ownNos: [...new Set(ownNos)].sort((a, b) => a - b) }
}

/** 書き込みの履歴の url `https://host/test/read.cgi/board/key/` → 板の URL とキー */
export function splitThreadUrl(url: string): { boardUrl: string; key: string } | undefined {
  const m = /^https?:\/\/([^/]+)\/test\/read\.cgi\/([^/]+)\/(\d+)/.exec(url)
  return m ? { boardUrl: to5chIo(`https://${m[1]}/${m[2]}/`), key: m[3] } : undefined
}

const asArray = (text: string | undefined): unknown[] => {
  if (!text) return []
  try {
    const v: unknown = JSON.parse(text)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseChmate(raw: ChmateRaw, now = Date.now()): ChmateImport {
  const notes = [...(raw.skipped ?? [])]
  const servers = new Map(raw.boards.filter((b) => b.name && b.server && !b.name.includes('%2F')).map((b) => [b.name, b.server]))
  const boardUrlOf = (name: string) => chmateBoardUrl(name, servers)
  const unknownBoards = new Set<string>()

  // 見たスレの行(板名 + キー → 行)。★ かどうかは flag
  const favorites = new Map<string, ChmateRaw['bookmarks'][number]>()
  for (const b of raw.bookmarks) favorites.set(`${b.name}_${b.created}`, b)
  // お気に入りの板。5ch の板は boards 表の自分の行にサーバーがある
  const favoriteBoards: { url: string; name: string }[] = []
  for (const b of raw.boards) {
    if (!isFavoriteFlag(b.flag)) continue
    const url = b.name.includes('%2F') ? boardUrlOf(b.name) : b.server ? to5chIo(`https://${b.server}/${b.name}/`) : undefined
    if (url) favoriteBoards.push({ url, name: b.title || b.name })
  }

  // スレのログ
  const threads: ChmateThread[] = []
  const seen = new Set<string>()
  let broken = 0
  for (const d of raw.dats) {
    const parts = splitDatName(d.name)
    if (!parts) {
      notes.push(`${d.name}: 名前から板とキーが分かりません`)
      continue
    }
    if (!looksLikeDat(d.text)) {
      broken++
      continue
    }
    const boardUrl = boardUrlOf(parts.board)
    if (!boardUrl) {
      unknownBoards.add(parts.board)
      continue
    }
    const id = `${boardUrl}${parts.key}`
    if (seen.has(id)) continue
    seen.add(id)
    const { posts, title } = parseDat(d.text)
    const fav = favorites.get(`${parts.board}_${parts.key}`)
    const { lastModified, ownNos } = parseIdx(d.idx)
    threads.push({
      boardUrl,
      key: parts.key,
      title: title || fav?.title || '',
      posts,
      readNo: posts.length,
      ownNos: ownNos.filter((n) => n <= posts.length),
      favorite: isFavoriteFlag(fav?.flag),
      viewedAt: lastModified > 0 ? lastModified : fav?.access && fav.access > 0 ? fav.access : now,
    })
  }
  if (broken > 0) notes.push(`壊れていてレスの読めないログ ${broken} 本は入れません(中身が空か、dat 落ちの返事だけ)`)
  // dat のない ★ のスレ(ログは消したがお気に入りには残っている)も、お気に入りとしては取り込む
  for (const b of raw.bookmarks) {
    if (!isFavoriteFlag(b.flag)) continue
    const boardUrl = boardUrlOf(b.name)
    if (!boardUrl) {
      unknownBoards.add(b.name)
      continue
    }
    const id = `${boardUrl}${b.created}`
    if (seen.has(id)) continue
    seen.add(id)
    threads.push({ boardUrl, key: String(b.created), title: b.title, posts: [], readNo: 0, ownNos: [], favorite: true, viewedAt: b.access > 0 ? b.access : now })
  }

  // NG
  const ngRules: Omit<NgRule, 'id'>[] = []
  let beCount = 0
  for (const [file, target] of Object.entries(NG_FILES)) {
    const rows = asArray(raw.texts[file]).filter(isObj)
    if (!target) {
      beCount += rows.length
      continue
    }
    for (const r of rows) {
      const pattern = typeof r.w === 'string' ? r.w : ''
      if (!pattern) continue
      const flags = typeof r.f === 'number' ? r.f : 0
      const board = typeof r.b === 'string' && r.b ? boardUrlOf(r.b) : undefined
      if (typeof r.b === 'string' && r.b && !board) unknownBoards.add(r.b)
      ngRules.push({
        target,
        pattern,
        isRegex: (flags & NG_FLAG_REGEX) !== 0,
        enabled: true,
        ...(board ? { boardUrl: board } : {}),
        note: 'ChMate から',
        ...(typeof r.ct === 'number' ? { createdAt: r.ct } : {}),
      })
    }
  }
  if (beCount > 0) notes.push(`BE の NG ${beCount} 件は OBB にないので取り込みません`)

  // 書き込みの履歴(posted が 0 のものは送れなかった下書き)
  const posts: ChmatePost[] = []
  for (const r of asArray(raw.texts['files/postDataList.json']).filter(isObj)) {
    const url = typeof r.url === 'string' ? r.url : ''
    const at = typeof r.posted === 'number' ? r.posted : 0
    const t = splitThreadUrl(url)
    if (!t || at <= 0) continue
    const confirmed = typeof r.confirmed === 'string' ? /\/(\d+)\/?$/.exec(r.confirmed)?.[1] : undefined
    const ownTitle = typeof r.targetTitle === 'string' ? r.targetTitle : ''
    posts.push({
      boardUrl: t.boardUrl,
      key: t.key,
      // ChMate の履歴にスレタイがなければ、ログのスレタイで埋める
      title: ownTitle || threads.find((x) => x.key === t.key && x.boardUrl === t.boardUrl)?.title || '',
      ...(confirmed ? { no: Number(confirmed) } : {}),
      name: typeof r.name === 'string' ? r.name : '',
      mail: typeof r.mail === 'string' ? r.mail : '',
      body: typeof r.body === 'string' ? r.body : '',
      at,
    })
  }

  // スレタイのキーワード
  const keywords: string[] = []
  try {
    const k = JSON.parse(raw.texts['files/keyword_group_list.json'] ?? '{}') as { items?: unknown }
    for (const it of Array.isArray(k.items) ? k.items : []) {
      const w = isObj(it) && typeof it.keyword === 'string' ? it.keyword.trim() : ''
      if (w && !keywords.includes(w)) keywords.push(w)
    }
  } catch {
    // キーワードのファイルがない・読めない
  }

  if (unknownBoards.size > 0) notes.push(`板のサーバーが分からず読まなかった板: ${[...unknownBoards].slice(0, 5).join('・')}${unknownBoards.size > 5 ? ` ほか ${unknownBoards.size - 5}` : ''}`)
  return { threads, favoriteBoards, ngRules, posts, keywords, notes }
}

/** 取り込んだ数の言い方 */
export function describeChmate(r: { threads: number; favoriteBoards?: number; favorites: number; posts: number; ngAdded: number; keywords: number; skippedBoards: number }): string {
  return [
    r.threads > 0 && `スレのログ ${r.threads}`,
    (r.favoriteBoards ?? 0) > 0 && `お気に入り板 ${r.favoriteBoards}`,
    r.favorites > 0 && `お気に入りのスレ ${r.favorites}`,
    r.posts > 0 && `書き込みの履歴 ${r.posts}`,
    r.ngAdded > 0 && `NG ${r.ngAdded}`,
    r.keywords > 0 && `キーワード ${r.keywords}`,
    r.skippedBoards > 0 && `対応していない掲示板のスレ ${r.skippedBoards} は読みませんでした`,
  ]
    .filter(Boolean)
    .join('・')
}
