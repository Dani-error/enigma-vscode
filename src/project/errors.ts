import * as vscode from 'vscode';
import { BackendError, JavaNotFoundError } from '../engine/backend';
import { describeJavaFailure } from '../engine/javaText';
import { t } from '../l10n';

/**
 * Tells the user what went wrong.
 */
export class ErrorReporter implements vscode.Disposable {
    private readonly mappingDiagnostics = vscode.languages.createDiagnosticCollection('enigma-mappings');

    constructor(private readonly output: vscode.LogOutputChannel) {
    }

    /** Shows an error to the user. Mapping parse errors are also reported as problems on the mappings file. */
    report(error: unknown): void {
        if (error instanceof JavaNotFoundError) {
            this.output.error(error.message);
            void vscode.window.showErrorMessage(describeJavaFailure(error.search), t('errors.selectJava'), t('errors.openSettings'), t('common.showLog')).then(choice => {
                if (choice === t('errors.selectJava')) {
                    void vscode.commands.executeCommand('enigma.selectJava');
                } else if (choice === t('errors.openSettings')) {
                    void vscode.commands.executeCommand('workbench.action.openSettings', 'enigma.java.home');
                } else if (choice === t('common.showLog')) {
                    this.output.show();
                }
            });
            return;
        }

        const where = error instanceof BackendError && error.data && 'kind' in error.data ? error.data : undefined;
        if (error instanceof BackendError && where?.file) {
            const file = vscode.Uri.file(where.file);
            const line = Math.max(0, (where.line ?? 1) - 1);
            const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), where.reason ?? error.message, vscode.DiagnosticSeverity.Error);
            diagnostic.source = 'Enigma';
            this.mappingDiagnostics.set(file, [diagnostic]);
            void vscode.window.showErrorMessage(t('errors.enigmaCouldNotReadTheMappings', error.message), t('errors.show')).then(choice => {
                if (choice) {
                    void vscode.window.showTextDocument(file, { selection: diagnostic.range });
                }
            });
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(message.startsWith('Enigma') ? message : `Enigma: ${message}`);
    }

    /** Runs an action, reporting failures instead of throwing. */
    async run<T>(action: () => Promise<T>): Promise<T | undefined> {
        try {
            return await action();
        } catch (error) {
            this.report(error);
            return undefined;
        }
    }

    /** Mappings were read without trouble: what was reported about mappings before no longer holds. */
    clearMappingProblems(): void {
        this.mappingDiagnostics.clear();
    }

    dispose(): void {
        this.mappingDiagnostics.dispose();
    }
}
