// Unit tests of the Java runtime discovery (src/engine/java.ts), on fake installations.
// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { describeFailure, discoverInstallations, environmentFor, findJava, normalizeJavaHome, parseMajorVersion } from '../src/engine/java';

const skip = process.platform === 'win32' ? 'fake installations are shell scripts' : false;
const temp = mkdtempSync(join(tmpdir(), 'enigma-java-'));
after(() => rmSync(temp, { recursive: true, force: true }));

/** Creates something that looks and behaves like a JDK of the given version. */
function fakeJdk(directory: string, versionString: string): string {
    mkdirSync(join(directory, 'bin'), { recursive: true });
    writeFileSync(join(directory, 'release'), `IMPLEMENTOR="Test"\nJAVA_VERSION="${versionString}"\n`);
    writeFileSync(join(directory, 'bin', 'java'), `#!/bin/sh\necho 'openjdk version "${versionString}" 2024-01-01' >&2\n`);
    chmodSync(join(directory, 'bin', 'java'), 0o755);
    return directory;
}

const java8 = fakeJdk(join(temp, 'jdks', 'zulu-8.jdk', 'Contents', 'Home'), '1.8.0_332');
const java17 = fakeJdk(join(temp, 'jdks', 'corretto-17'), '17.0.5');
const java21 = fakeJdk(join(temp, 'jdks', 'corretto-21.jdk', 'Contents', 'Home'), '21.0.3');
const jdks = join(temp, 'jdks');
const none = join(temp, 'empty');
mkdirSync(none);

// Like macOS' /usr/bin/java: runs whatever JAVA_HOME points to, and the newest installation otherwise.
const stubDir = join(temp, 'stub');
mkdirSync(stubDir);
writeFileSync(
    join(stubDir, 'java'),
    `#!/bin/sh\nif [ -n "$JAVA_HOME" ]; then exec "$JAVA_HOME/bin/java" "$@"; fi\necho 'openjdk version "25.0.1" 2025-10-21 LTS' >&2\n`,
);
chmodSync(join(stubDir, 'java'), 0o755);

describe('java discovery', { skip }, () => {
    it('parses version strings', () => {
        assert.equal(parseMajorVersion('openjdk version "1.8.0_332"\nOpenJDK Runtime Environment'), 8);
        assert.equal(parseMajorVersion('openjdk version "17.0.5" 2022-10-18 LTS'), 17);
        assert.equal(parseMajorVersion('java version "21" 2023-09-19'), 21);
        assert.equal(parseMajorVersion('Picked up JAVA_TOOL_OPTIONS: -Xmx1g\nopenjdk version "25.0.1" 2025-10-21 LTS'), 25);
        assert.equal(parseMajorVersion('JAVA_VERSION="11.0.2"'), 11);
        assert.equal(parseMajorVersion('not java at all'), undefined);
    });

    it('skips a JAVA_HOME that is too old instead of failing', async () => {
        // the situation that used to produce "Enigma needs Java 17": JAVA_HOME is Java 8 for other tools
        const search = await findJava({ env: { JAVA_HOME: java8, PATH: join(java21, 'bin') }, searchRoots: [none] });
        assert.equal(search.runtime?.version, 21);
        assert.equal(search.runtime?.source, 'the PATH');
        assert.equal(search.rejected.length, 1);
        assert.equal(search.rejected[0].source, 'JAVA_HOME');
        assert.match(search.rejected[0].reason, /Java 8/);
    });

    it('is not fooled by a launcher on the PATH that follows JAVA_HOME', async () => {
        const env = { JAVA_HOME: java8, PATH: stubDir };
        const search = await findJava({ env, searchRoots: [none] });
        assert.equal(search.runtime?.version, 25, 'the launcher is asked without JAVA_HOME');
        // ... and must be started that way too, or it would run Java 8 after all
        assert.equal('JAVA_HOME' in environmentFor(search.runtime, env), false);
    });

    it('falls back to installed JDKs, newest first', async () => {
        const search = await findJava({ env: { JAVA_HOME: java8, PATH: none }, searchRoots: [jdks] });
        assert.equal(search.runtime?.version, 21);
        assert.equal(search.runtime?.home, java21);
        assert.equal(environmentFor(search.runtime, { JAVA_HOME: java8 }).JAVA_HOME, java21);

        const installed = discoverInstallations({ searchRoots: [jdks] });
        assert.deepEqual(
            installed.map(installation => installation.version),
            [21, 17, 8],
        );
    });

    it('uses JAVA_HOME when it is new enough', async () => {
        const search = await findJava({ env: { JAVA_HOME: java17, PATH: join(java21, 'bin') }, searchRoots: [jdks] });
        assert.equal(search.runtime?.version, 17);
        assert.equal(search.runtime?.source, 'JAVA_HOME');
        assert.deepEqual(search.rejected, []);
    });

    it('treats the setting as authoritative', async () => {
        const chosen = await findJava({
            configuredHome: java17,
            env: { JAVA_HOME: java21, PATH: join(java21, 'bin') },
            searchRoots: [jdks],
        });
        assert.equal(chosen.runtime?.version, 17);
        assert.equal(chosen.runtime?.source, 'the enigma.java.home setting');

        // an unusable choice is reported, not silently replaced by something else
        const tooOld = await findJava({
            configuredHome: java8,
            env: { JAVA_HOME: java21, PATH: join(java21, 'bin') },
            searchRoots: [jdks],
        });
        assert.equal(tooOld.runtime, undefined);
        assert.equal(tooOld.configuredInvalid, true);
        assert.match(describeFailure(tooOld), /enigma\.java\.home.*Java 8/);

        const missing = await findJava({ configuredHome: join(temp, 'does-not-exist'), env: {}, searchRoots: [jdks] });
        assert.equal(missing.configuredInvalid, true);
        assert.match(describeFailure(missing), /there is no bin\/java in it/);
    });

    it('accepts the usual ways of writing an installation path', async () => {
        assert.equal(normalizeJavaHome(join(java21, 'bin', 'java')), java21);
        assert.equal(normalizeJavaHome(join(java21, 'bin')), java21);
        assert.equal(normalizeJavaHome(`  "${java21}"  `), java21);
        // a macOS bundle rather than the Contents/Home inside it
        assert.equal(normalizeJavaHome(join(temp, 'jdks', 'corretto-21.jdk')), java21);
        assert.equal(normalizeJavaHome('~/jdk', 'linux', '/home/me'), '/home/me/jdk');

        const search = await findJava({ configuredHome: join(temp, 'jdks', 'corretto-21.jdk'), env: {}, searchRoots: [none] });
        assert.equal(search.runtime?.version, 21);
    });

    it('explains what it looked at when nothing is suitable', async () => {
        const search = await findJava({ env: { JAVA_HOME: java8, PATH: join(java8, 'bin') }, searchRoots: [none] });
        assert.equal(search.runtime, undefined);
        assert.equal(search.configuredInvalid, undefined);
        const message = describeFailure(search);
        assert.match(message, /needs Java 17 or newer/);
        assert.match(message, /from JAVA_HOME\): it is Java 8/);
        assert.match(message, /from the PATH\): it is Java 8/);
    });
});

describe('java discovery on this machine', () => {
    it('finds a runtime even when JAVA_HOME points to something useless', async t => {
        const real = await findJava({ env: { ...process.env, JAVA_HOME: undefined } });
        if (!real.runtime) {
            t.skip('no Java 17+ is installed here');
            return;
        }

        const search = await findJava({ env: { ...process.env, JAVA_HOME: java8 } });
        assert.ok(search.runtime, describeFailure(search));
        assert.ok(search.runtime.version >= 17);
        console.log(
            `    with JAVA_HOME=Java 8, found Java ${search.runtime.version} from ${search.runtime.source}: ${search.runtime.executable}`,
        );
    });
});
