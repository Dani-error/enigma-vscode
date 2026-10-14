import * as vscode from 'vscode';
import { Backend, BackendError } from '../engine/backend';
import { ErrorCode, ParamsOf, PositionMethod, PositionOptions, ResultOf, SourceResult, TokenInfo, View } from '../engine/protocol';
import { settings } from '../config';
import { SCHEME, parseClassUri } from './classUri';
import { t } from '../l10n';

interface LoadedFile {
    source: SourceResult;
    bytes: Uint8Array;
    mtime: number;
}

export interface SourceEvent {
    uri: vscode.Uri;
    source: SourceResult;
}

/** How many classes are kept in memory although no document shows them (anymore). */
const MAX_UNOPENED = 32;

/**
 * Serves decompiled classes as files, straight from the engine.
 */
export class EnigmaDocuments implements vscode.FileSystemProvider, vscode.Disposable {
    private readonly files = new Map<string, LoadedFile>();
    private readonly loading = new Map<string, Promise<LoadedFile>>();
    /** Requests for the text of a class that the engine has not answered yet. */
    private readonly fetching = new Map<string, Promise<unknown>>();
    /** Documents whose tab is being closed: see retire. */
    private readonly retired = new Set<string>();
    /** Classes whose tabs are being closed because their jar is not open: see setAside. */
    private readonly aside = new Set<string>();
    private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private readonly sourceEmitter = new vscode.EventEmitter<SourceEvent>();
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('enigma');
    private readonly disposables: vscode.Disposable[] = [];
    private clock = 1;

    readonly onDidChangeFile = this.changeEmitter.event;
    /** The text of a class was (re)loaded from the engine. Fired before the editor is told about it. */
    readonly onDidLoadSource = this.sourceEmitter.event;

    /** Set by the editor controller: whether a name of this document is being typed, which shifts its positions. */
    isEditing: (uri: vscode.Uri) => boolean = () => false;
    /** Set by the editor controller: makes a document identical to what the engine says and marks it saved. */
    settle: (document: vscode.TextDocument) => Promise<void> = async () => undefined;

    constructor(
        private readonly backend: Backend,
        /** Resolves once the project the window had open is available again, or it is clear there is none. */
        private readonly ready: () => Promise<boolean>,
    ) {
        this.disposables.push(
            vscode.workspace.registerFileSystemProvider(SCHEME, this, { isCaseSensitive: true }),
            backend.onDidChangeSource(({ class: name, view }) => {
                for (const document of vscode.workspace.textDocuments) {
                    const parsed = parseClassUri(document.uri);
                    if (parsed && parsed.class === name && parsed.view === view) {
                        void this.refresh(document.uri);
                    }
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                const parsed = parseClassUri(document.uri);
                if (!parsed) {
                    return;
                }

                this.forget(document.uri);
                this.retired.delete(document.uri.toString());
                // the same class can be open under its previous name for a moment after it was renamed
                const stillOpen = vscode.workspace.textDocuments.some(other => {
                    const otherParsed = other !== document && !other.isClosed ? parseClassUri(other.uri) : undefined;
                    return otherParsed?.class === parsed.class && otherParsed.view === parsed.view;
                });
                if (!stillOpen && this.backend.running) {
                    this.backend.request('class/close', parsed).catch(() => undefined);
                }
            }),
            backend.onDidExit(() => {
                this.files.clear();
                this.loading.clear();
                this.fetching.clear();
            }),
            // with a jar open, every class can be read again
            backend.onDidChangeProject(() => this.aside.clear()),
        );
    }

    /**
     * Tells that the tab of a document is being closed, for one of another name: its class was renamed. From here on
     * the document is left alone. Bringing it in line with the engine once more would leave it with changes at the
     * moment its tab closes, and the editor would ask whether to save them.
     */
    retire(uri: vscode.Uri): void {
        this.retired.add(uri.toString());
    }

    /** Takes back {@link retire}: the document is shown again, as when a class gets back a name it had. */
    revive(uri: vscode.Uri): void {
        if (this.retired.delete(uri.toString())) {
            // what it missed meanwhile: the editor may still have the document, and then does not read it again
            void this.refresh(uri);
        }
    }

    isRetired(uri: vscode.Uri): boolean {
        return this.retired.has(uri.toString());
    }

    /**
     * Tells that the tabs of these classes are being closed because their jar is not open. The editor may be reading
     * them at this very moment, for the tabs it restored when the window was opened. It is answered with an empty
     * text: an error is what it would show, and log, for a tab that is gone the next moment.
     */
    setAside(classes: { class: string; view: View }[]): void {
        for (const parsed of classes) {
            this.aside.add(`${parsed.view}:${parsed.class}`);
        }
    }

    private readOnly(view: View): boolean {
        return view === 'bytecode' || !(settings.inlineRename);
    }

    private fetch(uri: vscode.Uri): Promise<LoadedFile> {
        const key = uri.toString();
        const pending = this.request(uri).finally(() => {
            if (this.fetching.get(key) === pending) {
                this.fetching.delete(key);
            }
        });
        this.fetching.set(key, pending);
        return pending;
    }

    private async request(uri: vscode.Uri): Promise<LoadedFile> {
        const parsed = parseClassUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        if (!await this.ready()) {
            if (this.aside.has(`${parsed.view}:${parsed.class}`)) {
                // not kept: this is no text of the class
                return { source: { ...parsed, deobfName: parsed.class, revision: 0, serial: 0, text: '', error: null, tokens: {} as SourceResult['tokens'], refs: [], groups: [] }, bytes: new Uint8Array(), mtime: 0 };
            }

            throw vscode.FileSystemError.Unavailable(t('documents.noEnigmaProjectIsOpenOpen'));
        }

        let source: SourceResult;
        try {
            source = await this.backend.request('class/source', parsed);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(error instanceof Error ? error.message : String(error));
        }

        // Positions are exchanged as lines and characters, which do not depend on line endings. Serving one kind of
        // line ending keeps the editor's text identical to this one, character for character.
        if (source.text.includes('\r')) {
            source.text = source.text.replace(/\r\n?/g, '\n');
        }

        // answers arrive in the order they were given, but nothing else guarantees it: never go back in time
        const known = this.files.get(uri.toString());
        if (known && known.source.serial > source.serial) {
            return known;
        }

        const file: LoadedFile = { source, bytes: Buffer.from(source.text, 'utf8'), mtime: ++this.clock };
        this.files.set(uri.toString(), file);
        this.reportDecompileError(uri, source);
        this.sourceEmitter.fire({ uri, source });
        this.prune();
        return file;
    }

    private load(uri: vscode.Uri): Promise<LoadedFile> {
        const key = uri.toString();
        const loaded = this.files.get(key);
        if (loaded) {
            return Promise.resolve(loaded);
        }

        let pending = this.loading.get(key);
        if (!pending) {
            pending = this.fetch(uri).finally(() => this.loading.delete(key));
            this.loading.set(key, pending);
        }

        return pending;
    }

    /**
     * Loads the current text of a class from the engine again and puts it into the documents showing it.
     */
    async refresh(uri: vscode.Uri): Promise<void> {
        const key = uri.toString();
        const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === key);
        if (!document) {
            this.forget(uri);
            return;
        }

        if (this.retired.has(key)) {
            return;
        }

        try {
            await this.fetch(uri);
        } catch (error) {
            this.backend.output.warn(`Could not reload ${uri.path}: ${error instanceof Error ? error.message : error}`);
            return;
        }

        // The controller first: it changes the text name by name, which leaves cursors where they are. Told that the
        // file changed, the editor reloads it if it has no unsaved changes, and that moves cursors (see settle); told
        // afterwards, it finds nothing left to change. It still has to be told, for the classes that cannot be typed
        // in, which the controller does not look after.
        // in a document that is not on display there is no cursor to keep, and the editor does it all
        if (vscode.window.visibleTextEditors.some(candidate => candidate.document === document)) {
            await this.settle(document);
        }

        this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        await this.settle(document);
    }

    private forget(uri: vscode.Uri): void {
        this.files.delete(uri.toString());
        this.diagnostics.delete(uri);
    }

    /** Drops classes that were read without ever being shown, for example by a preview. */
    private prune(): void {
        if (this.files.size <= MAX_UNOPENED) {
            return;
        }

        const open = new Set(vscode.workspace.textDocuments.map(document => document.uri.toString()));
        for (const key of this.files.keys()) {
            if (this.files.size <= MAX_UNOPENED) {
                break;
            }

            if (!open.has(key)) {
                this.files.delete(key);
            }
        }
    }

    private reportDecompileError(uri: vscode.Uri, source: SourceResult): void {
        if (!source.error) {
            this.diagnostics.delete(uri);
            return;
        }

        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            source.error.message ? t('documents.enigmaCouldNotShowThisClass', source.error.type, source.error.message) : t('documents.enigmaCouldNotShowThisClassNoReason', source.error.type),
            vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'Enigma';
        this.diagnostics.set(uri, [diagnostic]);
    }



    watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const parsed = parseClassUri(uri);
        if (!parsed) {
            // the folders of the address: the jar and its packages
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }

        const file = await this.load(uri);
        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: file.mtime,
            size: file.bytes.byteLength,
            permissions: this.readOnly(parsed.view) ? vscode.FilePermission.Readonly : undefined,
        };
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return (await this.load(uri)).bytes;
    }

    writeFile(): void {
        // Saving a class means nothing: its text is generated. The editor controller uses it to mark a document as
        // having no unsaved changes once the engine and the editor agree on its content.
    }

    readDirectory(): [string, vscode.FileType][] {
        return [];
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    rename(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }



    /** The source currently displayed for a document, if it has been loaded. */
    source(uri: vscode.Uri): SourceResult | undefined {
        return this.files.get(uri.toString())?.source;
    }

    /**
     * Waits, briefly, until a document shows the text that was last loaded for it: after a rename there is a moment
     * in which it still shows the previous one, where the same position is something else.
     */
    private async inSync(document: vscode.TextDocument): Promise<LoadedFile | undefined> {
        const key = document.uri.toString();
        for (let waited = 0; waited < 60 && !document.isClosed; waited++) {
            const file = this.files.get(key);
            if (!file) {
                // being decompiled, for example right after the engine was restarted
                const pending = this.fetching.get(key);
                if (!pending) {
                    return undefined;
                }

                await pending.then(undefined, () => undefined);
                continue;
            }

            // while a name is being typed, positions no longer match what the engine knows
            if (this.isEditing(document.uri)) {
                return undefined;
            }

            if (file.source.text === document.getText()) {
                return file;
            }

            await new Promise(resolve => setTimeout(resolve, 15));
        }

        return undefined;
    }

    private nextSource(uri: vscode.Uri, timeout: number): Promise<void> {
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                listener.dispose();
                resolve();
            };

            const timer = setTimeout(done, timeout);
            const listener = this.onDidLoadSource(event => {
                if (event.uri.toString() === uri.toString()) {
                    done();
                }
            });
        });
    }

    /**
     * Asks the engine about a position of a document.
     *
     * A position only means something for one text. The engine is told which one the position is for, and says so
     * when it has handed out another one since; the question is then asked again for that one.
     * @returns undefined if the document does not show a text of the engine, also after waiting for it
     */
    async atPosition<M extends PositionMethod>(
        document: vscode.TextDocument, position: vscode.Position, method: M, options?: PositionOptions<M>,
    ): Promise<NonNullable<ResultOf<M>> | undefined> {
        const parsed = parseClassUri(document.uri);
        if (!parsed) {
            return undefined;
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            const file = await this.inSync(document);
            if (!file) {
                return undefined;
            }

            try {
                const place = { ...parsed, ...options, serial: file.source.serial, line: position.line, character: position.character };
                // every such request takes a place and its own options, which is more than the compiler can tell of "M"
                const result = await this.backend.request<PositionMethod>(method, place as ParamsOf<PositionMethod>);
                return (result ?? undefined) as NonNullable<ResultOf<M>> | undefined;
            } catch (error) {
                if (!(error instanceof BackendError) || error.code !== ErrorCode.Stale) {
                    throw error;
                }

                // the newer text is on its way here
                await this.nextSource(document.uri, 2000);
            }
        }

        return undefined;
    }

    /** Asks the engine what is at a position of a document. */
    tokenAt(document: vscode.TextDocument, position: vscode.Position): Promise<TokenInfo | undefined> {
        return this.atPosition(document, position, 'class/entryAt');
    }

    /** What is under the cursor of the active editor, if it shows a class. */
    async tokenAtCursor(): Promise<{ token: TokenInfo; editor: vscode.TextEditor } | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== SCHEME) {
            return undefined;
        }

        const token = await this.tokenAt(editor.document, editor.selection.active);
        return token ? { token, editor } : undefined;
    }

    /** Drops every text that was loaded, when the jar they came from is closed. */
    forgetAll(): void {
        this.files.clear();
        this.diagnostics.clear();
    }

    /** Reloads every open class, after the project they belong to became available. */
    refreshAll(): void {
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme === SCHEME) {
                void this.refresh(document.uri);
            }
        }
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.diagnostics.dispose();
        this.changeEmitter.dispose();
        this.sourceEmitter.dispose();
    }
}
