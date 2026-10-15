import * as vscode from 'vscode';
import { ClassIndex } from '../documents/classIndex';
import { settings } from '../config';
import { ClassDecorations } from './classDecorations';
import { ClassTreeMode, ClassTreeNode, ClassTreeProvider } from './classTree';

const MODES: ClassTreeMode[] = ['obfuscated', 'deobfuscated', 'all'];

/**
 * The lists of classes in the Enigma side bar: Enigma's class dockers. Which of them are shown is a setting; this
 * knows which one a class is found in.
 */
export class ClassViews implements vscode.Disposable {
    readonly trees: Record<ClassTreeMode, ClassTreeProvider>;
    readonly views: Record<ClassTreeMode, vscode.TreeView<ClassTreeNode>>;
    private readonly selected = new vscode.EventEmitter<string>();
    private readonly disposables: vscode.Disposable[] = [this.selected];

    /** A class was picked in one of the trees. Carries its obfuscated name. */
    readonly onDidSelectClass = this.selected.event;

    /** How far each class is mapped, shown next to its name in every tree. */
    readonly decorations = new ClassDecorations();

    constructor(extensionUri: vscode.Uri, index: ClassIndex, private readonly isOpen: () => boolean) {
        const icons = vscode.Uri.joinPath(extensionUri, 'resources', 'icons');
        const tree = (mode: ClassTreeMode) => new ClassTreeProvider(mode, index, icons);
        this.trees = { obfuscated: tree('obfuscated'), deobfuscated: tree('deobfuscated'), all: tree('all') };
        const view = (mode: ClassTreeMode) => vscode.window.createTreeView(`enigma.classes.${mode}`, { treeDataProvider: this.trees[mode], showCollapseAll: true });
        this.views = { obfuscated: view('obfuscated'), deobfuscated: view('deobfuscated'), all: view('all') };

        this.disposables.push(
            ...Object.values(this.trees), ...Object.values(this.views), this.decorations,
            // after the trees took in the classes
            index.onDidChange(() => this.updateCounts()),
            ...Object.values(this.views).map(candidate => candidate.onDidChangeSelection(event => {
                const node = event.selection[0];
                if (node?.type === 'class') {
                    this.selected.fire(node.item.obf);
                }
            })),
        );
    }

    /** Shows how many classes each tree has next to its title. Called again when a jar is opened or closed. */
    updateCounts(): void {
        for (const mode of MODES) {
            this.views[mode].description = this.isOpen() ? this.trees[mode].classCount.toLocaleString() : undefined;
        }
    }

    /**
     * The command of the editor that brings up the list of classes and gives it the keyboard. Views can be dragged
     * anywhere, so this asks for the view: asking for the side bar of Enigma shows an empty one once they were moved.
     */
    static get focusCommand(): string {
        return `enigma.classes.${settings.oneClassTree ? 'all' : 'obfuscated'}.focus`;
    }

    /** Whether any of the lists can be seen. */
    get visible(): boolean {
        return Object.values(this.views).some(view => view.visible);
    }

    /** Brings up the list of classes, without selecting anything or taking the keyboard. */
    async show(): Promise<void> {
        const mode = settings.oneClassTree ? 'all' : this.trees.obfuscated.classCount > 0 ? 'obfuscated' : 'deobfuscated';
        const first = this.trees[mode].getChildren()[0];
        if (first) {
            await this.views[mode].reveal(first, { select: false, focus: false, expand: false });
        }
    }

    /** Selects a class in the tree it is listed in. */
    async reveal(obf: string): Promise<void> {
        for (const mode of settings.oneClassTree ? ['all'] as const : ['deobfuscated', 'obfuscated'] as const) {
            const node = this.trees[mode].nodeOf(obf);
            if (node) {
                await this.views[mode].reveal(node, { select: true, focus: true, expand: true });
                return;
            }
        }
    }

    /** Mapped and mappable names per class, shown by the trees as progress; none to stop showing it. */
    setProgress(stats: Record<string, [number, number]> | undefined): void {
        Object.values(this.trees).forEach(tree => tree.setStats(stats ?? {}));
        this.decorations.setProgress(stats ?? {});
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
