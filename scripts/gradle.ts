import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { JavaRuntime, MINIMUM_JAVA, describeFailure, discoverInstallations, findJava } from '../src/engine/java';

const PREFERRED_VERSIONS = [21, 17];

async function chooseJdk(): Promise<JavaRuntime & { home: string }> {
    const usable = discoverInstallations().filter(
        (jdk): jdk is JavaRuntime & { home: string } => jdk.version >= MINIMUM_JAVA && !!jdk.home,
    );
    const preferred = PREFERRED_VERSIONS.map(version => usable.find(jdk => jdk.version === version)).find(jdk => jdk);
    if (preferred) {
        return preferred;
    }

    const search = await findJava({});
    const found = search.runtime?.home ? { ...search.runtime, home: search.runtime.home } : usable.at(-1);
    if (!found) {
        console.error(describeFailure(search));
        console.error('Install a JDK (17 or 21 recommended), or set JAVA_HOME to one, and try again.');
        process.exit(1);
    }

    return found;
}

const jdk = await chooseJdk();
console.log(`Using Java ${jdk.version} for Gradle: ${jdk.home}`);

const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'gradlew.bat' : './gradlew', process.argv.slice(2), {
    cwd: path.resolve(import.meta.dirname, '..', 'backend'),
    stdio: 'inherit',
    env: { ...process.env, JAVA_HOME: jdk.home },
    shell: windows,
});
if (result.error) {
    console.error(`Failed to start Gradle: ${result.error.message}`);
}
process.exit(result.status ?? 1);
