import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc/node';
import { JavaRuntime, JavaSearch, environmentFor, findJava } from './java';
import { describeJavaFailure } from './javaText';
import { ArgumentsOf, EnvironmentInfo, ErrorCode, ErrorData, Method, Notifications, ResultOf, isErrorCode } from './protocol';
import { settings } from '../config';
import { t } from '../l10n';
import { describeSaid } from './messages';
import { TaskProgress } from './taskProgress';

/** An error reported by the engine that is meant to be read by the user, as opposed to a bug. */
export class BackendError extends Error {
    constructor(
        message: string,
        readonly code: ErrorCode,
        readonly data?: ErrorData,
    ) {
        super(message);
    }
}

/** No usable Java runtime was found. */
export class JavaNotFoundError extends Error {
    constructor(readonly search: JavaSearch) {
        super(describeJavaFailure(search));
    }
}

/** What the connection answers for requests the engine will not answer, because it stopped. */
const GONE = new Set<number>([rpc.ErrorCodes.PendingResponseRejected, rpc.ErrorCodes.ConnectionInactive]);

/** How long the engine gets to shut down, and then to exit, before it is killed. */
const STOP_TIMEOUT_MS = 5000;

type Emitters = { [N in keyof Notifications]: vscode.EventEmitter<Notifications[N]> };

export class Backend implements vscode.Disposable {
    private process?: ChildProcessWithoutNullStreams;
    private connection?: rpc.MessageConnection;
    private starting?: Promise<EnvironmentInfo>;
    /** The process that was asked to stop: its exit is no surprise. */
    private stopping?: ChildProcessWithoutNullStreams;
    /** The stop under way: what is asked of the engine meanwhile waits for the next one. */
    private stopped?: Promise<void>;
    private disposed = false;
    private readonly progress = new TaskProgress();
    private readonly exitEmitter = new vscode.EventEmitter<{ expected: boolean }>();
    /** What the engine tells without being asked, by the name it is sent under. */
    private readonly emitters: Emitters = {
        'stateChanged': new vscode.EventEmitter(),
        'projectChanged': new vscode.EventEmitter(),
        'mappingsChanged': new vscode.EventEmitter(),
        'sourceChanged': new vscode.EventEmitter(),
        'notification': new vscode.EventEmitter(),
        'progress': new vscode.EventEmitter(),
        'collab/stateChanged': new vscode.EventEmitter(),
        'collab/message': new vscode.EventEmitter(),
    };

    /** Any change of the project state: dirty flag, undo history, file paths, connection. */
    readonly onDidChangeState = this.emitters['stateChanged'].event;
    /** A jar was opened or closed. */
    readonly onDidChangeProject = this.emitters['projectChanged'].event;
    readonly onDidChangeMappings = this.emitters['mappingsChanged'].event;
    /** The text of a class shown in an editor is out of date. */
    readonly onDidChangeSource = this.emitters['sourceChanged'].event;

    readonly onUserNotification = this.emitters['notification'].event;
    readonly onDidChangeCollabState = this.emitters['collab/stateChanged'].event;
    readonly onCollabMessage = this.emitters['collab/message'].event;
    readonly onDidExit = this.exitEmitter.event;

    info?: EnvironmentInfo;
    /** The Java runtime the engine was last started with. */
    runtime?: JavaRuntime;

    constructor(
        private readonly context: vscode.ExtensionContext,
        readonly output: vscode.LogOutputChannel,
    ) {
        this.emitters['progress'].event(params => this.progress.handle(params));
    }

    get jarPath(): string {
        return this.context.asAbsolutePath(path.join('server', 'enigma-backend.jar'));
    }

    get running(): boolean {
        return this.connection !== undefined;
    }

    /**
     * Finds the Java runtime used to run the engine and its dedicated server.
     * @throws JavaNotFoundError if there is none that is new enough
     */
    async findRuntime(): Promise<JavaRuntime> {
        const configuredHome = settings.javaHome;
        const search = await findJava({ configuredHome });
        for (const rejected of search.rejected) {
            this.output.info(`Not using ${rejected.path} (from ${rejected.source}): ${rejected.reason}`);
        }

        if (!search.runtime) {
            throw new JavaNotFoundError(search);
        }

        this.runtime = search.runtime;
        return search.runtime;
    }

    classpath(): string {
        const plugins = settings.pluginJars;
        return [this.jarPath, ...plugins.filter(jar => jar.trim().length > 0)].join(path.delimiter);
    }

    start(): Promise<EnvironmentInfo> {
        if (!this.starting) {
            this.starting = this.launch().catch(error => {
                this.starting = undefined;
                throw error;
            });
        }

        return this.starting;
    }

    private async launch(): Promise<EnvironmentInfo> {
        if (!fs.existsSync(this.jarPath)) {
            throw new Error(t('backend.theEnigmaBackendIsMissingBuild', this.jarPath));
        }

        const runtime = await this.findRuntime();
        const args = [...settings.javaArguments, '-cp', this.classpath(), 'dev.danibcastro.enigmavscode.backend.Main'];
        this.output.info(`Using Java ${runtime.version} from ${runtime.source}: ${runtime.executable}`);
        this.output.info(`Starting backend: ${runtime.executable} ${args.join(' ')}`);

        const child = spawn(runtime.executable, args, { stdio: ['pipe', 'pipe', 'pipe'], env: environmentFor(runtime) });
        const connection = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout), new rpc.StreamMessageWriter(child.stdin));
        this.process = child;
        this.connection = connection;
        // what the engine logs arrives on its error stream, see LogCapture in backend/
        const flushLog = this.logLines(child.stderr);
        this.listen(connection);

        const exited = new Promise<never>((_, reject) => {
            child.on('error', error => reject(new Error(t('backend.couldNotStart', error.message))));
            child.on('exit', (code, signal) => {
                flushLog();
                this.log(() => this.output.info(`Backend exited (${signal ?? code})`));
                this.onExit(child, connection);
                reject(new Error(t('backend.theEnigmaBackendExitedUnexpectedlySee', signal ?? code)));
            });
        });
        // rejections are only interesting while starting up
        exited.catch(() => undefined);

        const info = await Promise.race([
            connection.sendRequest<EnvironmentInfo>('initialize', rpc.ParameterStructures.byName, settings.engine),
            exited,
        ]);
        this.info = info;
        this.output.info(`Enigma ${info.enigmaVersion} running on Java ${info.javaVersion}`);
        return info;
    }

    /** Writes to the log of the extension, which is gone already while the window closes. */
    private log(write: () => void): void {
        try {
            write();
        } catch {
            // nobody is left to read it
        }
    }

    /**
     * Copies what a stream says to the log, line by line.
     * @returns writes what is left of an unfinished line
     */
    private logLines(stream: Readable): () => void {
        let pending = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
            const lines = (pending + chunk).split(/\r?\n/);
            pending = lines.pop() ?? '';
            this.log(() => lines.forEach(line => this.output.appendLine(line)));
        });
        return () => {
            if (pending) {
                this.log(() => this.output.appendLine(pending));
                pending = '';
            }
        };
    }

    private listen(connection: rpc.MessageConnection): void {
        const forward = <N extends keyof Notifications>(
            name: N,
            adapt: (params: Notifications[N]) => Notifications[N] = params => params,
        ) => {
            connection.onNotification(name, (params: Notifications[N]) => this.emitters[name].fire(adapt(params)));
        };
        for (const name of Object.keys(this.emitters) as (keyof Notifications)[]) {
            if (name !== 'notification') {
                forward(name);
            }
        }

        // what the engine layer only names is worded here: see messages.ts
        forward('notification', params => ({ ...params, text: describeSaid(params.text, params) }));
        connection.onError(([error]) => this.log(() => this.output.error(`Protocol error: ${error.message}`)));
        connection.listen();
    }

    private onExit(child: ChildProcessWithoutNullStreams, connection: rpc.MessageConnection): void {
        if (this.process !== child) {
            return;
        }

        const expected = this.stopping === child;
        this.process = undefined;
        this.connection = undefined;
        this.starting = undefined;
        this.stopping = undefined;
        this.info = undefined;
        this.progress.endAll();
        connection.dispose();
        if (!this.disposed) {
            this.exitEmitter.fire({ expected });
        }
    }

    /**
     * Sends a request to the engine, starting it if needed.
     * @throws BackendError for errors the user caused or can fix
     */
    async request<M extends Method>(method: M, ...[params]: ArgumentsOf<M>): Promise<ResultOf<M>> {
        // an engine on its way out takes nothing new: what is asked meanwhile goes to the one that follows, if any
        await this.stopped;
        if (this.disposed) {
            throw new Error(t('backend.theEnigmaBackendIsNotRunning'));
        }

        await this.start();
        const connection = this.connection;
        if (!connection) {
            throw new Error(t('backend.theEnigmaBackendIsNotRunning'));
        }

        try {
            return await connection.sendRequest<ResultOf<M>>(method, rpc.ParameterStructures.byName, params ?? {});
        } catch (error) {
            if (error instanceof rpc.ResponseError && GONE.has(error.code)) {
                // stopped before it answered, as when it is restarted: nothing failed
                this.output.debug(`${method} was not answered: the engine stopped`);
                throw new Error(t('backend.theEnigmaBackendIsNotRunning'), { cause: error });
            }

            if (error instanceof rpc.ResponseError) {
                // answers the callers know how to handle; anything else is a failure of the engine
                const data = error.data as ErrorData | undefined;
                if (isErrorCode(error.code)) {
                    throw new BackendError(describeSaid(error.message, data), error.code, data);
                }

                this.output.error(`${method} failed: ${error.message}\n${data && 'stackTrace' in data ? data.stackTrace : ''}`);
                throw new Error(`Enigma: ${error.message}`, { cause: error });
            }

            throw error;
        }
    }

    /** Pushes the current settings to a running backend. */
    async configure(): Promise<void> {
        if (this.running) {
            const { profile: _profile, decompiler: _decompiler, ...changeable } = settings.engine;
            await this.request('configure', changeable);
        }
    }

    stop(): Promise<void> {
        this.stopped ??= this.shutDown().finally(() => {
            this.stopped = undefined;
        });
        return this.stopped;
    }

    private async shutDown(): Promise<void> {
        const child = this.process;
        const connection = this.connection;
        if (!child) {
            return;
        }

        this.stopping = child;
        try {
            if (connection) {
                await Promise.race([
                    connection.sendRequest('shutdown', rpc.ParameterStructures.byName, {}),
                    new Promise(resolve => setTimeout(resolve, STOP_TIMEOUT_MS)),
                ]);
            }
        } catch {
            // it is going away anyway
        }

        await new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                child.kill();
                resolve();
            }, STOP_TIMEOUT_MS);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });

            // the backend exits when its input is closed
            child.stdin.end();
        });
    }

    async restart(): Promise<EnvironmentInfo> {
        await this.stop();
        return this.start();
    }

    dispose(): void {
        this.disposed = true;
        void this.stop();
        Object.values(this.emitters).forEach(emitter => emitter.dispose());
        this.exitEmitter.dispose();
    }
}
