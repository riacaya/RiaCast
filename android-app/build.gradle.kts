plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    // Plugin FCM hanya dipakai bila app/google-services.json ada (tanpanya build tetap jalan).
    id("com.google.gms.google-services") version "4.4.2" apply false
}
