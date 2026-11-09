// 同期の置き場の差し替え口(docs/sync-drive.md 7.2)。エンジンは周の順・リベース・作り直し・待ちだけを持ち、置き場とのやりとりはここを通す
import { toHex } from '../bytes'
import type { SyncKeys } from '../keys'
import type { SyncPace } from './scheduler'
import type { SyncSqlDb } from './tables'
import { SyncApi, type ChangesPage, type HeadResult, type PushResponse, type SyncTransport } from './transport'

/**
 * version はエンジンが「since との大小」と「0 か 0 でないか」にしか使わない。
 * サーバーは領域の通番を返し、Drive は端末の中だけの通番を返す(どちらでも意味が保たれる)
 */
export interface SyncRemote {
  /** 置き場からの間隔の指示。指示を返さない置き場はいつも null */
  readonly pace: SyncPace | null
  /** 領域を作るのに許可証が要るか。要らない置き場では、許可証がなくても止まらずに作る */
  readonly needsTicket: boolean
  /**
   * 送る前に読まなくてよいか。Drive は書き込みがぶつからない(409 がない)ので、送るだけの周で変更の一覧とダウンロードを省く。
   * サーバーは 409 を減らすため、送る前に読む
   */
  readonly pushWithoutPull?: boolean
  /** 容量を超えたとき、外さずに待つ長さ(ms)。なければ古い閲覧履歴から外す(サーバーの 10MB の枠) */
  readonly quotaWaitMs?: number
  /** 1 回の送信に入れる上限。なければ PUSH_BATCH_RECORDS・PUSH_BATCH_BYTES */
  readonly pushBatch?: { records: number; bytes: number }
  /** 変化の確認。変化がなければ version: null(304 と同じ) */
  head(etag: string | null): Promise<HeadResult>
  /** since = 0 は全件 */
  changes(since: number): Promise<ChangesPage>
  pushRecords(requestId: string, records: Record<string, unknown>[]): Promise<PushResponse>
  createSpace(ticket: string | null): Promise<{ epoch: string }>
  /** 周が通った最後に呼ぶ片づけ(Drive のまとめ直しなど)。失敗は周の失敗にする */
  maintain?(): Promise<void>
}

export interface RemoteContext {
  db: SyncSqlDb
  keys: SyncKeys
  spaceId: string
  deviceId: string
  now: () => number
}

/** 周ごと(と確認ごと)に作る。周をまたいで持つ値は同期の表に置く */
export type SyncRemoteFactory = (c: RemoteContext) => SyncRemote

export function serverRemote(serverUrl: string, transport: SyncTransport, allowLocalhost = false): SyncRemoteFactory {
  return (c) => new SyncApi(serverUrl, toHex(c.keys.auth_token), transport, allowLocalhost)
}
