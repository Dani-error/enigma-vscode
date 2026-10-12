pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    versionCatalogs {
        // share Enigma's own version catalog so the backend always compiles against the same library versions
        create("libs") {
            from(files("../vendor/enigma/gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "enigma-vscode-backend"

// adds Enigma as composite build
includeBuild("../vendor/enigma")
