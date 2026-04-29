plugins {
    alias(libs.plugins.android.application)
}

// Key WebSocket — trùng với server .env SECRET_KEY. Override: gradle.properties (wsSecretKey=...) hoặc -PwsSecretKey=...
val wsSecretKeyForBuild: String = (project.findProperty("wsSecretKey") as String?).orEmpty()
    .ifBlank { "MonitorTournamentSecretKey2026!" }

android {
    namespace = "com.ops.tournamentmonitor"
    compileSdk {
        version = release(36)
    }

    defaultConfig {
        applicationId = "com.ops.tournamentmonitor"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "WS_SECRET_KEY", "\"${wsSecretKeyForBuild.replace("\"", "\\\"")}\"")
    }
    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Coroutines để chạy ngầm
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}