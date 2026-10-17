import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassItem, EntryRef, LocationResult, MappingsChangedParams, View } from '../engine/protocol';
import { ClassIndex } from './classIndex';
import { SCHEME, parseClassUri } from './classUri';
import { EnigmaDocuments } from './documents';

/**
 * The editors that show classes: opening them, and keeping their tabs in step with the names of the classes.
 */
export class ClassEditors implements vscode.Disposable {
    private migrating = Promise.resolve();
    private readonly subscriptions: vscode.Disposable[];
    /** Whether all mappings changed, and the tabs follow once the classes have their new names. */
    private changedAll = false;
    /** How many projects are being opened, during which tabs keep their names (see whileOpening). */
    private opening = 0;

    constructor(
        private readonly backend: Backend,
        private readonly index: ClassIndex,
        private readonly documents: EnigmaDocuments,
    ) {
        this.subscriptions = [
            backend.onDidChangeMappings(params => this.onMappingsChanged(params)),
            index.onDidChange(() => this.onIndexChanged()),
        ];
    }

    /** Opens a class, optionally at a token. */
    async show(result: LocationResult, options: { preview?: boolean; preserveFocus?: boolean } = {}): Promise<vscode.TextEditor> {
        const location = this.index.location(result);
        return vscode.window.showTextDocument(location.uri, {
            selection: result.range ? location.range : undefined,
            preview: options.preview ?? true,
            preserveFocus: options.preserveFocus,
        });
    }

    async openClass(
        obf: string,
        view: View = 'source',
        options: { preview?: boolean; viewColumn?: vscode.ViewColumn; preserveFocus?: boolean } = {},
    ): Promise<vscode.TextEditor> {
        this.documents.revive(this.index.uri(obf, view));
        return vscode.window.showTextDocument(this.index.uri(obf, view), {
            preview: options.preview ?? true,
            viewColumn: options.viewColumn,
            preserveFocus: options.preserveFocus,
        });
    }

    /** The classes that are open in tabs, in the order of the tabs. */
    openTabs(): { class: string; view: View; column: vscode.ViewColumn; active: boolean }[] {
        return vscode.window.tabGroups.all.flatMap(group =>
            group.tabs.flatMap(tab => {
                const parsed = tab.input instanceof vscode.TabInputText ? parseClassUri(tab.input.uri) : undefined;
                return parsed ? [{ ...parsed, column: group.viewColumn, active: tab.isActive && group.isActive }] : [];
            }),
        );
    }

    /**
     * Navigates to the declaration of an entry, or to one of its references when {@code context} is given.
     * @returns whether there was somewhere to go
     */
    async navigate(entry: EntryRef, context?: EntryRef | null, view: View = 'source'): Promise<boolean> {
        const location = await this.backend.request('nav/reference', { entry, context: context ?? undefined, view });
        if (!location) {
            return false;
        }

        await this.show(location);
        return true;
    }

    private onMappingsChanged(params: MappingsChangedParams): void {
        if (params.full) {
            // as when other mappings were opened, here or by the host of a session: which classes changed is not said
            this.changedAll = true;
        } else if (params.classes.length > 0) {
            this.migrate(params.classes);
        }
    }

    /** After all mappings changed, the classes have their new names here: every open one may have another. */
    private onIndexChanged(): void {
        if (!this.changedAll || this.opening > 0) {
            return;
        }

        this.changedAll = false;
        const open = [...new Set(this.openTabs().map(tab => tab.class))];
        const classes = open.map(obf => this.index.get(obf)).filter((item): item is ClassItem => item !== undefined);
        if (classes.length > 0) {
            this.migrate(classes);
        }
    }

    /**
     * Leaves tabs as they are while a project opens: its jar first, its mappings a moment later, which can be a while
     * on a large jar. Tabs follow once both are there, rather than show the names of the jar alone in between.
     */
    async whileOpening<T>(action: () => Promise<T>): Promise<T> {
        this.opening++;
        try {
            return await action();
        } finally {
            this.opening--;
            if (this.opening === 0 && this.changedAll) {
                await this.index.loaded();
                this.onIndexChanged();
            }
        }
    }

    private migrate(classes: ClassItem[]): void {
        // one at a time: each migration opens and closes editors
        this.migrating = this.migrating
            .then(() => this.migrateTabs(classes))
            .catch(error => {
                this.backend.output.warn(`Failed to update editor tabs: ${error}`);
            });
    }

    /** Resolves when tabs have caught up with the classes that were renamed. */
    whenTabsMigrated(): Promise<void> {
        return this.migrating;
    }

    private async closeTab(tab: vscode.Tab): Promise<void> {
        if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri.toString();
            // nothing changes it anymore, or it would have changes again by the time it is closed
            this.documents.retire(tab.input.uri);
            // nor while it is closed: an edit that arrives after it was is refused, and logged as an error
            await this.documents.editsDone(tab.input.uri);
            const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri);
            // A tab with unsaved changes would ask whether to save them; there is nothing to save in a generated text.
            // Until it has none, which only a save says: changed while it is being saved, as by the save that follows
            // a name typed in the code, a document stays modified, although the extension host takes it for unmodified.
            for (let attempt = 0; document && !document.isClosed && !this.documents.isReadOnly(document.uri) && attempt < 25; attempt++) {
                if (await document.save()) {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 40));
            }
        }

        // The tab as it is now: some versions of VS Code, such as 1.106, replace tabs and their groups by others whenever
        // one changes, and closing one that was replaced never finishes.
        const uri = tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : undefined;
        const live = vscode.window.tabGroups.all
            .filter(group => group.viewColumn === tab.group.viewColumn)
            .flatMap(group => group.tabs)
            .find(
                candidate =>
                    candidate === tab || (candidate.input instanceof vscode.TabInputText && candidate.input.uri.toString() === uri),
            );
        if (live) {
            await vscode.window.tabGroups.close(live, true);
        }
    }

    /**
     * A tab shows the name its address ends with. When a class is renamed, tabs showing it are replaced by ones with
     * the new name, keeping their place and selection.
     */
    private async migrateTabs(classes: ClassItem[]): Promise<void> {
        const renamed = new Map(classes.map(item => [item.obf, item]));
        const activeGroup = vscode.window.tabGroups.activeTabGroup;

        for (const group of vscode.window.tabGroups.all) {
            const originallyActive = group.activeTab;
            let switchedAway = false;

            for (const tab of [...group.tabs]) {
                if (!(tab.input instanceof vscode.TabInputText)) {
                    continue;
                }

                const oldUri = tab.input.uri;
                const parsed = parseClassUri(oldUri);
                const item = parsed && renamed.get(parsed.class);
                if (!parsed || !item) {
                    continue;
                }

                const newUri = this.index.uri(item.obf, parsed.view, item.deobf);
                if (newUri.toString() === oldUri.toString()) {
                    continue;
                }

                const editor = vscode.window.visibleTextEditors.find(
                    candidate => candidate.document.uri.toString() === oldUri.toString() && candidate.viewColumn === group.viewColumn,
                );
                this.documents.revive(newUri);
                await vscode.window.showTextDocument(newUri, {
                    viewColumn: group.viewColumn,
                    preview: tab.isPreview && tab.isActive,
                    preserveFocus: !(tab.isActive && group === activeGroup),
                    selection: editor?.selection,
                });
                switchedAway = switchedAway || tab !== originallyActive;

                const stale = group.tabs.find(
                    candidate => candidate.input instanceof vscode.TabInputText && candidate.input.uri.toString() === oldUri.toString(),
                );
                if (stale) {
                    await this.closeTab(stale);
                }
            }

            // Opening the replacement of a background tab brought it to the front: put back the tab the user was looking at.
            if (switchedAway && originallyActive?.input instanceof vscode.TabInputText) {
                const parsed = parseClassUri(originallyActive.input.uri);
                const item = parsed && renamed.get(parsed.class);
                const uri = parsed && item ? this.index.uri(item.obf, parsed.view, item.deobf) : originallyActive.input.uri;
                await vscode.window.showTextDocument(uri, {
                    viewColumn: group.viewColumn,
                    preview: false,
                    preserveFocus: group !== activeGroup,
                });
            }
        }
    }

    /** Closes every editor showing a class, when the jar is closed. */
    async closeAll(): Promise<void> {
        const tabs = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === SCHEME);
        for (const tab of tabs) {
            await this.closeTab(tab);
        }

        this.documents.forgetAll();
    }

    dispose(): void {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
    }
}
