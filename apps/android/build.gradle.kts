plugins {
    id("com.android.application") version "9.3.1" apply false
    id("org.jetbrains.kotlin.android") version "2.4.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
}

// 使っているソフトウェアの一覧を作るタスク(:app:licensesGen)。app/build.gradle.kts に apply を書くと、配布用ビルドの lint がそのスクリプトの解析で落ちる
project(":app") { apply(from = rootDir.resolve("gradle/licenses.gradle.kts")) }
