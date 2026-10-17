import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '../l10n';
import { Project } from './project';
import { filePath } from './paths';

const sameFile = (a: string | null | undefined, b: string) => {
    if (!a) {
        return false;
    }

    const real = (file: string) => {
        try {
            return fs.realpathSync(file);
        } catch {
            return path.resolve(file);
        }
    };
    return real(a) === real(b);
};

/**
 * Puts Enigma among the ways the editor offers to open a jar ("Open With..."), and opens the jar in Enigma when it
 * is chosen.
 */
export class JarOpener implements vscode.CustomReadonlyEditorProvider, vscode.Disposable {
    static readonly viewType = 'enigma.jar';

    private readonly registration: vscode.Disposable;

    constructor(private readonly project: Project) {
        this.registration = vscode.window.registerCustomEditorProvider(JarOpener.viewType, this, {
            supportsMultipleEditorsPerDocument: true,
        });
    }

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        // nothing is read: the engine does that
        return { uri, dispose: () => undefined };
    }

    resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
        // once the editor is done bringing the tab up; closed any earlier, it leaves an empty tab behind
        setTimeout(() => {
            panel.dispose();
        }, 0);
        void this.open(document.uri);
    }

    /**
     * Opens a jar in Enigma, or shows its classes if it is the one that is open.
     * @returns whether the jar is open in Enigma afterwards
     */
    async open(uri: vscode.Uri): Promise<boolean> {
        if (uri.scheme !== 'file') {
            void vscode.window.showErrorMessage(t('jarOpener.onlyFilesOnDisk'));
            return false;
        }

        if (!sameFile(this.project.state?.jarPath, filePath(uri.fsPath))) {
            // asks about unsaved changes of the jar that is open, and reports what goes wrong
            await this.project.openJar(filePath(uri.fsPath));
        }

        if (!sameFile(this.project.state?.jarPath, filePath(uri.fsPath))) {
            return false;
        }

        await vscode.commands.executeCommand('enigma.showClasses');
        return true;
    }

    dispose(): void {
        this.registration.dispose();
    }
}
