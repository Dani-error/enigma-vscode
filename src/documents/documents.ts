import * as vscode from 'vscode';
import { Backend, BackendError, EngineStoppedError } from '../engine/backend';
import { ErrorCode, PositionMethod, PositionOptions, ResultOf, SourceResult, TokenInfo, View } from '../engine/protocol';
import { settings } from '../config';
import { SCHEME, parseClassUri } from './classUri';
import { t } from '../l10n';

interface LoadedFile {
    source: SourceResult;
    bytes: Uint8Array;
}

/** What the editor is told of a file when it asks: see stampOf. */
interface Stamp {
    mtime: number;
    size: number;
}

export interface SourceEvent {
    uri: vscode.Uri;
    source: SourceResult;
}

/** Whether a tab shows a document. */
const shownInTab = (uri: vscode.Uri) =>
    vscode.window.tabGroups.all.some(group =>
        group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()),
    );

/**
 * What a class reads as while its tab is being closed because its jar is not open (see setAside). Not kept: this is
 * no text of the class.
 */
const placeholder = (parsed: { class: string; view: View }): LoadedFile => ({
    source: {
        ...parsed,
        deobfName: parsed.class,
        revision: 0,
        serial: 0,
        text: '',
        error: null,
        tokens: {} as SourceResult['tokens'],
        refs: [],
        groups: [],
    },
    bytes: new Uint8Array(),
});

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
    /** By address, until the document is closed: see stampOf. */
    private readonly stamps = new Map<string, Stamp>();
    /** The texts the editor read of documents it had already, by address, since they last had unsaved changes. */
    private readonly rereads = new Map<string, Set<string>>();
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
    settle: (document: vscode.TextDocument) => Promise<void> = () => Promise.resolve();
    /** Set by the editor controller: whether it brings this document in line itself (see refresh). */
    manages: (document: vscode.TextDocument) => boolean = () => false;
    /** Set by the editor controller: resolves once the edits it is making to a document are done. */
    editsDone: (uri: vscode.Uri) => Promise<void> = () => Promise.resolve();

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
            vscode.workspace.onDidChangeTextDocument(event => {
                // typed in, or edited by the controller: what the editor read before is not what it shows anymore
                if (event.document.isDirty) {
                    this.rereads.delete(event.document.uri.toString());
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                const parsed = parseClassUri(document.uri);
                if (!parsed) {
                    return;
                }

                this.forget(document.uri);
                this.stamps.delete(document.uri.toString());
                this.rereads.delete(document.uri.toString());
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
            // with a jar open, every class can be read again; until then, what was set aside stays so
            backend.onDidChangeProject(state => {
                if (state.jarPath) {
                    this.aside.clear();
                }
            }),
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

    /** Whether a document cannot be typed in. Its editor does not take edits of extensions either. */
    isReadOnly(uri: vscode.Uri): boolean {
        const parsed = parseClassUri(uri);
        return !parsed || this.readOnly(parsed.view);
    }

    /**
     * Tells that the tabs of these classes are being closed because their jar is not open, or is about to close. The
     * editor may be reading them at this very moment: for the tabs it restored when the window was opened, or for
     * what was asked just before the jar went. It is answered with an empty text: an error is what it would show,
     * and log, for a tab that is gone the next moment.
     */
    setAside(classes: { class: string; view: View }[]): void {
        for (const parsed of classes) {
            this.aside.add(`${parsed.view}:${parsed.class}`);
        }
    }

    /**
     * The text the editor has of a class no tab shows, as if read again: neither kept nor passed on, so that the
     * controller goes on with what it knew of the class.
     */
    private asItIs(uri: vscode.Uri, parsed: { class: string; view: View }): LoadedFile | undefined {
        const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString());
        if (!document || shownInTab(uri)) {
            return undefined;
        }

        const text = document.getText();
        return { source: { ...placeholder(parsed).source, text }, bytes: Buffer.from(text, 'utf8') };
    }

    private readOnly(view: View): boolean {
        return view === 'bytecode' || !settings.inlineRename;
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

    /** @param again whether this is the second try, after the project went and came back while the first was asked */
    private async request(uri: vscode.Uri, again = false): Promise<LoadedFile> {
        const parsed = parseClassUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        // Without a jar to read it from: a tab being closed reads as nothing (see setAside), and a document the editor
        // keeps without a tab, as one an extension opened, reads as what it is, so that nothing changes in it until
        // the jar is back. An error is what the editor would log, for nobody to see.
        const withoutJar = (): LoadedFile | undefined =>
            this.aside.has(`${parsed.view}:${parsed.class}`) ? placeholder(parsed) : this.asItIs(uri, parsed);
        if (!(await this.ready())) {
            const answer = withoutJar();
            if (answer) {
                return answer;
            }

            throw vscode.FileSystemError.Unavailable(t('documents.noEnigmaProjectIsOpenOpen'));
        }

        let source: SourceResult;
        try {
            source = await this.backend.request('class/source', parsed);
        } catch (error) {
            // the engine stopped or the jar went while this was asked for: restarted, closed, or another opened
            const gone = error instanceof EngineStoppedError || (error instanceof BackendError && error.code === ErrorCode.NoProject);
            if (gone && !again && (await this.ready())) {
                // back with the project
                return this.request(uri, true);
            }

            const answer = gone ? withoutJar() : undefined;
            if (answer) {
                return answer;
            }

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

        const file: LoadedFile = { source, bytes: Buffer.from(source.text, 'utf8') };
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
            this.backend.output.warn(`Could not reload ${uri.path}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        // One way or the other, never both: the editor reading the document while the controller edits it refuses the
        // controller's edit, as made for a document that changed in the meantime. The controller knows which it is for a
        // document it looks after (see EditorController.settle); the others the editor reads again.
        if (!this.manages(document)) {
            this.reload(uri);
        }

        await this.settle(document);
    }

    /**
     * Has the editor read a file again, some time later, which on a busy machine is long after. It does not for a
     * document with unsaved changes.
     */
    reload(uri: vscode.Uri): void {
        const stamp = this.stamps.get(uri.toString());
        if (stamp) {
            stamp.mtime = ++this.clock;
        }

        this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
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
            source.error.message
                ? t('documents.enigmaCouldNotShowThisClass', source.error.type, source.error.message)
                : t('documents.enigmaCouldNotShowThisClassNoReason', source.error.type),
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

        const stamp = this.stampOf(uri, await this.load(uri));
        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: stamp.mtime,
            size: stamp.size,
            permissions: this.readOnly(parsed.view) ? vscode.FilePermission.Readonly : undefined,
        };
    }

    /**
     * The time and size of a file, as the editor knows them. The editor reads a document again whenever they are not
     * what it last read, also of its own accord, as when a tab of the document is opened, and that would change the
     * document under the edits of the controller. So the time changes only when the editor is to read it again (see
     * reload), and the size never does: the editor refuses to save a file that is newer than what it read and of
     * another size, as one changed by someone else, and saving is how the controller marks a document as unmodified.
     */
    private stampOf(uri: vscode.Uri, file: LoadedFile): Stamp {
        const key = uri.toString();
        let stamp = this.stamps.get(key);
        if (!stamp) {
            stamp = { mtime: ++this.clock, size: file.bytes.byteLength };
            this.stamps.set(key, stamp);
        }

        return stamp;
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const file = await this.load(uri);
        const key = uri.toString();
        // a document the editor has already, which it reads again (see wasReread)
        if (vscode.workspace.textDocuments.some(document => document.uri.toString() === key)) {
            this.rereads.set(key, (this.rereads.get(key) ?? new Set<string>()).add(file.source.text));
        }

        return file.bytes;
    }

    /**
     * Whether what last changed a document was the editor reading it again (see reload), rather than someone typing:
     * it has a text the editor read since it last had unsaved changes. The engine may have another one by then, as
     * the editor reads a document when told to, but applies what it read some time later.
     */
    wasReread(document: vscode.TextDocument): boolean {
        const key = document.uri.toString();
        if (!this.rereads.get(key)?.has(document.getText())) {
            return false;
        }

        this.rereads.delete(key);
        return true;
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
        document: vscode.TextDocument,
        position: vscode.Position,
        method: M,
        options?: PositionOptions<M>,
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
                const result = await this.backend.request<PositionMethod>(method, place);
                return result ?? undefined;
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
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.diagnostics.dispose();
        this.changeEmitter.dispose();
        this.sourceEmitter.dispose();
    }
}
