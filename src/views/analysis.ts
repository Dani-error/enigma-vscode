import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { treeIcon } from '../kinds';
import { t } from '../l10n';
import { EntryRef, TreeNodeResult, TreeRoot } from '../engine/protocol';

export type AnalysisMode = 'inheritance' | 'implementations' | 'calls' | 'callsSpecific';

/** What the view says it shows, and what is said when there is nothing to show. */
const describe = (mode: AnalysisMode, name: string): { title: string; nothing: string } => ({
    inheritance: { title: t('analysis.inheritanceOf', name), nothing: t('analysis.inheritanceOfNothingInheritsFromIt', name) },
    implementations: { title: t('analysis.implementationsOf', name), nothing: t('analysis.implementationsOfNothingInTheJar', name) },
    calls: { title: t('analysis.callsOf', name), nothing: t('analysis.callsOfNothingInTheJar', name) },
    callsSpecific: { title: t('analysis.callsOfThisMethodOnlyOf', name), nothing: t('analysis.callsOfNothingInTheJar', name) },
})[mode];

/**
 * Shows the result of "Show Inheritance", "Show Implementations" and "Show Calls", like the matching Enigma dockers.
 */
export class AnalysisProvider implements vscode.TreeDataProvider<TreeNodeResult>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<TreeNodeResult | undefined>();
    private readonly parents = new Map<TreeNodeResult, TreeNodeResult>();
    private root?: TreeNodeResult;
    /** What the tree is about, so that it can be shown in another way or brought up to date. */
    subject?: { entry: EntryRef; name: string; mode: AnalysisMode };

    readonly onDidChangeTreeData = this.emitter.event;

    get title(): string {
        return this.subject ? { inheritance: t('common.inheritance'), implementations: t('common.implementations'), calls: t('common.calls'), callsSpecific: t('analysis.callsOfThisMethodOnly') }[this.subject.mode] : '';
    }

    show(subject: { entry: EntryRef; name: string; mode: AnalysisMode } | undefined, root: TreeNodeResult | undefined): void {
        this.subject = subject;
        this.root = root;
        this.parents.clear();
        const link = (node: TreeNodeResult) => node.children.forEach(child => {
            this.parents.set(child, node);
            link(child);
        });
        if (root) {
            link(root);
        }

        void vscode.commands.executeCommand('setContext', 'enigma.analysis.mode', subject?.mode ?? '');
        this.emitter.fire(undefined);
    }

    clear(): void {
        this.show(undefined, undefined);
    }

    /** The node of the entry the tree was requested for. */
    get selected(): TreeNodeResult | undefined {
        const find = (node: TreeNodeResult): TreeNodeResult | undefined => node.selected ? node : node.children.map(find).find(Boolean);
        return this.root ? find(this.root) : undefined;
    }

    getChildren(element?: TreeNodeResult): TreeNodeResult[] {
        return element ? element.children : this.root ? [this.root] : [];
    }

    getParent(element: TreeNodeResult): TreeNodeResult | undefined {
        return this.parents.get(element);
    }

    getTreeItem(element: TreeNodeResult): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label.replace(/\//g, '.'), element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.iconPath = treeIcon(element.kind);
        const notes: string[] = [];
        if (element.implemented === false) {
            notes.push('inherited');
        }

        if (element.selected) {
            notes.push('this');
        }

        item.description = notes.join(' · ') || undefined;
        if (element.entry && element.navigable !== false) {
            item.command = { command: 'enigma.navigateTo', title: 'Go To', arguments: [element.entry, element.context ?? undefined] };
        }

        return item;
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

/** What the engine is asked for each way of looking at an entry. */
const REQUESTS: Record<AnalysisMode, { method: 'hierarchy/inheritance' | 'hierarchy/implementations' | 'calls'; params: { recursive?: boolean } }> = {
    inheritance: { method: 'hierarchy/inheritance', params: {} },
    implementations: { method: 'hierarchy/implementations', params: {} },
    calls: { method: 'calls', params: { recursive: true } },
    callsSpecific: { method: 'calls', params: { recursive: false } },
};

/**
 * The "Inheritance and Calls" view: asks the engine for one of its trees about an entry, shows it, and keeps it
 * current while names change.
 */
export class AnalysisView implements vscode.Disposable {
    readonly provider = new AnalysisProvider();
    readonly view = vscode.window.createTreeView('enigma.analysis', { treeDataProvider: this.provider, showCollapseAll: true });
    private readonly disposables: vscode.Disposable[] = [this.provider, this.view];

    constructor(private readonly backend: Backend) {
        // trees are computed from the names at the time; keep the one on display current
        this.disposables.push(backend.onDidChangeMappings(() => void this.refresh()));
    }

    private request(mode: AnalysisMode, entry: EntryRef): Promise<TreeRoot> {
        return this.backend.request(REQUESTS[mode].method, { entry, ...REQUESTS[mode].params });
    }

    /**
     * Shows a tree about an entry.
     * @param mode
     * @param entry
     * @param name
     * @param reveal whether to bring the view up, with the entry selected in it
     * @returns whether there was anything to show
     */
    async show(mode: AnalysisMode, entry: EntryRef, name: string, reveal = true): Promise<boolean> {
        const result = await this.request(mode, entry);
        if (!result.root) {
            void vscode.window.showInformationMessage(describe(mode, name).nothing);
            return false;
        }

        this.provider.show({ entry, name, mode }, result.root);
        this.view.description = describe(mode, name).title;
        if (reveal) {
            await vscode.commands.executeCommand('enigma.analysis.focus');
            const selected = this.provider.selected;
            if (selected) {
                await this.view.reveal(selected, { select: true, focus: false }).then(undefined, () => undefined);
            }
        }

        return true;
    }

    /**
     * Looks at the entry on display in another way: what the buttons of the view do.
     * @returns false if nothing is on display
     */
    async switchTo(mode: AnalysisMode): Promise<boolean> {
        const subject = this.provider.subject;
        if (subject) {
            await this.show(mode, subject.entry, subject.name, false);
        }

        return subject !== undefined;
    }

    clear(): void {
        this.provider.clear();
        this.view.description = undefined;
    }

    private async refresh(): Promise<void> {
        const subject = this.provider.subject;
        if (!subject || !this.view.visible) {
            return;
        }

        try {
            const result = await this.request(subject.mode, subject.entry);
            if (this.provider.subject === subject && result.root) {
                this.provider.show(subject, result.root);
            }
        } catch {
            // the project may be closing
        }
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
