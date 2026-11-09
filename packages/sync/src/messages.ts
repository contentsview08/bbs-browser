// 画面に出す文。スマホ版の SyncController.kt と packages/conformance/sync-ui.json で揃える
const TICKET_AGAIN = '同期を続けるには、もう一度確認が必要です。この端末のデータはそのまま使えます。'

const MESSAGES: Record<string, string> = {
  auth_failed: 'この端末の鍵が使えなくなりました。もう一度つないでください。',
  capacity_full: '同期は満員です。枠が空くまで作れません。この端末のデータはそのまま使えます。',
  creation_closed: '同期の新規作成を止めています。この端末のデータはそのまま使えます。',
  ticket_required: TICKET_AGAIN,
  ticket_expired: TICKET_AGAIN,
  ticket_invalid: TICKET_AGAIN,
  bad_ticket: '確認の結果を受け取れませんでした。もう一度お試しください。',
  key_store_unavailable: 'この環境では鍵を安全に保存できないため、同期を使えません。',
  bad_url: 'サーバーの URL が正しくありません。https の URL だけを使えます。',
  bad_code: 'コードが正しくありません。',
  already_on: '同期を使っています。先にこの端末で同期をやめてください。',
  cancelled: '同期を始めるのをやめました。',
  network: 'オフライン',
  redirect: 'サーバーが別の場所へ移るよう返したので、送りませんでした。',
  too_large: 'サーバーの応答が大きすぎるので読みませんでした。',
  http_429: '少し待ってから同期します。',
  rate_limited: '少し待ってから同期します。',
  too_many_rebases: 'サーバーの状態が何度も変わったので、同期を止めました。',
  quota_exceeded: '同期の容量がいっぱいです。',
  sync_off: '先に「同期を使う」をオンにしてください。',
}

/**
 * Google ドライブの置き場の文(docs/sync-drive.md 5.7)。今は PC だけが使うので sync-ui.json の外に置く。
 * スマホが Drive を使う段(D4)で sync-ui.json の messages へ移す
 */
export const DRIVE_MESSAGES: Readonly<Record<string, string>> = {
  google_auth_failed: 'Google との接続が切れました。もう一度 Google でログインしてください。この端末のデータはそのまま使えます。',
  google_other_account: '前と違う Google アカウントです。同期のデータは前のアカウントにあります。',
  google_unavailable: 'この版には Google の同期の設定が入っていないため、Google ドライブで同期できません。',
  google_login_denied: 'Google のログインがやめられました。',
  google_login_timeout: 'Google のログインが 5 分のうちに終わらなかったので、やめました。',
  google_login_failed: 'Google のログインに失敗しました。もう一度お試しください。',
  drive_pairing_later: 'Google ドライブの同期では、端末の追加はまだ使えません。',
}

export function syncMessage(code: string): string {
  return MESSAGES[code] ?? DRIVE_MESSAGES[code] ?? `同期できませんでした(${code})`
}

export const SYNC_MESSAGES: Readonly<Record<string, string>> = MESSAGES

/** PC とスマホで同じ言葉にする */
/** 要約の「合わない理由」の見出し。bad_ で始まるものは捨てた数なので、理由の名前をそのまま出す */
export const SYNC_NOTES: Record<string, string> = {
  history_no_record: '手元の履歴のうち、まだ同期の表にないもの(次の同期で送ります)',
  history_over_shown: '履歴の画面に出す 300 件を超える分',
  view_old: 'ログの保持日数より古いので、手元に入れていない履歴',
  view_unresolved: 'この端末で開けない掲示板の履歴',
  view_reset: 'ログの削除より前の閲覧なので、手元に入れていない履歴',
  view_other: '手元にまだ入っていない履歴',
  read_no_row: '既読の記録だけがあり、手元に行のないスレ',
  read_differs: '手元の既読が同期の表と違うスレ',
  ops_waiting: 'まだ処理していない操作',
}

export const SYNC_LABELS = {
  section: '同期(実験的)',
  intro: '履歴やお気に入りを暗号化して、別の端末と同期します。実験的な機能です。サーバーは保管庫ではなく、端末の間の中継の置き場なので、しばらく使わないとサーバーのデータは消えます。この端末のデータは消えません。',
  master: '同期を使う',
  master_note: 'オフの間は通信も送信待ちも起きません。鍵とサーバーのデータは残るので、オンに戻すと続きから同期します。',
  kinds: '同期するもの',
  kinds_note: '切った種類は送らず、受け取っても手元へ写しません。サーバーのデータは消えません。オンに戻すと追いつきます。',
  kinds_resume_note: '切っていた間に手元で消したものは、オンに戻すと同期のデータから戻ります。',
  secret_ask_title: '画像の削除キー・管理トークンを同期しますか?',
  secret_ask_body: '上げた画像を置き場から消すための値を、暗号化して同期します。これを持つ人はその画像を消せます。同期につないだ端末のどれかが漏れると、値も漏れたものと考えてください。暗号化の鍵を変えても守れません。ほかの端末には自動で広がりません。使う端末ごとにオンにしてください。',
  secret_ask_ok: '危険を理解してオンにする',
  secret_note: '既定はオフです。オフの間は、この端末からサーバーへ送らず、届いても読みません。',
  advanced: '詳しい設定',
  leave_ask: 'この端末の鍵と同期の表を消します。この端末のお気に入りは消えません。サーバーのデータはそのままです。',
  server_ask: '新しいサーバーに認証の情報を送ります。',
  join_ask: 'この端末の閲覧履歴・お気に入り・書き込み履歴・自分のレスの印・上げた画像の履歴・設定が、この同期へ送られます。相手の鍵で読めるので、自分の端末の QR 以外は読まないでください。',
  join_ask_server: '同期サーバー: {host}(ふだんと違います)',
  join_ok: '参加する',
  join_cancel: 'やめる',
  search_note: '履歴・お気に入り・NG などを別の端末と同期(端末を追加・コードで参加)',
  start: '同期を始める',
  add_device: '端末を追加',
  join: 'コードで参加',
  sync_now: '今すぐ同期',
  leave: 'この端末で同期をやめる',
  server_url: 'サーバーの URL',
  status_space: '領域',
  status_pending: '送信待ち',
  status_error: '最後のエラー',
  pairing_warning: '他の人に見せないでください。このコードがあれば、同期のデータをすべて読めます。',
  copy: 'コピー',
  scan: 'QR を読む',
} as const

/** スイッチの見出し。並びと既定は engine/kinds.ts */
export const SYNC_GROUP_LABELS = {
  history: '閲覧履歴と既読',
  favorites: 'お気に入り(スレ・板)',
  sites: 'サイト',
  posts: '書き込み履歴と自分のレスの印',
  images: '上げた画像の履歴',
  ng: 'NG',
  settings: '設定',
  secret: '画像の削除キー・管理トークン',
} as const

/** Google ドライブの置き場の画面の言葉(PC だけ。DRIVE_MESSAGES と同じく D4 で sync-ui.json へ移す) */
export const DRIVE_LABELS = {
  store: '同期の置き場',
  store_server: '同期サーバー',
  store_drive: 'Google ドライブ',
  store_note: 'Google ドライブでは、アプリ専用の見えないフォルダに暗号化したまま置きます。Google にも中身は読めません。',
  store_ask: '置き場を変えると、この端末のデータを新しい置き場へ全部送り直します。前の置き場のデータはそのまま残ります。',
  start_drive: 'Google でログインして同期を始める',
  relogin: 'Google でログインし直す',
  login_waiting: 'ブラウザで Google にログインしてください(5 分まで待ちます)',
  login_cancel: 'ログインをやめる',
  revoke: 'Google の接続を切る(全端末)',
  revoke_ask: 'Google に OBB の許可の取り消しを送り、この端末で同期をやめます。同じ許可を使うほかの端末も止まります。Google ドライブのデータは残ります。',
} as const
