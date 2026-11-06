// hono-bbs(自作の掲示板)のコネクタ。2ch 互換の窓口(subject.txt・dat)ではなく、掲示板の JSON の API を読む。
// JSON の API はスレ一覧の時点で 1 レス目(本文・書いた人の ID・画像)が付いてくるので、のぞき・サムネイル・立てた人の ID を出せる。
// - 板の URL は web の URL(https://<web>/boards/<板ID>/)。スレは https://<web>/boards/<板ID>/<スレID>
// - API の場所は、web のページの <meta name="bbs-api" content="https://api.<…>/api/v1"> から見つける(なければ https://api.<web のホスト>/api/v1)
// - 板の一覧 GET /boards、スレ一覧 GET /boards/:板/threads(firstPost 付き)、レス GET /boards/:板/threads/:スレ/posts?cursor=…
// - 書き込み POST /boards/:板/threads/:スレ/posts(JSON)、スレ立て POST /boards/:板/threads。
//   Turnstile が要るとき(TURNSTILE_REQUIRED・TURNSTILE_INVALID)は、エッヂの認証と同じ流れにする:
//   POST /auth/turnstile/pair でコードをもらい(Cookie turnstile_pair が付く)、認証ページの URL とコードを出す。
//   人がブラウザで認証してから送り直すと、その Cookie でセッションが使われる
// 本番の板への試し書き込みはしない

import type { Board, Connector, ConnectorContext, FetchPostsResult, HttpResponse, Post, PostResult, ThreadSummary, ThreadStatusInfo, LoginResult, PostInput } from '../types'

const ID = 'honobbs'

/** web の板・スレの URL。スレ ID は UUID */
const THREAD_URL = /^(https?:\/\/[^/]+)\/boards\/([A-Za-z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/
const BOARD_URL = /^(https?:\/\/[^/]+)\/boards\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/

interface RawCursor {
  /** 取り終えた最後のレス番号 */
  lastNo: number
}

interface ApiPost {
  postNumber: number
  authorId?: string
  posterName?: string
  posterOptionInfo?: string
  content?: string
  isDeleted?: boolean
  createdAt: string
}

interface ApiThread {
  id: string
  boardId: string
  title: string
  postCount: number
  isArchived?: boolean
  createdAt: string
  firstPost?: ApiPost
}

interface ApiBoard {
  id: string
  name: string
  category?: string
  defaultPosterName?: string
  defaultMaxPostLength?: number
  defaultMaxPostLines?: number
}

/** web のオリジン → API の場所(https://api.…/api/v1)。一度調べたら覚えておく */
const apiBases = new Map<string, string>()

function parts(boardUrl: string): { origin: string; boardId: string } {
  const m = BOARD_URL.exec(boardUrl)
  if (!m) throw new Error(`hono-bbs の板の URL ではありません: ${boardUrl}`)
  return { origin: m[1], boardId: m[2] }
}

const boardUrlOf = (origin: string, boardId: string) => `${origin}/boards/${boardId}/`

/** API の場所を見つける。web のページの <meta name="bbs-api"> を読み、なければ api.<ホスト> と決めてかかる */
export async function apiBaseOf(origin: string, ctx: ConnectorContext): Promise<string> {
  const known = apiBases.get(origin)
  if (known) return known
  let base: string | undefined
  let read = false
  try {
    const res = await ctx.http.get(`${origin}/`)
    if (res.status === 200) {
      read = true
      const html = ctx.decode(res.body, 'utf-8')
      const m = /<meta\s+name=["']bbs-api["']\s+content=["']([^"']+)["']/i.exec(html)
      if (m && /^https?:\/\//.test(m[1])) base = m[1].replace(/\/+$/, '')
    }
  } catch {
    // 読めなければ、決まった形にしておく
  }
  base ??= `${origin.replace(/^(https?:\/\/)/, '$1api.')}/api/v1`
  // ページを読めなかったときの決めつけは覚えない(一時的な失敗で、再起動まで違う API へ行き続けないように)
  if (read) apiBases.set(origin, base)
  return base
}

/** アカウントの id(AccountKind) */
const ACCOUNT_ID = 'user'
/** 設定で保存してログインしたユーザー ID とパスワード(このプロセスの中だけ。保存は App の DB) */
let savedCredential: { user: string; password: string } | undefined
/** サイト(origin)ごとのログインのセッション */
const sessions = new Map<string, { sessionId: string; expiresAt: number }>()

/**
 * パスワードを送ってよいサイト。hono-bbs の板は URL の形だけで判定するので、確かめないと、形を合わせただけの別サイトへパスワードが渡る。
 * API の場所(<meta name="bbs-api">)も相手のページが決めるので、こちらも確かめる
 */
const ACCOUNT_HOST = 'red-edge.net'
export function isAccountSite(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === ACCOUNT_HOST || u.hostname.endsWith(`.${ACCOUNT_HOST}`))
  } catch {
    return false
  }
}

/** そのサイトにログインしてセッションをもらう(POST /auth/login) */
async function loginTo(origin: string, credential: { user: string; password: string }, ctx: ConnectorContext): Promise<LoginResult> {
  const api = await apiBaseOf(origin, ctx)
  if (!isAccountSite(origin) || !isAccountSite(api)) return { ok: false, message: `このサイトにはパスワードを送りません(${origin})` }
  const res = await ctx.http.post(`${api}/auth/login`, JSON.stringify({ id: credential.user, password: credential.password }), {
    headers: { 'Content-Type': 'application/json' },
    sameCookiesAsGet: true,
  })
  const body = json<{ data?: { sessionId: string; expiresAt: string; displayName: string }; error?: string; message?: string }>(res, ctx)
  if (res.status !== 200 || !body.data) {
    const why =
      body.error === 'INVALID_CREDENTIALS'
        ? 'ユーザー ID かパスワードが違います'
        : body.error === 'PASSKEY_REQUIRED'
          ? 'このアカウントはパスキーでしか入れません'
          : body.error === 'TOO_MANY_ATTEMPTS'
            ? 'ログインの失敗が続いたので、しばらく待ってください'
            : (body.message ?? `HTTP ${res.status}`)
    return { ok: false, message: why }
  }
  sessions.set(origin, { sessionId: body.data.sessionId, expiresAt: new Date(body.data.expiresAt).getTime() })
  return { ok: true, message: `ログインしました(${body.data.displayName})` }
}

/** 書き込みに付ける Authorization。アカウントを使う書き込みで、ログインしてあれば(なければここでログイン) */
async function authHeader(origin: string, input: PostInput, ctx: ConnectorContext): Promise<Record<string, string>> {
  if (!input.accounts?.includes(ACCOUNT_ID) || !savedCredential || !isAccountSite(origin)) return {}
  const s = sessions.get(origin)
  if (!s || s.expiresAt - Date.now() < 60_000) {
    const r = await loginTo(origin, savedCredential, ctx)
    if (!r.ok) throw new Error(`アカウントでログインできませんでした: ${r.message}`)
  }
  return { Authorization: `Bearer ${sessions.get(origin)!.sessionId}` }
}

/** ログインし直して送り直すか。アカウントを付けて送ったのに、セッションが向こうで切れていたとき(packages/conformance/hono-relogin.json) */
export function shouldRelogin(status: number, sentAuth: boolean): boolean {
  return status === 401 && sentAuth
}

/** アカウントを付けて送る。セッションが切れていたら、一度だけログインし直して送り直す */
async function postWithAuth(origin: string, url: string, body: string, input: PostInput, ctx: ConnectorContext): Promise<HttpResponse> {
  // Turnstile のつなぎの Cookie(読む通信で受け取ったもの)を付けて送る。アカウントを使うならセッションも
  const send = async (auth: Record<string, string>) => ctx.http.post(url, body, { headers: { 'Content-Type': 'application/json', ...auth }, sameCookiesAsGet: true })
  const auth = await authHeader(origin, input, ctx)
  const res = await send(auth)
  if (!shouldRelogin(res.status, 'Authorization' in auth)) return res
  sessions.delete(origin)
  return send(await authHeader(origin, input, ctx))
}

function json<T>(res: HttpResponse, ctx: ConnectorContext): T {
  return JSON.parse(ctx.decode(res.body, 'utf-8')) as T
}

/** 「2026/09/20(日) 04:02:29.239」(日本時間)。2ch と同じ形にそろえる(日付の差・短い日付の読み取りがそのまま効くように) */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const j = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const wd = '日月火水木金土'[j.getUTCDay()]
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())}(${wd}) ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}:${p(j.getUTCSeconds())}.${p(j.getUTCMilliseconds(), 3)}`
}

export function toPost(p: ApiPost): Post {
  return {
    no: p.postNumber,
    name: p.isDeleted ? 'あぼーん' : (p.posterName ?? ''),
    // 名前の後ろの情報(sage など)を、2ch のメール欄の位置に出す
    mail: p.isDeleted ? '' : (p.posterOptionInfo ?? ''),
    date: formatDate(p.createdAt),
    ...(p.authorId && !p.isDeleted ? { id: p.authorId } : {}),
    body: p.isDeleted ? 'あぼーん' : (p.content ?? ''),
  }
}

/** 本文の最初の画像の URL(スレ一覧のサムネイル) */
const firstImage = (text: string) => /https?:\/\/\S+?\.(?:jpe?g|png|gif|webp)(?:\?\S*)?(?=\s|$)/i.exec(text)?.[0]

/** base64url(パディングなし) */
function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 書き込みの応答を読む。Turnstile が要るときは、つなぎのコードをもらって、認証の案内を返す */
async function readWrite(res: HttpResponse, api: string, ctx: ConnectorContext): Promise<PostResult> {
  const text = ctx.decode(res.body, 'utf-8')
  let body: { data?: { postNumber?: number }; error?: string; message?: string } = {}
  try {
    // 本文が null のときも空として読む
    body = JSON.parse(text) ?? {}
  } catch {
    // JSON でない応答(WAF のページなど)は、そのまま見られるように html に入れる
  }
  if (res.status >= 200 && res.status < 300) {
    return { status: 'ok', message: '書き込みました', ...(body.data?.postNumber ? { resNumber: body.data.postNumber } : {}) }
  }
  if (body.error === 'TURNSTILE_REQUIRED' || body.error === 'TURNSTILE_INVALID') {
    try {
      const pr = await ctx.http.post(`${api}/auth/turnstile/pair`, '{}', { headers: { 'Content-Type': 'application/json' }, sameCookiesAsGet: true })
      const pair = json<{ data?: { code: string; url: string } }>(pr, ctx).data
      if (pair) {
        return {
          status: 'auth',
          message: 'この掲示板は、書き込みの前に人の確認(Turnstile)が要ります。認証ページを開いて確認が済んだら、もう一度送ってください',
          url: pair.url,
          code: pair.code,
        }
      }
    } catch {
      // つなぎのコードをもらえない(古い掲示板)ときは、下の知らせだけ
    }
    return { status: 'auth', message: 'この掲示板は、書き込みの前に人の確認(Turnstile)が要ります', url: `${api}/auth/turnstile` }
  }
  const message = body.message ? `${body.error ?? 'エラー'}: ${body.message}` : `書き込めませんでした(HTTP ${res.status})`
  return { status: 'error', message, html: text }
}

export const honoBbsConnector: Connector = {
  id: ID,
  name: 'hono-bbs',
  capabilities: { post: true, images: true, incremental: true },

  canHandle(url) {
    return THREAD_URL.test(url) || BOARD_URL.test(url)
  },

  isThreadUrl(url) {
    return THREAD_URL.test(url)
  },

  /** サイトの入口は web の板の一覧の URL(https://<web>/boards) */
  handlesSite(menuUrl) {
    return /^https?:\/\/[^/]+\/boards\/?(?:[?#].*)?$/.test(menuUrl)
  },

  async resolveUrl(url, ctx) {
    const t = THREAD_URL.exec(url)
    const b = t ? undefined : BOARD_URL.exec(url)
    const origin = t?.[1] ?? b?.[1]
    const boardId = t?.[2] ?? b?.[2]
    if (!origin || !boardId) return null
    const api = await apiBaseOf(origin, ctx)
    const res = await ctx.http.get(`${api}/boards/${encodeURIComponent(boardId)}`)
    if (res.status === 404) throw new Error('hono-bbs の板が見つかりません(HTTP 404)')
    if (res.status !== 200) throw new Error(`hono-bbs の板を開けません(HTTP ${res.status})`)
    const info = json<{ data: ApiBoard }>(res, ctx).data
    const board: Board = { connectorId: ID, url: boardUrlOf(origin, boardId), name: info.name, ...(info.category ? { category: info.category } : {}) }
    if (!t) return { board }
    return { board, thread: { connectorId: ID, boardUrl: board.url, key: t[3], title: '', postCount: 0, order: 0 } }
  },

  async boardInfo(board, ctx) {
    try {
      const { origin, boardId } = parts(board.url)
      const api = await apiBaseOf(origin, ctx)
      const res = await ctx.http.get(`${api}/boards/${encodeURIComponent(boardId)}`)
      if (res.status !== 200) return {}
      const info = json<{ data: ApiBoard }>(res, ctx).data
      return {
        title: info.name,
        nonameName: info.defaultPosterName || undefined,
        limits: {
          ...(info.defaultMaxPostLength ? { messageBytes: info.defaultMaxPostLength } : {}),
          ...(info.defaultMaxPostLines ? { lines: info.defaultMaxPostLines } : {}),
        },
      }
    } catch {
      return {}
    }
  },

  /** 板の一覧。サイトの入口(menuUrl)は web の URL */
  async listBoards(site, ctx) {
    const origin = new URL(site.menuUrl).origin
    const api = await apiBaseOf(origin, ctx)
    const res = await ctx.http.get(`${api}/boards?limit=500`)
    if (res.status !== 200) throw new Error(`hono-bbs の板の一覧を読めません(HTTP ${res.status})`)
    return json<{ data: ApiBoard[] }>(res, ctx).data.map((b) => ({
      connectorId: ID,
      url: boardUrlOf(origin, b.id),
      name: b.name,
      ...(b.category ? { category: b.category } : {}),
    }))
  },

  /** スレの状態のまとめ取り(POST /threads/status。200 件ずつ)。サイト(origin)ごとにまとめる */
  async threadStatus(threads, ctx) {
    const byOrigin = new Map<string, ThreadSummary[]>()
    for (const t of threads) {
      const { origin } = parts(t.boardUrl)
      byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), t])
    }
    const out: ThreadStatusInfo[] = []
    for (const [origin, list] of byOrigin) {
      const api = await apiBaseOf(origin, ctx)
      const byId = new Map(list.map((t) => [t.key, t]))
      for (let i = 0; i < list.length; i += 200) {
        const ids = list.slice(i, i + 200).map((t) => t.key)
        const res = await ctx.http.post(`${api}/threads/status`, JSON.stringify({ ids }), { headers: { 'Content-Type': 'application/json' } })
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${api}/threads/status`)
        const body = json<{ data: { id: string; postCount: number; isArchived: boolean }[] }>(res, ctx)
        for (const s of body.data) {
          const t = byId.get(s.id)
          if (t) out.push({ boardUrl: t.boardUrl, key: t.key, postCount: s.postCount, archived: s.isArchived })
        }
      }
    }
    return out
  },

  async listThreads(board, ctx) {
    const { origin, boardId } = parts(board.url)
    const api = await apiBaseOf(origin, ctx)
    const threads: ApiThread[] = []
    let cursor: string | undefined
    // 何ページにも分かれていればたどる(板のスレの上限までなので、たどりきれる)
    for (let page = 0; page < 20; page++) {
      const url = `${api}/boards/${encodeURIComponent(boardId)}/threads?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const res = await ctx.http.get(url)
      if (res.status === 404) throw new Error(`hono-bbs の板が見つかりません(HTTP 404): ${board.url}`)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
      const body = json<{ data: ApiThread[]; nextCursor?: string | null }>(res, ctx)
      threads.push(...body.data)
      if (!body.nextCursor) break
      cursor = body.nextCursor
    }
    return threads.map((t, i) => {
      const fp = t.firstPost
      const thumb = fp?.content ? firstImage(fp.content) : undefined
      return {
        connectorId: ID,
        boardUrl: board.url,
        key: t.id,
        title: t.title,
        postCount: t.postCount,
        order: i,
        createdAt: new Date(t.createdAt),
        ...(thumb ? { thumb } : {}),
        ...(fp && !fp.isDeleted ? { preview: [{ no: 1, name: fp.posterName ?? '', date: formatDate(fp.createdAt), body: fp.content ?? '' }] } : {}),
        ...(fp?.authorId && !fp.isDeleted ? { authorId: fp.authorId } : {}),
      } satisfies ThreadSummary
    })
  },

  async fetchPosts(thread, rawCursor, ctx): Promise<FetchPostsResult> {
    const cursor = rawCursor as RawCursor | null
    const { origin, boardId } = parts(thread.boardUrl)
    const api = await apiBaseOf(origin, ctx)
    const base = `${api}/boards/${encodeURIComponent(boardId)}/threads/${encodeURIComponent(thread.key)}`
    // 初めて開くときは、スレタイと「もう書けないスレか」を取る
    let title: string | undefined
    let archived = false
    if (!cursor) {
      const tr = await ctx.http.get(base)
      if (tr.status === 404) return { status: 'archived', posts: [], cursor }
      if (tr.status === 200) {
        const t = json<{ data: ApiThread }>(tr, ctx).data
        title = t.title
        archived = !!t.isArchived
      }
    }
    const posts: Post[] = []
    // API の続きの印は {"postNumber": 最後の番号} を base64url にしたもの
    let next: string | undefined = cursor ? base64Url(JSON.stringify({ postNumber: cursor.lastNo })) : undefined
    for (let page = 0; page < 50; page++) {
      const url = `${base}/posts?limit=500${next ? `&cursor=${encodeURIComponent(next)}` : ''}`
      const res = await ctx.http.get(url)
      if (res.status === 404) return { status: 'archived', posts: [], cursor }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`)
      const body = json<{ data: ApiPost[]; nextCursor?: string | null }>(res, ctx)
      posts.push(...body.data.filter((p) => !cursor || p.postNumber > cursor.lastNo).map(toPost))
      if (!body.nextCursor) break
      next = body.nextCursor
    }
    const lastNo = posts.at(-1)?.no ?? cursor?.lastNo ?? 0
    const nextCursor: RawCursor = { lastNo }
    if (posts.length === 0) return { status: 'notModified', posts: [], cursor: nextCursor, ...(title ? { title } : {}), archived: archived || undefined }
    return { status: 'updated', posts, cursor: nextCursor, ...(title ? { title } : {}), archived: archived || undefined }
  },

  // ── アカウント(ユーザー ID とパスワード。docs/endpoints/auth-login.md) ──
  // 5ch の BE と違って Cookie ではなく、ログインでもらったセッション ID を Authorization: Bearer で書き込みに付ける。
  // サイト(origin)はいくつもあり得るので、ログインは「サイトごと」に、書き込みのときに要るぶんだけ行う
  accounts: [{ id: ACCOUNT_ID, name: 'アカウント', site: 'red-edge.net', hosts: [ACCOUNT_HOST], userLabel: 'ユーザー ID' }],

  async login(accountId, credential, ctx) {
    if (accountId !== ACCOUNT_ID) return { ok: false, message: `知らないアカウントです(${accountId})` }
    savedCredential = credential
    sessions.clear()
    // もう分かっているサイト(板を開いたことがある)には、いまログインして確かめる
    const origins = [...apiBases.keys()].filter(isAccountSite)
    if (origins.length === 0) return { ok: true, message: '保存しました。この掲示板に書き込むときにログインします' }
    const results = await Promise.all(origins.map((o) => loginTo(o, credential, ctx).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }))))
    const ng = results.find((r) => !r.ok)
    return ng ?? { ok: true, message: `ログインしました(${origins.length} サイト)` }
  },

  async createPost(thread, input, ctx) {
    const { origin, boardId } = parts(thread.boardUrl)
    const api = await apiBaseOf(origin, ctx)
    const res = await postWithAuth(
      origin,
      `${api}/boards/${encodeURIComponent(boardId)}/threads/${encodeURIComponent(thread.key)}/posts`,
      JSON.stringify({ content: input.body, ...(input.name ? { posterName: input.name } : {}), ...(input.mail ? { posterOptionInfo: input.mail } : {}) }),
      input,
      ctx,
    )
    return readWrite(res, api, ctx)
  },

  async createThread(board, input, ctx) {
    const { origin, boardId } = parts(board.url)
    const api = await apiBaseOf(origin, ctx)
    const res = await postWithAuth(
      origin,
      `${api}/boards/${encodeURIComponent(boardId)}/threads`,
      JSON.stringify({ title: input.title, content: input.body, ...(input.name ? { posterName: input.name } : {}), ...(input.mail ? { posterOptionInfo: input.mail } : {}) }),
      input,
      ctx,
    )
    return readWrite(res, api, ctx)
  },

  threadWebUrl(thread) {
    const { origin, boardId } = parts(thread.boardUrl)
    return `${origin}/boards/${boardId}/${thread.key}`
  },

  /** 本文の上限は文字数(UTF-16 の長さ)で数える */
  postByteLength: (text) => text.length,
}
