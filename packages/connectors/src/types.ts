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
    /** body はエンコード済みの文字列(フォームなら ASCII だけになっている) */
    post(url: string, body: string, opts?: HttpRequestOptions): Promise<HttpResponse>
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

/** 板の設定(2ch 互換なら SETTING.TXT から) */
export interface BoardInfo {
  title?: string
  /** 名前を空にして書き込んだときの名前(「名無しさん」など) */
  nonameName?: string
}

export interface ResolvedUrl {
  board: Board
  thread?: ThreadSummary
}

export interface PostInput {
  name: string
  mail: string
  body: string
}

export interface NewThreadInput extends PostInput {
  title: string
}

/** 書き込み確認(5ch の「上記全てを承諾して書き込む」)で、承諾したときに送るもの */
export interface PostConfirm {
  /** 送り先 */
  url: string
  /** 元の書き込みの内容に、確認画面のフォームの項目を重ねたもの */
  fields: Record<string, string>
  referer: string
}

export type PostResult =
  | { status: 'ok'; message: string; /** サーバーが教えてくれたときだけ */ resNumber?: number }
  /** 認証が要る。url をブラウザで開き、code を入れてから書き込み直す */
  | { status: 'auth'; message: string; url?: string; code?: string; html?: string }
  /** html はサーバーが返したページそのもの(原因を調べるときに、そのまま見られるように) */
  | { status: 'error'; message: string; html?: string }
  /** 書き込み確認。内容(message・html)を見せ、承諾されたら confirm を submitConfirm に渡す */
  | { status: 'confirm'; message: string; html: string; confirm: PostConfirm }

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
  /** 板の設定を取る(名無しの名前など)。取れなければ空のまま返す */
  boardInfo?(board: Board, ctx: ConnectorContext): Promise<BoardInfo>
  listBoards(site: SiteConfig, ctx: ConnectorContext): Promise<Board[]>
  listThreads(board: Board, ctx: ConnectorContext): Promise<ThreadSummary[]>
  fetchPosts(thread: ThreadSummary, cursor: Cursor | null, ctx: ConnectorContext): Promise<FetchPostsResult>
  /** 書き込む。capabilities.post が true のコネクタだけが持つ */
  createPost?(thread: ThreadSummary, input: PostInput, ctx: ConnectorContext): Promise<PostResult>
  /**
   * スレを立てる。成功しても新しいスレのキーは返らないことが多いので、
   * ホストがスレ一覧を取り直してスレタイで探す
   */
  createThread?(board: Board, input: NewThreadInput, ctx: ConnectorContext): Promise<PostResult>
  /** 書き込み確認で承諾したときに送り直す(createPost / createThread が confirm を返したときだけ使う) */
  submitConfirm?(confirm: PostConfirm, ctx: ConnectorContext): Promise<PostResult>
  /** ブラウザで開くための URL */
  threadWebUrl(thread: ThreadSummary): string
}
