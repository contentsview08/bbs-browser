package io.github.contentsview08.obb.ui

import org.json.JSONArray
import org.json.JSONObject

/** サイトの画面へ渡す画像 1 枚(整えたあとの中身と SHA-256) */
class WebUploadFile(val name: String, val type: String, val bytes: ByteArray, val hash: String)

/** サイトの画面を開く頼み。files が空なら開くだけ。note は開いた画面に出す理由 */
class WebUploadJob(val site: WebUploadSite, val files: List<WebUploadFile> = emptyList(), val note: String? = null) {
    /** ページが受け取りの結果を返した。ページを移っても渡し直さない */
    var delivered = false
    /** ページが貼り付けかドロップを受け付けた */
    var accepted = false
    /** 利用者がサイトの画面でファイルを選んだ(渡した画像と違うものが上がりうる) */
    var manualPick = false
    private var hashUsed = false

    /**
     * 拾ったリンクに結びつけるハッシュ。リンクの順は上げた順とは限らず、取り違えると別の画像に同じ URL を使ってしまうので、
     * 渡した画像が 1 枚で、ページが受け付け、手で選んでいないときの最初のリンクだけに付ける
     */
    fun hashForLink(): String? {
        if (files.size != 1 || !accepted || manualPick || hashUsed) return null
        hashUsed = true
        return files[0].hash
    }
}

/** WebView へ文字列で渡すので、大きいとメモリが足りなくなる */
const val WEB_PASS_MAX_BYTES = 20L * 1024 * 1024

/** 1 回で渡す大きさ。3 の倍数にすると、切れ目ごとに base64 を解ける */
private const val WEB_PASS_PART_BYTES = 3 * 256 * 1024

/** 合計が上限を超えるときの理由 */
fun webPassProblem(totalBytes: Long, limit: Long = WEB_PASS_MAX_BYTES): String? =
    if (totalBytes <= limit) null
    else "サイトの画面へ渡せるのは合計 ${limit / (1024 * 1024)}MB までです(選んだ画像は ${"%.1f".format(totalBytes / (1024.0 * 1024.0))}MB)。サイトの画面から選んでください"

/** 中身を区切って base64 にする */
fun webPassParts(bytes: ByteArray, partBytes: Int = WEB_PASS_PART_BYTES): Sequence<String> = sequence {
    val enc = java.util.Base64.getEncoder()
    var at = 0
    while (at < bytes.size) {
        val end = minOf(at + partBytes, bytes.size)
        yield(enc.encodeToString(bytes.copyOfRange(at, end)))
        at = end
    }
}

/** 転送先のページへ画像を渡さないよう、置き場のサイトかを確かめる */
fun isWebUploadPage(pageUrl: String?, siteUrl: String): Boolean {
    val host = { u: String? -> runCatching { java.net.URI(u).host?.lowercase() }.getOrNull() }
    val page = host(pageUrl) ?: return false
    val site = host(siteUrl) ?: return false
    return page == site || page.endsWith(".$site")
}

/** 見張りから取り出した結果を読む。ページは文字列を自由に返せるので、リンクの形を確かめ直す */
fun parseWebUploadLinks(raw: String?, pattern: String): List<String> {
    val text = runCatching { JSONArray("[$raw]").getString(0) }.getOrNull() ?: return emptyList()
    val arr = runCatching { JSONArray(text) }.getOrNull() ?: return emptyList()
    val re = Regex(pattern)
    return (0 until arr.length()).mapNotNull { arr.optString(it) }.filter { re.matches(it) }.distinct()
}

/**
 * 上げ終わるまで待つ時間。渡した画像の数だけリンクが来たらすぐ閉じる。
 * まだ足りないときは次のリンクを長めに待つ(早く閉じると、あとのリンクを取りこぼす)
 */
fun webUploadCloseDelayMs(passedFiles: Int, got: Int): Long = when {
    passedFiles == 0 -> 4000
    got >= passedFiles -> 1200
    else -> 30000
}

fun webUploadWatchScript(pattern: String): String = WATCH_SCRIPT.replace("__PATTERN__", JSONObject.quote(pattern))

const val WEB_UPLOAD_TAKE_SCRIPT = "window.__bbsTake ? window.__bbsTake() : '[]'"

/** 画像の一部をページに貯める(page を移ると消える) */
fun webPassPartScript(fileIndex: Int, base64: String): String =
    PART_SCRIPT.replace("__INDEX__", fileIndex.toString()).replace("__DATA__", base64)

/** 貯めた画像をページへ渡す。結果は paste・drop・none・lost(途中でページが移って欠けた) */
fun webPassFireScript(files: List<WebUploadFile>, partBytes: Int = WEB_PASS_PART_BYTES): String {
    val meta = JSONArray(files.map { f ->
        JSONObject().put("name", f.name).put("type", f.type).put("parts", webPassPartCount(f.bytes.size, partBytes))
    })
    return FIRE_SCRIPT.replace("__FILES__", meta.toString())
}

internal fun webPassPartCount(size: Int, partBytes: Int): Int = (size + partBytes - 1) / partBytes

/** evaluateJavascript の返事(JSON の文字列)を結果にする。返事がなければ lost */
fun webPassResult(raw: String?): String = raw?.trim('"')?.takeIf { it == "paste" || it == "drop" || it == "none" } ?: "lost"

/**
 * ページに差し込む見張り。読み込んで 3 秒の間にあったリンクは数えず(見本の画像など)、そのあとに出たものを貯める。
 * 見たリンクと取り出し待ちを sessionStorage に置くので、ページを移っても読み直しても、取りこぼさず二度も拾わない
 */
private const val WATCH_SCRIPT = """
(() => {
  if (window.top !== window || window.__bbsTake) return
  const re = new RegExp(__PATTERN__, 'g')
  const SEEN = 'bbs-upload-seen'
  const QUEUE = 'bbs-upload-queue'
  const load = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null') } catch { return null } }
  const stored = load(SEEN)
  // 上げたあとに別のページへ移ると、新しいリンクが読み込みの直後から見えている
  const moved = stored !== null
  const seen = new Set(stored || [])
  let queue = load(QUEUE) || []
  const save = () => { try { sessionStorage.setItem(SEEN, JSON.stringify([...seen])); sessionStorage.setItem(QUEUE, JSON.stringify(queue)) } catch {} }
  let ready = false
  // 関連画像の並ぶページを、上げた画像と取り違えない(一度に多く増えたら見本とみなす)
  const MAX_NEW_LINKS = 10
  const scan = () => {
    const texts = []
    document.querySelectorAll('a[href]').forEach((a) => texts.push(a.href))
    document.querySelectorAll('img[src]').forEach((i) => texts.push(i.src))
    document.querySelectorAll('input, textarea').forEach((i) => texts.push(i.value))
    if (document.body) texts.push(document.body.innerText)
    const fresh = []
    for (const t of texts) for (const m of String(t || '').matchAll(re)) {
      if (seen.has(m[0])) continue
      seen.add(m[0])
      fresh.push(m[0])
    }
    if (ready && fresh.length <= MAX_NEW_LINKS) queue.push(...fresh)
    save()
  }
  window.__bbsTake = () => { const q = queue; queue = []; save(); return JSON.stringify(q) }
  // 画像を渡す直前に呼ぶ。すぐ上がると 3 秒の間に出るので、見本との境目をここにする
  window.__bbsArm = () => { scan(); ready = true }
  save()
  setTimeout(() => {
    ready = ready || moved
    scan()
    ready = true
    setInterval(scan, 700)
  }, 3000)
})()
"""

private const val PART_SCRIPT = """
(() => {
  const bin = atob('__DATA__')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const all = window.__bbsParts = window.__bbsParts || []
  ;(all[__INDEX__] = all[__INDEX__] || []).push(bytes)
})()
"""

/** imgur などは paste か drop で受け付ける。受け付けた(既定の動きを止めた)サイトへ続けて送ると、同じ画像が 2 回上がる */
private const val FIRE_SCRIPT = """
(() => {
  const files = __FILES__
  const parts = window.__bbsParts || []
  if (files.some((f, i) => (parts[i] || []).length !== f.parts)) return 'lost'
  const build = () => {
    const dt = new DataTransfer()
    files.forEach((f, i) => dt.items.add(new File(parts[i], f.name, { type: f.type })))
    return dt
  }
  if (window.__bbsArm) window.__bbsArm()
  let result = 'none'
  try { if (!document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: build() }))) result = 'paste' } catch {}
  if (result === 'none') {
    try {
      const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body
      const dt = build()
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      if (!target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))) result = 'drop'
    } catch {}
  }
  delete window.__bbsParts
  return result
})()
"""
