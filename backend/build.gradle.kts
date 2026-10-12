import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

plugins {
	java
	alias(libs.plugins.shadow)
}

group = "dev.danibcastro"
version = "1.0.0"

repositories {
	mavenCentral()
	maven("https://maven.quiltmc.org/repository/release/")
	maven("https://maven.fabricmc.net/")
}

dependencies {
	// from vendor/enigma
	implementation("org.quiltmc:enigma:2.7.2")
	implementation("org.quiltmc:enigma-server:2.7.2")
	runtimeOnly("org.quiltmc:enigma-cli:2.7.2")

	implementation(libs.guava)
	implementation(libs.gson)
	implementation(libs.jspecify)
	implementation(libs.bundles.asm)
	implementation(libs.bundles.tinylog)

	testImplementation(libs.junit)
	testRuntimeOnly(libs.junit.engine)
	testRuntimeOnly(libs.junit.launcher)
	testImplementation(libs.hamcrest)
}

java {
	sourceCompatibility = JavaVersion.VERSION_17
	targetCompatibility = JavaVersion.VERSION_17
}

tasks.withType<JavaCompile>().configureEach {
	options.encoding = "UTF-8"
	options.release = 17
}

val enigmaBuild = gradle.includedBuild("enigma")

tasks.test {
	useJUnitPlatform()
	// the obfuscated fixture jars are produced by Enigma's own build
	dependsOn(enigmaBuild.task(":enigma:obfuscateTestInputs"))
	systemProperty("enigma.test.obf", file("../vendor/enigma/enigma/build/test-obf").absolutePath)
	systemProperty("enigma.test.resources", file("../vendor/enigma").absolutePath)

	// use the backend's logging configuration, which the error capturing relies on
	systemProperty("tinylog.configuration", "enigma-vscode-tinylog.properties")

	testLogging {
		events("failed")
		exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
	}
}

tasks.jar {
	manifest.attributes("Main-Class" to "dev.danibcastro.enigmavscode.backend.Main")
}

val shadowJar = tasks.named<ShadowJar>("shadowJar") {
	archiveFileName = "enigma-backend.jar"

	duplicatesStrategy = DuplicatesStrategy.INCLUDE
	mergeServiceFiles()

	append("META-INF/LICENSE")
	append("META-INF/LICENSE.txt")
	append("META-INF/NOTICE")
	append("META-INF/NOTICE.txt")
	manifest.attributes("Main-Class" to "dev.danibcastro.enigmavscode.backend.Main")
}

val installJar = tasks.register("installJar") {
	dependsOn(shadowJar)
	val built = shadowJar.flatMap { it.archiveFile }
	val target = file("../server/enigma-backend.jar")
	inputs.file(built)
	outputs.file(target)
	doLast {
		target.parentFile.mkdirs()
		val staged = target.resolveSibling("${target.name}.new").toPath()
		Files.copy(built.get().asFile.toPath(), staged, StandardCopyOption.REPLACE_EXISTING)
		try {
			Files.move(staged, target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
		} catch (_: AtomicMoveNotSupportedException) {
			Files.move(staged, target.toPath(), StandardCopyOption.REPLACE_EXISTING)
		}
	}
}

tasks.build {
	dependsOn(installJar)
}

