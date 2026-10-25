// bbs-browser の Android ネイティブ版(Kotlin + Jetpack Compose)。Tauri のスマホ版(apps/desktop の Android)と並べて比べるための作り直し。
// AGP は Tauri の Android 版(apps/desktop/src-tauri/gen/android)とそろえている。Kotlin は画像の Coil 3.6 に合わせて 2.4
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
