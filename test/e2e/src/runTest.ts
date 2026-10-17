import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// Runs the extension inside a real VS Code and drives it through the editor's own commands.
// An installed VS Code is used when found; set VSCODE_EXECUTABLE to choose one, VSCODE_DOWNLOAD=1 to download the
// latest build, or VSCODE_VERSION to download that one: the oldest the extension supports is in package.json.
/**
 * Takes a picture of the editor's window through the debugging protocol of its browser engine. Nothing else shows what
 * the interface really looks like: where the panes are, how the code is highlighted.
 */
async function capture(port: number, file: string): Promise<void> {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl: string;
    }[];
    const page = targets.find(target => target.type === 'page' && target.url.includes('workbench'));
    if (!page) {
        throw new Error(`No window found among ${targets.map(target => target.url).join(', ')}`);
    }

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    try {
        await new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            socket.onerror = () => reject(new Error('could not connect to the window'));
        });
        const data = await new Promise<string>((resolve, reject) => {
            socket.onmessage = event => {
                const message = JSON.parse(String(event.data)) as { id: number; result?: { data: string }; error?: { message: string } };
                if (message.id !== 1) {
                    return;
                }

                if (message.error || !message.result) {
                    reject(new Error(message.error?.message ?? 'no picture'));
                } else {
                    resolve(message.result.data);
                }
            };
            socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
        });
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
    } finally {
        socket.close();
    }
}

/** Serves the requests of the tests for screenshots: a file "name.request" is answered with "name.png". */
function serveScreenshots(directory: string, port: number): NodeJS.Timeout {
    let busy = false;
    const serve = async () => {
        if (busy) {
            return;
        }

        busy = true;
        try {
            for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.request'))) {
                const name = file.substring(0, file.length - '.request'.length);
                try {
                    await capture(port, path.join(directory, `${name}.png`));
                } catch (error) {
                    fs.writeFileSync(path.join(directory, `${name}.error`), String(error));
                }

                fs.rmSync(path.join(directory, file), { force: true });
            }
        } finally {
            busy = false;
        }
    };
    return setInterval(() => void serve(), 100);
}

async function main(): Promise<void> {
    let logged: string[] | undefined;
    // this runs from build/extension/test/e2e (see tests() in scripts/build.ts)
    const root = path.resolve(__dirname, '../../../..');
    // the extension as it ships, which is what is tested (see scripts/layout.ts; this file is not bundled, so it cannot import it)
    const extension = path.join(root, 'build', 'extension');
    const fixtures = path.join(root, 'vendor', 'enigma', 'enigma', 'build', 'test-obf');
    if (!fs.existsSync(path.join(fixtures, 'inheritance_tree.jar'))) {
        throw new Error('Enigma test fixtures are missing. Run "npm run test:backend" once to build them.');
    }

    if (!fs.existsSync(path.join(extension, 'server', 'enigma-backend.jar'))) {
        throw new Error('The backend jar is missing. Run "npm run build:backend".');
    }

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'enigma-vscode-e2e-'));
    const workspace = path.join(temp, 'workspace');
    fs.mkdirSync(workspace);
    fs.copyFileSync(path.join(fixtures, 'inheritance_tree.jar'), path.join(workspace, 'inheritance_tree.jar'));

    const results = path.join(temp, 'results.txt');

    // Many machines have JAVA_HOME pointing at an old Java for other tools. The extension must cope with that, so
    // the tests always run that way: this is a stand-in for a Java 8 installation.
    const oldJava = path.join(temp, 'java8');
    // what the tests say they cause on purpose, one pattern per line (see expectTrouble in harness.ts)
    const expected = path.join(temp, 'expected.txt');
    const testEnv: Record<string, string> = {
        ENIGMA_E2E_WORKSPACE: workspace,
        ENIGMA_E2E_RESULTS: results,
        ENIGMA_E2E_FIXTURES: fixtures,
        ENIGMA_E2E_EXPECTED: expected,
    };
    if (process.env.ENIGMA_E2E_FILES) {
        testEnv.ENIGMA_E2E_FILES = process.env.ENIGMA_E2E_FILES;
    }

    // what of the extension the tests run, as Node measures it in the extension host (see scripts/e2e.ts)
    if (process.env.ENIGMA_E2E_COVERAGE) {
        testEnv.NODE_V8_COVERAGE = path.resolve(process.env.ENIGMA_E2E_COVERAGE);
    }

    if (process.platform !== 'win32') {
        fs.mkdirSync(path.join(oldJava, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(oldJava, 'release'), 'JAVA_VERSION="1.8.0_332"\n');
        fs.writeFileSync(path.join(oldJava, 'bin', 'java'), '#!/bin/sh\necho \'openjdk version "1.8.0_332"\' >&2\n', { mode: 0o755 });
        testEnv.JAVA_HOME = oldJava;
        testEnv.ENIGMA_E2E_OLD_JAVA = oldJava;
    }

    const candidates = [
        process.env.VSCODE_EXECUTABLE,
        '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
        '/usr/share/code/code',
    ];
    const version = process.env.VSCODE_VERSION;
    const installed =
        process.env.VSCODE_DOWNLOAD || version ? undefined : candidates.find(candidate => candidate && fs.existsSync(candidate));

    // ENIGMA_E2E_SCREENSHOTS=<folder> makes the tests leave pictures of the window there
    const screenshots = process.env.ENIGMA_E2E_SCREENSHOTS ? path.resolve(process.env.ENIGMA_E2E_SCREENSHOTS) : undefined;
    const debugPort = 9333 + Math.floor(Math.random() * 500);
    let screenshotServer: NodeJS.Timeout | undefined;
    if (screenshots) {
        fs.mkdirSync(screenshots, { recursive: true });
        testEnv.ENIGMA_E2E_SCREENSHOTS = screenshots;
        screenshotServer = serveScreenshots(screenshots, debugPort);
    }

    try {
        await runTests({
            vscodeExecutablePath: installed,
            version,
            extensionDevelopmentPath: extension,
            extensionTestsPath: path.resolve(__dirname, './suite/index'),
            extensionTestsEnv: testEnv,
            launchArgs: [
                workspace,
                '--disable-extensions',
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
                '--user-data-dir',
                path.join(temp, 'user-data'),
                '--extensions-dir',
                path.join(temp, 'extensions'),
                ...(screenshots ? [`--remote-debugging-port=${debugPort}`] : []),
            ],
        });
    } finally {
        clearInterval(screenshotServer);
        console.log('\n=== Enigma end-to-end results ===');
        console.log(fs.existsSync(results) ? fs.readFileSync(results, 'utf8') : 'No results were written: the tests did not start.');
        const allowed = fs.existsSync(expected)
            ? fs
                  .readFileSync(expected, 'utf8')
                  .split('\n')
                  .filter(line => line)
                  .map(line => new RegExp(line))
            : [];
        logged = loggedErrors(path.join(temp, 'user-data', 'logs')).filter(line => !allowed.some(pattern => pattern.test(line)));
        fs.rmSync(temp, { recursive: true, force: true });
    }

    if (logged && logged.length > 0) {
        throw new Error(`VS Code logged errors about the extension during the tests:\n${logged.map(line => `  ${line}`).join('\n')}`);
    }
}

/**
 * What VS Code wrote down as errors about the extension, in the logs of its window and of its extension host: what
 * goes wrong outside of any one test, like a document that could not be read while tabs were being restored.
 */
/**
 * What VS Code logs as errors of its own, naming the extension only because it is about one of its things: a page
 * whose panel was closed while it was still loading asks for its files after VS Code forgot it, as the tests that
 * open and close panels in quick succession do.
 */
const VSCODE_BOOKKEEPING = [/Blocked vscode-webview request/];

function loggedErrors(directory: string): string[] {
    const found: string[] = [];
    if (!fs.existsSync(directory)) {
        return found;
    }

    for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/^(renderer|exthost|main)\.log$/.test(entry.name)) {
            continue;
        }

        const lines = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8').split('\n');
        lines.forEach((line, index) => {
            // the error and where it happened: the stack trace below it, but not the lines of whatever comes next
            const trace = [line];
            for (let next = index + 1; next < lines.length && /^\s+at /.test(lines[next]); next++) {
                trace.push(lines[next]);
            }

            // about this extension: its scheme, its id, or its code; what VS Code says about itself is not ours to fix
            const ours = /enigma:|danibcastro\.enigma-vscode|build\/extension\/dist/.test(trace.join(' '));
            if (line.includes('[error]') && ours && !VSCODE_BOOKKEEPING.some(pattern => pattern.test(line))) {
                found.push(`${entry.name}: ${trace.map(part => part.trim()).join('\n      ')}`);
            }
        });
    }

    return found;
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
