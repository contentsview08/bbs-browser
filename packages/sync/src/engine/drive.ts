// Google ドライブのアプリ専用フォルダ(appDataFolder)を置き場にする SyncRemote。決まりは docs/sync-drive.md の 2・3・7.2 章。
// Drive は採番も比較もしないので、端末は自分のファイルにしか書かず、他の端末のファイルを読んでマージする(マージは冪等なので順によらず揃う)。
// 通信は SyncTransport を借りる(https だけ・リダイレクトをたどらない)。アクセストークンの取り方は持たず、外から受け取る
import { randomBytes } from '@noble/ciphers/utils.js'
import { toBase64Url, toHex } from '../bytes'
import { HTTP_IDLE_TIMEOUT_MS, HTTP_TOTAL_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../config'
import { sealPayload } from '../crypto'
import { SyncError } from '../errors'
import { canonicalJson, parseStrictJson } from '../json'
import type { RemoteContext, SyncRemote, SyncRemoteFactory } from './remote'
import { setState, SyncTables, type SqlStatement } from './tables'
import { SyncApiError, SyncResponseTooLarge, type ChangesPage, type HeadResult, type PushResponse, type SyncRequest, type SyncResponse, type SyncTransport } from './transport'

export const DRIVE_API = 'https://www.googleapis.com/drive/v3'
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
/** ファイルの形の版(appProperties の f と中身の obbsync)。知らない版のファイルは読まない */
export const DRIVE_FORMAT = 1
/** 1 ファイルを丸ごと読むので、サーバーの 1 ページ(MAX_RESPONSE_BYTES)より大きく取る */
export const MAX_DRIVE_FILE_BYTES = 5 * 1024 * 1024
/** 上書きのたびに古い版が残るので、超えそうなら閉じて次のセグメントへ */
export const DRIVE_SEG_BYTES = 512 * 1024

const FILE_FIELDS = 'id,name,appProperties,version,size,trashed,createdTime'
const RATE_REASONS = new Set(['userRateLimitExceeded', 'rateLimitExceeded'])

export interface DriveFile {
  id: string
  name?: string
  appProperties?: Record<string, string>
  version?: string
  createdTime?: string
  trashed?: boolean
}

interface DriveChange {
  fileId: string
  removed: boolean
  file?: DriveFile
}

/** 開いているセグメント。中身は送るたびに同期の表から作り直す(暗号文を手元に置かない) */
interface SegState {
  n: number
  /** 開いた UTC の日。日が変わったら閉じる */
  day: string
  file: string | null
  ids: string[]
}

export interface DriveRemoteOptions {
  transport: SyncTransport
  /**
   * Drive へ付けるアクセストークン。fresh は 401 のあとの取り直し(1 回だけ)。
   * 取り直せない(invalid_grant など)ときは SyncApiError('http', 401, 'google_auth_failed') を投げる
   */
  accessToken: (fresh: boolean) => Promise<string>
  /** 目印の e。テストで固定する */
  newEpoch?: () => string
}

/** 置き場の作り方に、設定の画面が使う「使っている量」を添える */
export type DriveRemoteFactory = SyncRemoteFactory & {
  /** appDataFolder の全ファイルの大きさの合計(バイト)。周とは別に、画面を開いたときと同期の後だけ呼ぶ */
  usage(): Promise<number>
}

export function driveRemote(o: DriveRemoteOptions): DriveRemoteFactory {
  return Object.assign((c: RemoteContext) => new DriveRemote(c, o), { usage: () => driveUsage(o) })
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const bad = () => new SyncApiError('bad_response')
const enc = encodeURIComponent
const query = (q: Record<string, string>) => Object.entries(q).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const fileVersion = (f: DriveFile) => {
  const v = Number(f.version ?? 0)
  return Number.isSafeInteger(v) && v >= 0 ? v : 0
}
const ok = (res: SyncResponse) => res.status >= 200 && res.status < 300

function errorReason(body: string): string {
  try {
    const v = parseStrictJson(body)
    const errors = isObject(v) && isObject(v.error) ? v.error.errors : undefined
    const first = Array.isArray(errors) ? errors[0] : undefined
    return isObject(first) && typeof first.reason === 'string' ? first.reason : ''
  } catch {
    return ''
  }
}

/** Drive の失敗をエンジンの今の分け方へ写す(7.2)。404 は呼ぶ側が意味を決めるので、ここへ来たものは領域の消失と読み違えないようにする */
function driveError(res: SyncResponse): SyncApiError {
  const reason = errorReason(res.body)
  if (res.status === 429) return new SyncApiError('http', 429)
  if (res.status === 403 && RATE_REASONS.has(reason)) return new SyncApiError('http', 429, 'rate_limited')
  if (res.status === 403 && reason === 'storageQuotaExceeded') return new SyncApiError('http', 413, 'quota_exceeded')
  if (res.status === 404) return bad()
  // 5xx の理由(backendError など)は画面の言葉にならないので、サーバーと同じく番号で出す
  return new SyncApiError('http', res.status, res.status >= 500 ? '' : reason.slice(0, 64))
}

function parseObject(body: string): Record<string, unknown> {
  let v: unknown
  try {
    v = parseStrictJson(body)
  } catch {
    throw bad()
  }
  if (!isObject(v)) throw bad()
  return v
}

function checkFile(v: unknown): DriveFile {
  if (!isObject(v) || typeof v.id !== 'string' || v.id === '') throw bad()
  const props = v.appProperties
  if (props !== undefined && (!isObject(props) || !Object.values(props).every((x) => typeof x === 'string'))) throw bad()
  return v as unknown as DriveFile
}

async function driveRequest(o: DriveRemoteOptions, method: SyncRequest['method'], url: string, body?: string, contentType?: string, maxBytes = MAX_RESPONSE_BYTES): Promise<SyncResponse> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${await o.accessToken(attempt > 0)}` }
    if (contentType !== undefined) headers['Content-Type'] = contentType
    let res: SyncResponse
    try {
      res = await o.transport.send({ method, url, headers, ...(body !== undefined && { body }), maxBytes, timeoutMs: HTTP_TOTAL_TIMEOUT_MS, idleTimeoutMs: HTTP_IDLE_TIMEOUT_MS })
    } catch (e) {
      throw new SyncApiError(e instanceof SyncResponseTooLarge ? 'too_large' : 'network')
    }
    if (res.status >= 300 && res.status < 400) throw new SyncApiError('redirect', res.status)
    if (res.body.length > maxBytes) throw new SyncApiError('too_large')
    // アクセストークンの期限切れ。1 回だけ取り直して送り直す
    if (res.status === 401 && attempt === 0) continue
    if (res.status === 401) throw new SyncApiError('http', 401, 'google_auth_failed')
    return res
  }
}

async function driveJson(o: DriveRemoteOptions, method: SyncRequest['method'], url: string): Promise<Record<string, unknown>> {
  const res = await driveRequest(o, method, url)
  if (!ok(res)) throw driveError(res)
  return parseObject(res.body)
}

/**
 * appDataFolder で使っている量。files.list の size(今の版の大きさ)を全ページ足す。
 * 古い版・ほかの領域のファイルも appDataFolder にある分は数える(Drive の容量の見え方に近づける)。古い版の分は size に出ないので入らない
 */
export async function driveUsage(o: DriveRemoteOptions): Promise<number> {
  let total = 0
  let page: string | null = null
  for (;;) {
    const q: Record<string, string> = { spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(size)' }
    if (page !== null) q.pageToken = page
    const r = await driveJson(o, 'GET', `${DRIVE_API}/files?${query(q)}`)
    if (!Array.isArray(r.files)) throw bad()
    for (const f of r.files) {
      // size は 10 進の文字列(int64)。ないもの(中身のないファイル)は 0
      const n = isObject(f) && typeof f.size === 'string' && /^\d{1,15}$/.test(f.size) ? Number(f.size) : 0
      total += n
    }
    if (r.nextPageToken === undefined) return total
    if (typeof r.nextPageToken !== 'string' || r.nextPageToken === page) throw new SyncApiError('no_progress')
    page = r.nextPageToken
  }
}

export class DriveRemote implements SyncRemote {
  readonly pace = null
  readonly needsTicket = false
  private readonly t: SyncTables

  constructor(private readonly c: RemoteContext, private readonly o: DriveRemoteOptions) {
    this.t = new SyncTables(c.db)
  }

  // ── 通信 ──

  private request(method: SyncRequest['method'], url: string, body?: string, contentType?: string, maxBytes = MAX_RESPONSE_BYTES): Promise<SyncResponse> {
    return driveRequest(this.o, method, url, body, contentType, maxBytes)
  }

  private json(method: SyncRequest['method'], url: string): Promise<Record<string, unknown>> {
    return driveJson(this.o, method, url)
  }

  private async startToken(): Promise<string> {
    const r = await this.json('GET', `${DRIVE_API}/changes/startPageToken?${query({ fields: 'startPageToken' })}`)
    if (typeof r.startPageToken !== 'string' || r.startPageToken === '') throw bad()
    return r.startPageToken
  }

  /** appDataFolder の全ファイル。2〜3 台なら 1 ページ */
  private async listAll(): Promise<DriveFile[]> {
    const out: DriveFile[] = []
    let page: string | null = null
    for (;;) {
      const q: Record<string, string> = { spaces: 'appDataFolder', pageSize: '1000', fields: `nextPageToken,files(${FILE_FIELDS})` }
      if (page !== null) q.pageToken = page
      const r = await this.json('GET', `${DRIVE_API}/files?${query(q)}`)
      if (!Array.isArray(r.files)) throw bad()
      out.push(...r.files.map(checkFile))
      if (r.nextPageToken === undefined) return out
      if (typeof r.nextPageToken !== 'string' || r.nextPageToken === page) throw new SyncApiError('no_progress')
      page = r.nextPageToken
    }
  }

  /** token からの変更。token を断られたら null(3.7: 全件の読み取りへ切り替える) */
  private async scanChanges(token: string): Promise<{ changes: DriveChange[]; next: string } | null> {
    const byFile = new Map<string, DriveChange>()
    let page = token
    for (;;) {
      const q = { pageToken: page, spaces: 'appDataFolder', pageSize: '1000', includeRemoved: 'true', fields: `changes(fileId,removed,file(${FILE_FIELDS})),nextPageToken,newStartPageToken` }
      const res = await this.request('GET', `${DRIVE_API}/changes?${query(q)}`)
      if (res.status === 400 || res.status === 404) return null
      if (!ok(res)) throw driveError(res)
      const r = parseObject(res.body)
      if (!Array.isArray(r.changes)) throw bad()
      for (const ch of r.changes) {
        if (!isObject(ch) || typeof ch.fileId !== 'string') throw bad()
        // 同じファイルが何度来ても、最後の状態だけを見る
        byFile.delete(ch.fileId)
        byFile.set(ch.fileId, { fileId: ch.fileId, removed: ch.removed === true, ...(ch.file !== undefined && ch.file !== null && { file: checkFile(ch.file) }) })
      }
      if (typeof r.newStartPageToken === 'string' && r.newStartPageToken !== '') return { changes: [...byFile.values()], next: r.newStartPageToken }
      if (typeof r.nextPageToken !== 'string' || r.nextPageToken === page) throw new SyncApiError('no_progress')
      page = r.nextPageToken
    }
  }

  private multipart(meta: Record<string, unknown>, content: string): { body: string; type: string } {
    const b = `obbsync_${toHex(randomBytes(12))}`
    return {
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`,
      type: `multipart/related; boundary=${b}`,
    }
  }

  private async createFile(meta: Record<string, unknown>, content: string): Promise<string> {
    const m = this.multipart({ ...meta, parents: ['appDataFolder'] }, content)
    const res = await this.request('POST', `${DRIVE_UPLOAD}/files?${query({ uploadType: 'multipart', fields: 'id,version' })}`, m.body, m.type)
    if (!ok(res)) throw driveError(res)
    return checkFile(parseObject(res.body)).id
  }

  /** 上書き。ファイルが消えていたら false */
  private async updateFile(id: string, content: string): Promise<boolean> {
    const m = this.multipart({}, content)
    const res = await this.request('PATCH', `${DRIVE_UPLOAD}/files/${enc(id)}?${query({ uploadType: 'multipart', fields: 'id,version' })}`, m.body, m.type)
    if (res.status === 404) return false
    if (!ok(res)) throw driveError(res)
    return true
  }

  private async deleteFile(id: string): Promise<void> {
    const res = await this.request('DELETE', `${DRIVE_API}/files/${enc(id)}`)
    if (!ok(res) && res.status !== 404) throw driveError(res)
  }

  // ── 読み分け ──

  private props(f: DriveFile): Record<string, string> | null {
    const p = f.appProperties
    return p !== undefined && p.f === String(DRIVE_FORMAT) && p.s === this.c.spaceId ? p : null
  }

  /** 他の端末のレコードのファイル。自分の書いたものは読み戻さない(手元が正) */
  private isOthersData(f: DriveFile): boolean {
    const p = this.props(f)
    return p !== null && f.trashed !== true && (p.t === 'seg' || p.t === 'snap') && typeof p.d === 'string' && p.d !== this.c.deviceId
  }

  /** 目印が 2 つあれば(2 台が同時に作った)、作った時刻の古い方、同じなら id の小さい方を正にする */
  private winner(files: readonly DriveFile[]): DriveFile | null {
    const markers = files.filter((f) => {
      const p = this.props(f)
      return p !== null && f.trashed !== true && p.t === 'space' && typeof p.e === 'string' && p.e.length > 0 && p.e.length <= 128
    })
    markers.sort((a, b) => ((a.createdTime ?? '') < (b.createdTime ?? '') ? -1 : (a.createdTime ?? '') > (b.createdTime ?? '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return markers[0] ?? null
  }

  private async seen(): Promise<Record<string, number>> {
    const raw = await this.t.state('drive_seen')
    return raw === null ? {} : (parseStrictJson(raw) as Record<string, number>)
  }

  private classify(changes: readonly DriveChange[], seen: Record<string, number>, marker: string | null): { markerTouched: boolean; toRead: DriveFile[]; removed: string[] } {
    const out = { markerTouched: false, toRead: [] as DriveFile[], removed: [] as string[] }
    for (const ch of changes) {
      const f = ch.file
      if (ch.removed || f === undefined || f.trashed === true) {
        if (ch.fileId === marker) out.markerTouched = true
        out.removed.push(ch.fileId)
        continue
      }
      const p = this.props(f)
      if (p === null) continue
      if (p.t === 'space') out.markerTouched = true
      else if (this.isOthersData(f) && fileVersion(f) > (seen[f.id] ?? 0)) out.toRead.push(f)
    }
    return out
  }

  /** ファイルを読み、レコードに端末の中だけの通番を振る。読む間に消えたもの(404)は飛ばす(消えた印は次の変更で来る) */
  private async readFiles(files: readonly DriveFile[], since: number): Promise<{ records: Record<string, unknown>[]; seen: Map<string, number>; bad: string[] }> {
    const out = { records: [] as Record<string, unknown>[], seen: new Map<string, number>(), bad: [] as string[] }
    let version = since
    for (const f of files) {
      const res = await this.request('GET', `${DRIVE_API}/files/${enc(f.id)}?${query({ alt: 'media' })}`, undefined, undefined, MAX_DRIVE_FILE_BYTES)
      if (res.status === 404) continue
      if (!ok(res)) throw driveError(res)
      out.seen.set(f.id, fileVersion(f))
      const records = this.parseFile(f, res.body)
      if (records === null) {
        out.bad.push('drive_mismatch')
        continue
      }
      for (const r of records) out.records.push({ ...r, version: ++version })
    }
    return out
  }

  /** 見出しが appProperties と違うファイルは丸ごと捨てる(2.3)。レコードの形は openRecords が確かめる */
  private parseFile(f: DriveFile, body: string): Record<string, unknown>[] | null {
    const p = f.appProperties as Record<string, string>
    let v: unknown
    try {
      v = parseStrictJson(body)
    } catch {
      return null
    }
    if (!isObject(v) || v.obbsync !== DRIVE_FORMAT || v.space !== this.c.spaceId || v.device !== p.d || v.type !== p.t || !Array.isArray(v.records)) return null
    if (p.t === 'seg' && String(v.n) !== p.n) return null
    return v.records.map((r) => (isObject(r) ? { record_id: r.record_id, kind_tag: r.kind_tag, schema_version: r.schema_version, nonce: r.nonce, ciphertext: r.ciphertext } : {}))
  }

  private async knownEpoch(): Promise<string> {
    const epoch = await this.t.state('epoch')
    if (epoch !== null) return epoch
    const m = this.winner(await this.listAll())
    if (m === null) throw new SyncApiError('http', 404, 'space_not_found')
    return (m.appProperties as Record<string, string>).e
  }

  // ── 口 ──

  /**
   * 前置きの確認(3.1)。token が手元と同じなら 304 と同じ。違えば変更を見て、他の端末の変化か目印の変化があれば「変化あり」。
   * 自分の書いたものだけなら token を進めて「変化なし」にする
   */
  async head(): Promise<HeadResult> {
    const known = await this.t.state('drive_token')
    const since = Number((await this.t.state('since')) ?? 0)
    const changed: HeadResult = { version: since + 1, epoch: (await this.t.state('epoch')) ?? '', gc_floor: 0 }
    if (known === null) return changed
    if ((await this.startToken()) === known) return { version: null }
    const scan = await this.scanChanges(known)
    if (scan === null) return changed
    const seen = await this.seen()
    const c = this.classify(scan.changes, seen, await this.t.state('drive_space'))
    if (c.markerTouched || c.toRead.length > 0) return changed
    for (const id of c.removed) delete seen[id]
    await this.c.db.batch([setState('drive_token', scan.next), setState('drive_seen', canonicalJson(seen))])
    return { version: null }
  }

  async changes(since: number): Promise<ChangesPage> {
    const token = since === 0 ? null : await this.t.state('drive_token')
    if (token === null) return this.fullRead(since)
    const scan = await this.scanChanges(token)
    // token を断られた。手元を消さない全件の読み取り(マージだけ)にする
    if (scan === null) return this.fullRead(since)
    const seen = await this.seen()
    const marker = await this.t.state('drive_space')
    const c = this.classify(scan.changes, seen, marker)
    const commit: SqlStatement[] = []
    let epoch = await this.t.state('epoch')
    if (c.markerTouched || marker === null || epoch === null) {
      const m = this.winner(await this.listAll())
      if (m === null) throw new SyncApiError('http', 404, 'space_not_found')
      epoch = (m.appProperties as Record<string, string>).e
      commit.push(setState('drive_space', m.id))
    }
    const read = await this.readFiles(c.toRead, since)
    for (const id of c.removed) delete seen[id]
    for (const [id, v] of read.seen) seen[id] = v
    commit.push(setState('drive_token', scan.next), setState('drive_seen', canonicalJson(seen)), setState('drive_read_at', String(this.c.now())))
    return { records: read.records, head: since + read.records.length, more: false, epoch, gc_floor: 0, commit, bad: read.bad }
  }

  /**
   * 全件の読み取り(3.4)。一覧より先に token を取っておき、一覧の後に起きた変更を次の周で拾う。
   * head は読んだ数より 1 つ進め、空の領域でも次からは変更だけを読むようにする
   */
  private async fullRead(since: number): Promise<ChangesPage> {
    const start = await this.startToken()
    const files = await this.listAll()
    const m = this.winner(files)
    if (m === null) throw new SyncApiError('http', 404, 'space_not_found')
    const read = await this.readFiles(files.filter((f) => this.isOthersData(f)), since)
    return {
      records: read.records,
      head: since + read.records.length + 1,
      more: false,
      epoch: (m.appProperties as Record<string, string>).e,
      gc_floor: 0,
      commit: [setState('drive_token', start), setState('drive_seen', canonicalJson(Object.fromEntries(read.seen))), setState('drive_space', m.id), setState('drive_read_at', String(this.c.now()))],
      bad: read.bad,
    }
  }

  /**
   * 開いているセグメントを、今までに入れたレコードの今の値 + 今回の分で上書きする(1 回の送信 = 1 回の書き込み)。
   * 書き込みはぶつからないので 409 はない。version は since の続きを振り、エンジンが自分の送ったものを読み戻さないようにする
   */
  async pushRecords(_requestId: string, records: Record<string, unknown>[]): Promise<PushResponse> {
    const now = this.c.now()
    const day = utcDay(now)
    const raw = await this.t.state('drive_seg')
    let seg: SegState = raw === null ? { n: 0, day: '', file: null, ids: [] } : (parseStrictJson(raw) as SegState)
    const fresh = records.map((r) => ({ record_id: r.record_id as string, kind_tag: r.kind_tag, schema_version: r.schema_version, nonce: r.nonce, ciphertext: r.ciphertext }))
    const freshIds = new Set(fresh.map((r) => r.record_id))
    let prev: typeof fresh = []
    let close = !(seg.n > 0 && seg.day === day)
    if (!close) {
      const want = seg.ids.filter((id) => !freshIds.has(id))
      prev = await this.reseal(want)
      // 表から消えたもの(権限系を切った・期限の切れた tombstone)は封をし直せない。上書きで Drive から消さないよう、閉じて残す
      close = prev.length < want.length
    }
    let body = [...prev, ...fresh]
    if (close) {
      seg = { n: seg.n + 1, day, file: null, ids: [] }
      body = fresh
    } else if (prev.length > 0 && this.segContent(seg.n, body).length > DRIVE_SEG_BYTES) {
      seg = { n: seg.n + 1, day, file: null, ids: [] }
      body = fresh
    }
    let file = seg.file
    if (file !== null && !(await this.updateFile(file, this.segContent(seg.n, body)))) {
      // 消えていた(領域の削除など)。同じ通番のファイルを 2 つ作らないよう、次の通番で作る
      seg = { n: seg.n + 1, day, file: null, ids: [] }
      file = null
    }
    if (file === null) file = await this.createFile({ name: this.segName(seg.n), appProperties: this.segProps(seg.n) }, this.segContent(seg.n, body))
    await this.c.db.batch([setState('drive_seg', canonicalJson({ ...seg, file, ids: body.map((r) => r.record_id) }))])
    const since = Number((await this.t.state('since')) ?? 0)
    return { results: records.map((r, i) => ({ record_id: r.record_id as string, status: 200, version: since + 1 + i })), epoch: await this.knownEpoch(), gc_floor: 0 }
  }

  /** 前に入れたレコードを同期の表の今の値で封をし直す。表から消えたもの・封ができないものは外す */
  private async reseal(ids: readonly string[]): Promise<{ record_id: string; kind_tag: unknown; schema_version: unknown; nonce: unknown; ciphertext: unknown }[]> {
    const rows = await this.t.records(ids)
    const out = []
    for (const id of ids) {
      const r = rows.get(id)
      if (!r) continue
      try {
        const sealed = sealPayload(this.c.keys, { space_id: this.c.spaceId, record_id: id, kind_tag: r.kind_tag, schema_version: r.schema_version }, r.payload)
        out.push({ record_id: id, kind_tag: r.kind_tag, schema_version: r.schema_version, ...sealed })
      } catch (e) {
        if (!(e instanceof SyncError)) throw e
      }
    }
    return out
  }

  private prefix(): string {
    return `obbsync${DRIVE_FORMAT}.${this.c.spaceId.slice(0, 16)}`
  }

  private segName(n: number): string {
    return `${this.prefix()}.${this.c.deviceId}.seg.${n}`
  }

  private segProps(n: number): Record<string, string> {
    return { f: String(DRIVE_FORMAT), s: this.c.spaceId, t: 'seg', d: this.c.deviceId, n: String(n) }
  }

  private segContent(n: number, records: readonly unknown[]): string {
    return JSON.stringify({ obbsync: DRIVE_FORMAT, space: this.c.spaceId, device: this.c.deviceId, type: 'seg', n, records })
  }

  /**
   * 目印を作る(なければ)。許可証は使わない。2 台が同時に作ったら、作った後に一覧で正を決め、負けた方は自分の目印を消す
   */
  async createSpace(): Promise<{ epoch: string }> {
    const existing = this.winner(await this.listAll())
    if (existing !== null) {
      await this.c.db.batch([setState('drive_space', existing.id)])
      return { epoch: (existing.appProperties as Record<string, string>).e }
    }
    const e = this.o.newEpoch?.() ?? toBase64Url(randomBytes(16))
    const mine = await this.createFile({ name: `${this.prefix()}.space`, appProperties: { f: String(DRIVE_FORMAT), s: this.c.spaceId, t: 'space', e } }, '')
    const w = this.winner(await this.listAll())
    if (w !== null && w.id !== mine) {
      await this.deleteFile(mine)
      await this.c.db.batch([setState('drive_space', w.id)])
      return { epoch: (w.appProperties as Record<string, string>).e }
    }
    await this.c.db.batch([setState('drive_space', mine)])
    return { epoch: e }
  }
}
