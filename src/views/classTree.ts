import * as vscode from 'vscode';
import { ClassIndex } from '../documents/classIndex';
import { classIcon, themeIcon } from '../kinds';
import { t } from '../l10n';
import { ClassDecorations } from './classDecorations';
import { ClassItem } from '../engine/protocol';
import { settings } from '../config';

export type ClassTreeMode = 'obfuscated' | 'deobfuscated' | 'all';

export interface PackageNode {
    type: 'package';
    /** Full name of the package, with slashes. */
    name: string;
    /** What is displayed: the last part of the name, or several parts when packages in between hold nothing else. */
    label: string;
    parent?: PackageNode;
    packages: Map<string, PackageNode>;
    classes: ClassItem[];
}

export interface ClassNode {
    type: 'class';
    item: ClassItem;
    parent?: PackageNode;
}

export type ClassTreeNode = PackageNode | ClassNode;

const simpleName = (name: string) => {
    return name.substring(name.lastIndexOf('/') + 1);
}

/**
 * One of Enigma's class dockers: obfuscated, deobfuscated or all classes, nested by package.
 */
export class ClassTreeProvider implements vscode.TreeDataProvider<ClassTreeNode>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<ClassTreeNode | undefined>();
    private readonly disposables: vscode.Disposable[] = [];
    private root: PackageNode = { type: 'package', name: '', label: '', packages: new Map(), classes: [] };
    private nodes = new Map<string, ClassNode>();
    /** Mapped and mappable entries per class, when statistics were generated. */
    private stats: Record<string, [number, number]> = {};

    readonly onDidChangeTreeData = this.emitter.event;

    /**
     * @param mode
     * @param index
     * @param icons the folder of the pictures of classes
     */
    constructor(private readonly mode: ClassTreeMode, private readonly index: ClassIndex, private readonly icons: vscode.Uri) {
        this.disposables.push(
            index.onDidChange(() => this.rebuild()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('enigma.classTree')) {
                    this.rebuild();
                }
            }),
        );
        this.rebuild();
    }

    setStats(stats: Record<string, [number, number]>): void {
        this.stats = stats;
        this.emitter.fire(undefined);
    }

    private rebuild(): void {
        const root: PackageNode = { type: 'package', name: '', label: '', packages: new Map(), classes: [] };
        const nodes = new Map<string, ClassNode>();
        for (const item of this.index.all) {
            if ((this.mode === 'obfuscated' && !item.obfuscated) || (this.mode === 'deobfuscated' && item.obfuscated)) {
                continue;
            }

            const segments = item.deobf.split('/');
            segments.pop();
            let parent = root;
            let path = '';
            for (const segment of segments) {
                path = path ? `${path}/${segment}` : segment;
                let next = parent.packages.get(segment);
                if (!next) {
                    next = { type: 'package', name: path, label: segment, parent: parent === root ? undefined : parent, packages: new Map(), classes: [] };
                    parent.packages.set(segment, next);
                }

                parent = next;
            }

            parent.classes.push(item);
            nodes.set(item.obf, { type: 'class', item, parent: parent === root ? undefined : parent });
        }

        if (settings.compactPackages) {
            this.compact(root);
            for (const node of nodes.values()) {
                // parents may have been merged away
                node.parent = this.owner(root, node.item.deobf);
            }
        }

        this.root = root;
        this.nodes = nodes;
        this.emitter.fire(undefined);
    }

    /** Merges packages that only contain one other package into it, like the explorer does with folders: "com.example". */
    private compact(container: PackageNode): void {
        for (const [key, child] of [...container.packages]) {
            let merged = child;
            while (merged.classes.length === 0 && merged.packages.size === 1) {
                const only = [...merged.packages.values()][0];
                merged = { ...only, label: `${merged.label}.${only.label}`, parent: child.parent };
            }

            if (merged !== child) {
                container.packages.set(key, merged);
            }

            for (const grandchild of merged.packages.values()) {
                grandchild.parent = merged;
            }

            this.compact(merged);
        }
    }

    private owner(root: PackageNode, deobf: string): PackageNode | undefined {
        const packageName = deobf.includes('/') ? deobf.substring(0, deobf.lastIndexOf('/')) : '';
        if (!packageName) {
            return undefined;
        }

        let current = root;
        for (;;) {
            const next = [...current.packages.values()].find(candidate => packageName === candidate.name || packageName.startsWith(`${candidate.name}/`));
            if (!next) {
                return current === root ? undefined : current;
            }

            if (next.name === packageName) {
                return next;
            }

            current = next;
        }
    }

    get classCount(): number {
        return this.nodes.size;
    }

    nodeOf(obf: string): ClassNode | undefined {
        return this.nodes.get(obf);
    }

    getChildren(element?: ClassTreeNode): ClassTreeNode[] {
        const container = element ?? this.root;
        if (container.type !== 'package') {
            return [];
        }

        const packages = [...container.packages.values()].sort((a, b) => a.name.localeCompare(b.name));
        const classes = [...container.classes]
            .sort((a, b) => simpleName(a.deobf).localeCompare(simpleName(b.deobf), undefined, { numeric: true }))
            .flatMap(item => this.nodes.get(item.obf) ?? []);
        return [...packages, ...classes];
    }

    getParent(element: ClassTreeNode): ClassTreeNode | undefined {
        return element.parent;
    }

    getTreeItem(element: ClassTreeNode): vscode.TreeItem {
        if (element.type === 'package') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
            item.id = `${this.mode}:package:${element.name}`;
            item.iconPath = themeIcon('package');
            item.contextValue = 'enigma.package';
            item.tooltip = element.name.replace(/\//g, '.');
            return item;
        }

        const { obf, deobf, obfuscated, tokenType, kind } = element.item;
        const look = classIcon(element.item);
        const item = new vscode.TreeItem(simpleName(deobf), vscode.TreeItemCollapsibleState.None);
        item.id = `${this.mode}:class:${obf}`;
        item.contextValue = 'enigma.class';
        item.command = { command: 'enigma.openClass', title: t('statsPage.open', simpleName(deobf)), arguments: [obf] };

        const stats = this.stats[obf];
        const details: string[] = [];
        if (!obfuscated && deobf !== obf) {
            details.push(obf);
        }

        if (stats && stats[1] > 0) {
            details.push(`${Math.floor(stats[0] / stats[1] * 100)}%`);
        }

        item.description = details.join('  ');

        // Enigma's icons for classes. They have colours of their own, so how far a class is mapped is not said by
        // tinting them: that is next to its name, like the stat icons of Enigma's class tree (see ClassDecorations).
        item.iconPath = vscode.Uri.joinPath(this.icons, `${look}.svg`);
        item.resourceUri = ClassDecorations.uri(obf);

        const what = { exception: t('classTree.exception'), abstract: t('classTree.abstractClass'), class: t('common.class'), interface: t('common.interface'), annotation: t('common.annotation'), enum: t('common.enum'), record: t('common.record') }[look] ?? kind;
        const state = tokenType === 'obfuscated' ? t('common.notMapped') : tokenType === 'deobfuscated' ? t('common.mapped') : t('common.proposed');
        const tooltip = new vscode.MarkdownString(`**${deobf.replace(/\//g, '.')}**\n\n${t('common.obfuscated')}: \`${obf}\`\n\n${what}, ${state}`);
        if (stats) {
            tooltip.appendMarkdown(`\n\n${t('classTree.mappedOfNames', stats[0], stats[1])}`);
        }

        item.tooltip = tooltip;
        return item;
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.emitter.dispose();
    }
}
