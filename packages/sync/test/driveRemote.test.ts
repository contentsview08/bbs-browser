// Drive の置き場(drive.ts)の、共通シナリオでは書けない決まり。偽の Drive(fakeDrive.ts)を相手にし、本物の Google には繋がない
import { describe, expect, it } from 'vitest'
import { deriveKeys, driveRemote, driveUsage, openRecords, parseHlc, recordId, sealPayload, spaceId, SyncApiError, writeRecord, type SyncPayload, type SyncRemote, type SyncSqlDb, type SyncTransport } from '../src/index'
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

const DAY = 24 * 60 * 60 * 1000

/** エンジンの代わりに、変更を読み続ける端末 */
function follower(d: { db: SyncSqlDb; remote: () => SyncRemote }) {
  let since = 0
  return async () => {
    const page = await read(d.db, d.remote(), since)
    since = page.head
    return page
  }
}

/** 1 日 1 件ずつ送る。日が変わるたびに前のセグメントが閉じる */
async function pushDays(w: { now: number }, d: { db: SyncSqlDb; remote: () => SyncRemote }, prefix: string, n: number, after?: () => Promise<unknown>) {
  for (let i = 0; i < n; i++) {
    w.now += DAY
    await d.remote().pushRecords('r', [await stored(d.db, `${prefix}${i}`)])
    await after?.()
  }
}

describe('Drive のまとめ直し', () => {
  const kinds = (drive: FakeDrive, device: string) => drive.filesOf(sid).filter((f) => f.appProperties.d === device).map((f) => `${f.appProperties.t}${f.appProperties.n ?? ''}`).sort()

  it('条件を満たすまでは、手元の控えを見るだけで通信しない', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await pushDays(w, pc, 'a', 7)
    const units = w.drive.units
    await pc.remote().maintain?.()
    expect(w.drive.units).toBe(units)
    expect(kinds(w.drive, 'pc')).toHaveLength(7)
  })

  it('閉じたセグメントが 7 つで 1 つのスナップショットにまとめ、古いものを消す。使っている量が減り、1 日 1 回まで', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await pushDays(w, pc, 'a', 8)
    const used = await driveUsage({ transport: { send: async (req) => w.drive.handle(req) }, accessToken: async () => FAKE_DRIVE_TOKEN })
    const calls = { ...w.drive.calls }
    await pc.remote().maintain?.()
    // 作る 1 回 + 消す 7 回だけ。一覧も読み戻しもしない
    expect(w.drive.calls['files.create'] - calls['files.create']).toBe(1)
    expect(w.drive.calls['files.delete'] ?? 0).toBe(7)
    expect(w.drive.calls['files.list']).toBe(calls['files.list'])
    expect(w.drive.calls['files.get(media)'] ?? 0).toBe(0)
    expect(kinds(w.drive, 'pc')).toEqual(['seg8', 'snap'])
    const snap = w.drive.filesOf(sid).find((f) => f.appProperties.t === 'snap')!
    expect(snap.appProperties).toMatchObject({ u: '7', p: '1/1', g: '0' })
    expect(openRecords(keys, sid, (JSON.parse(snap.content).records as Record<string, unknown>[]).map((r) => ({ ...r, version: 1 }))).records).toHaveLength(7)
    expect(await driveUsage({ transport: { send: async (req) => w.drive.handle(req) }, accessToken: async () => FAKE_DRIVE_TOKEN })).toBeLessThan(used)
    // 同じ日にまた 7 つ閉じても、次の日までまとめ直さない
    for (let i = 0; i < 7; i++) {
      w.now += 60_000
      await pc.db.batch([{ sql: "UPDATE sync_state SET value = json_set(value, '$.day', '') WHERE key = 'drive_seg'" }])
      await pc.remote().pushRecords('r', [await stored(pc.db, `b${i}`)])
    }
    await pc.remote().maintain?.()
    expect(kinds(w.drive, 'pc').filter((k) => k === 'snap')).toHaveLength(1)
    w.now += DAY
    await pc.remote().maintain?.()
    expect(kinds(w.drive, 'pc')).toEqual(['seg15', 'snap'])
  })

  it('読み続けている端末はスナップショットを落とさない。しばらく読まなかった端末はスナップショットで追いつく', async () => {
    const { w, device } = world()
    const pc = device('pc')
    const phone = device('phone')
    const tablet = device('tablet')
    await pc.remote().createSpace(null)
    const phoneRead = follower(phone)
    const tabletRead = follower(tablet)
    await phoneRead()
    await tabletRead()
    await pushDays(w, pc, 'a', 3, phoneRead)
    await tabletRead()
    await pushDays(w, pc, 'b', 5, phoneRead)
    const before = w.drive.calls['files.get(media)']
    await pc.remote().maintain?.()
    // phone は閉じたセグメントを最後の版まで読んでいるので、新しいセグメントの 1 回だけ
    const page = await phoneRead()
    expect(page.records).toEqual([])
    expect(w.drive.calls['files.get(media)']).toBe(before)
    // tablet は消えたセグメントの分をスナップショット(読んだ分も含む)と新しいセグメントで読む
    const lag = await tabletRead()
    expect(openRecords(keys, sid, lag.records).records.map((r) => r.payload.body?.thread).sort()).toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'b2', 'b3', 'b4'])
    expect(w.drive.calls['files.get(media)']).toBe(before + 2)
  })

  it('2 台が同時にまとめ直しても、互いのファイルを消さない。あとから参加した端末は全部を読める', async () => {
    const { w, device } = world()
    const pc = device('pc')
    const phone = device('phone')
    await pc.remote().createSpace(null)
    await read(phone.db, phone.remote(), 0)
    for (let i = 0; i < 8; i++) {
      w.now += DAY
      await pc.remote().pushRecords('r', [await stored(pc.db, `p${i}`)])
      await phone.remote().pushRecords('r', [await stored(phone.db, `q${i}`)])
    }
    await Promise.all([pc.remote().maintain?.(), phone.remote().maintain?.()])
    expect(kinds(w.drive, 'pc')).toEqual(['seg8', 'snap'])
    expect(kinds(w.drive, 'phone')).toEqual(['seg8', 'snap'])
    const tablet = device('tablet')
    const page = await read(tablet.db, tablet.remote(), 0)
    expect(new Set(openRecords(keys, sid, page.records).records.map((r) => r.payload.body?.thread)).size).toBe(16)
    // 読んだのはスナップショット 2 つと開いているセグメント 2 つ
    expect(page.records).toHaveLength(16)
  })

  it('容量の超過でスナップショットを作れなければ周を止めず、1 日おいて続きから作る', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    await pushDays(w, pc, 'a', 8)
    w.drive.quotaBytes = [...w.drive.files.values()].reduce((n, f) => n + f.content.length, 0)
    await expect(pc.remote().maintain?.()).resolves.toBeUndefined()
    w.drive.quotaBytes = Infinity
    const units = w.drive.units
    w.now += DAY - 1
    await pc.remote().maintain?.()
    expect(w.drive.units).toBe(units)
    w.now += 1
    await pc.remote().maintain?.()
    expect(kinds(w.drive, 'pc')).toEqual(['seg8', 'snap'])
  })

  it('表にないレコード(権限系を切った)は古いファイルから引き継ぎ、90 日より古い tombstone は落として g に書く', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    // 100 日前に消したもの
    const oldTomb = '01a115606000.0000.pc'
    const id = recordId(keys.k_id, 'favorite', 'https://a.5ch.io/x/', 'gone')
    const p: SyncPayload = { ...payload('gone', oldTomb), deleted: true }
    await pc.db.batch([writeRecord({ record_id: id, kind: 'favorite', kind_tag: 'h', schema_version: 1, payload: p, hlc: oldTomb, version: 0, pending: true, priority: 0, needs_apply: false, ref_board: null, ref_thread: null, ref_detail: null, ref_local: null, tomb_at: null })])
    w.now += DAY
    await pc.remote().pushRecords('r', [{ record_id: id, kind_tag: 'h', schema_version: 1, ...sealPayload(keys, { space_id: sid, record_id: id, kind_tag: 'h', schema_version: 1 }, p) }])
    await pushDays(w, pc, 'a', 7)
    const kept = recordId(keys.k_id, 'favorite', 'https://a.5ch.io/x/', 'a0')
    await pc.db.batch([{ sql: 'DELETE FROM sync_records WHERE record_id = $1', params: [kept] }])
    expect(parseHlc(oldTomb).wall).toBeLessThan(w.now - 90 * DAY)
    await pc.remote().maintain?.()
    const snap = w.drive.filesOf(sid).find((f) => f.appProperties.t === 'snap')!
    const ids = (JSON.parse(snap.content).records as { record_id: string }[]).map((r) => r.record_id)
    expect(ids).toContain(kept)
    expect(ids).not.toContain(id)
    expect(ids).toHaveLength(6)
    expect(Number(snap.appProperties.g)).toBe(w.now - 90 * DAY)
  })

  it('部分の揃わないスナップショットは読まず、揃ったら全部の部分を読む', async () => {
    const { w, device } = world()
    const pc = device('pc')
    await pc.remote().createSpace(null)
    const pcRead = follower(pc)
    await pcRead()
    const part = (i: number, key: string) => {
      const p = payload(key)
      const rid = recordId(keys.k_id, 'favorite', 'https://a.5ch.io/x/', key)
      const rec = { record_id: rid, kind_tag: 'h', schema_version: 1, ...sealPayload(keys, { space_id: sid, record_id: rid, kind_tag: 'h', schema_version: 1 }, p) }
      const props = { f: '1', s: sid, t: 'snap', d: 'other', u: '3', uv: '2', g: '0', p: `${i}/2` }
      w.drive.putFile(`obbsync1.x.other.snap.3.${i}of2`, props, JSON.stringify({ obbsync: 1, space: sid, device: 'other', type: 'snap', u: 3, uv: 2, g: 0, p: `${i}/2`, records: [rec] }))
    }
    part(1, 's1')
    expect((await pcRead()).records).toEqual([])
    part(2, 's2')
    const page = await pcRead()
    expect(openRecords(keys, sid, page.records).records.map((r) => r.payload.body?.thread).sort()).toEqual(['s1', 's2'])
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
