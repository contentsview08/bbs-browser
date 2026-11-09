// Google ドライブのアプリ専用フォルダ(appDataFolder)を置き場にする SyncRemote。決まりは docs/sync-drive.md の 2・3・7.2 章。
// Drive は採番も比較もしないので、端末は自分のファイルにしか書かず、他の端末のファイルを読んでマージする(マージは冪等なので順によらず揃う)。
// 通信は SyncTransport を借りる(https だけ・リダイレクトをたどらない)。アクセストークンの取り方は持たず、外から受け取る
import { randomBytes } from '@noble/ciphers/utils.js'
import { toBase64Url, toHex } from '../bytes'
import { HTTP_IDLE_TIMEOUT_MS, HTTP_TOTAL_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../config'
import { openRecords, sealPayload } from '../crypto'
import { SyncError } from '../errors'
import { parseHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { TOMB_MAX_AGE_MS } from '../rebase'
import type { RemoteContext, SyncRemote, SyncRemoteFactory } from './remote'
import { delState, isDeleted, setState, SyncTables, type SqlStatement, type StoredRecord } from './tables'
import { SyncApiError, SyncResponseTooLarge, type ChangesPage, type HeadResult, type PushResponse, type SyncRequest, type SyncResponse, type SyncTransport } from './transport'

export const DRIVE_API = 'https://www.googleapis.com/drive/v3'
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
/** ファイルの形の版(appProperties の f と中身の obbsync)。知らない版のファイルは読まない */
export const DRIVE_FORMAT = 1
/** 1 ファイルを丸ごと読むので、サーバーの 1 ページ(MAX_RESPONSE_BYTES)より大きく取る */
export const MAX_DRIVE_FILE_BYTES = 5 * 1024 * 1024
/** 上書きのたびに古い版が残るので、超えそうなら閉じて次のセグメントへ */
export const DRIVE_SEG_BYTES = 512 * 1024
/** まとめ直しの条件(2.5)。閉じたセグメントがこの数以上か、その合計がこの大きさ以上 */
export const DRIVE_COMPACT_SEGS = 7
export const DRIVE_COMPACT_BYTES = 2 * 1024 * 1024
/** まとめ直しは 1 日 1 回まで。容量の超過で作れなかったときも、この間は試さない */
export const DRIVE_COMPACT_GAP_MS = 24 * 60 * 60 * 1000
/** スナップショットの 1 部分。本文とメタデータを 1 回で送る multipart(5MB まで)に収める。見出しの分を残す */
export const DRIVE_SNAP_PART_BYTES = 4 * 1024 * 1024 - 4096

const FILE_FIELDS = 'id,name,appProperties,version,size,trashed,createdTime'
const RATE_REASONS = new Set(['userRateLimitExceeded', 'rateLimitExceeded'])
/** 同期の表を ID で引く 1 回の数。古い Android の SQLite は変数が 999 個まで */
const ID_CHUNK = 500

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

/** 開いているセグメント。中身は送るたびに同期の表から作り直す(暗号文を手元に置かない)。v と bytes は最後に書いた版と大きさ */
interface SegState {
  n: number
  /** 開いた UTC の日。日が変わったら閉じる */
  day: string
  file: string | null
  ids: string[]
  v?: number
  bytes?: number
}

/** 閉じたセグメント。まとめ直しで消すまで、中のレコード ID と最後の版を控える */
interface ClosedSeg {
  n: number
  file: string
  v: number
  bytes: number
  ids: string[]
}

/** 自分のファイルの控え(drive_own)。中身を読み戻さずに、まとめ直しとリベースで使う */
interface OwnFiles {
  snap?: { u: number; g: number; files: string[]; ids: string[] }
  segs: ClosedSeg[]
}

/** 途中のまとめ直し(drive_compact)。部分ごとのレコード ID を先に決め、作り終えた部分の ID を足していく */
interface CompactJob {
  u: number
  /** 含めた最後のセグメントの最後の版。読む側が「もう全部読んだか」を決めるのに使う */
  uv: number
  g: number
  /** tombstone を落とす基準の時刻。続きから作るときも同じ基準にする */
  cut: number
  /** 作り終えたら消す古いファイル */
  del: string[]
  parts: string[][]
  done: string[]
  /** 容量の超過で止めたとき、次に試してよい時刻 */
  wait?: number
}

interface SnapInfo {
  d: string
  u: number
  uv: number
  g: number
  i: number
  n: number
}

/** 封をしたレコード(ファイルに入れる形) */
interface Sealed {
  record_id: string
  kind_tag: unknown
  schema_version: unknown
  nonce: unknown
  ciphertext: unknown
}

/** 書き手ごとの、読み終えたセグメントの通番と、そのとき読んだ版(drive_read_upto)。この通番より前のセグメントは最後の版まで読んである */
type Upto = Record<string, [number, number]>

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
/** appProperties の数(10 進の文字列)。形が違えば null */
const propNum = (s: string | undefined): number | null => (s !== undefined && /^\d{1,15}$/.test(s) ? Number(s) : null)
const sortedUnique = (ids: Iterable<string>) => [...new Set(ids)].sort()
/** 最後の版が分からないセグメント(版を控える前の drive_seg)。読む側が「最後の版まで読んだ」と決めないよう、どの版より大きくする(appProperties の 15 桁に収める) */
const UNKNOWN_VERSION = 999_999_999_999_999

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

  /** 作ったファイルの ID と版 */
  private async createFile(meta: Record<string, unknown>, content: string): Promise<{ id: string; version: number }> {
    const m = this.multipart({ ...meta, parents: ['appDataFolder'] }, content)
    const res = await this.request('POST', `${DRIVE_UPLOAD}/files?${query({ uploadType: 'multipart', fields: 'id,version' })}`, m.body, m.type)
    if (!ok(res)) throw driveError(res)
    const f = checkFile(parseObject(res.body))
    return { id: f.id, version: fileVersion(f) }
  }

  /** 上書きして、新しい版を返す。ファイルが消えていたら null */
  private async updateFile(id: string, content: string): Promise<number | null> {
    const m = this.multipart({}, content)
    const res = await this.request('PATCH', `${DRIVE_UPLOAD}/files/${enc(id)}?${query({ uploadType: 'multipart', fields: 'id,version' })}`, m.body, m.type)
    if (res.status === 404) return null
    if (!ok(res)) throw driveError(res)
    return fileVersion(checkFile(parseObject(res.body)))
  }

  private async deleteFile(id: string): Promise<void> {
    const res = await this.request('DELETE', `${DRIVE_API}/files/${enc(id)}`)
    if (!ok(res) && res.status !== 404) throw driveError(res)
  }

  /** 中身を読む。消えていたら null */
  private async download(id: string): Promise<string | null> {
    const res = await this.request('GET', `${DRIVE_API}/files/${enc(id)}?${query({ alt: 'media' })}`, undefined, undefined, MAX_DRIVE_FILE_BYTES)
    if (res.status === 404) return null
    if (!ok(res)) throw driveError(res)
    return res.body
  }

  // ── 手元の控え ──

  private async stateJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.t.state(key)
    return raw === null ? fallback : (parseStrictJson(raw) as T)
  }

  private seen(): Promise<Record<string, number>> {
    return this.stateJson<Record<string, number>>('drive_seen', {})
  }

  private own(): Promise<OwnFiles> {
    return this.stateJson<OwnFiles>('drive_own', { segs: [] })
  }

  /** 同期の表を ID で引く。数が多くても SQL の変数の上限を超えないよう分ける */
  private async rows(ids: readonly string[]): Promise<Map<string, StoredRecord>> {
    const out = new Map<string, StoredRecord>()
    for (let i = 0; i < ids.length; i += ID_CHUNK) for (const [k, v] of await this.t.records(ids.slice(i, i + ID_CHUNK))) out.set(k, v)
    return out
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

  /** スナップショットの部分の見出し。形が違えば null(読まない) */
  private snapInfo(f: DriveFile): SnapInfo | null {
    const p = this.props(f)
    if (p === null || p.t !== 'snap') return null
    const u = propNum(p.u)
    const uv = propNum(p.uv)
    const g = propNum(p.g)
    const m = /^(\d{1,4})\/(\d{1,4})$/.exec(p.p ?? '')
    if (u === null || uv === null || g === null || m === null) return null
    const i = Number(m[1])
    const n = Number(m[2])
    return i >= 1 && i <= n ? { d: p.d, u, uv, g, i, n } : null
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

  /**
   * 書き手ごとの「揃った最新のスナップショット」。部分が全部あるものだけを数える(2.5: 揃うまでは古いスナップショットとセグメントを読む)。
   * u の大きい方が新しい
   */
  private bestSnaps(files: readonly DriveFile[]): Map<string, { info: SnapInfo; parts: DriveFile[] }> {
    const groups = new Map<string, { info: SnapInfo; parts: Map<number, DriveFile> }>()
    for (const f of files) {
      const s = this.snapInfo(f)
      if (s === null) continue
      const key = `${s.d}\n${s.u}`
      const gr = groups.get(key)
      if (gr === undefined) groups.set(key, { info: s, parts: new Map([[s.i, f]]) })
      // 同じ u で部分の数や見出しが合わないものは混ぜない
      else if (gr.info.n === s.n && gr.info.g === s.g && gr.info.uv === s.uv && !gr.parts.has(s.i)) gr.parts.set(s.i, f)
    }
    const best = new Map<string, { info: SnapInfo; parts: DriveFile[] }>()
    for (const gr of groups.values()) {
      if (gr.parts.size !== gr.info.n) continue
      const cur = best.get(gr.info.d)
      if (cur === undefined || gr.info.u > cur.info.u) best.set(gr.info.d, { info: gr.info, parts: [...gr.parts.values()] })
    }
    return best
  }

  /** 部分の揃わないスナップショットのある書き手。一覧で、ほかの部分がもうあるかを確かめる */
  private hasPartialSnap(files: readonly DriveFile[]): Set<string> {
    const have = new Map<string, { n: number; count: number }>()
    for (const f of files) {
      const s = this.snapInfo(f)
      if (s === null) continue
      const key = `${s.d}\n${s.u}`
      const cur = have.get(key) ?? { n: s.n, count: 0 }
      cur.count++
      have.set(key, cur)
    }
    const out = new Set<string>()
    for (const [key, v] of have) if (v.count < v.n) out.add(key.split('\n')[0])
    return out
  }

  /**
   * 読むファイルを決める。files の順を保つ(端末の中の通番を振る順が PC とスマホで同じになるように)。
   * - 揃ったスナップショットは、その書き手の最新だけを読む。読み終えた所(upto)までしか含まないものは読まずに控えだけ進める(2.5)
   * - スナップショットに含まれたセグメントは読まない
   * - 揃っていない部分・古いスナップショットは読まず、控えにも入れない(揃ったら変更として来る)
   */
  private plan(files: readonly DriveFile[], seen: Record<string, number>, upto: Upto): { read: DriveFile[]; mark: DriveFile[]; g: number } {
    const best = this.bestSnaps(files)
    const out = { read: [] as DriveFile[], mark: [] as DriveFile[], g: 0 }
    const covered = new Map<string, boolean>()
    for (const [d, b] of best) {
      if (!b.parts.some((p) => fileVersion(p) > (seen[p.id] ?? 0))) continue
      const at = upto[d]
      covered.set(d, at !== undefined && (b.info.u < at[0] || (b.info.u === at[0] && at[1] >= b.info.uv)))
      out.g = Math.max(out.g, b.info.g)
    }
    for (const f of files) {
      if (fileVersion(f) <= (seen[f.id] ?? 0)) continue
      const p = this.props(f) as Record<string, string>
      const b = best.get(p.d)
      if (p.t === 'snap') {
        if (b === undefined || !b.parts.includes(f) || !covered.has(p.d)) continue
        ;(covered.get(p.d) ? out.mark : out.read).push(f)
        continue
      }
      const n = propNum(p.n)
      if (n === null) continue
      ;(b !== undefined && n <= b.info.u ? out.mark : out.read).push(f)
    }
    return out
  }

  /** 読んだファイルで、書き手ごとの読み終えた所を進める */
  private advance(upto: Upto, files: readonly DriveFile[]): Upto {
    const out = { ...upto }
    for (const f of files) {
      const p = this.props(f) as Record<string, string>
      const s = this.snapInfo(f)
      const at = s !== null ? ([s.u, s.uv] as [number, number]) : propNum(p.n) !== null ? ([propNum(p.n) as number, fileVersion(f)] as [number, number]) : null
      if (at === null) continue
      const cur = out[p.d]
      if (cur === undefined || at[0] > cur[0] || (at[0] === cur[0] && at[1] > cur[1])) out[p.d] = at
    }
    return out
  }

  /** ファイルを読み、レコードに端末の中だけの通番を振る。読む間に消えたもの(まとめ直しの途中)があれば missing */
  private async readFiles(files: readonly DriveFile[], since: number): Promise<{ records: Record<string, unknown>[]; seen: Map<string, number>; bad: string[]; missing: boolean }> {
    const out = { records: [] as Record<string, unknown>[], seen: new Map<string, number>(), bad: [] as string[], missing: false }
    let version = since
    for (const f of files) {
      const body = await this.download(f.id)
      if (body === null) {
        out.missing = true
        return out
      }
      out.seen.set(f.id, fileVersion(f))
      const records = this.parseFile(f, body)
      if (records === null) {
        out.bad.push('drive_mismatch')
        continue
      }
      for (const r of records) out.records.push({ ...r, version: ++version })
    }
    return out
  }

  /** 見出しが appProperties と違うファイルは丸ごと捨てる(2.3)。レコードの形は openRecords が確かめる */
  private parseFile(f: DriveFile, body: string): Sealed[] | null {
    const p = f.appProperties as Record<string, string>
    let v: unknown
    try {
      v = parseStrictJson(body)
    } catch {
      return null
    }
    if (!isObject(v) || v.obbsync !== DRIVE_FORMAT || v.space !== this.c.spaceId || v.device !== p.d || v.type !== p.t || !Array.isArray(v.records)) return null
    if (p.t === 'seg' && String(v.n) !== p.n) return null
    if (p.t === 'snap' && (String(v.u) !== p.u || String(v.uv) !== p.uv || String(v.g) !== p.g || v.p !== p.p)) return null
    return v.records.map((r) => (isObject(r) ? { record_id: r.record_id as string, kind_tag: r.kind_tag, schema_version: r.schema_version, nonce: r.nonce, ciphertext: r.ciphertext } : ({} as Sealed)))
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

  /** 読む間にファイルが消えた(相手のまとめ直しの途中)ら、同じ token から 1 回だけ読み直す。消えた印と新しいスナップショットが来る */
  async changes(since: number): Promise<ChangesPage> {
    for (let attempt = 0; ; attempt++) {
      const page = await this.changesOnce(since)
      if (page !== null) return page
      if (attempt > 0) throw bad()
    }
  }

  private async changesOnce(since: number): Promise<ChangesPage | null> {
    const token = since === 0 ? null : await this.t.state('drive_token')
    if (token === null) return this.fullRead(since)
    const scan = await this.scanChanges(token)
    // token を断られた。手元を消さない全件の読み取り(マージだけ)にする
    if (scan === null) return this.fullRead(since)
    const seen = await this.seen()
    const marker = await this.t.state('drive_space')
    const c = this.classify(scan.changes, seen, marker)
    // 部分の揃わないスナップショットが来た書き手は、一覧で揃ったかを確かめる(まとめ直しはまれなので、一覧もまれ)
    const listed = this.hasPartialSnap(c.toRead)
    const commit: SqlStatement[] = []
    let epoch = await this.t.state('epoch')
    const needMarker = c.markerTouched || marker === null || epoch === null
    const listing = needMarker || listed.size > 0 ? await this.listAll() : []
    if (needMarker) {
      const m = this.winner(listing)
      if (m === null) throw new SyncApiError('http', 404, 'space_not_found')
      epoch = (m.appProperties as Record<string, string>).e
      commit.push(setState('drive_space', m.id))
    }
    const owner = (f: DriveFile) => (f.appProperties as Record<string, string>).d
    const sources = [...c.toRead.filter((f) => !listed.has(owner(f))), ...listing.filter((f) => this.isOthersData(f) && listed.has(owner(f)))]
    const upto = await this.stateJson<Upto>('drive_read_upto', {})
    const plan = this.plan(sources, seen, upto)
    // 自分が最後に読み終えた後に、相手が tombstone を落としていた。知らない削除があるかもしれないので全件で合わせ直す(2.6)
    if (plan.g > Number((await this.t.state('drive_read_at')) ?? 0)) {
      await this.c.db.batch([setState('drive_rebase', '1')])
      return { records: [], head: since, more: false, epoch: epoch as string, gc_floor: since + 1, commit: [], bad: [] }
    }
    const read = await this.readFiles(plan.read, since)
    if (read.missing) return null
    for (const id of c.removed) delete seen[id]
    for (const f of plan.mark) seen[f.id] = fileVersion(f)
    for (const [id, v] of read.seen) seen[id] = v
    commit.push(
      setState('drive_token', scan.next),
      setState('drive_seen', canonicalJson(seen)),
      setState('drive_read_upto', canonicalJson(this.advance(upto, plan.read))),
      setState('drive_read_at', String(this.c.now())),
    )
    return { records: read.records, head: since + read.records.length, more: false, epoch: epoch as string, gc_floor: 0, commit, bad: read.bad }
  }

  /**
   * 全件の読み取り(3.4)。一覧より先に token を取っておき、一覧の後に起きた変更を次の周で拾う。
   * 書き手ごとに揃った最新のスナップショットと、それより後のセグメントを読む。
   * head は読んだ数より 1 つ進め、空の領域でも次からは変更だけを読むようにする
   */
  private async fullRead(since: number): Promise<ChangesPage | null> {
    const start = await this.startToken()
    const files = await this.listAll()
    const m = this.winner(files)
    if (m === null) throw new SyncApiError('http', 404, 'space_not_found')
    const plan = this.plan(files.filter((f) => this.isOthersData(f)), {}, {})
    const read = await this.readFiles(plan.read, since)
    if (read.missing) return null
    const seen = Object.fromEntries(read.seen)
    for (const f of plan.mark) seen[f.id] = fileVersion(f)
    const records = read.records
    const commit = [
      setState('drive_token', start),
      setState('drive_seen', canonicalJson(seen)),
      setState('drive_read_upto', canonicalJson(this.advance({}, plan.read))),
      setState('drive_space', m.id),
      setState('drive_read_at', String(this.c.now())),
    ]
    // リベースでは、全件に自分の書いた分も入れる。入れないと、自分しか持たないレコードが「全件にない」として消える
    if ((await this.t.state('drive_rebase')) === '1') {
      records.push(...(await this.ownRecords(files, since + records.length)))
      commit.push(delState('drive_rebase'))
    }
    return { records, head: since + records.length + 1, more: false, epoch: (m.appProperties as Record<string, string>).e, gc_floor: 0, commit, bad: read.bad }
  }

  /** Drive に今ある自分のファイルに入れたレコードを、同期の表の値で封をして返す。中身は読み戻さない(手元の値の方が新しいか同じ) */
  private async ownRecords(files: readonly DriveFile[], base: number): Promise<Record<string, unknown>[]> {
    const present = new Set(files.map((f) => f.id))
    const own = await this.own()
    const seg = await this.stateJson<SegState | null>('drive_seg', null)
    const ids: string[] = []
    if (own.snap && own.snap.files.some((id) => present.has(id))) ids.push(...own.snap.ids)
    for (const s of own.segs) if (present.has(s.file)) ids.push(...s.ids)
    if (seg !== null && seg.file !== null && present.has(seg.file)) ids.push(...seg.ids)
    let version = base
    return (await this.reseal(sortedUnique(ids))).sealed.map((r) => ({ ...r, version: ++version }))
  }

  /**
   * 開いているセグメントを、今までに入れたレコードの今の値 + 今回の分で上書きする(1 回の送信 = 1 回の書き込み)。
   * 書き込みはぶつからないので 409 はない。version は since の続きを振り、エンジンが自分の送ったものを読み戻さないようにする
   */
  async pushRecords(_requestId: string, records: Record<string, unknown>[]): Promise<PushResponse> {
    const now = this.c.now()
    const day = utcDay(now)
    const old = await this.stateJson<SegState>('drive_seg', { n: 0, day: '', file: null, ids: [] })
    let seg = old
    const fresh: Sealed[] = records.map((r) => ({ record_id: r.record_id as string, kind_tag: r.kind_tag, schema_version: r.schema_version, nonce: r.nonce, ciphertext: r.ciphertext }))
    const freshIds = new Set(fresh.map((r) => r.record_id))
    let prev: Sealed[] = []
    let close = !(seg.n > 0 && seg.day === day)
    if (!close) {
      const want = seg.ids.filter((id) => !freshIds.has(id))
      prev = (await this.reseal(want)).sealed
      // 表から消えたもの(権限系を切った・期限の切れた tombstone)は封をし直せない。上書きで Drive から消さないよう、閉じて残す
      close = prev.length < want.length
    }
    let body = [...prev, ...fresh]
    if (close || (prev.length > 0 && this.segContent(seg.n, body).length > DRIVE_SEG_BYTES)) {
      seg = { n: seg.n + 1, day, file: null, ids: [] }
      body = fresh
    }
    // 閉じたセグメントは、まとめ直しで消すまで控える
    const closed: ClosedSeg | null = seg !== old && old.file !== null ? { n: old.n, file: old.file, v: old.v ?? UNKNOWN_VERSION, bytes: old.bytes ?? 0, ids: old.ids } : null
    let file = seg.file
    let content = this.segContent(seg.n, body)
    let version: number | null = null
    if (file !== null) {
      version = await this.updateFile(file, content)
      if (version === null) {
        // 消えていた(領域の削除など)。同じ通番のファイルを 2 つ作らないよう、次の通番で作る
        seg = { n: seg.n + 1, day, file: null, ids: [] }
        file = null
        content = this.segContent(seg.n, body)
      }
    }
    if (file === null) {
      const made = await this.createFile({ name: this.segName(seg.n), appProperties: this.segProps(seg.n) }, content)
      file = made.id
      version = made.version
    }
    const stmts = [setState('drive_seg', canonicalJson({ n: seg.n, day: seg.day, file, ids: body.map((r) => r.record_id), v: version as number, bytes: content.length }))]
    if (closed !== null) {
      const own = await this.own()
      stmts.push(setState('drive_own', canonicalJson({ ...own, segs: [...own.segs, closed] })))
    }
    await this.c.db.batch(stmts)
    const since = Number((await this.t.state('since')) ?? 0)
    return { results: records.map((r, i) => ({ record_id: r.record_id as string, status: 200, version: since + 1 + i })), epoch: await this.knownEpoch(), gc_floor: 0 }
  }

  /** 前に入れたレコードを同期の表の今の値で封をし直す。表にないもの・封ができないものは missing に返す */
  private async reseal(ids: readonly string[], cut = -1): Promise<{ sealed: Sealed[]; missing: string[]; dropped: boolean }> {
    const rows = await this.rows(ids)
    const out = { sealed: [] as Sealed[], missing: [] as string[], dropped: false }
    for (const id of ids) {
      const r = rows.get(id)
      if (!r) {
        out.missing.push(id)
        continue
      }
      // 期限の切れた tombstone は落とす(2.6)
      if (isDeleted(r.payload) && parseHlc(r.payload.hlc).wall < cut) {
        out.dropped = true
        continue
      }
      try {
        const sealed = sealPayload(this.c.keys, { space_id: this.c.spaceId, record_id: id, kind_tag: r.kind_tag, schema_version: r.schema_version }, r.payload)
        out.sealed.push({ record_id: id, kind_tag: r.kind_tag, schema_version: r.schema_version, ...sealed })
      } catch (e) {
        if (!(e instanceof SyncError)) throw e
        out.missing.push(id)
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

  // ── まとめ直し(2.5・2.6) ──

  /** 周の最後に呼ばれる。条件を満たしたときだけ動き、そうでなければ手元の控えを見るだけで通信しない */
  async maintain(): Promise<void> {
    try {
      await this.compact()
    } catch (e) {
      // 容量の超過: 作るのに容量が要るので、1 日は試さない。送信の側の「古い閲覧履歴を外す」が先に効く
      if (e instanceof SyncApiError && e.kind === 'http' && e.status === 413) {
        const job = await this.stateJson<CompactJob | null>('drive_compact', null)
        const wait = this.c.now() + DRIVE_COMPACT_GAP_MS
        await this.c.db.batch([job !== null ? setState('drive_compact', canonicalJson({ ...job, wait })) : setState('drive_compact_at', String(this.c.now()))])
        return
      }
      // 回数の上限は次の周で続ける。同期そのものは止めない
      if (e instanceof SyncApiError && e.kind === 'http' && e.status === 429) return
      throw e
    }
  }

  private async compact(): Promise<void> {
    const now = this.c.now()
    let job = await this.stateJson<CompactJob | null>('drive_compact', null)
    let made: Map<string, Sealed> | null = null
    if (job === null) {
      const own = await this.own()
      const bytes = own.segs.reduce((n, s) => n + s.bytes, 0)
      if (own.segs.length === 0 || (own.segs.length < DRIVE_COMPACT_SEGS && bytes < DRIVE_COMPACT_BYTES)) return
      if (now - Number((await this.t.state('drive_compact_at')) ?? 0) < DRIVE_COMPACT_GAP_MS) return
      const last = own.segs.reduce((a, s) => (s.n > a.n ? s : a))
      const del = [...(own.snap?.files ?? []), ...own.segs.map((s) => s.file)]
      const cut = now - TOMB_MAX_AGE_MS
      const built = await this.snapRecords(sortedUnique([...(own.snap?.ids ?? []), ...own.segs.flatMap((s) => s.ids)]), del, cut)
      job = { u: last.n, uv: last.v, g: built.dropped ? cut : (own.snap?.g ?? 0), cut, del, parts: splitParts(built.records).map((p) => p.map((r) => r.record_id)), done: [] }
      // 部分の分け方を先に置く。途中で落ちても、作り終えた部分を作り直さずに続きから作れる
      await this.c.db.batch([setState('drive_compact', canonicalJson(job))])
      made = new Map(built.records.map((r) => [r.record_id, r]))
    } else if (job.wait !== undefined && now < job.wait) {
      return
    }
    for (let i = job.done.length; i < job.parts.length; i++) {
      const ids = job.parts[i]
      const records = made !== null ? ids.flatMap((id) => made.get(id) ?? []) : (await this.snapRecords(ids, job.del, job.cut)).records
      const p = `${i + 1}/${job.parts.length}`
      const f = await this.createFile(
        { name: `${this.prefix()}.${this.c.deviceId}.snap.${job.u}.${i + 1}of${job.parts.length}`, appProperties: { f: String(DRIVE_FORMAT), s: this.c.spaceId, t: 'snap', d: this.c.deviceId, u: String(job.u), uv: String(job.uv), g: String(job.g), p } },
        JSON.stringify({ obbsync: DRIVE_FORMAT, space: this.c.spaceId, device: this.c.deviceId, type: 'snap', u: job.u, uv: job.uv, g: job.g, p, records }),
      )
      job = { ...job, done: [...job.done, f.id] }
      delete job.wait
      await this.c.db.batch([setState('drive_compact', canonicalJson(job))])
    }
    // 作り終えてから古いものを消す。どこにもない瞬間を作らない
    for (const id of job.del) await this.deleteFile(id)
    const own = await this.own()
    const u = job.u
    const next: OwnFiles = { snap: { u, g: job.g, files: job.done, ids: job.parts.flat() }, segs: own.segs.filter((s) => s.n > u) }
    await this.c.db.batch([setState('drive_own', canonicalJson(next)), delState('drive_compact'), setState('drive_compact_at', String(now))])
  }

  /**
   * スナップショットに入れるレコード。同期の表の今の値で封をし、期限の切れた tombstone を落とす。
   * 表にないもの(権限系を切った・手元で期限が切れた)は、古い自分のファイルから暗号文のまま引き継ぐ(切った端末が Drive から消さないように)
   */
  private async snapRecords(ids: readonly string[], oldFiles: readonly string[], cut: number): Promise<{ records: Sealed[]; dropped: boolean }> {
    const r = await this.reseal(ids, cut)
    let dropped = r.dropped
    const records = r.sealed
    if (r.missing.length > 0) {
      const old = new Map<string, Sealed>()
      // 後のファイル(新しいセグメント)の値で上書きする
      for (const id of oldFiles) {
        const body = await this.download(id)
        for (const x of (body === null ? null : this.parseOwn(body)) ?? []) old.set(x.record_id, x)
      }
      for (const id of r.missing) {
        const x = old.get(id)
        const opened = x === undefined ? null : openRecords(this.c.keys, this.c.spaceId, [{ ...x, version: 0 }]).records[0]
        if (x === undefined || opened === undefined || opened === null || (isDeleted(opened.payload) && parseHlc(opened.payload.hlc).wall < cut)) {
          dropped = true
          continue
        }
        records.push(x)
      }
      records.sort((a, b) => (a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0))
    }
    return { records, dropped }
  }

  /** 自分のファイルの中身。形が違えば null */
  private parseOwn(body: string): Sealed[] | null {
    let v: unknown
    try {
      v = parseStrictJson(body)
    } catch {
      return null
    }
    if (!isObject(v) || v.obbsync !== DRIVE_FORMAT || v.space !== this.c.spaceId || v.device !== this.c.deviceId || !Array.isArray(v.records)) return null
    return v.records.flatMap((r) => (isObject(r) && typeof r.record_id === 'string' ? [{ record_id: r.record_id, kind_tag: r.kind_tag, schema_version: r.schema_version, nonce: r.nonce, ciphertext: r.ciphertext }] : []))
  }

  /**
   * 目印を作る(なければ)。許可証は使わない。2 台が同時に作ったら、作った後に一覧で正を決め、負けた方は自分の目印を消す。
   * 目印がない = 領域のファイルが全部消えたので、自分のファイルの控えも捨てる(消えたファイルを数えてまとめ直さない)
   */
  async createSpace(): Promise<{ epoch: string }> {
    const forget = [delState('drive_own'), delState('drive_compact')]
    const existing = this.winner(await this.listAll())
    if (existing !== null) {
      await this.c.db.batch([...forget, setState('drive_space', existing.id)])
      return { epoch: (existing.appProperties as Record<string, string>).e }
    }
    const e = this.o.newEpoch?.() ?? toBase64Url(randomBytes(16))
    const mine = (await this.createFile({ name: `${this.prefix()}.space`, appProperties: { f: String(DRIVE_FORMAT), s: this.c.spaceId, t: 'space', e } }, '')).id
    const w = this.winner(await this.listAll())
    if (w !== null && w.id !== mine) {
      await this.deleteFile(mine)
      await this.c.db.batch([...forget, setState('drive_space', w.id)])
      return { epoch: (w.appProperties as Record<string, string>).e }
    }
    await this.c.db.batch([...forget, setState('drive_space', mine)])
    return { epoch: e }
  }
}

/** 部分に分ける。1 部分は DRIVE_SNAP_PART_BYTES まで。レコードがなくても 1 部分は作る(u と g を伝えるため) */
function splitParts(records: readonly Sealed[]): Sealed[][] {
  const parts: Sealed[][] = [[]]
  let size = 0
  for (const r of records) {
    const n = JSON.stringify(r).length + 1
    if (size + n > DRIVE_SNAP_PART_BYTES && parts[parts.length - 1].length > 0) {
      parts.push([])
      size = 0
    }
    parts[parts.length - 1].push(r)
    size += n
  }
  return parts
}
