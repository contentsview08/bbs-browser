// お試しの掲示板(通信しない)。アプリの共通の部品(反応・操作・印・添付のない書き込みなど)を、
// 本物の掲示板なしで確かめるためのもの。開発中のアプリだけに出す(apps/desktop が import.meta.env.DEV のときに足す)。
// URL は https://demo.bbs-browser.invalid/ の下(.invalid は使われることのないドメイン)。
// コネクタの決まりの使い方を一通り入れてある

import type { Board, Connector, FetchPostsResult, Post, PostResult, ThreadSummary } from '../types'

const ID = 'demo'
const ORIGIN = 'https://demo.bbs-browser.invalid'
const BOARD_URL = `${ORIGIN}/board/`
const BOARD: Board = { connectorId: ID, url: BOARD_URL, name: 'お試しの掲示板' }
const THREAD_URL = /^https:\/\/demo\.bbs-browser\.invalid\/board\/(\d+)\/?$/

interface DemoThread {
  key: string
  title: string
  posts: Post[]
  badges?: ThreadSummary['badges']
}

const now = Date.UTC(2026, 9, 18, 3, 0, 0)
const date = (min: number) => new Date(now + min * 60_000).toISOString().replace('T', ' ').slice(0, 16)
const post = (no: number, body: string, extra: Partial<Post> = {}): Post => ({ no, name: '名無しさん', mail: '', date: date(no), id: `id${no % 4}`, body, ...extra })

/** 掲示板の中身(アプリを閉じるまで覚えている。書き込みや反応で変わる) */
const threads: DemoThread[] = [
  {
    key: '1000',
    title: '【お知らせ】お試しの掲示板の使い方',
    badges: [{ label: '固定', tone: 'accent', title: 'いつも一覧の上に出すスレ' }],
    posts: [
      post(1, 'この掲示板は通信しません。反応(いいね・草・低評価)、操作(通報・保存)、印(管理人・認証済み)を試せます。', {
        name: '管理人',
        badges: [{ label: '管理人', tone: 'danger' }],
      }),
      post(2, '>>1\nいいねを押すと数が増えます', { badges: [{ label: '認証済み', tone: 'success' }] }),
      post(3, '通報はメニューの「その他」から。押す前に確かめが出ます'),
    ],
  },
  {
    key: '1001',
    title: '雑談スレ',
    posts: [post(1, '雑談しましょう'), post(2, '>>1\nこんにちは'), post(3, '草'), post(4, '>>2\nどうも')],
  },
  {
    key: '1002',
    title: '終わったスレ',
    badges: [{ label: 'ロック', tone: 'muted', title: 'もう書き込めないスレ' }],
    posts: [post(1, 'このスレは書き込めません')],
  },
]
/** 反応の数(スレのキー → レス番号 → 反応 → 数) */
const reactions = new Map<string, Record<string, Record<string, number>>>([
  ['1000', { '1': { like: 12, kusa: 3 }, '2': { like: 2 } }],
  ['1001', { '3': { kusa: 8, dislike: 1 } }],
])

const summary = (t: DemoThread, order: number): ThreadSummary => ({
  connectorId: ID,
  boardUrl: BOARD_URL,
  key: t.key,
  title: t.title,
  postCount: t.posts.length,
  order,
  createdAt: new Date(now - (threads.length - order) * 3_600_000),
  ...(t.badges && { badges: t.badges }),
})
const find = (key: string) => {
  const t = threads.find((x) => x.key === key)
  if (!t) throw new Error(`お試しの掲示板にないスレです: ${key}`)
  return t
}

export const demoConnector: Connector = {
  id: ID,
  name: 'お試しの掲示板',
  reactions: [
    { id: 'like', label: 'いいね', icon: 'thumb_up' },
    { id: 'kusa', label: '草', icon: 'grass' },
    { id: 'dislike', label: '低評価', icon: 'thumb_down' },
  ],
  postActions: [
    { id: 'report', label: '通報', icon: 'flag', confirm: 'このレスを管理人に通報します(お試しなので、どこにも送りません)', danger: true },
    { id: 'save', label: 'このレスを保存', icon: 'bookmark_add' },
  ],

  canHandle: (url) => url.startsWith(`${ORIGIN}/`),
  isThreadUrl: (url) => THREAD_URL.test(url),
  threadWebUrl: (t) => `${BOARD_URL}${t.key}/`,

  async resolveUrl(url) {
    if (!url.startsWith(`${ORIGIN}/`)) return null
    const m = THREAD_URL.exec(url)
    if (!m) return { board: BOARD }
    const i = threads.findIndex((t) => t.key === m[1])
    return i < 0 ? { board: BOARD } : { board: BOARD, thread: summary(threads[i], i) }
  },

  async boardInfo() {
    return { title: BOARD.name, nonameName: '名無しさん' }
  },

  async listBoards() {
    return [BOARD]
  },

  async listThreads() {
    return threads.map(summary)
  },

  // しおりは「何番まで渡したか」。それより後のレスだけ返す
  async fetchPosts(thread, rawCursor): Promise<FetchPostsResult> {
    const t = find(thread.key)
    const last = (rawCursor as { last?: number } | null)?.last ?? 0
    const fresh = t.posts.filter((p) => p.no > last)
    const counts = reactions.get(t.key) ?? {}
    if (fresh.length === 0) return { status: 'notModified', posts: [], cursor: { last }, reactions: counts }
    return { status: 'updated', posts: fresh, cursor: { last: t.posts.at(-1)!.no }, title: t.title, reactions: counts }
  },

  async createPost(thread, input): Promise<PostResult> {
    const t = find(thread.key)
    if (t.badges?.some((b) => b.label === 'ロック')) return { status: 'error', message: 'このスレは書き込めません(ロック)' }
    const no = t.posts.length + 1
    t.posts.push(post(no, input.body, { name: input.name || '名無しさん', mail: input.mail }))
    return { status: 'ok', message: '書き込みました(お試し)', resNumber: no }
  },

  async react(thread, p, reactionId) {
    const counts = reactions.get(thread.key) ?? {}
    const key = String(p.ref ?? p.no)
    const n = (counts[key]?.[reactionId] ?? 0) + 1
    counts[key] = { ...counts[key], [reactionId]: n }
    reactions.set(thread.key, counts)
    return n
  },

  async runPostAction(_thread, p, actionId): Promise<PostResult> {
    if (actionId === 'report') return { status: 'ok', message: `>>${p.no} を通報しました(お試し)` }
    if (actionId === 'save') return { status: 'ok', message: `>>${p.no} を保存しました(お試し)` }
    return { status: 'error', message: `お試しの掲示板にない操作です: ${actionId}` }
  },
}
