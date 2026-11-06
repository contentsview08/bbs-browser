package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.Http
import io.github.contentsview08.obb.data.HttpResponse
import kotlinx.coroutines.runBlocking

/** 通信の代わりに届いた 1 件 */
internal class Sent(val method: String, val url: String, val headers: Map<String, String>, val body: ByteArray?) {
    val text: String get() = body?.toString(Charsets.UTF_8) ?: ""
}

/** 通信せずに答える。頼まれたものを sent に残す */
internal class FakeServer(private val answer: (Sent) -> HttpResponse) {
    val sent = ArrayList<Sent>()

    fun <T> run(block: suspend () -> T): T {
        Http.fake = { method, url, headers, body -> Sent(method, url, headers, body).let { sent += it; answer(it) } }
        try {
            return runBlocking { block() }
        } finally {
            Http.fake = null
        }
    }
}

internal fun res(status: Int, body: ByteArray = ByteArray(0), headers: Map<String, String> = emptyMap()) = HttpResponse(status, headers, body)
internal fun res(status: Int, body: String, headers: Map<String, String> = emptyMap()) = res(status, body.toByteArray(), headers)
