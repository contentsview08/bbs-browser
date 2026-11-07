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
}

export function syncMessage(code: string): string {
  return MESSAGES[code] ?? `同期できませんでした(${code})`
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
  section: '同期(開発中)',
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

/** このアプリについての版を押す回数 */
export const SYNC_REVEAL_TAPS = 7
