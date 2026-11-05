// 配布物に入る OSS の一覧とライセンス全文を src/main/assets/licenses.json に書き出す(設定 → このアプリについて → 使っているソフトウェア)。
// 依存を変えたら流し直してコミットする: gradlew.bat licensesGen
// 形は PC 版の scripts/gen-licenses.mjs と同じ。プラグインを足さないのは、AGP を上げるときの足かせを増やさないため
import groovy.json.JsonGenerator
import groovy.json.JsonSlurper
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import org.gradle.api.artifacts.result.ResolvedArtifactResult
import org.gradle.maven.MavenModule
import org.gradle.maven.MavenPomArtifact
import org.w3c.dom.Element

/** POM の表記を SPDX の名前にそろえる。知らない表記はそのまま残す */
fun spdxOf(name: String): String = when {
    Regex("apache", RegexOption.IGNORE_CASE).containsMatchIn(name) -> "Apache-2.0"
    Regex("^(the )?mit( license)?$", RegexOption.IGNORE_CASE).containsMatchIn(name.trim()) -> "MIT"
    Regex("bsd.*3|3.*bsd", RegexOption.IGNORE_CASE).containsMatchIn(name) -> "BSD-3-Clause"
    Regex("bsd.*2|2.*bsd", RegexOption.IGNORE_CASE).containsMatchIn(name) -> "BSD-2-Clause"
    else -> name
}

class Pom(val name: String?, val licenses: List<String>, val url: String?, val scm: String?, val parent: Triple<String, String, String>?)

fun readPom(group: String, name: String, version: String): Pom? {
    val file = project.dependencies.createArtifactResolutionQuery().forModule(group, name, version)
        .withArtifacts(MavenModule::class.java, MavenPomArtifact::class.java).execute().resolvedComponents
        .flatMap { it.getArtifacts(MavenPomArtifact::class.java) }.filterIsInstance<ResolvedArtifactResult>().firstOrNull()?.file ?: return null
    val root = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).documentElement
    fun Element.children(tag: String) = (0 until childNodes.length).map { childNodes.item(it) }.filterIsInstance<Element>().filter { it.tagName == tag }
    fun Element.text(tag: String) = children(tag).firstOrNull()?.textContent?.trim()?.ifEmpty { null }
    return Pom(
        root.text("name"),
        root.children("licenses").flatMap { it.children("license") }.mapNotNull { it.text("name") },
        root.text("url"),
        root.children("scm").firstOrNull()?.text("url"),
        root.children("parent").firstOrNull()?.let { p -> Triple(p.text("groupId") ?: group, p.text("artifactId") ?: "", p.text("version") ?: version) },
    )
}

/** ライセンスと URL は親の POM に書いてあることが多いので、見つかるまで親へ上がる */
fun pomInfo(group: String, name: String, version: String): Pair<List<String>, String?> {
    var licenses = emptyList<String>()
    var url: String? = null
    var at: Triple<String, String, String>? = Triple(group, name, version)
    while (at != null && (licenses.isEmpty() || url == null)) {
        val pom = readPom(at.first, at.second, at.third) ?: break
        if (licenses.isEmpty()) licenses = pom.licenses
        if (url == null) url = pom.url ?: pom.scm
        at = pom.parent
    }
    return licenses to url
}

val licenseEntry = Regex("""(^|/)(licen[cs]e|notice|copying|third[-_. ]?party)[^/]*$""", RegexOption.IGNORE_CASE)

/** jar の中のライセンスの文を集める */
fun textsInJar(file: File): List<Pair<String, String>> = ZipFile(file).use { zip ->
    zip.entries().asSequence().filter { !it.isDirectory && licenseEntry.containsMatchIn(it.name) && !it.name.endsWith(".class") && !it.name.endsWith(".kotlin_module") && it.size < 256 * 1024 }
        .map { e -> e.name.substringAfterLast('/') to zip.getInputStream(e).readBytes().decodeToString().replace("\r\n", "\n").trim() }
        .filter { it.second.isNotEmpty() }.toList()
}

tasks.register("licensesGen") {
    group = "help"
    description = "assets/licenses.json を作り直す"
    doLast {
        val repo = rootDir.resolve("../..")
        // Apache-2.0 の文を持たない jar がほとんどなので、標準文(リポジトリの LICENSE の本文。自分の著作権の行は APPENDIX にあるので除く)を添える
        val apache = repo.resolve("LICENSE").readText().replace("\r\n", "\n").substringBefore("END OF TERMS AND CONDITIONS").trim()
        val classes = configurations.getByName("releaseRuntimeClasspath").incoming.artifactView {
            attributes { attribute(Attribute.of("artifactType", String::class.java), "android-classes-jar") }
            lenient(true)
        }.artifacts
        // KMP の親のモジュール(ui → ui-android)は中身を持たないので、ここには出てこない
        val modules = classes.artifacts.filter { it.id.componentIdentifier is ModuleComponentIdentifier }.groupBy { it.id.componentIdentifier as ModuleComponentIdentifier }
        val texts = mutableListOf<String>()
        val textIndex = HashMap<String, Int>()
        fun textRef(file: String, text: String): Map<String, Any> {
            val i = textIndex.getOrPut(text.replace(Regex("\\s+"), " ")) { texts.add(text); texts.size - 1 }
            return linkedMapOf("file" to file, "text" to i)
        }
        val rows = modules.map { (id, artifacts) ->
            val (licenses, url) = pomInfo(id.group, id.module, id.version)
            val license = licenses.map(::spdxOf).distinct().joinToString(" AND ")
            val inJar = artifacts.flatMap { textsInJar(it.file) }.distinctBy { it.second }
            val refs = inJar.map { (f, t) -> textRef(f, t) }.toMutableList()
            // NOTICE だけを持つ jar(okhttp など)にも本文を添える
            if (license == "Apache-2.0" && inJar.none { it.second.contains("Apache License") }) refs += textRef("Apache-2.0", apache)
            linkedMapOf<String, Any>(
                "name" to "${id.group}:${id.module}", "version" to id.version, "license" to license,
                "url" to (url ?: "https://mvnrepository.com/artifact/${id.group}/${id.module}"), "kind" to "gradle", "texts" to refs,
            )
        }
        @Suppress("UNCHECKED_CAST")
        val manual = (JsonSlurper().parse(repo.resolve("scripts/licenses-manual.json")) as List<Map<String, Any>>)
            .filter { (it["apps"] as? List<*>)?.contains("android") == true }
            .map { m -> LinkedHashMap(m - "apps" - "textFile").apply { put("texts", emptyList<Any>()) } }
        val all = (rows + manual).sortedWith(compareBy({ (it["name"] as String).lowercase() }, { it["version"] as String }))
        val json = JsonGenerator.Options().disableUnicodeEscaping().build()
        val out = project.file("src/main/assets/licenses.json")
        out.writeText("{\"packages\":[\n" + all.joinToString(",\n") { json.toJson(it) } + "\n],\"texts\":[\n" + texts.joinToString(",\n") { json.toJson(it) } + "\n]}\n")
        println("${all.size} 件、文 ${texts.size} 種類、${out.length() / 1024} KB")
        for (p in all) if (!Regex("^(Apache-2\\.0|MIT|BSD-[23]-Clause)( AND (Apache-2\\.0|MIT|BSD-[23]-Clause))*$").matches(p["license"] as String)) println("  確かめる: ${p["name"]} ${p["version"]}: ${p["license"]}")
        for (p in all) if ((p["texts"] as List<*>).isEmpty()) println("  全文なし: ${p["name"]} ${p["version"]}: ${p["license"]}")
    }
}
