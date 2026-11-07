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

androidComponents {
    onVariants { variant -> variant.sources.assets?.addGeneratedSourceDirectory(logstoreMigrations, LogstoreMigrations::output) }
}

android {
    namespace = "io.github.contentsview08.obb"
    compileSdk = 37
    defaultConfig {
        // Tauri のスマホ版(io.github.contentsview08.bbs_browser)とは別のアプリ。並べて入れられる
        applicationId = "io.github.contentsview08.obb"
        minSdk = 26
        targetSdk = 37
        versionCode = 4
        versionName = "0.1.3"
        // ONNX Runtime(AI NG)はネイティブのライブラリを持つので、スマホ(arm64)とエミュレーター(x86_64)の分だけ入れる
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        // 同期サーバーの既定値。元は packages/sync/server-url.json。ビルドのときに環境変数 OBB_SYNC_SERVER_URL で差し替えられる
        val syncDefault = (groovy.json.JsonSlurper().parse(file("../../../packages/sync/server-url.json")) as Map<*, *>)["default"] as String
        val syncServer = providers.environmentVariable("OBB_SYNC_SERVER_URL").orNull ?: syncDefault
        buildConfigField("String", "SYNC_SERVER_URL", "\"$syncServer\"")
    }
    buildTypes {
        // http://localhost の同期サーバーは開発の版だけ。-PobbSyncAllowLocalhost で R8 を通した版でも試せる
        getByName("debug") { buildConfigField("boolean", "SYNC_ALLOW_LOCALHOST", "true") }
        getByName("release") {
            buildConfigField("boolean", "SYNC_ALLOW_LOCALHOST", if (providers.gradleProperty("obbSyncAllowLocalhost").isPresent) "true" else "false")
            // R8 で縮めて最適化する(Compose はデバッグ用のビルドだと何倍も遅い。速さは配布用のビルドで比べる)
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // 手元の開発用の鍵で署名する(配るときは自分の鍵に)
            signingConfig = signingConfigs.getByName("debug")
        }
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
