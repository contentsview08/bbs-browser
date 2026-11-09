// テスト用の Google ドライブ。同期が使う分(appDataFolder の files・changes)だけをメモリで真似る。決まりは docs/sync-drive.md の 9.1。
// 本物の Google には繋がない。応答の形は公式の参照の一部(fields は見ずに全部返す)
export const FAKE_DRIVE_TOKEN = 'fake-drive-access-token'
export const FAKE_DRIVE_HOST = 'www.googleapis.com'

/** 4.1 の単位。呼び出しごとに数え、見積もりを確かめる */
export const DRIVE_UNITS = { other: 5, read: 5, list: 100, edit: 50, download: 200 } as const

export interface FakeDriveFile {
  id: string
  name: string
  parents: string[]
  appProperties: Record<string, string>
  version: number
  createdTime: string
  /** 最後に中身か appProperties を書いた時刻。止まった書き手のファイルを見分けるのに使う */
  modifiedTime: string
  content: string
}

export interface FakeHttpRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
}

export interface FakeHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const json = (status: number, v: unknown): FakeHttpResponse => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
export const driveFail = (status: number, reason: string, message = reason): FakeHttpResponse =>
  json(status, { error: { code: status, message, errors: [{ domain: 'global', reason, message }] } })

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

export class FakeDrive {
  readonly files = new Map<string, FakeDriveFile>()
  /** 変更の記録。token は次に付く番号 */
  private changes: { seq: number; fileId: string }[] = []
  private seq = 1
  private ids = 0
  units = 0
  calls: Record<string, number> = {}
  tokens = new Set([FAKE_DRIVE_TOKEN])
  /** 利用者の Drive の空き。超えたら 403 storageQuotaExceeded */
  quotaBytes = Infinity
  /** 1 ページに返す数の上限。本物も pageSize より少なく返すことがあるので、ページを辿るかを確かめる */
  pageCap = Infinity

  constructor(private readonly now: () => number) {}

  private count(name: string, units: number): void {
    this.calls[name] = (this.calls[name] ?? 0) + 1
    this.units += units
  }

  private bump(fileId: string): void {
    this.changes.push({ seq: this.seq++, fileId })
  }

  private meta(f: FakeDriveFile): Record<string, unknown> {
    return { kind: 'drive#file', id: f.id, name: f.name, appProperties: { ...f.appProperties }, version: String(f.version), size: String(utf8Bytes(f.content)), createdTime: f.createdTime, modifiedTime: f.modifiedTime, trashed: false }
  }

  private usedBytes(): number {
    let n = 0
    for (const f of this.files.values()) n += utf8Bytes(f.content)
    return n
  }

  // ── テストの操作。API にはない ──

  /** 利用者がほかの Drive のファイルを触った。appDataFolder の変更ではないが token は進む */
  touchOther(): void {
    this.seq++
  }

  filesOf(spaceId: string): FakeDriveFile[] {
    return [...this.files.values()].filter((f) => f.appProperties.s === spaceId)
  }

  /** 目印のある領域の数 */
  spaceCount(): number {
    return new Set([...this.files.values()].filter((f) => f.appProperties.t === 'space').map((f) => f.appProperties.s)).size
  }

  /** 利用者が「隠しアプリデータを削除」した */
  deleteSpace(spaceId: string): void {
    for (const f of this.filesOf(spaceId)) this.remove(f.id)
  }

  /** 目印の e を替える */
  bumpEpoch(spaceId: string): void {
    for (const f of this.filesOf(spaceId)) {
      if (f.appProperties.t !== 'space') continue
      f.appProperties = { ...f.appProperties, e: `bumped${this.seq}` }
      f.version++
      f.modifiedTime = new Date(this.now()).toISOString()
      this.bump(f.id)
    }
  }

  /** 書き手 device のセグメント 1 つに、レコードを足す(同じ ID は置き換える)。他の端末が書いた状態を作る */
  putRecord(spaceId: string, device: string, record: Record<string, unknown>): void {
    const f = this.filesOf(spaceId).find((x) => x.appProperties.t === 'seg' && x.appProperties.d === device)
    const records = f ? ((JSON.parse(f.content) as { records: Record<string, unknown>[] }).records.filter((r) => r.record_id !== record.record_id)) : []
    records.push(record)
    const content = JSON.stringify({ obbsync: 1, space: spaceId, device, type: 'seg', n: 1, records })
    if (f) {
      f.content = content
      f.version++
      f.modifiedTime = new Date(this.now()).toISOString()
      this.bump(f.id)
    } else {
      this.create({ name: `obbsync1.${spaceId.slice(0, 16)}.${device}.seg.1`, parents: ['appDataFolder'], appProperties: { f: '1', s: spaceId, t: 'seg', d: device, n: '1' } }, content)
    }
  }

  /** 他の端末が書いたファイルを、そのまま置く(部分の揃わないスナップショットなど) */
  putFile(name: string, appProperties: Record<string, string>, content: string): string {
    return this.create({ name, parents: ['appDataFolder'], appProperties }, content).id
  }

  /** 領域のファイルにあるレコード。同じ ID が書き手ごとにあれば全部 */
  recordsOf(spaceId: string): Record<string, unknown>[] {
    return this.filesOf(spaceId).flatMap((f) => {
      if (f.appProperties.t !== 'seg' && f.appProperties.t !== 'snap') return []
      try {
        const v = JSON.parse(f.content) as { records?: unknown }
        return Array.isArray(v.records) ? (v.records as Record<string, unknown>[]) : []
      } catch {
        return []
      }
    })
  }

  private remove(id: string): void {
    if (this.files.delete(id)) this.bump(id)
  }

  private create(meta: Record<string, unknown>, content: string): FakeDriveFile {
    const f: FakeDriveFile = {
      id: `f${String(++this.ids).padStart(8, '0')}`,
      name: typeof meta.name === 'string' ? meta.name : 'untitled',
      parents: meta.parents as string[],
      appProperties: { ...(meta.appProperties as Record<string, string> | undefined) },
      version: 1,
      createdTime: new Date(this.now()).toISOString(),
      modifiedTime: new Date(this.now()).toISOString(),
      content,
    }
    this.files.set(f.id, f)
    this.bump(f.id)
    return f
  }

  // ── API ──

  handle(req: FakeHttpRequest): FakeHttpResponse {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return driveFail(400, 'badRequest')
    }
    if (url.protocol !== 'https:' || url.host !== FAKE_DRIVE_HOST) return driveFail(404, 'notFound')
    const auth = /^Bearer (.+)$/.exec(req.headers?.Authorization ?? '')
    if (!auth || !this.tokens.has(auth[1])) return driveFail(401, 'authError', 'Invalid Credentials')
    const q = url.searchParams
    const path = url.pathname
    const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(path)
    if (path === '/drive/v3/changes/startPageToken' && req.method === 'GET') {
      this.count('changes.getStartPageToken', DRIVE_UNITS.other)
      return json(200, { kind: 'drive#startPageToken', startPageToken: String(this.seq) })
    }
    if (path === '/drive/v3/changes' && req.method === 'GET') return this.listChanges(q)
    if (!m) return driveFail(404, 'notFound')
    const upload = m[1] !== undefined
    const id = m[2] === undefined ? undefined : decodeURIComponent(m[2])
    if (upload) {
      if (q.get('uploadType') !== 'multipart') return driveFail(400, 'badRequest')
      if (req.method === 'POST' && id === undefined) return this.upload(req, undefined)
      if (req.method === 'PATCH' && id !== undefined) return this.upload(req, id)
      return driveFail(405, 'methodNotAllowed')
    }
    if (id === undefined) {
      if (req.method !== 'GET') return driveFail(405, 'methodNotAllowed')
      return this.listFiles(q)
    }
    const f = this.files.get(id)
    if (req.method === 'GET') {
      const media = q.get('alt') === 'media'
      this.count(media ? 'files.get(media)' : 'files.get', media ? DRIVE_UNITS.download : DRIVE_UNITS.read)
      if (!f) return driveFail(404, 'notFound', `File not found: ${id}.`)
      return media ? { status: 200, headers: { 'Content-Type': 'application/json' }, body: f.content } : json(200, this.meta(f))
    }
    if (req.method === 'DELETE') {
      this.count('files.delete', DRIVE_UNITS.edit)
      if (!f) return driveFail(404, 'notFound', `File not found: ${id}.`)
      this.remove(id)
      return { status: 204, headers: {}, body: '' }
    }
    return driveFail(405, 'methodNotAllowed')
  }

  private pageSize(q: URLSearchParams): number | null {
    const raw = q.get('pageSize')
    if (raw === null) return Math.min(100, this.pageCap)
    const n = Number(raw)
    return Number.isSafeInteger(n) && n >= 1 && n <= 1000 ? Math.min(n, this.pageCap) : null
  }

  /** appDataFolder の中は spaces=appDataFolder を付けないと見えない */
  private inAppData(q: URLSearchParams): boolean {
    return (q.get('spaces') ?? 'drive').split(',').includes('appDataFolder')
  }

  private listChanges(q: URLSearchParams): FakeHttpResponse {
    this.count('changes.list', DRIVE_UNITS.list)
    const token = Number(q.get('pageToken'))
    const size = this.pageSize(q)
    if (!Number.isSafeInteger(token) || token < 1 || token > this.seq || size === null) return driveFail(400, 'invalid', 'Invalid Value')
    // ファイルごとに最後の変更だけを、その順に返す
    const last = new Map<string, number>()
    for (const c of this.changes) if (c.seq >= token) last.set(c.fileId, c.seq)
    const entries = [...last].sort((a, b) => a[1] - b[1])
    const page = this.inAppData(q) ? entries.slice(0, size) : []
    const more = this.inAppData(q) && entries.length > size
    const changes = page.map(([fileId]) => {
      const f = this.files.get(fileId)
      return f ? { kind: 'drive#change', changeType: 'file', fileId, removed: false, file: this.meta(f) } : { kind: 'drive#change', changeType: 'file', fileId, removed: true }
    })
    return json(200, { kind: 'drive#changeList', changes, ...(more ? { nextPageToken: String(page[page.length - 1][1] + 1) } : { newStartPageToken: String(this.seq) }) })
  }

  private listFiles(q: URLSearchParams): FakeHttpResponse {
    this.count('files.list', DRIVE_UNITS.list)
    const size = this.pageSize(q)
    const offset = Number(q.get('pageToken') ?? 0)
    if (size === null || !Number.isSafeInteger(offset) || offset < 0) return driveFail(400, 'invalid', 'Invalid Value')
    const all = this.inAppData(q) ? [...this.files.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) : []
    const page = all.slice(offset, offset + size)
    return json(200, { kind: 'drive#fileList', files: page.map((f) => this.meta(f)), ...(offset + size < all.length && { nextPageToken: String(offset + size) }) })
  }

  /** multipart/related: メタデータの JSON と本文の 2 部分 */
  private upload(req: FakeHttpRequest, id: string | undefined): FakeHttpResponse {
    this.count(id === undefined ? 'files.create' : 'files.update', DRIVE_UNITS.edit)
    const b = /boundary=([^;]+)/.exec(req.headers?.['Content-Type'] ?? '')?.[1]
    if (!b || !req.body) return driveFail(400, 'badRequest', 'Bad multipart')
    const parts = req.body.split(`--${b}`).slice(1, -1).map((p) => {
      const at = p.indexOf('\r\n\r\n')
      return at < 0 ? null : p.slice(at + 4).replace(/\r\n$/, '')
    })
    if (parts.length !== 2 || parts[0] === null || parts[1] === null || !req.body.trimEnd().endsWith(`--${b}--`)) return driveFail(400, 'badRequest', 'Bad multipart')
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(parts[0]) as Record<string, unknown>
    } catch {
      return driveFail(400, 'badRequest', 'Bad metadata')
    }
    const content = parts[1]
    const props = meta.appProperties as Record<string, unknown> | undefined
    if (props !== undefined) {
      // 1 ファイル 30 個まで、1 つは鍵と値を合わせて 124 バイトまで
      const entries = Object.entries(props)
      if (entries.length > 30 || entries.some(([k, v]) => typeof v !== 'string' || utf8Bytes(k) + utf8Bytes(v) > 124)) return driveFail(400, 'invalidProperty')
    }
    const old = id === undefined ? 0 : utf8Bytes(this.files.get(id)?.content ?? '')
    if (this.usedBytes() - old + utf8Bytes(content) > this.quotaBytes) return driveFail(403, 'storageQuotaExceeded', 'The user has exceeded their Drive storage quota')
    if (id === undefined) {
      const parents = meta.parents
      if (!Array.isArray(parents) || parents.length !== 1 || parents[0] !== 'appDataFolder') return driveFail(403, 'insufficientPermissions')
      return json(200, this.meta(this.create(meta, content)))
    }
    const f = this.files.get(id)
    if (!f) return driveFail(404, 'notFound', `File not found: ${id}.`)
    if (meta.parents !== undefined) return driveFail(403, 'fieldNotWritable')
    if (props !== undefined) f.appProperties = { ...f.appProperties, ...(props as Record<string, string>) }
    f.content = content
    f.version++
    f.modifiedTime = new Date(this.now()).toISOString()
    this.bump(f.id)
    return json(200, this.meta(f))
  }
}
