import java.util.Properties
import javax.inject.Inject
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// テーブルを作る SQL は PC 版と同じファイル。packages/logstore をそのまま足すと src や node_modules まで入るので、migrations だけを assets に入れる
abstract class LogstoreMigrations @Inject constructor(private val fs: FileSystemOperations) : DefaultTask() {
    @get:InputDirectory
    abstract val source: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @TaskAction
    fun run() {
        fs.sync {
            from(source)
            into(output.dir("migrations"))
        }
    }
}

val logstoreMigrations = tasks.register<LogstoreMigrations>("logstoreMigrations") {
    source.set(layout.projectDirectory.dir("../../../packages/logstore/migrations"))
    output.set(layout.buildDirectory.dir("generated/logstoreAssets"))
}

// 同期する設定の一覧は PC と同じファイル。packages/sync の中はほかのものも多いので、このファイルだけを assets に入れる
abstract class SyncAllowlistAsset @Inject constructor(private val fs: FileSystemOperations) : DefaultTask() {
    @get:InputFile
    abstract val source: RegularFileProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @TaskAction
    fun run() {
        fs.sync {
            from(source)
            into(output)
        }
    }
}

val syncAllowlistAsset = tasks.register<SyncAllowlistAsset>("syncAllowlistAsset") {
    source.set(layout.projectDirectory.file("../../../packages/sync/settings-allowlist.json"))
    output.set(layout.buildDirectory.dir("generated/syncAllowlistAssets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(logstoreMigrations, LogstoreMigrations::output)
        variant.sources.assets?.addGeneratedSourceDirectory(syncAllowlistAsset, SyncAllowlistAsset::output)
    }
}

/** KEY=VALUE の行から値を探す。# の行と空の行は飛ばす。Windows で作ったファイル(CRLF・BOM)と、値の両端の引用符も受ける */
fun oauthFileValue(text: String, key: String): String? {
    for (raw in text.removePrefix("\uFEFF").lines()) {
        val line = raw.trim().removePrefix("export ").trim()
        if (line.isEmpty() || line.startsWith("#")) continue
        val at = line.indexOf('=')
        if (at < 0 || line.substring(0, at).trim() != key) continue
        var v = line.substring(at + 1).trim()
        for (q in listOf("\"", "'")) if (v.length >= 2 && v.startsWith(q) && v.endsWith(q)) v = v.substring(1, v.length - 1)
        return v.ifEmpty { null }
    }
    return null
}

/** 環境変数の ID・シークレットを先に見る。どちらかが欠けたらファイルを見る。両方そろわなければ null(同期を使えないビルド) */
fun googleOAuthClient(): Pair<String, String>? {
    fun env(k: String) = providers.environmentVariable(k).orNull?.trim()?.takeIf { it.isNotEmpty() }
    val id = env("OBB_GOOGLE_CLIENT_ID")
    val secret = env("OBB_GOOGLE_CLIENT_SECRET")
    if (id != null && secret != null) return id to secret
    val path = env("OBB_GOOGLE_OAUTH_FILE") ?: return null
    val f = file(path)
    if (!f.isFile) {
        logger.warn("OBB_GOOGLE_OAUTH_FILE のファイルがないため、Google の同期のないビルドになります")
        return null
    }
    val text = f.readText(Charsets.UTF_8)
    val fid = oauthFileValue(text, "OBB_GOOGLE_CLIENT_ID")
    val fsecret = oauthFileValue(text, "OBB_GOOGLE_CLIENT_SECRET")
    if (fid == null || fsecret == null) {
        logger.warn("OBB_GOOGLE_OAUTH_FILE から Google のクライアントを読めませんでした。Google の同期のないビルドになります")
        return null
    }
    return fid to fsecret
}

/** Java の文字列の書き方(BuildConfig に入れる) */
fun javaString(v: String) = "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "io.github.contentsview08.obb"
    compileSdk = 37
    defaultConfig {
        // Tauri のスマホ版(io.github.contentsview08.bbs_browser)とは別のアプリ。並べて入れられる
        applicationId = "io.github.contentsview08.obb"
        minSdk = 26
        targetSdk = 37
        versionCode = 6
        versionName = "0.1.5"
        // ONNX Runtime(AI NG)はネイティブのライブラリを持つので、スマホ(arm64)とエミュレーター(x86_64)の分だけ入れる
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        // Google ドライブの同期のクライアント(PC と同じ「デスクトップ アプリ」)。値をリポジトリに置かないので、ビルドのときに
        // 環境変数 OBB_GOOGLE_CLIENT_ID・OBB_GOOGLE_CLIENT_SECRET か、OBB_GOOGLE_OAUTH_FILE が指す KEY=VALUE のファイルから入れる。
        // どちらもなければ空になり、アプリは同期を使えない旨を出す(PC の src-tauri/src/oauth_env.rs と同じ読み方)
        val google = googleOAuthClient()
        buildConfigField("String", "GOOGLE_CLIENT_ID", javaString(google?.first ?: ""))
        buildConfigField("String", "GOOGLE_CLIENT_SECRET", javaString(google?.second ?: ""))
    }
    // 配布用の鍵は apps/android/keystore.properties(git には入れない。書き方は bbs-suite の docs/workflows.md)から読む。
    // ないときは手元の開発用の鍵で署名する(CI と手元の試しを止めないため。その APK は配らない)
    val keystoreProps = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
        Properties().apply { f.inputStream().use { load(it) } }
    }
    signingConfigs {
        if (keystoreProps != null) {
            create("release") {
                // 相対パスは apps/android からの位置
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("release") {
            // R8 で縮めて最適化する(Compose はデバッグ用のビルドだと何倍も遅い。速さは配布用のビルドで比べる)
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    // 開発用の鍵の release は app-release.apk という同じ名前で出てくるので、配る APK と取り違えないよう出力の最後に大きく知らせる
    if (keystoreProps == null) {
        tasks.matching { it.name == "assembleRelease" }.configureEach {
            doLast {
                logger.warn(
                    """
                    |
                    |================================================================
                    |  警告: keystore.properties がないので、release を開発用の鍵
                    |  (CN=Android Debug)で署名しました。この APK は配らないこと。
                    |  配ると、配布用の鍵の版を入れた人は上書き更新できなくなります。
                    |================================================================
                    """.trimMargin(),
                )
            }
        }
    }
    packaging {
        // コルーチンのデバッグ用の表・Kotlin のビルド情報・各ライブラリの版の印は、動かすのに要らない
        resources.excludes += listOf("DebugProbesKt.bin", "kotlin-tooling-metadata.json", "META-INF/*.version")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        // User-Agent の版
        buildConfig = true
    }
    // 最初から入れておく掲示板・板(PC 版と同じ packages/presets/sites.json)を assets に同梱する
    sourceSets["main"].assets.srcDir("../../../packages/presets")
    // PC 版のテストと同じケース(packages/conformance)を単体テストで読む
    sourceSets["test"].resources.srcDir("../../../packages/conformance")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    // Material Symbols のアイコン(炎・画像・動画など)。使わないものは R8 が外す
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.core:core-ktx:1.18.0")
    // 閲覧履歴の定期確認と OS の通知(アプリを閉じている間)
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // ファイルを絵にするのと、リンクのカードの絵。本文の画像の取得は ImageStore
    implementation("io.coil-kt.coil3:coil-compose:3.6.3")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.6.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // リンクをアプリの中で開く(Custom Tabs)
    implementation("androidx.browser:browser:1.8.0")
    // AI NG の判定モデル(mDeBERTa-v3 の ONNX)を動かす
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
    // 同期の暗号(ChaCha20-Poly1305・HKDF・HMAC)。JVM の単体テストでも同じ実装が動き、使わないものは R8 が外す
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")
    // 端末を足すコードの QR の読み書き。カメラは Camera2 を直に使い、CameraX を足さない
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
    // android.jar の org.json は単体テストでは動かないので、本物を使う
    testImplementation("org.json:json:20250517")
    // 本物のマイグレーションと履歴の SQL を単体テストで流す
    testImplementation("org.xerial:sqlite-jdbc:3.49.1.0")
}
