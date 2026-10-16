import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// Runs the extension inside a real VS Code and drives it through the editor's own commands.
// An installed VS Code is used when found; set VSCODE_EXECUTABLE to choose one, or VSCODE_DOWNLOAD=1 to download a build.
/**
 * Takes a picture of the editor's window through the debugging protocol of its browser engine. Nothing else shows what
 * the interface really looks like: where the panes are, how the code is highlighted.
 */
async function capture(port: number, file: string): Promise<void> {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
    const page = targets.find(target => target.type === 'page' && target.url.includes('workbench'));
    if (!page) {
        throw new Error(`No window found among ${targets.map(target => target.url).join(', ')}`);
    }

    const socket = new (globalThis as any).WebSocket(page.webSocketDebuggerUrl);
    try {
        await new Promise((resolve, reject) => {
            socket.onopen = resolve;
            socket.onerror = () => reject(new Error('could not connect to the window'));
        });
        const data = await new Promise<string>((resolve, reject) => {
            socket.onmessage = (event: { data: unknown }) => {
                const message = JSON.parse(String(event.data));
                if (message.id === 1) {
                    message.error ? reject(new Error(message.error.message)) : resolve(message.result.data);
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
    return setInterval(async () => {
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
    }, 100);
}

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '../../..');
    const fixtures = path.join(root, 'vendor', 'enigma', 'enigma', 'build', 'test-obf');
    if (!fs.existsSync(path.join(fixtures, 'inheritance_tree.jar'))) {
        throw new Error('Enigma test fixtures are missing. Run "bun run test:backend" once to build them.');
    }

    if (!fs.existsSync(path.join(root, 'server', 'enigma-backend.jar'))) {
        throw new Error('The backend jar is missing. Run "bun run build:backend".');
    }

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'enigma-vscode-e2e-'));
    const workspace = path.join(temp, 'workspace');
    fs.mkdirSync(workspace);
    fs.copyFileSync(path.join(fixtures, 'inheritance_tree.jar'), path.join(workspace, 'inheritance_tree.jar'));

    const results = path.join(temp, 'results.txt');

    // Many machines have JAVA_HOME pointing at an old Java for other tools. The extension must cope with that, so
    // the tests always run that way: this is a stand-in for a Java 8 installation.
    const oldJava = path.join(temp, 'java8');
    const testEnv: Record<string, string> = { ENIGMA_E2E_WORKSPACE: workspace, ENIGMA_E2E_RESULTS: results };
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
    const installed = process.env.VSCODE_DOWNLOAD ? undefined : candidates.find(candidate => candidate && fs.existsSync(candidate));

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
            extensionDevelopmentPath: root,
            extensionTestsPath: path.resolve(__dirname, './suite/index'),
            extensionTestsEnv: testEnv,
            launchArgs: [
                workspace,
                '--disable-extensions',
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
                '--user-data-dir', path.join(temp, 'user-data'),
                '--extensions-dir', path.join(temp, 'extensions'),
                ...(screenshots ? [`--remote-debugging-port=${debugPort}`] : []),
            ],
        });
    } finally {
        clearInterval(screenshotServer);
        console.log('\n=== Enigma end-to-end results ===');
        console.log(fs.existsSync(results) ? fs.readFileSync(results, 'utf8') : 'No results were written: the tests did not start.');
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
