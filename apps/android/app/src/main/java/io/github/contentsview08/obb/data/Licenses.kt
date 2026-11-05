package io.github.contentsview08.obb.data

import org.json.JSONObject

// 使っている OSS の一覧(assets/licenses.json。app/licenses.gradle.kts が作る)。形と探し方は PC 版の utils/licenses.ts と同じ

class LicensePackage(
    val name: String,
    val version: String,
    val license: String,
    val url: String,
    val kind: String,
    val note: String?,
    /** ファイル名と、LicensesFile.texts の番号 */
    val texts: List<Pair<String, Int>>,
) {
    val id get() = "$name@$version"
    val kindLabel get() = when (kind) {
        "gradle" -> "Android"
        "font" -> "フォント"
        else -> "ライブラリ"
    }
}

class LicensesFile(val packages: List<LicensePackage>, val texts: List<String>)

fun parseLicenses(json: String): LicensesFile {
    val root = JSONObject(json)
    val pkgs = root.getJSONArray("packages")
    val texts = root.getJSONArray("texts")
    return LicensesFile(
        List(pkgs.length()) { i ->
            val p = pkgs.getJSONObject(i)
            val refs = p.getJSONArray("texts")
            LicensePackage(
                p.getString("name"), p.getString("version"), p.getString("license"), p.getString("url"), p.getString("kind"),
                p.optString("note").ifEmpty { null },
                List(refs.length()) { j -> refs.getJSONObject(j).let { it.getString("file") to it.getInt("text") } },
            )
        },
        List(texts.length()) { texts.getString(it) },
    )
}

/** 名前・版・ライセンスで絞る。空白で区切ると、すべてを含むものだけ残す */
fun filterLicenses(packages: List<LicensePackage>, query: String): List<LicensePackage> {
    val words = query.trim().split(Regex("[\\s\u3000]+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return packages
    return packages.filter { p -> words.all { w -> "${p.name} ${p.version} ${p.license}".contains(w, ignoreCase = true) } }
}

private val SPDX_ID = Regex("^(0BSD|Apache|Artistic|BSD|BSL|CC0|CDLA|GPL|ISC|LGPL|MIT|MPL|OFL|Unicode|Unlicense|Zlib|blessing)")

/** ライセンスの表記から SPDX の標準文のページを作る。全文のファイルがないパッケージの案内に使う */
fun spdxLinks(license: String): List<Pair<String, String>> =
    license.split(Regex("[\\s()/]+")).filter { SPDX_ID.containsMatchIn(it) }.distinct().map { it to "https://spdx.org/licenses/$it.html" }
