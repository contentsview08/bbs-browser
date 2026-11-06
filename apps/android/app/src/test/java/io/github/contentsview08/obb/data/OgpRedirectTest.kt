package io.github.contentsview08.obb.data

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OgpRedirectTest {
    /** 通信せずに答える。頼まれた URL を sent に残す */
    private class Fake(val answer: (String) -> Pair<Int, String?>) {
        val sent = ArrayList<String>()
        val client: OkHttpClient = OkHttpClient.Builder().followRedirects(false).addInterceptor { chain ->
            val url = chain.request().url.toString()
            sent += url
            val (code, location) = answer(url)
            val b = Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("").body("".toResponseBody(null))
            if (location != null) b.header("Location", location)
            b.build()
        }.build()
    }

    private fun open(f: Fake, url: String) = openCheckingRedirects(f.client, url) { Request.Builder().url(it).build() }

    @Test fun redirect_to_home_network_is_not_requested() {
        val f = Fake { 302 to "http://192.168.0.1/" }
        assertNull(open(f, "https://example.com/a"))
        assertEquals(listOf("https://example.com/a"), f.sent)
    }

    @Test fun redirect_to_trailing_dot_localhost_is_not_requested() {
        val f = Fake { 302 to "http://localhost./" }
        assertNull(open(f, "https://example.com/a"))
        assertEquals(listOf("https://example.com/a"), f.sent)
    }

    @Test fun relative_redirect_is_followed() {
        val f = Fake { if (it.endsWith("/b")) 200 to null else 302 to "/b" }
        val res = open(f, "https://example.com/a")
        assertEquals(200, res?.code)
        assertEquals(listOf("https://example.com/a", "https://example.com/b"), f.sent)
    }

    @Test fun redirect_without_location_gives_nothing() {
        assertNull(open(Fake { 302 to null }, "https://example.com/a"))
    }

    @Test fun too_many_redirects_give_nothing() {
        var n = 0
        val f = Fake { 302 to "/${++n}" }
        assertNull(open(f, "https://example.com/0"))
        assertEquals(6, f.sent.size)
    }

    @Test fun trailing_dot_hosts() {
        assertFalse(isAutoLoadable("http://localhost./"))
        assertFalse(isAutoLoadable("http://router./"))
        assertFalse(isAutoLoadable("http://nas.local./"))
        assertTrue(isAutoLoadable("https://example.com./a"))
    }
}
