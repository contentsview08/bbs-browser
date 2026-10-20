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
  /** 付けない Cookie の名前(POST だけ。BE を使わない書き込みで、BE の Cookie を外すときなど) */
  excludeCookies?: string[]
  /**
   * POST を、読む通信(GET)と同じ Cookie の置き場で送る。ふつうの POST は書き込み用の別の置き場を使うが、
   * ページを見たときに渡された Cookie が書き込みに要る掲示板(ふたば)で使う。excludeCookies は効かない
   */
  sameCookiesAsGet?: boolean
}

/** サーバーに頼めるスレ一覧の並び順。勢い・新しい・古い・レスの多い・少ない順 */
export type ListSort = 'momentum' | 'newest' | 'oldest' | 'most' | 'fewest'

export interface ConnectorContext {
  http: {
    get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>
    /**
     * body はエンコード済みの文字列(フォームなら ASCII だけになっている)。
     * ファイルを付けるとき(multipart)はバイト列で渡す。バイト列は sameCookiesAsGet の POST だけ受け付ける
     */
    post(url: string, body: string | Uint8Array, opts?: HttpRequestOptions): Promise<HttpResponse>
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
  /** スレの画像のサムネイル(画像が主役の掲示板。ふたば・4chan のカタログ)。なければ出さない */
  thumb?: string
  /**
   * スレ一覧を取ったときに一緒に届いた、スレの中身の一部(>>1 と最新のいくつか)。スレを開かずにのぞくのに使う。
   * スレ一覧に中身が入っている掲示板だけ付ける(2ch の subject.txt には入っていないので付けない。のぞくために取りに行くことはしない)
   */
  preview?: { no: number; name: string; date?: string; body: string }[]
  /** スレに付いた印(「固定」「ロック」「NSFW」など、掲示板が付けるもの)。スレ一覧のスレタイの前に出す */
  badges?: Badge[]
  /**
   * 運営のお知らせ・広告のスレ(5ch の「5ちゃんねるからのお知らせ」「プレミアムサービスのお知らせ」など)。
   * 掲示板はいつも一覧の頭に置くが、アプリはどの並べ方でも一番下に回す
   */
  announcement?: boolean
  /**
   * スレを立てた人の ID。スレ一覧に付いてくる掲示板だけ(エッジの subject-metadent.txt はスレタイの後ろに「[ID★]」が付く)。
   * スレタイからは外して、ここに入れる
   */
  authorId?: string
}

/**
 * 掲示板が付ける印(レスなら「スレ主」「管理人」「認証済み」、スレなら「固定」など)。
 * アプリは名前の横やスレタイの前に小さく出す。色は意味(tone)で選び、配色に合わせて塗る
 */
export interface Badge {
  label: string
  tone?: 'accent' | 'muted' | 'danger' | 'success' | 'warning'
  /** マウスを乗せたときの説明 */
  title?: string
}

/**
 * レスへの反応(ふたばの「そうだね」、いいね、リアクションの種類など)。数を数えるもの。
 * アプリはレスの頭に「名前×数」のチップを出し、押すとコネクタの react を呼ぶ
 */
export interface ReactionDef {
  /** コネクタの中での名前(react に渡し、FetchPostsResult.reactions のキーにする) */
  id: string
  /** 画面に出す名前(「そうだね」「いいね」) */
  label: string
  /** アイコン(Material Symbols の名前。thumb_up など) */
  icon: string
}

/**
 * レスへの操作(通報など、数を数えないもの)。アプリはレスの「その他」のメニューに並べ、押すとコネクタの runPostAction を呼ぶ。
 * 自分の書き込みの削除は、削除キーが要るので deletePost で別に扱う
 */
export interface PostActionDef {
  id: string
  label: string
  icon: string
  /** 押したときに確かめる文(通報など、取り消せないもの)。なければすぐ実行する */
  confirm?: string
  /** 危ない操作として赤く出す */
  danger?: boolean
  /** 自分の書き込みにだけ出す */
  ownOnly?: boolean
}

export interface Post {
  /**
   * スレの中で、レスが届いた順の通し番号(1 から、すき間なく)。既読・未読・新着の数・「ここから未読」は全部これで数える。
   * 約束: 一度付けた番号は変えない。新しいレスにはいつも、それまでより大きい番号を付ける(差分の取得で後ろに足していく)。
   * 2ch のようにレス番号がこの約束を満たす掲示板は、レス番号をそのまま使う。
   * 板の本当の番号が別にある掲示板(ふたば・4chan)は、本当の番号を ref に入れ、no は届いた順に振る。
   * (返信がツリーになる掲示板を扱うことになっても、no は「届いた順」のまま使い、表示の並びは別に持つ。
   * そうすれば、既読・未読の仕組みを変えずに済む)
   */
  no: number
  /**
   * 板の本当のレス番号が no と違う掲示板(ふたば・4chan は板全体の通し番号)のときの、その番号。
   * 画面の番号と、返信で付けるアンカー(>>番号)はこちらを使う。2ch のように no と同じなら付けない
   */
  ref?: number
  name: string
  mail: string
  /** サーバーが返したままの日付文字列(形式は板ごとにばらばら) */
  date: string
  id?: string
  /** 本文。HTML を取り除き、改行を \n にしたもの */
  body: string
  /** 掲示板がレスに付けた印(「管理人」「認証済み」など)。なければ付けない */
  badges?: Badge[]
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
  /**
   * dat 落ちしたが、過去ログ(5ch の oyster など)からレスを取れた。status は 'updated' / 'reset' で、
   * レスは保存し、スレは dat 落ちとして扱う
   */
  archived?: boolean
  /**
   * レスごとの反応の数(ふたばの「そうだね」など。種類は Connector.reactions)。
   * キーはレスの画面の番号(ref があれば ref、なければ no)、その中のキーは反応の id。
   * 数はそのときのスレ全体の分(取るたびに増えることがあるので、新しいレスがなくても返してよい)
   */
  reactions?: Record<string, Record<string, number>>
}

/** 板の設定(2ch 互換なら SETTING.TXT から) */
export interface BoardInfo {
  title?: string
  /** 名前を空にして書き込んだときの名前(「名無しさん」など) */
  nonameName?: string
  /** 書き込みの上限(分かるものだけ)。書き込む前の確かめに使う */
  limits?: PostLimits
}

/** 書き込みの上限。バイト数はコネクタの postByteLength で数えた値と比べる */
export interface PostLimits {
  messageBytes?: number
  /** 本文の行数 */
  lines?: number
  nameBytes?: number
  mailBytes?: number
  subjectBytes?: number
}

export interface ResolvedUrl {
  board: Board
  thread?: ThreadSummary
}

/** 書き込みに付けるファイル(画像・動画) */
export interface PostFile {
  name: string
  /** MIME の種類(image/png など) */
  type: string
  data: Uint8Array
}

/** 書き込みにファイルを付けられる掲示板の決まり(ふたば)。付けられない掲示板は持たない(外のアップローダーを使う) */
export interface AttachmentRules {
  maxFiles: number
  /** 1 つのファイルの大きさの上限(バイト) */
  maxBytes: number
  /** 付けられる種類(MIME)。image/png など */
  types: string[]
}

export interface PostInput {
  name: string
  mail: string
  body: string
  /** 付けるファイル(コネクタが attachments を持つときだけ) */
  files?: PostFile[]
  /** 書き込みの削除キー(ふたば。あとで自分の書き込みを消すときに使う)。使わない掲示板は無視する */
  deleteKey?: string
  /** この書き込みで使うアカウント(AccountKind の id)。入っていないアカウントの Cookie は付けない */
  accounts?: string[]
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
  /** 元の書き込みで外した Cookie(承諾して送り直すときも同じにする) */
  excludeCookies?: string[]
}

export type PostResult =
  | {
      status: 'ok'
      message: string
      /** サーバーが教えてくれたときだけ */
      resNumber?: number
      /** 書き込んだレスの、板の本当の番号(Post.ref。ふたばは返事の thisno) */
      ref?: number
    }
  /** 認証が要る。url をブラウザで開き、code を入れてから書き込み直す */
  | { status: 'auth'; message: string; url?: string; code?: string; html?: string }
  /** html はサーバーが返したページそのもの(原因を調べるときに、そのまま見られるように) */
  | { status: 'error'; message: string; html?: string }
  /** 書き込み確認。内容(message・html)を見せ、承諾されたら confirm を submitConfirm に渡す */
  | { status: 'confirm'; message: string; html: string; confirm: PostConfirm }

/** サイトのアカウント(5ch の BE など)。ログインするとサーバーが Cookie を渡し、以後の書き込みに自動で付く */
export interface AccountKind {
  id: string
  name: string
  /** どのサイトで使うものか(画面に出す説明) */
  site: string
  /** 登録の案内などの URL */
  registerUrl?: string
  /** このアカウントを使える板のホスト(この名前か、その下の名前。例: 5ch.io) */
  hosts: string[]
}

export interface LoginResult {
  ok: boolean
  message: string
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
  /** 書き込みにファイルを付けられるときの決まり。あれば、書き込み欄の画像のボタンは外のアップローダーではなく、書き込みに付ける */
  attachments?: AttachmentRules
  /** 1 つのスレに書けるレスの数の上限(2ch は 1000)。ここまで来たら「満」。上限のない掲示板は付けない */
  maxPosts?: number
  /** 自分の書き込みを消す(書いたときと同じ削除キーで)。消せない掲示板は持たない */
  deletePost?(thread: ThreadSummary, post: Post, deleteKey: string, ctx: ConnectorContext): Promise<PostResult>
  /** レスへの反応の種類(ふたばは「そうだね」)。反応のない掲示板は付けない */
  reactions?: ReactionDef[]
  /** 反応を押す。押したあとの数を返す */
  react?(thread: ThreadSummary, post: Post, reactionId: string, ctx: ConnectorContext): Promise<number>
  /** レスへの操作(通報など)の種類。なければ付けない */
  postActions?: PostActionDef[]
  /** 操作を実行する。結果の文は画面に知らせとして出す */
  runPostAction?(thread: ThreadSummary, post: Post, actionId: string, ctx: ConnectorContext): Promise<PostResult>
  /** 引用を「>前のレスの文章」の形で書く掲示板(ふたば)。引用した文章から、元のレスを探してつなぐ */
  textQuotes?: boolean
  /** 本文の >>番号 が指すもの。'no': スレの中の番号(2ch) / 'ref': 板の本当の番号(Post.ref。4chan など)。既定は 'no' */
  anchorTarget?: 'no' | 'ref'
  /** URL を貼られたとき、どのコネクタで開くかを決める */
  canHandle(url: string): boolean
  /**
   * 本文からアイコン(5ch の BE アイコンなど)を取り出す。掲示板ごとの書き方なので、コネクタが受け持つ。
   * 返す body はアイコンの部分を除いた本文
   */
  splitPostIcon?(body: string): { icon?: string; body: string }
  /** このコネクタで開けるスレの URL か(本文のリンクを押したとき、ブラウザではなくアプリで開くため) */
  isThreadUrl?(url: string): boolean
  /**
   * 板やスレの URL から板(スレの URL ならスレも)を割り出す。扱えない URL なら null。
   * bbsmenu を公開していない板を、URL で直接登録するために使う
   */
  resolveUrl(url: string, ctx: ConnectorContext): Promise<ResolvedUrl | null>
  /** 板の設定を取る(名無しの名前など)。取れなければ空のまま返す */
  boardInfo?(board: Board, ctx: ConnectorContext): Promise<BoardInfo>
  listBoards(site: SiteConfig, ctx: ConnectorContext): Promise<Board[]>
  /**
   * スレ一覧を取る。opts.sort は、サーバーに並べ替えてもらう順(serverSorts にあるものだけ)。
   * ふたばのカタログは並び順ごとに載るスレが変わる(板のスレ全部から選び直す)ので、手元で並べ替えるのではなくサーバーに頼む
   */
  listThreads(board: Board, ctx: ConnectorContext, opts?: { sort?: ListSort }): Promise<ThreadSummary[]>
  /** サーバーに並べ替えを頼める順(なければ、いつも同じ一覧を取り、並べ替えは手元でする) */
  serverSorts?: ListSort[]
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
  /**
   * 書き込みのバイト数を、その掲示板に送るときの数え方で数える(Shift_JIS なら全角は 2 バイト など)。
   * BoardInfo.limits と比べて、書き込む前に長すぎないか確かめる
   */
  postByteLength?(text: string): number
  /** ログインできるアカウントの種類 */
  accounts?: AccountKind[]
  /**
   * アカウントにログインする。Cookie は通信の仕組み(ホストの Cookie の保存場所)が受け取り、
   * 以後そのサイトへの書き込みに自動で付く
   */
  login?(accountId: string, credential: { user: string; password: string }, ctx: ConnectorContext): Promise<LoginResult>
}
