package io.github.contentsview08.obb.data

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.net.ConnectException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLException

/**
 * http の URL も先に https で取りに行き、取れなければ書いてあるとおり http に戻す。
 * 掲示板に書かれる URL は http のままでも、今のサーバーは https だけのことが多い。https と書いてある URL は http に戻さない。
 * 読む通信は失敗の返事(400 以上)でも戻す。書き込みはつながらないときだけ戻す(届いたあとに送り直すと二重投稿になる)。
 * PC 版の utils/httpsFirst.ts と同じ考え方
 */
object HttpsFirst : Interceptor {
    /** https で届かなかったホスト(毎回つながるのを待たない) */
    private val httpOnlyHosts = ConcurrentHashMap.newKeySet<String>()

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val url = req.url
        if (url.scheme != "http" || url.host in httpOnlyHosts) return chain.proceed(req)
        val reading = req.method == "GET" || req.method == "HEAD"
        val https = req.newBuilder().url(url.newBuilder().scheme("https").build()).build()
        try {
            val res = chain.proceed(https)
            if (!reading || res.code < 400) return res
            res.close()
        } catch (e: IOException) {
            if (chain.call().isCanceled()) throw e
            if (!reading && !notConnected(e)) throw e
            httpOnlyHosts += url.host
        }
        return chain.proceed(req)
    }

    private fun notConnected(e: IOException) = e is ConnectException || e is UnknownHostException || e is SSLException

    /** 試験用: 覚えたホストを忘れる */
    internal fun reset() = httpOnlyHosts.clear()
}
