// What comes back when a window is loaded again: "Developer: Reload Window", and quitting and starting the editor.
//
// The end-to-end suite cannot test this. A window that runs a suite of tests keeps nothing of what was open, so it
// has nothing to come back to. Here the editor is started the ordinary way, on a profile of its own, with the
// extension and a small driver (test/reload/driver) that runs what this script asks for inside the window. The
// window itself is looked at through the debugging protocol of its browser engine: its notifications, its web views,
// and pictures of it (ENIGMA_RELOAD_SHOTS=<folder> keeps them).
//
// Run with: npm run test:reload
import { buildSync } from 'esbuild';
import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as Vscode from 'vscode';
import { layout } from '../../scripts/layout';
import type { EnigmaApi } from '../../src/extension';

/** What a function that runs inside the window is given: the API of the editor, and a way to Enigma's own. */
type Editor = typeof Vscode;
type Enigma = () => Promise<EnigmaApi>;
type Task<T, A extends unknown[] = []> = (vscode: Editor, enigma: Enigma, ...args: A) => T | Promise<T>;

/** A page the debugging protocol of the window can reach. */
interface Target {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
}

interface Evaluated<T> {
    result?: { value?: T };
}

interface Toast {
    text: string;
    error: boolean;
    buttons: string[];
}

interface Pane {
    title: string | null;
    text: string | null;
}

interface WindowState {
    active: boolean;
    jarOpen: boolean;
    pane: { visible: boolean; loaded: boolean; entry: string | null; kind: string | null } | null;
    classTabs: string[];
}

interface Step {
    step: string;
    notifications: Toast[];
    state: WindowState;
    panes: Pane[];
}

const root = path.resolve(import.meta.dirname, '../..');
const driver = path.join(root, 'test', 'reload', 'driver');
const fixture = path.join(root, 'vendor', 'enigma', 'enigma', 'build', 'test-obf', 'inheritance_tree.jar');
const executable = [
    process.env.VSCODE_EXECUTABLE,
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    '/usr/share/code/code',
].find(candidate => candidate && fs.existsSync(candidate));

if (!fs.existsSync(fixture)) {
    throw new Error('Enigma test fixtures are missing. Run "npm run test:backend" once to build them.');
}

if (!executable) {
    throw new Error('No installed editor found. Set VSCODE_EXECUTABLE to its executable.');
}

// the driver is an extension, and the editor loads those as JavaScript
buildSync({
    entryPoints: [path.join(driver, 'extension.ts')],
    outfile: path.join(driver, 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    logLevel: 'warning',
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'enigma-vscode-reload-'));
const workspace = path.join(temp, 'workspace');
const requests = path.join(temp, 'driver');
const userData = path.join(temp, 'user-data');
const shots = process.env.ENIGMA_RELOAD_SHOTS ? path.resolve(process.env.ENIGMA_RELOAD_SHOTS) : undefined;
const jar = path.join(workspace, 'inheritance_tree.jar');
const port = 9400 + Math.floor(Math.random() * 400);

for (const directory of [workspace, requests, path.join(userData, 'User'), ...(shots ? [shots] : [])]) {
    fs.mkdirSync(directory, { recursive: true });
}

fs.copyFileSync(fixture, jar);
fs.writeFileSync(
    path.join(userData, 'User', 'settings.json'),
    JSON.stringify(
        {
            'workbench.startupEditor': 'none',
            'telemetry.telemetryLevel': 'off',
            'update.mode': 'none',
            'extensions.autoCheckUpdates': false,
            'window.restoreWindows': 'all',
            ...JSON.parse(process.env.ENIGMA_RELOAD_SETTINGS ?? '{}'),
        },
        undefined,
        '\t',
    ),
);

const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function until<T>(what: string, condition: () => T | Promise<T>, timeout = 60000): Promise<T> {
    const deadline = Date.now() + timeout;
    let last: unknown;
    while (Date.now() < deadline) {
        try {
            const value = await condition();
            last = value;
            if (value) {
                return value;
            }
        } catch (error) {
            last = error;
        }

        await pause(150);
    }

    throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// ---- the editor ----

let editor: ChildProcess | undefined;
/** Resolves when the editor that was started last is gone. */
let editorExited: Promise<void> = Promise.resolve();

function start(executable: string): void {
    const env: NodeJS.ProcessEnv = { ...process.env, ENIGMA_DRIVER_DIR: requests };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = (editor = spawn(
        executable,
        [
            workspace,
            `--extensionDevelopmentPath=${layout(root).extension}`,
            `--extensionDevelopmentPath=${driver}`,
            '--user-data-dir',
            userData,
            '--extensions-dir',
            path.join(temp, 'extensions'),
            '--disable-workspace-trust',
            '--skip-welcome',
            '--skip-release-notes',
            `--remote-debugging-port=${port}`,
        ],
        { env, stdio: 'ignore' },
    ));
    editorExited = new Promise(resolve => started.once('exit', () => resolve()));
}

const hosts = () => fs.readdirSync(requests).filter(name => name.startsWith('host-')).length;

/** Runs a function inside the window, as an extension. It gets the editor's API and a way to Enigma's own. */
let sequence = 0;
async function inside<T, A extends unknown[]>(task: Task<T, A>, ...args: A): Promise<T> {
    const name = String(++sequence).padStart(4, '0');
    // its source is what crosses over: it can use nothing of this file but what it is given
    fs.writeFileSync(path.join(requests, `${name}.tmp`), `return (${task.toString()})(vscode, enigma, ...${JSON.stringify(args)});`);
    fs.renameSync(path.join(requests, `${name}.tmp`), path.join(requests, `${name}.request.js`));
    const answer = path.join(requests, `${name}.json`);
    await until(`the window to answer request ${name}`, () => fs.existsSync(answer));
    const result = JSON.parse(fs.readFileSync(answer, 'utf8')) as { ok: true; value: T } | { ok: false; error: string };
    if (!result.ok) {
        throw new Error(result.error);
    }

    return result.value;
}

/** The same, for what ends the extension host: no answer comes back. */
function insideWithoutAnswer(task: Task<unknown>): void {
    const name = String(++sequence).padStart(4, '0');
    fs.writeFileSync(path.join(requests, `${name}.tmp`), `return (${task.toString()})(vscode, enigma);`);
    fs.renameSync(path.join(requests, `${name}.tmp`), path.join(requests, `${name}.request.js`));
}

// ---- the window, seen from outside ----

/** Asks a page of the window something, in the debugging protocol of its browser engine. */
async function ask<T>(socketUrl: string, method: string, params: object): Promise<T> {
    const socket = new WebSocket(socketUrl);
    try {
        await new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            socket.onerror = () => reject(new Error('could not connect to the window'));
        });
        return await new Promise<T>((resolve, reject) => {
            socket.onmessage = event => {
                const message = JSON.parse(String(event.data)) as { id: number; result: T; error?: { message: string } };
                if (message.id !== 1) {
                    return;
                }

                if (message.error) {
                    reject(new Error(message.error.message));
                } else {
                    resolve(message.result);
                }
            };
            socket.send(JSON.stringify({ id: 1, method, params }));
        });
    } finally {
        socket.close();
    }
}

const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[];
/** The pages of Enigma's panes: each web view of the extension is a page of its own. */
const paneTargets = async () =>
    (await targets()).filter(
        target => target.url.startsWith('vscode-webview://') && target.url.includes('extensionId=danibcastro.enigma-vscode'),
    );

async function workbench(): Promise<string> {
    const page = (await targets()).find(target => target.type === 'page' && target.url.includes('workbench'));
    if (!page) {
        throw new Error('the window is not there');
    }

    return page.webSocketDebuggerUrl;
}

/** Evaluates something in the window itself, where its own interface is. */
async function inWindow<T>(expression: string): Promise<T | undefined> {
    return (await ask<Evaluated<T>>(await workbench(), 'Runtime.evaluate', { expression, returnByValue: true })).result?.value;
}

async function shot(name: string): Promise<void> {
    if (shots) {
        const picture = await ask<{ data: string }>(await workbench(), 'Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(picture.data, 'base64'));
    }
}

/** What the window tells the user. */
const notifications = async () =>
    (await inWindow<
        Toast[]
    >(`[...document.querySelectorAll('.notifications-toasts .notification-list-item, .notifications-center .notification-list-item')].map(item => ({
	text: item.querySelector('.notification-list-item-message')?.innerText ?? '',
	error: !!item.querySelector('.notification-list-item-icon.codicon-error'),
	buttons: [...item.querySelectorAll('.monaco-button')].map(button => button.innerText.trim()),
}))`)) ?? [];

const answerNotification = (label: string) =>
    inWindow<boolean>(`(() => {
	const button = [...document.querySelectorAll('.notifications-toasts .monaco-button, .notifications-center .monaco-button')].find(candidate => candidate.innerText.trim() === ${JSON.stringify(label)});
	button?.click();
	return !!button;
})()`);

/** The pages of Enigma's panes, as they are on display: their titles and what they say. */
async function panes(): Promise<Pane[]> {
    const pages: Pane[] = [];
    for (const target of await paneTargets()) {
        const answer = await ask<Evaluated<Pane>>(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => {
				const page = document.getElementById('active-frame')?.contentDocument;
				return page ? { title: page.title, text: (page.body?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300) } : { title: null, text: null };
			})()`,
        }).then(
            result => result.result?.value,
            (error: Error) => ({ title: null, text: `not readable: ${error.message}` }),
        );
        pages.push(answer ?? { title: null, text: null });
    }

    return pages;
}

/** Runs something in the page of the Identifier pane, as if the user did it there. */
async function inIdentifier<T = void>(expression: string): Promise<T> {
    for (const target of await paneTargets()) {
        const answer = await ask<Evaluated<{ other?: boolean; error?: string; value?: T }>>(
            target.webSocketDebuggerUrl,
            'Runtime.evaluate',
            {
                returnByValue: true,
                expression: `(() => {
				const page = document.getElementById('active-frame')?.contentDocument;
				if (page?.title !== 'Identifier') {
					return { other: true };
				}

				try {
					return { value: (${expression})(page) };
				} catch (error) {
					return { error: String(error) };
				}
			})()`,
            },
        );
        const result = answer.result?.value;
        if (result?.error) {
            throw new Error(result.error);
        }

        if (result && !result.other) {
            return result.value as T;
        }
    }

    throw new Error('the page of the Identifier pane is not there');
}

/** Enigma as the extension sees itself, without waking it up if it is not running. */
const state = () =>
    inside(async (vscode): Promise<WindowState> => {
        const extension = vscode.extensions.getExtension<EnigmaApi>('danibcastro.enigma-vscode');
        const api = extension?.isActive ? extension.exports : undefined;
        return {
            active: extension?.isActive ?? false,
            jarOpen: api?.project.isOpen ?? false,
            pane: api
                ? {
                      visible: api.entryPane.visible,
                      loaded: api.entryPane.loaded,
                      entry: api.entryPane.entry?.displayName ?? null,
                      kind: api.entryPane.entry?.kindLabel ?? null,
                  }
                : null,
            classTabs: vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'enigma')
                .map(tab => tab.label),
        };
    });

/** What the editor wrote down as errors, in the logs of its window and of its extensions. */
function loggedErrors(): string[] {
    const found: string[] = [];
    const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(file);
            } else if (entry.name === 'renderer.log' || entry.name === 'exthost.log') {
                const lines = fs.readFileSync(file, 'utf8').split('\n');
                lines.forEach((line, index) => {
                    // the editor's own complaints about itself are not ours to fix
                    if (line.includes('[error]') && !/DEP0\d+|EXTRA proposals|product\.json|punycode/.test(line)) {
                        const origin = lines[index + 3] ?? '';
                        found.push(`${entry.name}: ${line}${/^\s+at /.test(origin) ? ` | ${origin.trim()}` : ''}`);
                    }
                });
            }
        }
    };

    if (fs.existsSync(path.join(userData, 'logs'))) {
        walk(path.join(userData, 'logs'));
    }

    return found;
}

// ---- what is tested ----

const report: { steps: Step[]; problems: string[] } = { steps: [], problems: [] };
const problem = (text: string) => {
    report.problems.push(text);
    console.log(`  PROBLEM ${text}`);
};

/** Watches the window for a while: what it says, and what Enigma's panes show meanwhile. */
async function watch(step: string, milliseconds: number): Promise<Step> {
    const seen = new Map<string, Toast>();
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
        for (const notification of await notifications().catch(() => [])) {
            seen.set(notification.text, notification);
        }

        await pause(200);
    }

    const entry: Step = { step, notifications: [...seen.values()], state: await state(), panes: await panes() };
    report.steps.push(entry);
    console.log(`\n== ${step}\n${JSON.stringify(entry, undefined, 2)}`);
    for (const notification of entry.notifications) {
        if (notification.error || /error loading webview|unable to (read|open)/i.test(notification.text)) {
            problem(`${step}: the window shows "${notification.text}"`);
        }
    }

    return entry;
}

const identifier = (entry: Step) => entry.panes.find(pane => pane.title === 'Identifier');
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function openClassesAndPointAtMethod() {
    await inside(async (vscode, enigma) => {
        const api = await enigma();
        for (const name of ['d', 'e']) {
            await vscode.commands.executeCommand('enigma.openClass', name);
            // a tab of its own: the next class would take the place of one that is only previewed
            await vscode.commands.executeCommand('workbench.action.keepEditor');
        }

        return api.project.isOpen;
    });
    await pointAtMethod();
}

async function pointAtMethod() {
    await until('the class to be on display', () =>
        inside(async vscode => {
            const active = vscode.window.activeTextEditor;
            if (active?.document.uri.scheme !== 'enigma' || !active.document.getText().includes('String a()')) {
                return false;
            }

            const position = active.document.positionAt(active.document.getText().indexOf('String a()') + 'String '.length);
            active.selection = new vscode.Selection(position, position);
            return true;
        }),
    );
    await until('the Identifier pane to show the method', async () => (await state()).pane?.kind === 'Method', 20000);
}

/** After the window came back: nothing broken on display, and with the jar open again, everything as it was. */
async function comesBack(how: string): Promise<void> {
    const back = await watch(`${how}: the window is back`, 6000);
    await shot(`${how}-1-back`);
    if (back.state.classTabs.length > 0 && !back.state.jarOpen) {
        problem(`${how}: tabs of classes are open without their jar: ${back.state.classTabs.join(', ')}`);
    }

    const pane = identifier(back);
    if (back.state.pane?.visible && !pane?.text) {
        problem(`${how}: the Identifier pane is on display but shows nothing (${JSON.stringify(back.panes)})`);
    }

    if (!back.state.jarOpen) {
        if (!(await answerNotification('Reopen'))) {
            problem(`${how}: there is no question whether to reopen the jar`);
            await inside(async (vscode, _enigma, jarPath: string) => {
                await vscode.commands.executeCommand('enigma.openJar', jarPath);
            }, jar);
        }
    }

    await until('the jar to be open again', async () => (await state()).jarOpen);
    await until('the classes to be back in their tabs', async () => (await state()).classTabs.length === 2, 30000).catch((error: unknown) =>
        problem(`${how}: ${messageOf(error)}`),
    );
    await pointAtMethod().catch((error: unknown) => problem(`${how}: ${messageOf(error)}`));
    const open = await watch(`${how}: the jar is open again`, 3000);
    await shot(`${how}-2-open-again`);
    if (open.state.classTabs.join() !== 'd.java,e.java') {
        problem(`${how}: the tabs that came back are ${JSON.stringify(open.state.classTabs)}`);
    }

    if (!/Method/.test(identifier(open)?.text ?? '')) {
        problem(`${how}: the Identifier pane does not show the method under the cursor (${JSON.stringify(open.panes)})`);
    }
}

/** The pane does what it is for, used the way a user does: through its page. */
async function paneWorks() {
    const step = 'using the Identifier pane';
    const text = () => inside(async vscode => vscode.window.activeTextEditor?.document.getText() ?? '');

    // a name typed into its field, and Enter
    await inIdentifier(`page => {
		const name = page.querySelector('input[aria-label="Name"]');
		name.focus();
		name.value = 'describe';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	}`);
    await until(
        'the method to be renamed from the pane',
        async () => (await state()).pane?.entry === 'describe' && (await text()).includes('String describe()'),
        20000,
    ).catch((error: unknown) => problem(`${step}: ${messageOf(error)}`));

    // its javadoc
    await inIdentifier(`page => {
		const javadoc = page.querySelector('textarea[aria-label="Javadoc"]');
		javadoc.focus();
		javadoc.value = 'Says what this is.';
		javadoc.dispatchEvent(new Event('input', { bubbles: true }));
	}`);
    // as a person would, a moment later: the page enables the button once it has caught up with the typing
    await pause(100);
    await inIdentifier(`page => [...page.querySelectorAll('button')].find(button => button.textContent === 'Save Javadoc').click()`);
    await until('the javadoc to be in the code', async () => (await text()).includes('Says what this is.'), 20000).catch((error: unknown) =>
        problem(`${step}: ${messageOf(error)}`),
    );

    // where to go from the entry: each of the buttons next to its kind
    const buttons = await inIdentifier<string[]>(
        `page => [...page.querySelectorAll('.toolbar button')].map(button => button.getAttribute('aria-label'))`,
    );
    for (const label of buttons) {
        await inIdentifier(
            `page => [...page.querySelectorAll('.toolbar button')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)}).click()`,
        );
        await pause(1200);
    }

    const used = await watch(step, 2500);
    await shot('3-pane-used');
    if (buttons.length === 0) {
        problem(`${step}: the pane has no buttons to go anywhere from the entry`);
    }

    // the name itself is in a field, which is not part of what the page says
    if (!/Method Mapped/.test(identifier(used)?.text ?? '') || used.state.pane?.entry !== 'describe') {
        problem(`${step}: the pane does not show the renamed method (${JSON.stringify(used.panes)})`);
    }
}

async function main(executable: string): Promise<void> {
    start(executable);
    await until('the window to open', () => hosts() === 1);
    await inside(async (vscode, enigma, jarPath: string) => {
        await enigma();
        await vscode.commands.executeCommand('enigma.openJar', jarPath);
    }, jar);
    await until('the jar to be open', async () => (await state()).jarOpen);
    await openClassesAndPointAtMethod();
    const before = await watch('a jar, two classes and a method under the cursor', 2000);
    await shot('0-before');
    if (!/Method/.test(identifier(before)?.text ?? '')) {
        problem(`before: the Identifier pane does not show the method under the cursor (${JSON.stringify(before.panes)})`);
    }

    // "Developer: Reload Window"
    insideWithoutAnswer(async vscode => vscode.commands.executeCommand('workbench.action.reloadWindow'));
    await until('the window to be loaded again', () => hosts() === 2);
    await comesBack('reload');

    // quitting the editor and starting it again
    insideWithoutAnswer(async vscode => vscode.commands.executeCommand('workbench.action.quit'));
    await Promise.race([editorExited, pause(20000)]);
    start(executable);
    await until('the window to open again', () => hosts() === 3);
    await comesBack('restart');
    await paneWorks();

    for (const line of loggedErrors()) {
        problem(`logged: ${line}`);
    }
}

let failed = false;
try {
    await main(executable);
} catch (error) {
    failed = true;
    console.error(error);
    await shot('failure').catch(() => undefined);
    for (const line of loggedErrors()) {
        console.log(`  logged: ${line}`);
    }
} finally {
    insideWithoutAnswer(async vscode => vscode.commands.executeCommand('workbench.action.quit'));
    await Promise.race([editorExited, pause(8000)]);
    editor?.kill();
    if (shots) {
        fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify(report, undefined, 2));
    }

    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(
    `\n=== Enigma, reloading the window ===\n${report.problems.length === 0 && !failed ? 'PASSED' : `FAILED: ${report.problems.length} problem(s)\n${report.problems.map(text => `  - ${text}`).join('\n')}`}`,
);
process.exit(report.problems.length === 0 && !failed ? 0 : 1);
