// 外付けのコネクタの見本(通信しない)。このフォルダを、アプリのデータフォルダの connectors/ の下にコピーし、
// 設定 → コネクタ で「読み込み直す」→「有効にする」を押すと使えます。
// URL 欄に https://sample.bbs-browser.invalid/board/ を入れると、この掲示板の板が開きます。
//
// 書き方の決まり(詳しくはリポジトリの docs/connectors.md):
// - defineConnector({ ... }) を 1 回呼ぶ。中身は、アプリの組み込みのコネクタと同じ形
// - 通信は ctx.http.get / ctx.http.post だけ(manifest.json の hosts に書いた先だけに届く)。fetch はない
// - 返す値は JSON にできるもの(日付の createdAt は Date のままでよい)

const ORIGIN = 'https://sample.bbs-browser.invalid'
const BOARD_URL = ORIGIN + '/board/'
const BOARD = { connectorId: 'sample-offline', url: BOARD_URL, name: '見本の掲示板' }
const THREAD = /^https:\/\/sample\.bbs-browser\.invalid\/board\/(\d+)\/?$/

const threads = [
  {
    key: '1',
    title: 'ようこそ(外付けのコネクタで動いています)',
    badges: [{ label: '固定', tone: 'accent' }],
    posts: [
      { no: 1, name: '管理人', mail: '', date: '2026/10/18 12:00', body: 'このスレは、フォルダに置いたコネクタから読んでいます。', badges: [{ label: '管理人', tone: 'danger' }] },
      { no: 2, name: '名無し', mail: '', date: '2026/10/18 12:01', body: '>>1\nいいねを押すと数が増えます' },
    ],
  },
  { key: '2', title: '雑談', posts: [{ no: 1, name: '名無し', mail: '', date: '2026/10/18 12:05', body: '書き込んでみてください' }] },
]
const likes = {}

function summary(t, order) {
  return {
    connectorId: 'sample-offline',
    boardUrl: BOARD_URL,
    key: t.key,
    title: t.title,
    postCount: t.posts.length,
    order,
    createdAt: new Date(Date.UTC(2026, 9, 18, 3, order)),
    badges: t.badges,
  }
}
function find(key) {
  const t = threads.find((x) => x.key === key)
  if (!t) throw new Error('ないスレです: ' + key)
  return t
}

defineConnector({
  capabilities: { post: true, images: false, incremental: true },
  reactions: [{ id: 'like', label: 'いいね', icon: 'thumb_up' }],
  postActions: [{ id: 'report', label: '通報', icon: 'flag', confirm: '通報します(見本なので、どこにも送りません)' }],

  canHandle: (url) => url.startsWith(ORIGIN + '/'),
  isThreadUrl: (url) => THREAD.test(url),
  threadWebUrl: (t) => BOARD_URL + t.key + '/',

  async resolveUrl(url) {
    const m = THREAD.exec(url)
    if (!m) return { board: BOARD }
    const i = threads.findIndex((t) => t.key === m[1])
    return i < 0 ? { board: BOARD } : { board: BOARD, thread: summary(threads[i], i) }
  },
  async boardInfo() {
    return { title: BOARD.name, nonameName: '名無し' }
  },
  async listBoards() {
    return [BOARD]
  },
  async listThreads() {
    return threads.map(summary)
  },
  // cursor は前回までに渡したレスの番号。それより後ろだけ返す(レスの no は届いた順の通し番号)
  async fetchPosts(thread, cursor) {
    const t = find(thread.key)
    const last = cursor ? cursor.last : 0
    const fresh = t.posts.filter((p) => p.no > last)
    const reactions = {}
    for (const [no, n] of Object.entries(likes[t.key] || {})) reactions[no] = { like: n }
    if (fresh.length === 0) return { status: 'notModified', posts: [], cursor: { last }, reactions }
    return { status: 'updated', posts: fresh, cursor: { last: t.posts[t.posts.length - 1].no }, title: t.title, reactions }
  },
  async createPost(thread, input) {
    const t = find(thread.key)
    t.posts.push({ no: t.posts.length + 1, name: input.name || '名無し', mail: input.mail, date: new Date().toISOString().slice(0, 16).replace('T', ' '), body: input.body })
    return { status: 'ok', message: '書き込みました(見本)' }
  },
  async react(thread, post, id) {
    const counts = (likes[thread.key] = likes[thread.key] || {})
    counts[post.no] = (counts[post.no] || 0) + 1
    return counts[post.no]
  },
  async runPostAction(thread, post) {
    return { status: 'ok', message: '>>' + post.no + ' を通報しました(見本)' }
  },
})
