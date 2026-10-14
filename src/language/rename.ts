import * as vscode from 'vscode';
import { toRange } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { TokenInfo } from '../engine/protocol';
import { Editing } from '../project/editing';
import { t } from '../l10n';

export class RenameProvider implements vscode.RenameProvider {
    constructor(private readonly documents: EnigmaDocuments, private readonly editing: Editing) {
    }

    async prepareRename(document: vscode.TextDocument, position: vscode.Position): Promise<{ range: vscode.Range; placeholder: string }> {
        const token = await this.documents.tokenAt(document, position);
        if (!token) {
            throw new Error(t('rename.thereIsNothingHereThatCan'));
        }

        if (!token.renamable) {
            throw new Error(this.whyNotRenamable(token));
        }

        return { range: toRange(token.range), placeholder: token.renameName };
    }

    private whyNotRenamable(token: TokenInfo): string {
        if (!token.inJar && token.entry.kind !== 'local') {
            return t('rename.isNotPartOfTheJar', token.simpleName || token.text);
        }

        if (token.entry.kind === 'local' && !token.entry.parameter) {
            return t('common.enigmaCannotRenameLocalVariablesOnly');
        }

        return t('rename.cannotBeRenamedItIsA', token.simpleName || token.text);
    }

    async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): Promise<vscode.WorkspaceEdit> {
        const token = await this.documents.tokenAt(document, position);
        if (!token?.renamable) {
            throw new Error(t('rename.thereIsNothingHereThatCan'));
        }

        // The name is changed in the mappings, not in this text: the engine validates the name, propagates it to every
        // related entry, and then re-maps the open classes. Errors are shown by the editor's rename widget.
        await this.editing.rename(token.renameEntry, newName.trim());
        return new vscode.WorkspaceEdit();
    }
}
