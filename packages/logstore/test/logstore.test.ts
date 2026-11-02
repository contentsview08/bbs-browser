import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchPostsResult, Post, ThreadSummary } from '@bbs-browser/connectors'
import { LogStore, applyFetch, type SqlDb, type ThreadLog } from '../src/index'

// アプリと同じ順番で全マイグレーションを流す
const migrations = ['001_init.sql', '002_settings.sql', '003_favorite_boards.sql', '004_own_posts.sql', '005_favicons.sql', '006_uploads.sql', '007_upload_account.sql', '008_ogp.sql', '009_post_history.sql', '010_favorite_threads.sql', '011_accounts.sql', '012_drafts.sql', '013_post_ref.sql', '014_troll_marks.sql', '015_post_badges.sql'].map((f) =>
  readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf-8'),
)
const SQL = await initSqlJs()

/** sql.js を SqlDb に合わせる。$1 は SQLite の番号つき変数 ?1 に読み替える */
function sqljs(): SqlDb {
  const db = new SQL.Database()
  for (const m of migrations) db.exec(m)
  const conv = (sql: string) => sql.replace(/\$(\d+)/g, '?$1')
  return {
    async execute(sql, params = []) {
      db.run(conv(sql), params as initSqlJs.BindParams)
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const st = db.prepare(conv(sql))
      st.bind(params as initSqlJs.BindParams)
      const rows: T[] = []
      while (st.step()) rows.push(st.getAsObject() as T)
      st.free()
      return rows
    },
  }
}

const thread: ThreadSummary = {
  connectorId: '2ch-compat',
  boardUrl: 'https://medaka.5ch.io/prog/',
  key: '1790153911',
  title: 'subject.txt のスレタイ',
  postCount: 3,
  order: 0,
  createdAt: new Date(1790153911 * 1000),
}

const post = (no: number, body = `レス${no}`): Post => ({ no, name: '名無し', mail: '', date: '2026/10/15', body })

let store: LogStore
beforeEach(() => {
  store = new LogStore(sqljs())
})

describe('サイトと板', () => {
  it('初期状態で 5ch が入っていて、サイトを足せる', async () => {
    await store.addSite({ connectorId: '2ch-compat', name: '自分の板', menuUrl: 'https://bbs.example/bbsmenu.html' })
    expect((await store.listSites()).map((s) => s.name)).toEqual(['5ch', '自分の板'])
  })

  it('板一覧を並び順ごと保存して、置き換えられる', async () => {
    const menu = 'https://menu.5ch.io/bbsmenu.json'
    const boards = Array.from({ length: 1200 }, (_, i) => ({
      connectorId: '2ch-compat',
      url: `https://x.5ch.io/b${i}/`,
      name: `板${i}`,
      category: i % 2 ? 'A' : undefined,
    }))
    await store.replaceBoards(menu, boards)
    const saved = await store.getBoards(menu)
    expect(saved).toHaveLength(1200)
    expect(saved[1]).toEqual(boards[1])
    expect(saved[0].category).toBeUndefined()

    await store.replaceBoards(menu, boards.slice(0, 2))
    expect(await store.getBoards(menu)).toHaveLength(2)
  })
})

describe('スレのログ', () => {
  it('開いていないスレは null', async () => {
    expect(await store.loadThread(thread)).toBeNull()
  })

  it('初回の取得と差分を積み上げ、Cursor を保存する', async () => {
    await store.saveFetch(thread, { status: 'updated', posts: [post(1), post(2)], cursor: { bytes: 100 }, title: 'dat のスレタイ' })
    await store.saveFetch(thread, { status: 'updated', posts: [post(3)], cursor: { bytes: 150 } })

    const log = await store.loadThread(thread)
    expect(log?.posts.map((p) => p.no)).toEqual([1, 2, 3])
    expect(log?.cursor).toEqual({ bytes: 150 })
    expect(log?.title).toBe('dat のスレタイ')
    expect(log?.postCount).toBe(3)
  })

  it('板の本当の番号(ref)があれば保存して読み戻す。なければ付けない', async () => {
    await store.saveFetch(thread, { status: 'updated', posts: [{ ...post(1), ref: 123456789 }, post(2)], cursor: null })
    const log = await store.loadThread(thread)
    expect(log?.posts[0].ref).toBe(123456789)
    expect('ref' in (log?.posts[1] ?? {})).toBe(false)
  })

  it('reset なら全件を置き換える', async () => {
    await store.saveFetch(thread, { status: 'updated', posts: [post(1), post(2), post(3)], cursor: { bytes: 150 } })
    await store.saveFetch(thread, { status: 'reset', posts: [post(1), post(2, 'あぼーん')], cursor: { bytes: 90 } })

    const log = await store.loadThread(thread)
    expect(log?.posts.map((p) => p.body)).toEqual(['レス1', 'あぼーん'])
    expect(log?.postCount).toBe(2)
  })

  it('dat 落ちになってもログは消さない', async () => {
    await store.saveFetch(thread, { status: 'updated', posts: [post(1)], cursor: { bytes: 50 } })
    await store.saveFetch(thread, { status: 'archived', posts: [], cursor: { bytes: 50 } })

    const log = await store.loadThread(thread)
    expect(log?.status).toBe('archived')
    expect(log?.posts).toHaveLength(1)
  })

  it('同じ差分を二度保存しても(cursor 更新前に落ちた場合)重複しない', async () => {
    const r = { status: 'updated' as const, posts: [post(1), post(2)], cursor: { bytes: 100 } }
    await store.saveFetch(thread, r)
    await store.saveFetch(thread, r)
    expect((await store.loadThread(thread))?.posts).toHaveLength(2)
  })

  it('既読位置は戻らず、履歴と板ごとの状態に出る', async () => {
    await store.saveFetch(thread, { status: 'updated', posts: [post(1), post(2), post(3)], cursor: { bytes: 150 } })
    await store.markRead(thread, 3, 1000)
    await store.markRead(thread, 1, 2000)

    const states = await store.getThreadStates(thread.boardUrl)
    expect(states.get(thread.key)).toEqual({ postCount: 3, readNo: 3, status: 'active' })

    const [h] = await store.history()
    expect(h.readAt).toBe(2000)
    expect(h.thread).toMatchObject({ boardUrl: thread.boardUrl, key: thread.key, connectorId: '2ch-compat' })
    expect(h.thread.createdAt?.getTime()).toBe(thread.createdAt?.getTime())
  })
})

describe('applyFetch: 取得結果を手元のログに当てはめる', () => {
  it('DB に書いて読み直したものと同じになる', async () => {
    const steps: FetchPostsResult[] = [
      { status: 'updated', posts: [post(1), post(2)], cursor: { bytes: 100 }, title: 'dat のスレタイ' },
      { status: 'notModified', posts: [], cursor: { bytes: 100 } },
      { status: 'updated', posts: [post(3), post(4)], cursor: { bytes: 200 } },
      // 同じ番号が来たら置き換える
      { status: 'updated', posts: [post(4, '書き直し'), post(5)], cursor: { bytes: 260 } },
      { status: 'reset', posts: [post(1), post(2, 'あぼーん'), post(3)], cursor: { bytes: 120 } },
      { status: 'archived', posts: [], cursor: { bytes: 120 } },
      // 過去ログから取れた(レスは保存し、dat 落ちのまま)
      { status: 'reset', posts: [post(1), post(2), post(3), post(4)], cursor: { bytes: 300 }, archived: true },
      // 一度 active に戻っても(古い版で取ったときなど)、過去ログの「変わらない」で dat 落ちに直る
      { status: 'reset', posts: [post(1), post(2), post(3), post(4)], cursor: { bytes: 300 } },
      { status: 'notModified', posts: [], cursor: { bytes: 300 }, archived: true },
    ]
    let mine: ThreadLog | null = null
    for (const r of steps) {
      await store.saveFetch(thread, r)
      mine = applyFetch(mine, thread, r)
      const fromDb = (await store.loadThread(thread))!
      expect(mine).toEqual(fromDb)
    }
    expect(mine?.status).toBe('archived')
  })

  it('変わらなかったときは同じものを返す(描き直さずに済むように)', () => {
    const before = applyFetch(null, thread, { status: 'updated', posts: [post(1)], cursor: { bytes: 10 } })
    expect(applyFetch(before, thread, { status: 'notModified', posts: [], cursor: { bytes: 10 } })).toBe(before)
  })
})

describe('設定', () => {
  it('JSON で保存して読み戻せる', async () => {
    await store.setSetting('scheme', 'light')
    await store.setSetting('fontSize', 4)
    await store.setSetting('scheme', '2ch-classic')
    expect(await store.getSettings()).toEqual({ scheme: '2ch-classic', fontSize: 4 })
  })
})

describe('お気に入り板', () => {
  it('初期状態でエッヂが入っていて、足したり外したりできる', async () => {
    expect((await store.listFavorites()).map((b) => b.name)).toEqual(['エッヂ'])
    const prog = { connectorId: '2ch-compat', url: 'https://medaka.5ch.io/prog/', name: 'プログラマー' }
    await store.addFavorite(prog)
    await store.addFavorite(prog)
    expect((await store.listFavorites()).map((b) => b.name)).toEqual(['エッヂ', 'プログラマー'])
    await store.removeFavorite('https://bbs.eddibb.cc/liveedge/')
    expect(await store.listFavorites()).toEqual([prog])
  })

  it('サイトを消すと、そのサイトの板一覧のキャッシュも消える', async () => {
    const menu = 'https://bbs.example/bbsmenu.html'
    await store.addSite({ connectorId: '2ch-compat', name: 'x', menuUrl: menu })
    await store.replaceBoards(menu, [{ connectorId: '2ch-compat', url: 'https://bbs.example/a/', name: 'a' }])
    await store.removeSite(menu)
    expect((await store.listSites()).map((s) => s.name)).toEqual(['5ch'])
    expect(await store.getBoards(menu)).toEqual([])
  })
})

describe('自分の書き込み', () => {
  it('スレごとに番号を覚える', async () => {
    await store.addOwnPost(thread, 12)
    await store.addOwnPost(thread, 5)
    await store.addOwnPost(thread, 12)
    await store.addOwnPost({ ...thread, key: '1' }, 3)
    expect(await store.getOwnPosts(thread)).toEqual([5, 12])
  })

  it('印を外せる(ほかのスレの同じ番号は残す)', async () => {
    await store.addOwnPost(thread, 3)
    await store.addOwnPost(thread, 7)
    await store.addOwnPost({ ...thread, key: '1' }, 3)
    await store.removeOwnPost(thread, 3)
    expect(await store.getOwnPosts(thread)).toEqual([7])
    expect(await store.getOwnPosts({ ...thread, key: '1' })).toEqual([3])
  })
})

describe('ログの削除', () => {
  it('レス・既読位置・自分の書き込みを消し、ほかのスレは残す', async () => {
    const other = { ...thread, key: '1' }
    await store.saveFetch(thread, { status: 'updated', posts: [post(1), post(2)], cursor: { bytes: 100 } })
    await store.saveFetch(other, { status: 'updated', posts: [post(1)], cursor: { bytes: 50 } })
    await store.markRead(thread, 2)
    await store.addOwnPost(thread, 2)

    await store.deleteThread(thread)
    expect(await store.loadThread(thread)).toBeNull()
    expect(await store.getOwnPosts(thread)).toEqual([])
    expect(await store.history()).toEqual([])
    expect((await store.loadThread(other))?.posts).toHaveLength(1)
  })
})

describe('お気に入り板の並べ替えとファビコン', () => {
  it('渡した並びにする', async () => {
    const a = { connectorId: '2ch-compat', url: 'https://a.example/a/', name: 'あ' }
    const b = { connectorId: '2ch-compat', url: 'https://b.example/b/', name: 'い' }
    await store.addFavorite(a)
    await store.addFavorite(b)
    await store.reorderFavorites([b.url, 'https://bbs.eddibb.cc/liveedge/', a.url])
    expect((await store.listFavorites()).map((f) => f.name)).toEqual(['い', 'エッヂ', 'あ'])
  })

  it('ファビコンを保存して読み戻す', async () => {
    expect(await store.getFavicon('https://bbs.eddibb.cc/liveedge/')).toBeNull()
    await store.setFavicon('https://bbs.eddibb.cc/liveedge/', 'data:image/x-icon;base64,AAAA', 1000)
    expect(await store.getFavicon('https://bbs.eddibb.cc/liveedge/')).toEqual({ data: 'data:image/x-icon;base64,AAAA', fetchedAt: 1000 })
  })
})

describe('アップロード履歴', () => {
  it('新しい順に並べ、消せる', async () => {
    await store.addUpload({ url: 'https://files.catbox.moe/a.png', name: 'a.png', size: 10, withAccount: false }, 1000)
    await store.addUpload({ url: 'https://files.catbox.moe/b.jpg', name: 'b.jpg', size: 20, withAccount: true }, 2000)
    expect((await store.listUploads()).map((u) => [u.name, u.withAccount])).toEqual([
      ['b.jpg', true],
      ['a.png', false],
    ])
    await store.removeUpload('https://files.catbox.moe/b.jpg')
    expect(await store.listUploads()).toEqual([
      { url: 'https://files.catbox.moe/a.png', name: 'a.png', size: 10, uploadedAt: 1000, withAccount: false },
    ])
  })
})

describe('リンクのプレビュー', () => {
  it('覚えて、取れなかったページも null として覚え、古いものは捨てる', async () => {
    await store.setOgp('https://a.example/', '{"title":"A"}', 1000)
    await store.setOgp('https://b.example/', null, 2000)
    expect(await store.getOgp('https://a.example/')).toEqual({ data: '{"title":"A"}', fetchedAt: 1000 })
    expect(await store.getOgp('https://b.example/')).toEqual({ data: null, fetchedAt: 2000 })
    expect(await store.getOgp('https://c.example/')).toBeNull()
    await store.pruneOgp(1500)
    expect(await store.getOgp('https://a.example/')).toBeNull()
    expect(await store.getOgp('https://b.example/')).not.toBeNull()
  })
})

describe('書き込み履歴', () => {
  it('新しい順に返し、スレのログを消しても残る', async () => {
    await store.saveFetch(thread, { status: 'updated', posts: [post(1)], cursor: { bytes: 10 } })
    await store.addPostHistory(thread, { no: 2, name: '', mail: 'sage', body: '一つ目' }, 1000)
    await store.addPostHistory(thread, { name: '名前', mail: '', body: '番号が分からなかった' }, 2000)
    await store.deleteThread(thread)
    const list = await store.listPostHistory()
    expect(list.map((e) => [e.no, e.body])).toEqual([
      [undefined, '番号が分からなかった'],
      [2, '一つ目'],
    ])
    expect(list[0].thread).toMatchObject({ boardUrl: thread.boardUrl, key: thread.key, title: thread.title })
    await store.deletePostHistory(list[0].id)
    expect(await store.listPostHistory()).toHaveLength(1)
  })
})

describe('お気に入りのスレ', () => {
  it('足した順に並べ、ログがあれば既読とレス数を付け、ログを消しても残る', async () => {
    const other = { ...thread, key: '1', title: 'ほかのスレ' }
    await store.addFavoriteThread(thread)
    await store.addFavoriteThread(other)
    await store.addFavoriteThread(thread)
    await store.saveFetch(thread, { status: 'updated', posts: [post(1), post(2)], cursor: { bytes: 100 }, title: 'dat のスレタイ' })
    await store.markRead(thread, 1)
    let list = await store.listFavoriteThreads()
    expect(list.map((f) => [f.thread.key, f.thread.title, f.postCount, f.readNo])).toEqual([
      [thread.key, 'dat のスレタイ', 2, 1],
      ['1', 'ほかのスレ', 0, 0],
    ])
    await store.deleteThread(thread)
    list = await store.listFavoriteThreads()
    expect(list.map((f) => [f.thread.key, f.postCount])).toEqual([
      [thread.key, 0],
      ['1', 0],
    ])
    await store.removeFavoriteThread(other)
    expect(await store.listFavoriteThreads()).toHaveLength(1)
  })
})

describe('アカウント', () => {
  it('覚えて、書き換えて、消す', async () => {
    const be = { connectorId: '2ch-compat', accountId: 'be', user: 'a@example.com', password: 'p', autoLogin: true }
    await store.setAccount(be)
    await store.setAccount({ ...be, password: 'q', autoLogin: false })
    expect(await store.listAccounts()).toEqual([{ ...be, password: 'q', autoLogin: false }])
    await store.deleteAccount('2ch-compat', 'be')
    expect(await store.listAccounts()).toEqual([])
  })
})

describe('古いログの整理', () => {
  it('しばらく開いていないスレだけ消し、お気に入り・自分が書いたスレ・開いているタブは残す', async () => {
    const t = (key: string): ThreadSummary => ({ ...thread, key })
    const fetched = { status: 'updated' as const, posts: [post(1)], cursor: null }
    for (const key of ['old', 'fav', 'own', 'tab', 'new']) await store.saveFetch(t(key), fetched, key === 'new' ? 2000 : 100)
    await store.addFavoriteThread(t('fav'))
    await store.addOwnPost(t('own'), 1)
    const removed = await store.pruneLogs(1000, [{ boardUrl: thread.boardUrl, key: 'tab' }])
    expect(removed).toBe(1)
    expect(await store.loadThread(t('old'))).toBeNull()
    for (const key of ['fav', 'own', 'tab', 'new']) expect(await store.loadThread(t(key))).not.toBeNull()
  })
})

describe('自動 NG の印', () => {
  it('本文の鍵ごとに 1 つ。付け直したら置き換わり、外せる', async () => {
    const base = { body: '貼り付け', boardUrl: thread.boardUrl, createdAt: 1 }
    await store.setTrollMark({ ...base, bodyKey: 'a', troll: true, reason: 'dup' })
    await store.setTrollMark({ ...base, bodyKey: 'b', troll: false, createdAt: 2 })
    await store.setTrollMark({ ...base, bodyKey: 'a', troll: false, createdAt: 3 })
    expect(await store.listTrollMarks()).toEqual([
      { ...base, bodyKey: 'b', troll: false, reason: undefined, createdAt: 2 },
      { ...base, bodyKey: 'a', troll: false, reason: undefined, createdAt: 3 },
    ])
    await store.removeTrollMark('b')
    expect((await store.listTrollMarks()).map((m) => m.bodyKey)).toEqual(['a'])
  })
})

describe('書き込みの下書き', () => {
  it('スレごとに覚え、空にしたら消す', async () => {
    await store.setDraft(thread, '書きかけ')
    await store.setDraft({ ...thread, key: '1' }, 'ほかのスレ')
    expect(await store.getDraft(thread)).toBe('書きかけ')
    await store.setDraft(thread, '書き足した')
    expect(await store.getDraft(thread)).toBe('書き足した')
    await store.setDraft(thread, '  ')
    expect(await store.getDraft(thread)).toBeUndefined()
    expect(await store.getDraft({ ...thread, key: '1' })).toBe('ほかのスレ')
  })
})
