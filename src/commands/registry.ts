import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { parseClassUri } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { EntryInfo, EntryRef, View } from '../engine/protocol';
import { Project } from '../project/project';
import { ClassTreeNode } from '../views/classTree';
import { t } from '../l10n';

/** Registers a command of the extension. What it throws is shown to the user. */
export type Register = (id: string, handler: (...args: any[]) => unknown) => void;

export const commandRegistry = (context: vscode.ExtensionContext, report: (error: unknown) => void) => {
    return ((id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: any[]) => {
            try {
                return await handler(...args);
            } catch (error) {
                report(error);
                return undefined;
            }
        }));
    }) as Register;
}

const isEntry = (value: unknown): value is EntryRef => {
    return (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        typeof value.kind === 'string' &&
        !('type' in value)
    );
};

/**
 * What a command applies to. Commands are run from the palette, from keys, from the menu of a tree item and by other
 * code, and get something different to work with each time.
 */
export class Targets {
    constructor(private readonly backend: Backend, private readonly documents: EnigmaDocuments, private readonly project: Project) {
    }

    /** Whether a jar is open; says what to do about it if not. */
    requireProject(): boolean {
        if (!this.project.isOpen) {
            void vscode.window.showInformationMessage(t('registry.enigmaOpenAJarFirst'), t('registry.openJar')).then(choice => {
                if (choice) {
                    void vscode.commands.executeCommand('enigma.openJar');
                }
            });
        }

        return this.project.isOpen;
    }

    /** The entry a command applies to: the one it was given, the tree item it was invoked on, or what is under the cursor. */
    async entry(argument?: unknown): Promise<EntryInfo | undefined> {
        if (isEntry(argument)) {
            return this.backend.request('entry/info', { entry: argument });
        }

        const node = argument as ClassTreeNode | undefined;
        if (node?.type === 'class') {
            return this.backend.request('entry/info', { entry: { kind: 'class', name: node.item.obf } });
        }

        const cursor = await this.documents.tokenAtCursor();
        if (!cursor) {
            void vscode.window.showInformationMessage(t('registry.enigmaPlaceTheCursorOnA'));
            return undefined;
        }

        return cursor.token;
    }

    /** The class a command applies to: the tree item it was invoked on, or the one in the active editor. */
    class(node?: ClassTreeNode): { class: string; view: View } | undefined {
        if (node?.type === 'class') {
            return { class: node.item.obf, view: 'source' };
        }

        const active = vscode.window.activeTextEditor;
        return active ? parseClassUri(active.document.uri) : undefined;
    }
}
