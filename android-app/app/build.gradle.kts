import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Tahap 2 (FCM) aktif otomatis begitu file google-services.json dari Firebase
// proyek Anda ditaruh di android-app/app/. Tanpa file itu build tetap sukses
// dan fitur hanya kehilangan push dari server (tahap 1 tetap jalan).
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.riacast.app"
    compileSdk = 35

    // Tanda tangan release: kunci tetap di secrets/ (lokal, tidak di-repo).
    val signingProps = Properties().apply {
        val f = rootDir.parentFile?.resolve("secrets/riacast-signing.properties")
        if (f?.exists() == true) f.inputStream().use { load(it) }
    }

    defaultConfig {
        applicationId = "com.riacast.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "1.6"
    }

    signingConfigs {
        create("release") {
            val store = signingProps.getProperty("storeFile")
            if (store != null) {
                storeFile = file(store)
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}


dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
    // Tahap 2: layanan pesan Firebase. Tanpa google-services.json kelasnya
    // tetap ada tapi tidak pernah diinisialisasi (dijaga di kode runtime).
    implementation("com.google.firebase:firebase-messaging:24.1.0")
}
