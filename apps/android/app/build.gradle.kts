import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "io.github.contentsview08.obb"
    compileSdk = 37
    defaultConfig {
        // Tauri のスマホ版(io.github.contentsview08.bbs_browser)と別のアプリとして入れ、並べて比べられるようにする
        // 2026-11-05 に OBB へ(インストールの場所も変わる。前の スマホ版 とは別のアプリになるので、設定は入れ直し)
        applicationId = "io.github.contentsview08.obb"
        minSdk = 26
        targetSdk = 37
        versionCode = 3
        versionName = "0.1.2"
        // ONNX Runtime(AI NG)はネイティブのライブラリを持つので、スマホ(arm64)とエミュレーター(x86_64)の分だけ入れる
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    buildTypes {
        getByName("release") {
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
    }
    // 最初から入れておく掲示板・板(PC 版と同じ packages/presets/sites.json)を assets に同梱する
    sourceSets["main"].assets.srcDir("../../../packages/presets")
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
    // 今の専ブラと同じアイコン(Material Symbols の炎・画像・動画など)。使わないものは R8 が外す
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.core:core-ktx:1.18.0")
    // 閲覧履歴の定期確認と OS の通知(アプリを閉じている間)
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // 画像(サムネイル・ビューアー)
    implementation("io.coil-kt.coil3:coil-compose:3.6.3")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.6.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // リンクをアプリの中で開く(Custom Tabs。今のスマホ版の「リンクをアプリの中で開く」)
    implementation("androidx.browser:browser:1.8.0")
    // AI NG の判定モデル(mDeBERTa-v3 の ONNX)を動かす
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
    testImplementation("junit:junit:4.13.2")
}
