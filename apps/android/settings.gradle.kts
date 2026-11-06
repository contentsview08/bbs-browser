// OBB のスマホ版(Kotlin + Compose)
// AGP は Tauri の Android 版(apps/desktop/src-tauri/gen/android)とそろえる。Kotlin は画像の Coil 3.6 に合わせて 2.4
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
