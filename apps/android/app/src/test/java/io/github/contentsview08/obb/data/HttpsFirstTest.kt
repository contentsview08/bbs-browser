package io.github.contentsview08.obb.data

import okhttp3.Call
import okhttp3.Connection
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.util.concurrent.TimeUnit

class HttpsFirstTest {
    private class FakeChain(private val req: Request, val handle: (Request) -> Int) : Interceptor.Chain {
        val sent = ArrayList<String>()
        override fun request() = req
        override fun proceed(request: Request): Response {
            sent += request.url.toString()
            return Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(handle(request)).message("")
                .body("".toResponseBody(null)).build()
        }
        override fun connection(): Connection? = null
        override fun call(): Call = NotCanceled
        override fun connectTimeoutMillis() = 0
        override fun withConnectTimeout(timeout: Int, unit: TimeUnit) = this
        override fun readTimeoutMillis() = 0
        override fun withReadTimeout(timeout: Int, unit: TimeUnit) = this
        override fun writeTimeoutMillis() = 0
        override fun withWriteTimeout(timeout: Int, unit: TimeUnit) = this
    }

    private fun get(url: String) = Request.Builder().url(url).build()

    @Before fun reset() = HttpsFirst.reset()

    @Test fun http_first_tries_https() {
        val c = FakeChain(get("http://a.test/x.png")) { 200 }
        assertEquals(200, HttpsFirst.intercept(c).code)
        assertEquals(listOf("https://a.test/x.png"), c.sent)
    }

    @Test fun error_status_falls_back_to_http() {
        val c = FakeChain(get("http://b.test/")) { if (it.isHttps) 404 else 200 }
        assertEquals(200, HttpsFirst.intercept(c).code)
        assertEquals(listOf("https://b.test/", "http://b.test/"), c.sent)
    }

    @Test fun https_url_is_left_alone() {
        val c = FakeChain(get("https://c.test/")) { 500 }
        assertEquals(500, HttpsFirst.intercept(c).code)
        assertEquals(listOf("https://c.test/"), c.sent)
    }

    @Test fun post_error_status_is_not_sent_again() {
        val post = Request.Builder().url("http://d.test/").post("a".toRequestBody("text/plain".toMediaType())).build()
        val c = FakeChain(post) { 500 }
        assertEquals(500, HttpsFirst.intercept(c).code)
        assertEquals(listOf("https://d.test/"), c.sent)
    }

    @Test fun connect_error_falls_back_and_remembers() {
        val c = FakeChain(get("http://e.test/")) { if (it.isHttps) throw ConnectException("つながらない") else 200 }
        assertEquals(200, HttpsFirst.intercept(c).code)
        HttpsFirst.intercept(c)
        assertEquals(listOf("https://e.test/", "http://e.test/", "http://e.test/"), c.sent)
    }

    private object NotCanceled : Call {
        override fun isCanceled() = false
        override fun cancel() = Unit
        override fun clone() = this
        override fun enqueue(responseCallback: okhttp3.Callback) = Unit
        override fun execute(): Response = throw IOException()
        override fun isExecuted() = false
        override fun request() = throw UnsupportedOperationException()
        override fun timeout() = throw UnsupportedOperationException()
    }
}
