// bbs-browser の Android ネイティブ版(Kotlin + Jetpack Compose)。Tauri のスマホ版(apps/desktop の Android)と並べて比べるための作り直し。
// 版は Tauri の Android 版(apps/desktop/src-tauri/gen/android)とそろえている(この PC でビルドが通っている組み合わせ)
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "bbs-native"
include(":app")
