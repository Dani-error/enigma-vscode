import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Api, activate, execute, jar, reported, waitFor, workspace } from './harness';

describe('Enigma in VS Code: opening a jar, and the Java it runs on', () => {
    let api: Api;

    before(async () => {
        api = await activate();
    });

    it('opens a jar and lists its classes', async () => {
        await execute('enigma.openJar', jar);
        await waitFor('the jar to be open', () => api.project.isOpen && api.index.size > 0);

        assert.equal(fs.realpathSync(api.project.state!.jarPath), fs.realpathSync(jar));
        assert.ok(api.index.get('a')?.obfuscated);
        assert.ok(api.index.get('a')?.kind, 'classes say what kind of type they are');
        // inner classes are part of their outer class
        assert.equal(api.index.get('b$a'), undefined);
    });

    it('runs although JAVA_HOME points to a Java that is too old', function () {
        // The launcher sets JAVA_HOME to a stand-in for Java 8. The editor may replace it with the JAVA_HOME of the
        // user's shell; either way, this only tests something if what it points to really is too old.
        const javaHome = process.env.JAVA_HOME;
        let major: number | undefined;
        try {
            const match = /JAVA_VERSION="(\d+)(?:\.(\d+))?/.exec(fs.readFileSync(path.join(javaHome ?? '', 'release'), 'utf8'));
            major = match ? (match[1] === '1' ? Number(match[2]) : Number(match[1])) : undefined;
        } catch {
            // no JAVA_HOME, or not a JDK
        }

        if (!javaHome || major === undefined || major >= 17) {
            this.skip();
        }

        assert.ok(api.backend.runtime, 'a runtime was found');
        assert.ok(api.backend.runtime.version >= 17, `the engine runs on Java ${api.backend.runtime.version}`);
        assert.notEqual(api.backend.runtime.source, 'JAVA_HOME');
        assert.ok(!api.backend.runtime.executable.startsWith(javaHome), `JAVA_HOME (Java ${major}) is not what runs the engine`);
        assert.ok(Number(api.backend.info?.javaVersion.split('.')[0]) >= 17, `the engine reports Java ${api.backend.info?.javaVersion}`);
    });

    it('applies the enigma.java.home setting as soon as it is changed', async function () {
        const config = () => vscode.workspace.getConfiguration('enigma');
        const errorsBefore = reported.length;

        // an installation that cannot be used is reported, naming the setting, and nothing else is run in its place
        await config().update(
            'java.home',
            process.env.ENIGMA_E2E_OLD_JAVA ?? path.join(workspace, 'no-java-here'),
            vscode.ConfigurationTarget.Global,
        );
        const message = await waitFor('the unusable setting to be reported', () =>
            reported.slice(errorsBefore).find(text => text.includes('enigma.java.home')),
        );
        assert.match(message, /cannot be used/);
        assert.equal(api.backend.running, false);
        assert.equal(api.project.isOpen, false);

        // fixing the setting starts the engine again and brings the project back, without any further action
        const installed = api.javaInstallations().find(installation => installation.home);
        if (installed) {
            await config().update('java.home', installed.home, vscode.ConfigurationTarget.Global);
            await waitFor(
                'the engine to start with the chosen Java',
                () => api.backend.running && api.project.isOpen && api.index.size > 0,
            );
            assert.equal(api.backend.runtime?.source, 'the enigma.java.home setting');
            assert.equal(api.backend.runtime?.home, installed.home);
        }

        // clearing it goes back to automatic detection
        await config().update('java.home', undefined, vscode.ConfigurationTarget.Global);
        await waitFor(
            'the engine to run with a detected Java',
            () =>
                api.backend.running &&
                api.project.isOpen &&
                api.index.size > 0 &&
                api.backend.runtime?.source !== 'the enigma.java.home setting',
        );
        assert.equal(fs.realpathSync(api.project.state!.jarPath), fs.realpathSync(jar));
    });
});
