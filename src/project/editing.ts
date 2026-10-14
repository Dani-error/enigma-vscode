import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { EditResult, EntryRef, PackageMode, ValidationMessage } from '../engine/protocol';
import { t } from '../l10n';

const describe = (messages: ValidationMessage[]) => {
    return messages.map(message => message.details ? `${message.text} ${message.details}` : message.text).join('\n');
}

/**
 * Changes to mappings requested by the user.
 */
export class Editing {
    constructor(private readonly backend: Backend) {
    }

    /**
     * Sends an edit to the engine, asking the user to confirm warnings.
     * @param send sends it, saying whether warnings are confirmed
     * @returns whether the edit was applied; false if the user cancelled
     * @throws if the engine rejected the edit
     */
    private async apply(send: (confirmWarnings: boolean) => Promise<EditResult>): Promise<boolean> {
        let result = await send(false);
        if (!result.applied && result.needsConfirmation) {
            const warnings = result.messages.filter(message => message.type === 'warning');
            const choice = await vscode.window.showWarningMessage(describe(warnings), { modal: true, detail: t('editing.doYouWantToProceedAnyway') }, t('editing.proceed'));
            if (choice !== t('editing.proceed')) {
                return false;
            }

            result = await send(true);
        }

        if (!result.applied) {
            const errors = result.messages.filter(message => message.type === 'error');
            throw new Error(describe(errors.length > 0 ? errors : result.messages) || t('editing.theChangeWasRejected'));
        }

        return true;
    }

    rename(entry: EntryRef, newName: string): Promise<boolean> {
        return this.apply(confirmWarnings => this.backend.request('entry/rename', { entry, newName, confirmWarnings }));
    }

    setJavadoc(entry: EntryRef, javadoc: string): Promise<boolean> {
        return this.apply(confirmWarnings => this.backend.request('entry/setJavadoc', { entry, javadoc, confirmWarnings }));
    }

    toggleMapping(entry: EntryRef): Promise<boolean> {
        return this.apply(confirmWarnings => this.backend.request('entry/toggleMapping', { entry, confirmWarnings }));
    }

    async undo(): Promise<void> {
        const result = await this.backend.request('edit/undo');
        this.reportHistory(result, false);
    }

    async redo(): Promise<void> {
        const result = await this.backend.request('edit/redo');
        this.reportHistory(result, true);
    }

    private reportHistory(result: EditResult, redo: boolean): void {
        if (result.applied) {
            vscode.window.setStatusBarMessage(redo ? t('editing.enigmaRedid', result.label) : t('editing.enigmaUndid', result.label), 4000);
        } else {
            const reason = describe(result.messages) || t('editing.theMappingsChangedInTheMeantime');
            void vscode.window.showWarningMessage(redo ? t('editing.enigmaCouldNotRedo', result.label, reason) : t('editing.enigmaCouldNotUndo', result.label, reason));
        }
    }

    /**
     * Renames or moves a package after showing which classes are affected.
     * @returns whether anything was renamed
     */
    async renamePackage(from: string, to: string, mode: PackageMode): Promise<boolean> {
        const preview = await this.backend.request('package/rename', { from, to, mode });
        if (preview.renames.length === 0) {
            void vscode.window.showInformationMessage(t('editing.enigmaNoClassesWouldBeRenamed', from, to));
            return false;
        }

        const sample = preview.renames.slice(0, 15).map(rename => `${rename.from} → ${rename.to}`).join('\n');
        const more = preview.renames.length > 15 ? `\n${t('editing.andMore', preview.renames.length - 15)}` : '';
        const choice = await vscode.window.showWarningMessage(
            mode === 'move' ? t('editing.movePackageToClassEsWill', from, to, preview.renames.length) : t('editing.renamePackageToClassEsWill', from, to, preview.renames.length),
            { modal: true, detail: sample + more },
            t('common.rename'),
        );
        if (choice !== t('common.rename')) {
            return false;
        }

        const result = await this.backend.request('package/rename', { from, to, mode, apply: true });
        const errors = result.messages.filter(message => message.type === 'error');
        if (errors.length > 0) {
            void vscode.window.showWarningMessage(t('editing.enigmaRenamedOfClasses', result.appliedCount ?? 0, result.renames.length, describe(errors)));
        }

        return result.applied;
    }
}
