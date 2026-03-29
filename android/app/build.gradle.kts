import java.io.File
import java.util.Properties
import org.gradle.api.GradleException

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

configurations.configureEach {
    resolutionStrategy {
        force("androidx.core:core:1.15.0")
        force("androidx.core:core-ktx:1.15.0")
    }
}

val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localPropertiesFile.inputStream().use { localProperties.load(it) }
}
fun loadEnvVars(envFile: File): Map<String, String> {
    if (!envFile.exists()) return emptyMap()
    return envFile.readLines()
        .asSequence()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .mapNotNull { line ->
            val separator = line.indexOf("=")
            if (separator <= 0) return@mapNotNull null
            val key = line.substring(0, separator).trim()
            var value = line.substring(separator + 1).trim()
            if ((value.startsWith("\"") && value.endsWith("\"")) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.substring(1, value.length - 1)
            }
            key to value
        }
        .toMap()
}
val rootEnv = loadEnvVars(rootProject.file("../.env"))
val googleMapsApiKey =
    rootEnv["GOOGLE_MAPS_API_KEY"]
        ?: localProperties.getProperty("google.maps.api.key")
        ?: System.getenv("GOOGLE_MAPS_API_KEY")
        ?: ""
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}
val hasReleaseSigningConfig = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    .all { !keystoreProperties.getProperty(it).isNullOrBlank() }
val releaseTaskRequested = gradle.startParameter.taskNames.any { taskName ->
    taskName.contains("Release", ignoreCase = true)
}

if (releaseTaskRequested && !hasReleaseSigningConfig) {
    throw GradleException(
        "Missing Android release signing config. Create android/key.properties from android/key.properties.example."
    )
}

android {
    namespace = "com.traylapps.trailmap"
    compileSdk = 36
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "com.traylapps.trailmap"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["googleMapsApiKey"] = googleMapsApiKey
    }

    signingConfigs {
        create("release") {
            if (hasReleaseSigningConfig) {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

flutter {
    source = "../.."
}
