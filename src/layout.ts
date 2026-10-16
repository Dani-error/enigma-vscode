import * as vscode from 'vscode';
import { ClassIndex } from './documents/classIndex';
import { SCHEME } from './documents/classUri';
import { EntryPane } from './panes/entryPane';
import { Project } from './project/project';
import { ClassViews } from './views/classViews';
import { StructureProvider } from './views/structure';
import { settings } from './config';

/**
 * Brings up the panes around the code when a jar is opened.
 *
 * The classes are on the left, the Identifier pane in the panel at the bottom, structure and hierarchies on the
 * right: the arrangement of Enigma's dockers. The side bars and the panel may be closed or show something else,
 * though, and whoever opens a jar would not know what they are missing.
 */
export class Layout implements vscode.Disposable {
    private jarOpen = false;
    /** The classes of the jar that was just opened are still to be shown. */
    private classesPending = false;
    /** The panes around the code were shown for the jar that is open. */
    private panesShown = false;
    private readonly disposables: vscode.Disposable[];

    constructor(
        project: Project,
        private readonly index: ClassIndex,
        private readonly classes: ClassViews,
        private readonly structure: StructureProvider,
        private readonly entryPane: EntryPane,
        private readonly output: vscode.LogOutputChannel,
    ) {
        this.disposables = [
            project.onDidChange(state => {
                const open = !!state?.jarPath;
                if (open && !this.jarOpen) {
                    this.classesPending = true;
                } else if (!open) {
                    // the next jar gets the same welcome
                    this.panesShown = false;
                    this.classesPending = false;
                }

                this.jarOpen = open;
            }),
            // after the trees took in the classes
            index.onDidChange(() => setTimeout(() => void this.showClasses(), 0)),
            vscode.window.onDidChangeActiveTextEditor(active => {
                if (active?.document.uri.scheme === SCHEME) {
                    void this.showPanes();
                }
            }),
        ];
    }

    /**
     * The classes of a jar that was just opened are what one wants to see first, also when it was opened from the
     * command palette, or reopened at startup, while the side bar shows something else.
     */
    private async showClasses(): Promise<void> {
        if (!this.classesPending || this.index.size === 0) {
            return;
        }

        this.classesPending = false;
        if (settings.revealPanes && !this.classes.visible) {
            await this.classes.show().then(undefined, error => this.output.debug(`Could not show the classes: ${error}`));
        }
    }

    /** Shows the Structure and Identifier panes when the first class of a jar is opened, if they are hidden. */
    private async showPanes(): Promise<void> {
        if (this.panesShown || !settings.revealPanes) {
            return;
        }

        this.panesShown = true;
        let focusMoved = false;
        // one pane failing to show is no reason not to show the other
        const attempt = async (pane: string, show: () => Promise<void>) => {
            try {
                await show();
            } catch (error) {
                this.output.debug(`Could not show the ${pane} pane: ${String(error)}`);
            }
        };

        await attempt('Structure', async () => {
            if (this.structure.view.visible) {
                return;
            }

            await this.structure.refresh();
            const first = this.structure.getChildren()[0];
            if (first) {
                await this.structure.view.reveal(first, { select: false, focus: false });
            } else {
                await vscode.commands.executeCommand('enigma.structure.focus');
                focusMoved = true;
            }
        });
        await attempt('Identifier', async () => {
            if (!this.entryPane.visible && !this.entryPane.reveal()) {
                await vscode.commands.executeCommand(`${EntryPane.viewId}.focus`);
                focusMoved = true;
            }
        });

        if (focusMoved) {
            // the keyboard belongs to the class that was just opened
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
