import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Post, ThreadSummary } from '@bbs-browser/connectors'
import { LogStore, type SqlDb } from '../src/index'

// アプリと同じ順番で全マイグレーションを流す
const migrations = ['001_init.sql', '002_settings.sql'].map((f) =>
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

describe('設定', () => {
  it('JSON で保存して読み戻せる', async () => {
    await store.setSetting('scheme', 'light')
    await store.setSetting('fontSize', 4)
    await store.setSetting('scheme', '2ch-classic')
    expect(await store.getSettings()).toEqual({ scheme: '2ch-classic', fontSize: 4 })
  })
})
