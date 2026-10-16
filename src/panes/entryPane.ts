import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { SCHEME } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { EntryInfo, EntryRef, TokenInfo } from '../engine/protocol';
import { Editing } from '../project/editing';
import { describeEntry } from './entryDescription';
import { EntryAction, EntryField, FromEntryPage, PaneEntry, Problem, ToEntryPage } from './messages';
import { page, problemOf, webviewOptions } from './webview';
import { t } from '../l10n';

/** The command behind each of the buttons that lead on from an entry. */
const ACTION_COMMANDS: Record<EntryAction, string> = {
    declaration: 'enigma.navigateTo', inheritance: 'enigma.showInheritance', implementations: 'enigma.showImplementations', calls: 'enigma.showCalls',
};

/**
 * The "Identifier" pane: Enigma's identifier panel and javadoc dialog in one place. It follows the cursor, and lets
 * the name and the javadoc of the entry under it be edited.
 */
export class EntryPane implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'enigma.entry';

    private view?: vscode.WebviewView;
    private current?: { info: EntryInfo | TokenInfo; pane: PaneEntry };
    /** The web view has unsaved edits, and keeps showing the entry they belong to. */
    private dirty = false;
    private timer?: NodeJS.Timeout;
    private request = 0;
    private pendingFocus?: EntryField;
    private pageReady = false;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly backend: Backend,
        private readonly documents: EnigmaDocuments,
        private readonly editing: Editing,
        private readonly isOpen: () => boolean,
    ) {
        this.disposables.push(
            vscode.window.registerWebviewViewProvider(EntryPane.viewId, this, { webviewOptions: { retainContextWhenHidden: true } }),
            vscode.window.onDidChangeTextEditorSelection(event => {
                if (event.textEditor === vscode.window.activeTextEditor && event.textEditor.document.uri.scheme === SCHEME) {
                    this.schedule();
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor?.document.uri.scheme === SCHEME) {
                    this.schedule();
                }
            }),
            backend.onDidChangeMappings(() => void this.refresh()),
            backend.onDidChangeProject(() => this.show(undefined)),
            backend.onDidExit(() => this.show(undefined)),
        );
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        this.pageReady = false;
        view.webview.options = webviewOptions(this.extensionUri);
        view.webview.html = page(view.webview, this.extensionUri, 'entry', t('entryPane.identifier'));
        view.webview.onDidReceiveMessage((message: FromEntryPage) => void this.onMessage(message), undefined, this.disposables);
        view.onDidDispose(() => {
            this.view = undefined;
            this.dirty = false;
        }, undefined, this.disposables);
    }

    private post(message: ToEntryPage): void {
        void this.view?.webview.postMessage(message);
    }

    private send(): void {
        this.post({
            type: 'entry',
            entry: this.current?.pane ?? null,
            empty: this.isOpen()
                ? { title: t('common.noNameSelected'), detail: t('common.placeTheCursorOnAHighlighted') }
                : { title: t('common.noJarIsOpen'), detail: t('entryPane.openAJarToStartNaming') },
        });
    }

    private show(info: EntryInfo | TokenInfo | undefined): void {
        this.current = info ? { info, pane: describeEntry(info) } : undefined;
        this.send();
    }

    /** The entry on display. */
    get entry(): PaneEntry | undefined {
        return this.current?.pane;
    }

    private schedule(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.followCursor(), 90);
    }

    private async followCursor(): Promise<void> {
        const request = ++this.request;
        try {
            const cursor = await this.documents.tokenAtCursor();
            // while a name is being typed in the editor, keep showing what was there
            const editor = vscode.window.activeTextEditor;
            if (request !== this.request || (editor && this.documents.isEditing(editor.document.uri))) {
                return;
            }

            this.show(cursor?.token);
        } catch {
            // the class may have just been closed
        }
    }

    /** Shows an entry that was picked somewhere else than in the editor, for example in a tree. */
    async showEntry(entry: EntryRef): Promise<void> {
        const request = ++this.request;
        const info = await this.backend.request('entry/info', { entry });
        if (request === this.request) {
            this.show(info);
        }
    }

    /** Loads the entry on display again, after mappings changed. */
    private async refresh(): Promise<void> {
        const current = this.current;
        if (!current || !this.isOpen()) {
            return;
        }

        try {
            const info = await this.backend.request('entry/info', { entry: current.info.entry });
            if (this.current === current) {
                // what was known from the token (its text, whether it can be renamed from there) stays valid
                this.show({ ...current.info, ...info, renamable: current.info.renamable && info.renamable });
            }
        } catch {
            // gone with the project
        }
    }

    /** Whether the page of the pane came up: it says so once it runs. */
    get loaded(): boolean {
        return this.pageReady;
    }

    /** Whether the pane can be seen. */
    get visible(): boolean {
        return this.view?.visible ?? false;
    }

    /**
     * Makes the pane visible without taking the keyboard away from where it is.
     * @returns false if that is not possible yet: a pane that was never shown can only be opened by focusing it
     */
    reveal(): boolean {
        if (!this.view) {
            return false;
        }

        this.view.show(true);
        return true;
    }

    /** Brings the pane up with the cursor in one of its fields: what "Edit Javadoc" and "Rename" lead to. */
    async focus(field: EntryField): Promise<void> {
        if (!this.dirty) {
            clearTimeout(this.timer);
            await this.followCursor();
        }

        this.pendingFocus = field;
        await vscode.commands.executeCommand(`${EntryPane.viewId}.focus`);
        // if the view was just created, the message is sent once it reports being ready
        if (this.view) {
            this.post({ type: 'focus', field });
            this.pendingFocus = undefined;
        }
    }

    /** Handles a message of the web view. Public so that tests can act as the web view. */
    async onMessage(message: FromEntryPage): Promise<void> {
        if (message.type === 'ready') {
            this.pageReady = true;
            this.send();
            if (this.pendingFocus) {
                this.post({ type: 'focus', field: this.pendingFocus });
                this.pendingFocus = undefined;
            }

            return;
        }

        if (message.type === 'dirty') {
            this.dirty = message.dirty;
            return;
        }

        if (message.type === 'copy') {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.setStatusBarMessage(t('entryPane.copied'), 2000);
            return;
        }

        const current = this.current;
        if (!current || message.key !== current.pane.key) {
            return;
        }

        const info = current.info;
        switch (message.type) {
            case 'validate': {
                let problem: Problem | null = null;
                try {
                    const result = await this.backend.request('entry/rename', { entry: info.renameEntry, newName: message.name, validateOnly: true });
                    const errors = result.messages.filter(candidate => candidate.type === 'error');
                    const warnings = result.messages.filter(candidate => candidate.type === 'warning');
                    problem = message.name.length === 0 ? { severity: 'error', message: t('common.theNameCannotBeEmpty') }
                        : errors.length > 0 ? { severity: 'error', message: errors.map(candidate => candidate.text).join(' ') }
                            : warnings.length > 0 ? { severity: 'warning', message: warnings.map(candidate => candidate.text).join(' ') } : null;
                } catch (error) {
                    problem = problemOf(error);
                }

                this.post({ type: 'validation', key: message.key, request: message.request, problem });
                break;
            }

            case 'rename':
                try {
                    // warnings are asked about; declining leaves the name as it was typed, to be changed or given up
                    const applied = await this.editing.rename(info.renameEntry, message.name);
                    this.post({ type: 'renameResult', key: message.key, problem: applied ? null : { severity: 'warning', message: t('entryPane.notRenamed') } });
                } catch (error) {
                    this.post({ type: 'renameResult', key: message.key, problem: problemOf(error) });
                }

                break;
            case 'saveJavadoc':
                try {
                    const applied = await this.editing.setJavadoc(info.entry, message.text);
                    this.post({ type: 'javadocResult', key: message.key, problem: applied ? null : { severity: 'warning', message: t('entryPane.notSaved') } });
                } catch (error) {
                    this.post({ type: 'javadocResult', key: message.key, problem: problemOf(error) });
                }

                break;
            case 'toggle':
                try {
                    await this.editing.toggleMapping(info.renameEntry);
                } catch (error) {
                    void vscode.window.showErrorMessage(`Enigma: ${problemOf(error).message}`);
                }

                break;
            case 'action': {
                await vscode.commands.executeCommand(ACTION_COMMANDS[message.id], info.entry);
                break;
            }
        }
    }

    dispose(): void {
        clearTimeout(this.timer);
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
