package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.SyncKeys
import io.github.contentsview08.obb.sync.toHex

// 同期の置き場の差し替え口(docs/sync-drive.md 7.2)。PC 版の packages/sync/src/engine/remote.ts の写し。
// エンジンは周の順・リベース・作り直し・待ちだけを持ち、置き場とのやりとりはここを通す

/**
 * version はエンジンが「since との大小」と「0 か 0 でないか」にしか使わない。
 * サーバーは領域の通番を返し、Drive は端末の中だけの通番を返す(どちらでも意味が保たれる)
 */
interface SyncRemote {
    /** 置き場からの間隔の指示。指示を返さない置き場はいつも null */
    val pace: SyncPace?

    /** 領域を作るのに許可証が要るか。要らない置き場では、許可証がなくても止まらずに作る */
    val needsTicket: Boolean

    /** 変化の確認。変化がなければ version が null(304 と同じ) */
    suspend fun head(etag: String?): HeadResult

    /** since = 0 は全件 */
    suspend fun changes(since: Long): ChangesPage

    suspend fun pushRecords(requestId: String, records: List<Map<String, Any?>>): PushResponse

    /** 作った(または見つけた)領域の epoch */
    suspend fun createSpace(ticket: String?): String

    /** 周が通った最後に呼ぶ片づけ(Drive のまとめ直しなど)。失敗は周の失敗にする */
    suspend fun maintain() {}
}

class RemoteContext(val db: SyncSql, val keys: SyncKeys, val spaceId: String, val deviceId: String, val now: () -> Long)

/** 周ごと(と確認ごと)に作る。周をまたいで持つ値は同期の表に置く */
typealias SyncRemoteFactory = (RemoteContext) -> SyncRemote

fun serverRemote(serverUrl: String, transport: SyncTransport, allowLocalhost: Boolean = false): SyncRemoteFactory =
    { c -> SyncApi(serverUrl, c.keys.authToken.toHex(), transport, allowLocalhost) }
