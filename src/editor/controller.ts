import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { SCHEME, parseClassUri } from '../documents/classUri';
import { ClassEditors } from '../documents/classEditors';
import { EnigmaDocuments } from '../documents/documents';
import { SourceResult, ValidationMessage } from '../engine/protocol';
import { settings } from '../config';
import { Decorations } from './decorations';
import { CommitReason, Problem, State } from './state';
import { CATEGORY_OBFUSCATED, FLAG_RENAMABLE, RefTuple, ZoneModel, changesBetween, insertedText, judge, newNameOf } from './zones';
import { t } from '../l10n';

const describe = (messages: ValidationMessage[]) => {
    return messages.map(message => message.text).join(' ');
};

const delay = (milliseconds: number) => {
    return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
};

/**
 * Turns decompiled classes into a constrained editor.
 */
export class EditorController implements vscode.Disposable {
    private readonly states = new Map<string, State>();
    private readonly decorations = new Decorations();
    private readonly disposables: vscode.Disposable[] = [];
    private lastRefusal = 0;
    private readonly saves = new Map<string, number[]>();

    constructor(
        private readonly backend: Backend,
        private readonly documents: EnigmaDocuments,
        private readonly editors: ClassEditors,
    ) {
        documents.isEditing = uri => this.states.get(uri.toString())?.session !== undefined;
        documents.settle = document => this.settle(document);

        this.disposables.push(
            documents.onDidLoadSource(event => this.setSource(event.uri, event.source)),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.scheme === SCHEME && event.contentChanges.length > 0) {
                    this.onChange(event.document);
                }
            }),
            vscode.workspace.onDidOpenTextDocument(document => {
                // a document restored with leftovers of an earlier session must not keep them
                const state = this.states.get(document.uri.toString());
                if (state) {
                    state.synced = document.getText() === state.expected;
                    void this.settle(document);
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                const state = this.states.get(document.uri.toString());
                if (state) {
                    this.endSession(state);
                    this.states.delete(document.uri.toString());
                    this.updateContext();
                }
            }),
            vscode.workspace.onWillSaveTextDocument(event => {
                // Saving a class stores nothing, but it is a way of saying "done": what the editor offers when a tab
                // with a name in it is closed, and what "Save All" does. Not when the editor saves by itself, which
                // it may do in the middle of a name.
                const session = event.reason === vscode.TextDocumentSaveReason.Manual ? this.stateOf(event.document)?.session : undefined;
                if (session && !session.busy) {
                    void this.commit(event.document, 'leave');
                }
            }),
            vscode.window.onDidChangeTextEditorSelection(event => this.onSelection(event)),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                // a name left behind in another tab is applied, like when moving the cursor away from it
                for (const state of this.states.values()) {
                    if (state.session && state.uri.toString() !== editor?.document.uri.toString()) {
                        const document = vscode.workspace.textDocuments.find(
                            candidate => candidate.uri.toString() === state.uri.toString(),
                        );
                        if (document) {
                            void this.commit(document, 'leave');
                        }
                    }
                }

                this.updateContext();
            }),
            vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(editor => this.decorate(editor))),
            // Also when a tab comes to the front. A class renamed back to a name it had gets the document of that name
            // again, which the editor may still have, with the very text it is to show: nothing changes then, and
            // nothing else would mark its names.
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.decorate(editor);
                    setTimeout(() => this.decorate(editor), 150);
                }
            }),
            vscode.commands.registerCommand('enigma.inlineRename.commit', () => this.commitActive('enter')),
            vscode.commands.registerCommand('enigma.inlineRename.cancel', () => this.cancelActive()),
            vscode.commands.registerCommand('enigma.inlineRename.start', () => this.selectNameAtCursor()),
        );
    }

    /** For the output channel at its "debug" level: what the editor did with an edit, and why. */
    private debug(document: vscode.TextDocument | vscode.Uri, message: string): void {
        const uri = document instanceof vscode.Uri ? document : document.uri;
        this.backend.output.debug(`[editor] ${uri.path.substring(uri.path.lastIndexOf('/') + 1)}: ${message}`);
    }

    private stateOf(document: vscode.TextDocument): State | undefined {
        return this.states.get(document.uri.toString());
    }

    private get enabled(): boolean {
        return settings.inlineRename;
    }

    private setSource(uri: vscode.Uri, source: SourceResult): void {
        const key = uri.toString();
        const previous = this.states.get(key);
        if (previous) {
            // whatever was being typed referred to the old text
            this.endSession(previous);
        }

        const editable = parseClassUri(uri)?.view === 'source' && this.enabled && !source.error;
        // without the "renamable" flag, names are still highlighted but cannot be typed over
        const refs = editable
            ? source.refs
            : source.refs.map((ref): RefTuple => [ref[0], ref[1], ref[2], ref[3], ref[4] & ~FLAG_RENAMABLE, ref[5]]);
        const model = new ZoneModel(source.text, refs, source.groups);
        const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === key);
        this.debug(uri, `source revision ${source.revision} loaded${previous?.session ? ', which ends the name being typed' : ''}`);
        this.states.set(key, {
            uri,
            model,
            parsed: model.original,
            expected: model.text,
            settling: previous?.settling ?? Promise.resolve(),
            // a document that is open still shows the previous text, until the editor reloads it
            synced: !document || document.getText() === model.text,
            awaitingSource: false,
        });
        this.updateContext();
        // the document gets the new text a moment later
        setTimeout(() => this.decorateUri(uri), 0);
    }

    private endSession(state: State): void {
        if (state.session) {
            clearTimeout(state.session.validation);
            state.session = undefined;
        }
    }

    private updateContext(): void {
        const active = vscode.window.activeTextEditor;
        const renaming = active !== undefined && this.stateOf(active.document)?.session !== undefined;
        void vscode.commands.executeCommand('setContext', 'enigma.renaming', renaming);
    }

    /** Whether a name is being typed in the active editor. */
    get renaming(): boolean {
        const active = vscode.window.activeTextEditor;
        return active !== undefined && this.stateOf(active.document)?.session !== undefined;
    }

    private onChange(document: vscode.TextDocument): void {
        const state = this.stateOf(document);
        if (!state) {
            return;
        }

        const text = document.getText();
        if (text === state.expected) {
            state.synced = true;
            // The names were last marked, or rather unmarked, when the document still had another text: marks for
            // one text mean nothing in another. Nothing else says that it has the right one now.
            this.decorateDocument(document);
            // an edit that was refused leaves the document marked as modified
            if (!state.session && !state.awaitingSource && document.isDirty) {
                void this.settle(document);
            }

            return;
        }

        if (state.awaitingSource) {
            return;
        }

        if (!state.synced) {
            // not typing: the document is on its way to the text it is supposed to have
            void this.settle(document);
            return;
        }

        const session = state.session;
        if (session?.busy) {
            // looked at again once the engine answered
            return;
        }

        const parsed = state.model.editable ? state.model.parse(text) : undefined;
        const verdict = judge(state.model, parsed);

        if (verdict.kind === 'unchanged') {
            // back to the engine's text, for example by undoing: nothing is being renamed any more
            this.endSession(state);
            state.parsed = state.model.original;
            state.expected = state.model.text;
            state.synced = true;
            this.updateContext();
            this.decorateDocument(document);
            void this.settle(document);
            return;
        }

        if (verdict.kind === 'invalid' || (session && session.group !== verdict.group)) {
            this.refuse(document, state);
            return;
        }

        state.parsed = parsed!;
        state.expected = text;

        const editor =
            vscode.window.visibleTextEditors.find(
                candidate => candidate.document === document && candidate === vscode.window.activeTextEditor,
            ) ?? vscode.window.visibleTextEditors.find(candidate => candidate.document === document);
        const cursorZone = editor ? state.model.zoneAt(state.parsed, document.offsetAt(editor.selection.active)) : -1;
        const primary =
            cursorZone >= 0 && state.model.zones[cursorZone].group === verdict.group && state.model.zones[cursorZone].inline
                ? cursorZone
                : session && verdict.zones.includes(session.primary)
                  ? session.primary
                  : verdict.zones[0];

        if (session) {
            session.primary = primary;
            session.problem = undefined;
        } else {
            const replacing = state.model.zones[primary].category === CATEGORY_OBFUSCATED && settings.replaceObfuscatedNames;
            state.session = {
                group: verdict.group,
                primary,
                busy: false,
                replacing,
                stripping: false,
                mirroring: false,
                mirrorFailures: 0,
                validationRequest: 0,
            };
            this.debug(
                document,
                `started renaming ${state.model.groups[verdict.group].name}${replacing ? ', replacing the obfuscated name' : ''}`,
            );
            this.updateContext();
        }

        this.stripOriginalName(document, state);
        this.mirror(document, state);
        this.scheduleValidation(document, state);
        this.decorateDocument(document);
    }

    /** Undoes a change that touched something other than the name being edited. */
    private refuse(document: vscode.TextDocument, state: State): void {
        this.debug(document, `refused an edit${state.session ? ' outside the name being typed' : ' outside of a name'}`);
        void this.replaceText(document, state.expected);
        const now = Date.now();
        if (now - this.lastRefusal > 4000) {
            this.lastRefusal = now;
            vscode.window.setStatusBarMessage(
                state.session
                    ? `$(edit) ${t('controller.finishTheNameYouAreEditing')}`
                    : `$(lock) ${t('controller.onlyTheHighlightedNamesCanBe')}`,
                3500,
            );
        }
    }

    private async replaceText(document: vscode.TextDocument, target: string): Promise<boolean> {
        const changes = changesBetween(this.stateOf(document)?.model, document.getText(), target).map(change => ({
            range: new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)),
            text: change.text,
        }));
        if (changes.length === 0) {
            return true;
        }

        const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document === document);
        if (editor) {
            // part of the user's own edit as far as undo is concerned; fails if the document changed in the meantime,
            // in which case the next change event brings us back here
            try {
                return await editor.edit(builder => changes.forEach(change => builder.replace(change.range, change.text)), {
                    undoStopBefore: false,
                    undoStopAfter: false,
                });
            } catch {
                // The editor is on its way out: a class that was renamed moves to a tab of its new name, and the one
                // it had is closed. Not through the document instead, which would leave unsaved changes in a
                // document nothing shows. Whoever asked tries again, and finds the document closed or shown elsewhere.
                return false;
            }
        }

        const edit = new vscode.WorkspaceEdit();
        changes.forEach(change => edit.replace(document.uri, change.range, change.text));
        return vscode.workspace.applyEdit(edit);
    }

    /**
     * Gives obfuscated names the behaviour of Enigma: what is typed on one replaces it, instead of being added to a
     * name nobody wants to keep any part of.
     *
     * Called after every change until the original name is gone. Until then, {@link typedName} leaves it out, so that
     * what is validated and applied never depends on how fast this catches up with the typing.
     */
    private stripOriginalName(document: vscode.TextDocument, state: State): void {
        const session = state.session;
        if (!session || !session.replacing || session.stripping || session.busy) {
            return;
        }

        const index = session.primary;
        const zone = state.model.zones[index];
        const start = state.parsed.starts[index];
        const end = state.parsed.ends[index];
        const current = document.getText().substring(start, end);
        const typed = insertedText(zone.text, current);
        if (typed === undefined) {
            // the original is not there as a whole any more: it was deleted or typed over
            session.replacing = false;
            return;
        }

        const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document === document);
        if (!editor) {
            return;
        }

        let at = 0;
        while (at < zone.text.length && zone.text[at] === current[at]) {
            at++;
        }

        session.stripping = true;
        const version = document.version;
        editor
            .edit(
                builder => {
                    // only what was not typed is removed, so that the cursor stays where it is
                    builder.delete(new vscode.Range(document.positionAt(start + at + typed.length), document.positionAt(end)));
                    builder.delete(new vscode.Range(document.positionAt(start), document.positionAt(start + at)));
                },
                { undoStopBefore: false, undoStopAfter: false },
            )
            .then(
                applied => {
                    session.stripping = false;
                    if (state.session !== session) {
                        return;
                    }

                    if (applied) {
                        session.replacing = false;
                        this.mirror(document, state);
                    } else if (document.version !== version) {
                        // something else was typed in the meantime; that is known here by now, so look again
                        this.stripOriginalName(document, state);
                    }
                },
                () => {
                    session.stripping = false;
                },
            );
    }

    /**
     * Makes the other occurrences of the name show what is being typed.
     *
     * The editor has a feature for this, linked editing, and it is deliberately not used: it tints the name under the
     * cursor at all times, which on top of the colours of this extension reads as another mapping state, and it only
     * learns which ranges belong together a moment after the cursor arrived, so that someone who clicks on a name
     * and types at once leaves the other occurrences behind.
     */
    private mirror(document: vscode.TextDocument, state: State): void {
        const session = state.session;
        // anything still on its way ends in another call of this
        if (!session || session.busy || session.stripping || session.mirroring || document.getText() !== state.expected) {
            return;
        }

        const text = state.expected;
        const { typed } = this.typedName(state, document);
        const behind = state.model
            .siblings(session.primary)
            .filter(index => index !== session.primary && text.substring(state.parsed.starts[index], state.parsed.ends[index]) !== typed)
            .map(index => new vscode.Range(document.positionAt(state.parsed.starts[index]), document.positionAt(state.parsed.ends[index])));
        const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document === document);
        if (behind.length === 0 || !editor || session.mirrorFailures > 25) {
            return;
        }

        session.mirroring = true;
        editor
            .edit(builder => behind.forEach(range => builder.replace(range, typed)), { undoStopBefore: false, undoStopAfter: false })
            .then(
                applied => {
                    session.mirroring = false;
                    session.mirrorFailures = applied ? 0 : session.mirrorFailures + 1;
                    if (state.session === session) {
                        // refused when another key was typed in the meantime, which is known here by now
                        this.mirror(document, state);
                    }
                },
                () => {
                    session.mirroring = false;
                },
            );
    }

    private onSelection(event: vscode.TextEditorSelectionChangeEvent): void {
        const document = event.textEditor.document;
        const state = this.stateOf(document);
        const session = state?.session;
        if (!state || !session || session.busy || event.textEditor !== vscode.window.activeTextEditor) {
            return;
        }

        // Selection and content events are not delivered in a fixed order: read the document rather than trust what
        // was known a moment ago.
        const parsed = state.model.parse(document.getText());
        if (!parsed) {
            return;
        }

        const zone = state.model.zoneAt(parsed, document.offsetAt(event.selections[0].active));
        if (zone >= 0 && state.model.zones[zone].group === session.group) {
            if (state.model.zones[zone].inline && session.primary !== zone) {
                session.primary = zone;
                this.decorate(event.textEditor);
            }

            return;
        }

        void this.commit(document, 'leave');
    }

    private typedName(state: State, document: vscode.TextDocument): { typed: string; newName: string } {
        const session = state.session!;
        const zone = state.model.zones[session.primary];
        const text = document.getText().substring(state.parsed.starts[session.primary], state.parsed.ends[session.primary]);
        const typed = session.replacing ? (insertedText(zone.text, text) ?? text) : text;
        return { typed, newName: newNameOf(zone, typed) };
    }

    private scheduleValidation(document: vscode.TextDocument, state: State): void {
        const session = state.session;
        if (!session) {
            return;
        }

        clearTimeout(session.validation);
        const request = ++session.validationRequest;
        session.validation = setTimeout(() => void this.validateTyped(document, state, session, request), 220);
    }

    /** Asks the engine whether the name being typed would do, and shows its answer next to it. */
    private async validateTyped(
        document: vscode.TextDocument,
        state: State,
        session: NonNullable<State['session']>,
        request: number,
    ): Promise<void> {
        if (state.session !== session || session.busy) {
            return;
        }

        const { typed, newName } = this.typedName(state, document);
        let problem: Problem | undefined;
        if (typed.length === 0) {
            problem = { severity: 'error', message: t('controller.theNameCannotBeEmpty') };
        } else {
            try {
                const result = await this.backend.request('entry/rename', {
                    entry: state.model.groups[session.group].entry,
                    newName,
                    validateOnly: true,
                });
                const errors = result.messages.filter(message => message.type === 'error');
                const warnings = result.messages.filter(message => message.type === 'warning');
                problem =
                    errors.length > 0
                        ? { severity: 'error', message: describe(errors) }
                        : warnings.length > 0
                          ? { severity: 'warning', message: describe(warnings) }
                          : undefined;
            } catch {
                // the commit will report it
            }
        }

        if (state.session === session && session.validationRequest === request) {
            session.problem = problem;
            this.decorateDocument(document);
        }
    }

    async commitActive(reason: CommitReason = 'enter'): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        return editor ? this.commit(editor.document, reason) : true;
    }

    async cancelActive(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await this.cancel(editor.document);
        }
    }

    /**
     * Applies the name that was typed.
     * @param reason on Enter, an invalid name stays in the editor to be fixed; when moving away, it is dropped
     * @returns whether nothing is being typed any more
     */
    async commit(document: vscode.TextDocument, reason: CommitReason): Promise<boolean> {
        const state = this.stateOf(document);
        const session = state?.session;
        if (!state || !session) {
            return true;
        }

        if (session.busy) {
            return false;
        }

        const zone = state.model.zones[session.primary];
        const { typed, newName } = this.typedName(state, document);
        this.debug(document, `applying "${typed}" for ${zone.text} (${reason})`);
        if (typed === zone.text) {
            await this.cancel(document);
            return true;
        }

        session.busy = true;
        session.problem = undefined;
        clearTimeout(session.validation);
        this.decorateDocument(document);
        const entry = state.model.groups[session.group].entry;

        const reject = async (problem: Problem): Promise<boolean> => {
            session.busy = false;
            this.debug(document, `not renamed: ${problem.message}`);
            if (state.session !== session) {
                return true;
            }

            if (reason === 'enter') {
                // keep the name in the editor, with the reason next to it, so that it can be corrected
                session.problem = problem;
                this.decorateDocument(document);
                if (document.getText() !== state.expected) {
                    // something was typed while the engine was asked
                    this.onChange(document);
                }

                return false;
            }

            await this.cancel(document);
            void vscode.window.showWarningMessage(t('controller.enigmaDidNotRenameTo', zone.text, typed, problem.message));
            return true;
        };

        try {
            if (typed.length === 0) {
                return await reject({ severity: 'error', message: t('controller.theNameCannotBeEmpty') });
            }

            const check = await this.backend.request('entry/rename', { entry, newName, validateOnly: true });
            const errors = check.messages.filter(message => message.type === 'error');
            if (errors.length > 0) {
                return await reject({ severity: 'error', message: describe(errors) });
            }

            const warnings = check.messages.filter(message => message.type === 'warning');
            if (warnings.length > 0) {
                const choice = await vscode.window.showWarningMessage(
                    describe(warnings),
                    { modal: true, detail: t('controller.renameToAnyway', zone.text, typed) },
                    t('common.rename'),
                );
                if (choice !== t('common.rename')) {
                    return await reject({ severity: 'warning', message: describe(warnings) });
                }
            }

            const result = await this.backend.request('entry/rename', { entry, newName, confirmWarnings: true });
            if (!result.applied) {
                return await reject({ severity: 'error', message: describe(result.messages) || t('controller.theEngineRejectedTheName') });
            }
        } catch (error) {
            return await reject({ severity: 'error', message: error instanceof Error ? error.message : String(error) });
        }

        // The engine has the name now and has re-mapped every open class. Tabs of a renamed class are being replaced;
        // this document then gets the engine's text, which is what was typed, plus the occurrences that had not followed.
        if (state.session === session) {
            this.endSession(state);
            state.awaitingSource = true;
            state.synced = false;
            this.updateContext();
            this.decorateDocument(document);
        }

        await this.editors.whenTabsMigrated();
        if (!document.isClosed) {
            await this.documents.refresh(document.uri);
            if (this.stateOf(document) === state && state.awaitingSource) {
                // the new text could not be loaded: go back to the one that is known
                state.awaitingSource = false;
                await this.cancel(document);
            }
        }

        return true;
    }

    /** Puts the original name back. */
    async cancel(document: vscode.TextDocument): Promise<void> {
        const state = this.stateOf(document);
        if (!state) {
            return;
        }

        this.debug(document, 'restoring the original name');
        this.endSession(state);
        state.expected = state.model.text;
        state.parsed = state.model.original;
        state.synced = document.getText() === state.expected;
        this.updateContext();
        await this.settle(document);
        this.decorateDocument(document);
    }

    /**
     * Makes a document identical to what it is supposed to contain, and marks it as having no unsaved changes when
     * nothing is being typed. Everything that can leave a document in another state ends up here.
     */
    settle(document: vscode.TextDocument): Promise<void> {
        const state = this.stateOf(document);
        if (!state || this.documents.isRetired(document.uri)) {
            return Promise.resolve();
        }

        state.settling = state.settling
            .then(async () => {
                for (let attempt = 0; attempt < 8 && !document.isClosed; attempt++) {
                    const current = this.stateOf(document);
                    if (!current || current.awaitingSource || this.documents.isRetired(document.uri)) {
                        return;
                    }

                    const target = current.session ? current.expected : current.model.text;
                    if (document.getText() !== target) {
                        // Name by name, which leaves cursors where they are. The editor would bring an unmodified file
                        // in line by itself, but by replacing all the lines from the first to the last that differ at
                        // once: a cursor among them ends up behind them, off the name that was just renamed from a pane.
                        // Where there is no cursor, in a document nobody looks at, the editor is left to do it: that
                        // does not make the document one with unsaved changes, which nothing shown could save again.
                        if (!document.isDirty && !vscode.window.visibleTextEditors.some(candidate => candidate.document === document)) {
                            for (let waited = 0; waited < 12 && document.getText() !== target && !document.isDirty; waited++) {
                                await delay(15);
                            }

                            if (this.stateOf(document) !== current || document.getText() === target) {
                                continue;
                            }
                        }

                        const replaced = await this.replaceText(document, target);
                        this.debug(
                            document,
                            `text brought in line with ${current.session ? 'the name being typed' : 'the engine'}: ${replaced ? 'done' : 'not accepted, trying again'}`,
                        );
                        continue;
                    }

                    if (!current.synced) {
                        current.synced = true;
                        this.decorateDocument(document);
                    }

                    if (!current.session && document.isDirty) {
                        if (!this.maySave(document)) {
                            return;
                        }

                        const saved = await document.save();
                        this.debug(document, `marked as unmodified: ${saved}`);
                        continue;
                    }

                    return;
                }
            })
            .catch(error => this.backend.output.warn(`Could not synchronize ${document.uri.path}: ${error}`));
        return state.settling;
    }

    /** Something that edits documents whenever they are saved would otherwise keep {@link settle} going forever. */
    private maySave(document: vscode.TextDocument): boolean {
        const now = Date.now();
        const key = document.uri.toString();
        const recent = (this.saves.get(key) ?? []).filter(time => now - time < 3000);
        recent.push(now);
        this.saves.set(key, recent);
        return recent.length <= 8;
    }

    /** Selects the name under the cursor, so that typing replaces it: what Enter does on a name. */
    private selectNameAtCursor(): void {
        const editor = vscode.window.activeTextEditor;
        const state = editor && this.stateOf(editor.document);
        if (!editor || !state || state.session) {
            return;
        }

        const zone = state.model.zoneAt(state.parsed, editor.document.offsetAt(editor.selection.active));
        if (zone >= 0 && state.model.zones[zone].inline) {
            editor.selection = new vscode.Selection(
                editor.document.positionAt(state.parsed.starts[zone]),
                editor.document.positionAt(state.parsed.ends[zone]),
            );
        }
    }

    /** Whether a document shows what the engine says, which is when its names are marked and can be typed over. */
    inSync(document: vscode.TextDocument): boolean {
        const state = this.stateOf(document);
        return !!state && state.synced && document.getText() === state.expected;
    }

    private decorateUri(uri: vscode.Uri): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) {
                this.decorate(editor);
            }
        }
    }

    private decorateDocument(document: vscode.TextDocument): void {
        this.decorateUri(document.uri);
    }

    private decorate(editor: vscode.TextEditor): void {
        if (editor.document.uri.scheme === SCHEME) {
            this.decorations.apply(editor, this.stateOf(editor.document));
        }
    }

    dispose(): void {
        for (const state of this.states.values()) {
            this.endSession(state);
        }

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.decorations.dispose();
    }
}
