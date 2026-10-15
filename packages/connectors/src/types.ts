// コネクタとホスト(Tauri アプリ / テスト / CLI)の境界になる型。
// コネクタは fetch や DOM に直接触れず、ここで定義した ConnectorContext だけを使う。
// そうしておくと、通信を Tauri(Rust)側に任せられ、テストでは保存済みデータを流し込める。

export type Encoding = 'utf-8' | 'shift_jis' | 'euc-jp'

export interface HttpResponse {
  status: number
  /** ヘッダー名は小文字 */
  headers: Record<string, string>
  /** dat の差分取得はバイト単位なので、デコード前のバイト列で受け取る */
  body: Uint8Array
}

export interface HttpRequestOptions {
  headers?: Record<string, string>
}

export interface ConnectorContext {
  http: {
    get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>
  }
  decode(bytes: Uint8Array, encoding: Encoding): string
}

/** 板一覧を取るための入口。2ch 互換なら bbsmenu の URL */
export interface SiteConfig {
  connectorId: string
  name: string
  menuUrl: string
}

export interface Board {
  connectorId: string
  /** 板の URL。板を一意に表すキーにもなる(例: https://medaka.5ch.io/prog/) */
  url: string
  name: string
  category?: string
}

export interface ThreadSummary {
  connectorId: string
  boardUrl: string
  /** 板の中でスレを一意に表すキー(2ch 互換なら dat 番号) */
  key: string
  title: string
  postCount: number
  /** subject.txt の並び順(0 始まり) */
  order: number
  createdAt?: Date
}

export interface Post {
  no: number
  name: string
  mail: string
  /** サーバーが返したままの日付文字列(形式は板ごとにばらばら) */
  date: string
  id?: string
  /** 本文。HTML を取り除き、改行を \n にしたもの */
  body: string
}

/**
 * 差分取得の続きを表す値。中身はコネクタだけが解釈する。
 * ホストは JSON としてそのまま保存して、次の取得で渡し返す。
 */
export type Cursor = unknown

export type FetchStatus =
  | 'updated' // 新しいレスがあった(0 件のこともある)
  | 'notModified' // 前回から変化なし
  | 'reset' // 差分が取れず全件を取り直した。posts は全件、手元のレスは置き換える
  | 'archived' // dat 落ち・削除

export interface FetchPostsResult {
  status: FetchStatus
  /** 'updated' のときは新着だけ、'reset' のときは全件 */
  posts: Post[]
  cursor: Cursor
  /** dat の 1 行目などから分かったスレタイ */
  title?: string
}

export interface ResolvedUrl {
  board: Board
  thread?: ThreadSummary
}

export interface ConnectorCapabilities {
  post: boolean
  images: boolean
  incremental: boolean
}

export interface Connector {
  id: string
  name: string
  capabilities: ConnectorCapabilities
  /** URL を貼られたとき、どのコネクタで開くかを決める */
  canHandle(url: string): boolean
  /**
   * 板やスレの URL から板(スレの URL ならスレも)を割り出す。扱えない URL なら null。
   * bbsmenu を公開していない板を、URL で直接登録するために使う
   */
  resolveUrl(url: string, ctx: ConnectorContext): Promise<ResolvedUrl | null>
  listBoards(site: SiteConfig, ctx: ConnectorContext): Promise<Board[]>
  listThreads(board: Board, ctx: ConnectorContext): Promise<ThreadSummary[]>
  fetchPosts(thread: ThreadSummary, cursor: Cursor | null, ctx: ConnectorContext): Promise<FetchPostsResult>
  /** ブラウザで開くための URL */
  threadWebUrl(thread: ThreadSummary): string
}
