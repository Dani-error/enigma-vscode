// The hands of test/reload/run.ts inside the window it tests: an extension of its own, loaded next to Enigma, that
// runs what the test asks for. The end-to-end suite cannot do this part: a window that runs a suite of tests keeps
// nothing when it is closed or reloaded, and reloading is what is tested here.
//
// A file "<n>.request.js" in ENIGMA_DRIVER_DIR holds the body of an async function of (vscode, enigma); its answer is
// written to "<n>.json". "enigma" activates the extension and returns what it exposes to tests.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** What a request is run as: the body of an async function of the editor's API and a way to Enigma's own. */
type Body = (editor: typeof vscode, enigma: () => Promise<unknown>) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...parameters: string[]) => Body;
const REQUEST_SUFFIX = '.request.js';
const POLL_MS = 40;

export function activate(): vscode.Disposable | undefined {
    const directory = process.env.ENIGMA_DRIVER_DIR;
    if (!directory) {
        return undefined;
    }

    const enigma = async (): Promise<unknown> => {
        const extension = vscode.extensions.getExtension('danibcastro.enigma-vscode');
        if (!extension) {
            throw new Error('Enigma is not installed in this window');
        }

        return extension.isActive ? extension.exports : await extension.activate();
    };

    // every extension host says that it is there: one more of these means the window was loaded again
    fs.writeFileSync(path.join(directory, `host-${Date.now()}-${process.pid}`), '');

    let busy = false;
    const serve = async () => {
        if (busy) {
            return;
        }

        busy = true;
        try {
            for (const file of fs.readdirSync(directory).filter(name => name.endsWith(REQUEST_SUFFIX)).sort()) {
                const name = file.substring(0, file.length - REQUEST_SUFFIX.length);
                const source = fs.readFileSync(path.join(directory, file), 'utf8');
                fs.rmSync(path.join(directory, file));
                let answer: { ok: true; value: unknown } | { ok: false; error: string };
                try {
                    answer = { ok: true, value: await new AsyncFunction('vscode', 'enigma', source)(vscode, enigma) };
                } catch (error) {
                    answer = { ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
                }

                fs.writeFileSync(path.join(directory, `${name}.tmp`), JSON.stringify(answer));
                fs.renameSync(path.join(directory, `${name}.tmp`), path.join(directory, `${name}.json`));
            }
        } catch {
            // the directory goes with the test
        } finally {
            busy = false;
        }
    };
    const timer = setInterval(() => void serve(), POLL_MS);
    return { dispose: () => clearInterval(timer) };
}
