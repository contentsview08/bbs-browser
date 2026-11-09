// Drive の置き場(drive.ts)の、共通シナリオでは書けない決まり。偽の Drive(fakeDrive.ts)を相手にし、本物の Google には繋がない
import { describe, expect, it } from 'vitest'
import { deriveKeys, driveRemote, openRecords, recordId, sealPayload, spaceId, SyncApiError, writeRecord, type SyncPayload, type SyncRemote, type SyncSqlDb, type SyncTransport } from '../src/index'
import { FAKE_DRIVE_TOKEN, FakeDrive } from './fakeDrive'
import { keyOf, testDb } from './scenarioRunner'

const START = 1_800_000_000_000
const keys = deriveKeys(keyOf('pc'))
const sid = spaceId(keys.auth_token)

function world() {
  const w = { now: START, drive: null as unknown as FakeDrive }
  w.drive = new FakeDrive(() => w.now)
  const transport: SyncTransport = { send: async (req) => w.drive.handle({ method: req.method, url: req.url, headers: req.headers, body: req.body }) }
  const device = (deviceId: string, accessToken: (fresh: boolean) => Promise<string> = async () => FAKE_DRIVE_TOKEN) => {
    const db = testDb()
    const remote = (): SyncRemote => driveRemote({ transport, accessToken })({ db, keys, spaceId: sid, deviceId, now: () => w.now })
    return { db, remote }
  }
  return { w, device }
}

const payload = (key: string, hlc = '01a3185c5000.0000.pc'): SyncPayload => ({ kind: 'favorite', hlc, device_id: 'pc', body: { board_url: 'https://a.5ch.io/x/', thread: key, title: key } })

/** 同期の表に行を置き、送る形の封をしたものを返す(エンジンの pushAll と同じ形) */
async function stored(db: SyncSqlDb, key: string, hlc?: string): Promise<Record<string, unknown>> {
  const id = recordId(keys.k_id, 'favorite', 'https://a.5ch.io/x/', key)
  const p = payload(key, hlc)
  await db.batch([writeRecord({ record_id: id, kind: 'favorite', kind_tag: 'h', schema_version: 1, payload: p, hlc: p.hlc, version: 0, pending: true, priority: 0, needs_apply: false, ref_board: null, ref_thread: null, ref_detail: null, ref_local: null, tomb_at: null })])
  return { record_id: id, base_version: 0, kind_tag: 'h', schema_version: 1, deleted: false, ...sealPayload(keys, { space_id: sid, record_id: id, kind_tag: 'h', schema_version: 1 }, p) }
}

/** エンジンと同じく、読んだ分の控えを書く */
async function read(db: SyncSqlDb, r: SyncRemote, since: number) {
  const page = await r.changes(since)
  await db.batch([...(page.commit ?? []), { sql: "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('since', $1)", params: [String(page.head)] }, { sql: "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('epoch', $1)", params: [page.epoch] }])
  return page
}

describe('Drive の置き場', () => {
  it('目印がなければ 404(領域がない)。作れば全件を読め、空でも次からは変更だけを読む', async () => {
    const { device } = world()
    const pc = device('pc')
    await expect(pc.remote().changes(0)).rejects.toMatchObject({ kind: 'http', status: 404 })
    const { epoch } = await pc.remote().createSpace(null)
    const page = await read(pc.db, pc.remote(), 0)
    expect(page).toMatchObject({ records: [], epoch, more: false, gc_floor: 0 })
    expect(page.head).toBeGreaterThan(0)
  })

  it('自分の書いたものは読み戻さない。前置きの token が同じなら 1 回の確認で済む', async () => {
    const { w, device } = world()
    const pc = device('pc')
    const phone = device('phone')
    await pc.remote().createSpace(null)
    await read(pc.db, pc.remote(), 0)
    await read(phone.db, phone.remote(), 0)
    const res = await pc.remote().pushRecords('r', [await stored(pc.db, '1')])
    expect(res.results).toEqual([{ record_id: expect.any(String), status: 200, version: 2 }])
    // 自分のセグメントだけの変化は「変化なし」にして token を進める
    expect((await pc.remote().head(null)).version).toBeNull()
    const units = w.drive.units
    expect((await pc.remote().head(null)).version).toBeNull()
    expect(w.drive.units - units).toBe(5)
    // 相手は変化ありと見て、1 回のダウンロードで読む
    expect((await phone.remote().head(null)).version).not.toBeNull()
    const downloads = w.drive.calls['files.get(media)'] ?? 0
    const page = await read(phone.db, phone.remote(), 1)
    expect(openRecords(keys, sid, page.records).records.map((r) => r.payload.body?.thread)).toEqual(['1'])
    expect(w.drive.calls['files.get(media)']).toBe(downloads + 1)
    // 読んだ版は読み直さない
    expect((await read(phone.db, phone.remote(), page.head)).records).toEqual([])
  })

  it('ほかの Drive のファイルで token が進んでも、変化なしにする', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await read(pc.db, pc.remote(), 0)
    w.drive.touchOther()
    const lists = w.drive.calls['changes.list'] ?? 0
    expect((await pc.remote().head(null)).version).toBeNull()
    expect(w.drive.calls['changes.list']).toBe(lists + 1)
    expect((await pc.remote().head(null)).version).toBeNull()
    expect(w.drive.calls['changes.list']).toBe(lists + 1)
  })

  it('同じセグメントを上書きし、同じレコードは 1 件にまとめる。UTC の日が変わったら次のセグメント', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await read(pc.db, pc.remote(), 0)
    await pc.remote().pushRecords('r1', [await stored(pc.db, '1'), await stored(pc.db, '2')])
    await pc.remote().pushRecords('r2', [await stored(pc.db, '1', '01a3185c6000.0000.pc')])
    const segs = () => w.drive.filesOf(sid).filter((f) => f.appProperties.t === 'seg')
    expect(segs().map((f) => [f.appProperties.n, f.version])).toEqual([['1', 2]])
    const opened = openRecords(keys, sid, w.drive.recordsOf(sid).map((r) => ({ ...r, version: 1 })))
    expect(opened.records.map((r) => [r.payload.body?.thread, r.payload.hlc]).sort()).toEqual([['1', '01a3185c6000.0000.pc'], ['2', '01a3185c5000.0000.pc']])
    w.now += 24 * 60 * 60 * 1000
    await pc.remote().pushRecords('r3', [await stored(pc.db, '3')])
    expect(segs().map((f) => f.appProperties.n)).toEqual(['1', '2'])
  })

  it('表から消えたレコードの入ったセグメントは上書きせずに閉じる(Drive から値を消さない)', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await read(pc.db, pc.remote(), 0)
    await pc.remote().pushRecords('r1', [await stored(pc.db, '1')])
    await pc.db.batch([{ sql: 'DELETE FROM sync_records' }])
    await pc.remote().pushRecords('r2', [await stored(pc.db, '2')])
    expect(w.drive.recordsOf(sid)).toHaveLength(2)
  })

  it('2 台が同時に目印を作っても 1 つになり、同じ epoch になる', async () => {
    const { w, device } = world()
    const [a, b] = await Promise.all([device('pc').remote().createSpace(null), device('phone').remote().createSpace(null)])
    expect(a.epoch).toBe(b.epoch)
    expect(w.drive.filesOf(sid).filter((f) => f.appProperties.t === 'space')).toHaveLength(1)
  })

  it('目印が消えたら 404、e が替わったら新しい epoch を返す', async () => {
    const { w, device } = world()
    const pc = device('pc')
    const phone = device('phone')
    const { epoch } = await pc.remote().createSpace(null)
    await read(phone.db, phone.remote(), 0)
    w.drive.bumpEpoch(sid)
    const page = await phone.remote().changes(1)
    expect(page.epoch).not.toBe(epoch)
    w.drive.deleteSpace(sid)
    await expect(phone.remote().changes(1)).rejects.toMatchObject({ kind: 'http', status: 404 })
  })

  it('token を断られたら、全件を読み直す(手元は消さない読み方)', async () => {
    const { device } = world()
    const pc = device('pc')
    const phone = device('phone')
    await pc.remote().createSpace(null)
    await read(pc.db, pc.remote(), 0)
    await pc.remote().pushRecords('r', [await stored(pc.db, '1')])
    await read(phone.db, phone.remote(), 0)
    await phone.db.batch([{ sql: "UPDATE sync_state SET value = '999999' WHERE key = 'drive_token'" }])
    const page = await phone.remote().changes(5)
    expect(page.records).toHaveLength(1)
    expect(page.records[0].version).toBe(6)
  })

  it('見出しが appProperties と違うファイルは丸ごと捨てて数える', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    w.drive.putRecord(sid, 'other', { record_id: 'x' })
    const f = w.drive.filesOf(sid).find((x) => x.appProperties.d === 'other')!
    f.content = f.content.replace('"device":"other"', '"device":"someone"')
    const page = await pc.remote().changes(0)
    expect(page.records).toEqual([])
    expect(page.bad).toEqual(['drive_mismatch'])
  })

  it('401 はアクセストークンを 1 回だけ取り直して送り直す。取り直せなければ google_auth_failed', async () => {
    const { device } = world()
    const asked: boolean[] = []
    const pc = device('pc', async (fresh) => {
      asked.push(fresh)
      return fresh ? FAKE_DRIVE_TOKEN : 'expired'
    })
    await pc.remote().createSpace(null)
    expect(asked.slice(0, 2)).toEqual([false, true])
    const revoked = device('phone', async (fresh) => {
      if (fresh) throw new SyncApiError('http', 401, 'google_auth_failed')
      return 'expired'
    })
    await expect(revoked.remote().changes(0)).rejects.toMatchObject({ kind: 'http', status: 401, code: 'google_auth_failed' })
  })

  it('容量超過は 413 quota_exceeded、利用者の上限は 429 に写す', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await read(pc.db, pc.remote(), 0)
    w.drive.quotaBytes = 10
    await expect(pc.remote().pushRecords('r', [await stored(pc.db, '1')])).rejects.toMatchObject({ kind: 'http', status: 413, code: 'quota_exceeded' })
  })
})

describe('偽の Drive の決まり', () => {
  const req = (method: string, path: string, body?: string, type?: string) => ({ method, url: `https://www.googleapis.com${path}`, headers: { Authorization: `Bearer ${FAKE_DRIVE_TOKEN}`, ...(type && { 'Content-Type': type }) }, body })
  const mp = (meta: unknown, content: string) => ({ body: `--b\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--b\r\nContent-Type: application/json\r\n\r\n${content}\r\n--b--`, type: 'multipart/related; boundary=b' })

  it('appDataFolder の外には作れず、appProperties は 1 つ 124 バイトまで', () => {
    const d = new FakeDrive(() => START)
    const outside = mp({ name: 'x' }, '')
    expect(d.handle(req('POST', '/upload/drive/v3/files?uploadType=multipart', outside.body, outside.type)).status).toBe(403)
    const long = mp({ name: 'x', parents: ['appDataFolder'], appProperties: { k: 'v'.repeat(124) } }, '')
    expect(d.handle(req('POST', '/upload/drive/v3/files?uploadType=multipart', long.body, long.type)).status).toBe(400)
    const okBody = mp({ name: 'x', parents: ['appDataFolder'], appProperties: { k: 'v'.repeat(123) } }, '{}')
    expect(d.handle(req('POST', '/upload/drive/v3/files?uploadType=multipart', okBody.body, okBody.type)).status).toBe(200)
  })

  it('spaces=appDataFolder を付けないと見えない。消えたファイルは removed で来る。token は数で、知らない値は 400', () => {
    const d = new FakeDrive(() => START)
    const start = JSON.parse(d.handle(req('GET', '/drive/v3/changes/startPageToken')).body).startPageToken as string
    const m = mp({ name: 'x', parents: ['appDataFolder'] }, '{}')
    const id = JSON.parse(d.handle(req('POST', '/upload/drive/v3/files?uploadType=multipart', m.body, m.type)).body).id as string
    expect(JSON.parse(d.handle(req('GET', '/drive/v3/files')).body).files).toEqual([])
    expect(JSON.parse(d.handle(req('GET', '/drive/v3/files?spaces=appDataFolder')).body).files).toHaveLength(1)
    expect(d.handle(req('DELETE', `/drive/v3/files/${id}`)).status).toBe(204)
    const list = JSON.parse(d.handle(req('GET', `/drive/v3/changes?pageToken=${start}&spaces=appDataFolder`)).body)
    expect(list.changes).toMatchObject([{ fileId: id, removed: true }])
    expect(list.newStartPageToken).not.toBe(start)
    expect(d.handle(req('GET', '/drive/v3/changes?pageToken=99999&spaces=appDataFolder')).status).toBe(400)
    expect(d.handle({ ...req('GET', '/drive/v3/files?spaces=appDataFolder'), headers: { Authorization: 'Bearer nope' } }).status).toBe(401)
  })
})
