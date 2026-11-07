// 同期の表の移行と拾い。PC は公開済みなので、016・017 まである DB に流しても何も壊れないことを確かめる
import { readdirSync, readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { applyNgDiff, LogStore, ngDiff, ngRuleFromBody, ngRuleToBody, UserOps, type SqlDb } from '../src/index'

const names = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()
const read = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf-8')
const SQL = await initSqlJs()

function wrap(db: initSqlJs.Database): SqlDb {
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
    async batch(statements) {
      db.exec('BEGIN')
      try {
        for (const s of statements) db.run(conv(s.sql), (s.params ?? []) as initSqlJs.BindParams)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

const OLD_TABLES = ['sites', 'boards', 'threads', 'posts', 'settings', 'favorite_boards', 'own_posts', 'favicons', 'uploads', 'ogp_cache', 'post_history', 'favorite_threads', 'accounts', 'drafts', 'troll_marks']

function oldDb(): initSqlJs.Database {
  const db = new SQL.Database()
  for (const f of names) if (f < '018') db.exec(read(f))
  // 公開済みの版の利用者のデータの形
  db.exec(`
    INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, cursor, status, created_at, fetched_at, read_at) VALUES ('https://a.5ch.io/x/', '100', '2ch-compat', 'スレ', 3, 2, '{"bytes":1}', 'active', 1, 2, 3);
    INSERT INTO posts (board_url, key, no, name, mail, date, id, body) VALUES ('https://a.5ch.io/x/', '100', 1, 'n', '', 'd', 'i', '本文');
    INSERT INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at) VALUES ('https://a.5ch.io/x/', '100', '2ch-compat', 'スレ', 1, 1, 5);
    INSERT INTO uploads (url, name, size, uploaded_at, with_account, hash, delete_url) VALUES ('https://i.test/a.png', 'a.png', 10, 20, 0, 'h', 'https://i.test/del');
    INSERT INTO settings (key, value) VALUES ('fontSize', '14');
    INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES ('2ch-compat', 'https://a.5ch.io/x/', '100', 'スレ', 1, 'n', '', '本文', 9);
  `)
  return db
}

const dump = (db: initSqlJs.Database, table: string) => db.exec(`SELECT * FROM ${table}`)[0]?.values ?? []
const shape = (db: initSqlJs.Database, table: string) => db.exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`)[0].values[0][0]

describe('018_sync.sql', () => {
  it('016・017 まである DB に流しても、既存の表の形と行が変わらない', () => {
    const db = oldDb()
    const before = OLD_TABLES.map((t) => [t, shape(db, t), dump(db, t)])
    db.exec(read('018_sync.sql'))
    expect(OLD_TABLES.map((t) => [t, shape(db, t), dump(db, t)])).toEqual(before)
    expect(db.exec('PRAGMA integrity_check')[0].values[0][0]).toBe('ok')
    for (const t of ['sync_records', 'sync_ops', 'sync_state']) expect(db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0]).toBe(0)
  })

  it('移行の後も、既存の関数がこれまでどおり読める', async () => {
    const db = oldDb()
    db.exec(read('018_sync.sql'))
    const store = new LogStore(wrap(db))
    expect((await store.listFavoriteThreads()).map((f) => f.thread.key)).toEqual(['100'])
    expect((await store.history()).map((h) => h.thread.key)).toEqual(['100'])
    expect((await store.listUploads())[0].deleteUrl).toBe('https://i.test/del')
    expect((await store.loadThread({ connectorId: '2ch-compat', boardUrl: 'https://a.5ch.io/x/', key: '100', title: '', postCount: 0, order: 0 }))?.posts).toHaveLength(1)
  })

  it('スマホの文の分け方でも同じ表になる(行頭のコメントを外し、行末の ; で区切る)', () => {
    const db = oldDb()
    const statements: string[] = []
    let cur = ''
    for (const line of read('018_sync.sql').split('\n')) {
      const t = line.trim()
      if (t === '' || t.startsWith('--')) continue
      cur += `${line}\n`
      if (t.endsWith(';')) {
        statements.push(cur)
        cur = ''
      }
    }
    expect(cur).toBe('')
    for (const s of statements) db.exec(s)
    expect(db.exec("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'sync_%'")[0].values[0][0]).toBe(7)
  })

  it('UPSERT を使わない(スマホの minSdk 26 は SQLite 3.18 で ON CONFLICT DO UPDATE が通らない)', () => {
    expect(read('018_sync.sql')).not.toMatch(/DO UPDATE/i)
  })
})

describe('UserOps', () => {
  const thread = { connectorId: '2ch-compat', boardUrl: 'https://a.5ch.io/x/', key: '1', title: 't', postCount: 0, order: 0, createdAt: new Date(1000) }
  function setup() {
    const db = new SQL.Database()
    for (const f of names) db.exec(read(f))
    const sql = wrap(db)
    const store = new LogStore(sql)
    return { db, sql, store, ops: new UserOps(store) }
  }
  const opsCount = (db: initSqlJs.Database) => db.exec('SELECT COUNT(*) FROM sync_ops')[0].values[0][0]

  it('同期が無効なら、今の関数と同じ行になり何も積まない', async () => {
    const a = setup()
    const b = setup()
    await a.ops.favoriteThreadAdd(thread, 5)
    await b.store.addFavoriteThread(thread, 5)
    expect(dump(a.db, 'favorite_threads')).toEqual(dump(b.db, 'favorite_threads'))
    expect(opsCount(a.db)).toBe(0)
    await a.ops.favoriteThreadRemove(thread)
    expect(dump(a.db, 'favorite_threads')).toEqual([])
    expect(opsCount(a.db)).toBe(0)
  })

  it('同期の表が読めなくても、利用者の操作は通る', async () => {
    const a = setup()
    a.db.exec('DROP TABLE sync_state')
    await a.ops.favoriteThreadAdd(thread, 5)
    expect(dump(a.db, 'favorite_threads')).toHaveLength(1)
  })

  it('同期が有効なら、更新と送信待ちが一緒に入る', async () => {
    const a = setup()
    a.db.exec("INSERT INTO sync_state (key, value) VALUES ('enabled', '1')")
    await a.ops.favoriteThreadAdd(thread, 5)
    const [[op, target, args, at]] = a.db.exec('SELECT op, target, args, at_ms FROM sync_ops')[0].values
    expect([op, at]).toEqual(['favorite_thread_add', 5])
    expect(target).toBe('https://a.5ch.io/x/\t1')
    expect(JSON.parse(args as string)).toEqual({ board_url: 'https://a.5ch.io/x/', key: '1' })
    expect(dump(a.db, 'favorite_threads')).toHaveLength(1)
  })

  it('送信待ちが書けなければ、データの更新も戻る', async () => {
    const a = setup()
    a.db.exec("INSERT INTO sync_state (key, value) VALUES ('enabled', '1')")
    a.db.exec('DROP TABLE sync_ops')
    await expect(a.ops.favoriteThreadAdd(thread, 5)).rejects.toThrow()
    expect(dump(a.db, 'favorite_threads')).toEqual([])
  })
})

describe('拾いの入口の検査', () => {
  const walk = (dir: URL): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx?$/.test(e.name) ? [new URL(e.name, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')] : []))

  it('画面はお気に入りのスレの関数を直接呼ばない', () => {
    const offenders = walk(new URL('../../../apps/desktop/src/', import.meta.url)).filter((f) => /\.(addFavoriteThread|removeFavoriteThread)\(/.test(readFileSync(decodeURIComponent(f), 'utf-8')))
    expect(offenders).toEqual([])
  })
})

describe('NG の差分', () => {
  const a = { id: 'a', target: 'content', pattern: 'a', isRegex: false, enabled: true }
  const b = { ...a, id: 'b', pattern: 'b' }
  const x = { ...a, id: 'x', pattern: 'x' }
  const old = { ...a, id: 'old', expiresOnDate: '2020-01-01' }

  it('窓の見ていた配列と比べるので、窓の知らない要素は消す差分に出ず、今の値に残る', () => {
    const d = ngDiff([a], [a, b], '2027-01-01')
    expect(d).toEqual({ upsert: [b], remove: [], drop: [] })
    expect(applyNgDiff([a, x], d)).toEqual([a, x, b])
  })

  it('期限切れと読み込みは送らず、手元からだけ消す', () => {
    expect(ngDiff([a, old], [a], '2027-01-01')).toEqual({ upsert: [], remove: [], drop: ['old'] })
    expect(ngDiff([a, b], [b], '2027-01-01', { keepRemoved: true })).toEqual({ upsert: [], remove: [], drop: ['a'] })
    expect(ngDiff([a, b], [b], '2027-01-01')).toEqual({ upsert: [], remove: ['a'], drop: [] })
  })

  it('本文と行き来しても同じ', () => {
    const full = { id: 'n', target: 'posterId', pattern: 'ID', isRegex: true, enabled: false, expiresOnDate: '2030-01-01', boardUrl: 'https://a.5ch.io/x/', boardName: '板', note: 'メモ', createdAt: 5 }
    expect(ngRuleFromBody(ngRuleToBody(full))).toEqual(full)
    expect(ngRuleFromBody(ngRuleToBody(a))).toEqual(a)
  })
})
