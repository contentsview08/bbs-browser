package io.github.contentsview08.obb.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.fromBase64Url
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.toBase64Url
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// K・許可証・device_id を Android Keystore の鍵で包んで置く。
// 設定の Prefs に置かない(設定の書き出しは sp.all から作るので、新しい項目が入ってしまう)

/** 包む鍵。JVM のテストでは差し替える */
interface KeyWrap {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

interface KeyBlob {
    fun read(): String?
    fun write(value: String)
    fun delete()
}

/** 開けない値は鍵がないものとして扱う(機種変更で包む鍵がないときなど。DB だけ残った状態と同じ流れになる) */
class WrappedSyncKeyStore(private val wrap: KeyWrap, private val blob: KeyBlob) : SyncKeyStore {
    override suspend fun load(): SyncKeyMaterial? {
        val raw = blob.read() ?: return null
        return try {
            val o = parseStrictJson(String(wrap.open(fromBase64Url(raw)), Charsets.UTF_8)) as Map<*, *>
            SyncKeyMaterial(fromBase64Url(o["k"] as String), o["device_id"] as String, o["ticket"] as String?)
        } catch (_: Exception) {
            null
        }
    }

    override suspend fun save(v: SyncKeyMaterial) {
        val json = canonicalJson(mapOf("k" to toBase64Url(v.k), "device_id" to v.deviceId, "ticket" to v.ticket))
        blob.write(toBase64Url(wrap.seal(json.toByteArray(Charsets.UTF_8))))
    }

    override suspend fun clear() = blob.delete()
}

internal const val SYNC_KEY_PREFS = "sync_key"
internal const val SYNC_DEV_PREFS = "sync_dev"
private const val BLOB_KEY = "blob"
private const val KEY_ALIAS = "obb_sync_wrap"
private const val GCM_IV = 12
private const val GCM_TAG_BITS = 128

private class AndroidKeystoreWrap : KeyWrap {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        return c.iv + c.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, sealed, 0, GCM_IV))
        return c.doFinal(sealed, GCM_IV, sealed.size - GCM_IV)
    }
}

fun androidSyncKeyStore(context: Context): Pair<SyncKeyStore, () -> Boolean> {
    val sp = context.getSharedPreferences(SYNC_KEY_PREFS, Context.MODE_PRIVATE)
    val blob = object : KeyBlob {
        override fun read() = sp.getString(BLOB_KEY, null)
        override fun write(value: String) { sp.edit().putString(BLOB_KEY, value).commit() }
        override fun delete() { sp.edit().remove(BLOB_KEY).commit() }
    }
    return WrappedSyncKeyStore(AndroidKeystoreWrap(), blob) to { sp.contains(BLOB_KEY) }
}

/** 開発用の同期の画面を出すか。書き出しに入らないよう、設定の Prefs に置かない */
fun syncDevOpen(context: Context) = context.getSharedPreferences(SYNC_DEV_PREFS, Context.MODE_PRIVATE).getBoolean("open", false)

fun openSyncDev(context: Context) {
    context.getSharedPreferences(SYNC_DEV_PREFS, Context.MODE_PRIVATE).edit().putBoolean("open", true).apply()
}
