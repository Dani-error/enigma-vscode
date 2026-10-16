// The packaged engine as a real child process, spoken to over stdio the way the extension does: what the tests
// outside the editor share.
import assert from 'node:assert/strict';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as rpc from 'vscode-jsonrpc/node';
import { layout } from '../scripts/layout';
import type { ArgumentsOf, EntryRef, Method, Notifications, ResultOf } from '../src/engine/protocol';

export const root = path.resolve(import.meta.dirname, '..');
export const backendJar = layout(root).serverJar;
/** The jars Enigma's own build obfuscates for its tests. */
export const fixtures = path.join(root, 'vendor', 'enigma', 'enigma', 'build', 'test-obf');

/** Something the engine told without being asked. */
export type Told = { [N in keyof Notifications]: { name: N; params: Notifications[N] } }[keyof Notifications];

const NOTIFICATIONS: (keyof Notifications)[] = [
    'stateChanged',
    'projectChanged',
    'mappingsChanged',
    'sourceChanged',
    'notification',
    'progress',
    'collab/stateChanged',
    'collab/message',
];
/** How long the engine gets to exit once its input is closed. */
const EXIT_TIMEOUT_MS = 15000;

export const classEntry = (name: string): EntryRef => ({ kind: 'class', name });
export const methodEntry = (owner: string, name: string, desc: string): EntryRef => ({ kind: 'method', owner, name, desc });
export const fieldEntry = (owner: string, name: string, desc: string): EntryRef => ({ kind: 'field', owner, name, desc });

export class Engine {
    /** Everything the engine told so far, in the order it arrived. */
    readonly told: Told[] = [];
    /** What it wrote to its output that is no message: there must be none. */
    readonly protocolErrors: Error[] = [];
    /** What it logged. */
    log = '';
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly connection: rpc.MessageConnection;

    /**
     * @param java the java to run it with; ENIGMA_JAVA, JAVA_HOME or the PATH otherwise
     * @param directory where it runs, which it must leave alone
     */
    constructor(directory: string, java?: string) {
        assert.ok(fs.existsSync(backendJar), `backend jar not built: ${backendJar} (run "bun run build:backend")`);
        assert.ok(
            fs.existsSync(path.join(fixtures, 'inheritance_tree.jar')),
            'Enigma test fixtures not built (run "bun run test:backend" once)',
        );

        const executable =
            java ?? process.env.ENIGMA_JAVA ?? (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java');
        this.child = spawn(executable, ['-jar', backendJar], { stdio: ['pipe', 'pipe', 'pipe'], cwd: directory });
        this.child.stderr.on('data', (chunk: Buffer) => {
            this.log += chunk.toString();
        });

        this.connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(this.child.stdout),
            new rpc.StreamMessageWriter(this.child.stdin),
        );
        this.connection.onError(([error]) => this.protocolErrors.push(error));
        for (const name of NOTIFICATIONS) {
            this.connection.onNotification(name, (params: unknown) => {
                this.told.push({ name, params } as Told);
            });
        }

        this.connection.listen();
    }

    /** Asks the engine for something it answers, as the extension does. */
    request<M extends Method>(method: M, ...[params]: ArgumentsOf<M>): Promise<ResultOf<M>> {
        return this.connection.sendRequest<ResultOf<M>>(method, rpc.ParameterStructures.byName, params ?? {});
    }

    /** Sends the engine anything at all, also what it should refuse. */
    send(method: string, params: object = {}): Promise<unknown> {
        return this.connection.sendRequest(method, rpc.ParameterStructures.byName, params);
    }

    /** Waits until the engine told something. */
    async waitFor(what: string, told: (told: Told) => boolean, since = 0, timeout = 20000): Promise<void> {
        const deadline = Date.now() + timeout;
        while (!this.told.slice(since).some(told)) {
            assert.ok(Date.now() < deadline, what);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }

    /**
     * Closes the input of the engine, which is how it is told to go.
     * @returns whether it went by itself
     */
    async close(): Promise<boolean> {
        this.connection.dispose();
        this.child.stdin.end();
        return new Promise<boolean>(resolve => {
            const timer = setTimeout(() => {
                this.child.kill();
                resolve(false);
            }, EXIT_TIMEOUT_MS);
            this.child.on('exit', () => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    }
}

/** Whether something thrown is an error of the engine with this code. */
export function isResponseError(error: unknown, code: number): error is rpc.ResponseError<unknown> {
    return error instanceof rpc.ResponseError && error.code === code;
}
