import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.nio.file.FileSystems
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

plugins {
	java
	jacoco
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

	// lombok
	compileOnly("org.projectlombok:lombok:1.18.48")
	annotationProcessor("org.projectlombok:lombok:1.18.48")
	testCompileOnly("org.projectlombok:lombok:1.18.48")
	testAnnotationProcessor("org.projectlombok:lombok:1.18.48")
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

// how much of the backend the tests run, in build/reports/jacoco
tasks.jacocoTestReport {
	reports {
		xml.required = true
		html.required = true
	}
}

// the tests fail when they run less of the backend than they did: a little below what they reach now
tasks.jacocoTestCoverageVerification {
	// some of the tests, chosen with --tests, run only some of the backend
	onlyIf { gradle.startParameter.taskRequests.none { "--tests" in it.args } }
	violationRules {
		rule {
			limit {
				counter = "LINE"
				minimum = "0.87".toBigDecimal()
			}
			limit {
				counter = "BRANCH"
				minimum = "0.75".toBigDecimal()
			}
			limit {
				counter = "METHOD"
				minimum = "0.89".toBigDecimal()
			}
		}
	}
}

tasks.test {
	finalizedBy(tasks.jacocoTestReport, tasks.jacocoTestCoverageVerification)
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

	// Enigma's translations lack many of the texts the extension shows. ../l10n/enigma has them, by Enigma's language
	// codes, and they are added to Enigma's own files in the jar; where Enigma has a translation, it is kept.
	val completions = file("../l10n/enigma")
	inputs.dir(completions)
	doLast {
		val jar = archiveFile.get().asFile.toPath()
		FileSystems.newFileSystem(jar).use { zip ->
			completions.listFiles { file -> file.extension == "json" }?.sortedBy { it.name }?.forEach { completion ->
				val target = zip.getPath("lang", completion.name)
				@Suppress("UNCHECKED_CAST")
				val own = if (Files.exists(target)) JsonSlurper().parse(Files.newInputStream(target)) as Map<String, Any> else emptyMap()
				@Suppress("UNCHECKED_CAST")
				val added = JsonSlurper().parse(completion) as Map<String, Any>
				val merged = LinkedHashMap(own)
				added.forEach { (key, text) -> merged.putIfAbsent(key, text) }
				Files.writeString(target, JsonOutput.prettyPrint(JsonOutput.toJson(merged)))
			}
		}
	}
}

val installJar = tasks.register("installJar") {
	dependsOn(shadowJar)
	val built = shadowJar.flatMap { it.archiveFile }
	// where the extension expects it, inside the extension as it ships (see scripts/layout.ts)
	val target = file("../build/extension/server/enigma-backend.jar")
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

