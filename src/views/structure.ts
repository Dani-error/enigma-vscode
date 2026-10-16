import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { SCHEME, parseClassUri } from '../documents/classUri';
import { treeIcon } from '../kinds';
import { t } from '../l10n';
import { TreeNodeResult } from '../engine/protocol';

export interface StructureOptions {
    obfuscation: 'all' | 'obfuscated' | 'deobfuscated';
    documentation: 'all' | 'documented' | 'non_documented';
    sorting: 'default' | 'a_z' | 'z_a';
}

/** Every value of every option: each is an entry in the menu of the view. */
export const STRUCTURE_OPTIONS: { [K in keyof StructureOptions]: StructureOptions[K][] } = {
    obfuscation: ['all', 'obfuscated', 'deobfuscated'],
    documentation: ['all', 'documented', 'non_documented'],
    sorting: ['default', 'a_z', 'z_a'],
};

/**
 * Enigma's structure docker: the members of the class in the active editor, with its filters.
 */
export class StructureProvider implements vscode.TreeDataProvider<TreeNodeResult>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<TreeNodeResult | undefined>();
    private readonly disposables: vscode.Disposable[] = [];
    private root?: TreeNodeResult;
    private readonly parents = new Map<TreeNodeResult, TreeNodeResult>();
    private current?: string;
    private request = 0;
    readonly options: StructureOptions = { obfuscation: 'all', documentation: 'all', sorting: 'default' };

    readonly onDidChangeTreeData = this.emitter.event;
    /** The view this is shown in. */
    readonly view: vscode.TreeView<TreeNodeResult>;

    constructor(private readonly backend: Backend, private readonly isOpen: () => boolean) {
        this.view = vscode.window.createTreeView('enigma.structure', { treeDataProvider: this, showCollapseAll: true });
        this.disposables.push(
            this.view,
            // next to the title of the view: the class, and the filters that hide something
            this.onDidChangeTreeData(() => {
                this.view.description = this.description;
            }),
            vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
            backend.onDidChangeMappings(() => void this.refresh()),
            backend.onDidChangeProject(() => void this.refresh()),
        );
        this.publishOptions();
        void this.refresh();
    }

    /** Makes the options known to the menus of the view, which show them as checked. */
    private publishOptions(): void {
        for (const [key, value] of Object.entries(this.options)) {
            void vscode.commands.executeCommand('setContext', `enigma.structure.${key}`, value);
        }
    }

    async setOption<K extends keyof StructureOptions>(key: K, value: StructureOptions[K]): Promise<void> {
        this.options[key] = value;
        this.publishOptions();
        await this.refresh();
    }

    /** A summary of the filters that hide something, shown next to the title of the view. */
    get description(): string | undefined {
        const active: string[] = [];
        if (this.options.obfuscation !== 'all') {
            active.push(this.options.obfuscation === 'obfuscated' ? t('structure.obfuscatedOnly') : t('structure.deobfuscatedOnly'));
        }

        if (this.options.documentation !== 'all') {
            active.push(this.options.documentation === 'documented' ? t('structure.documentedOnly') : t('structure.undocumentedOnly'));
        }

        if (this.options.sorting !== 'default') {
            active.push(this.options.sorting === 'a_z' ? 'A–Z' : 'Z–A');
        }

        const name = this.root?.label;
        return [name, ...active].filter(Boolean).join(' · ') || undefined;
    }

    async refresh(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const parsed = editor && editor.document.uri.scheme === SCHEME ? parseClassUri(editor.document.uri) : undefined;
        if (!parsed) {
            // keep showing the last class while the focus is elsewhere, unless the project is gone
            if (!this.isOpen() && this.root) {
                this.root = undefined;
                this.current = undefined;
                this.emitter.fire(undefined);
            }

            return;
        }

        const request = ++this.request;
        try {
            const root = await this.backend.request('structure', { class: parsed.class, ...this.options });
            if (request === this.request) {
                this.root = root;
                this.current = parsed.class;
                this.parents.clear();
                const remember = (node: TreeNodeResult) => node.children.forEach(child => {
                    // the class itself is not shown: its members are the top of the tree
                    if (node !== root) {
                        this.parents.set(child, node);
                    }

                    remember(child);
                });
                remember(root);
                this.emitter.fire(undefined);
            }
        } catch {
            // the class may be gone; leave the view as it is
        }
    }

    get currentClass(): string | undefined {
        return this.current;
    }

    getChildren(element?: TreeNodeResult): TreeNodeResult[] {
        return element ? element.children : this.root?.children ?? [];
    }

    /** Needed to reveal a member, which is how the view is brought up without taking the keyboard. */
    getParent(element: TreeNodeResult): TreeNodeResult | undefined {
        return this.parents.get(element);
    }

    getTreeItem(element: TreeNodeResult): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.description = element.modifiers || undefined;
        // Enigma's icons have colours of their own: whether a member is mapped is in its tooltip, and in the code
        item.iconPath = treeIcon(element.kind);
        item.tooltip = `${element.modifiers ? `${element.modifiers} ` : ''}${element.label}\n${element.tokenType === 'obfuscated' ? t('common.notMapped') : element.tokenType === 'deobfuscated' ? t('common.mapped') : t('common.proposed')}`;
        if (element.entry) {
            item.command = { command: 'enigma.navigateTo', title: t('entryDescription.goToTheDeclaration'), arguments: [element.entry] };
        }

        return item;
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.emitter.dispose();
    }
}
