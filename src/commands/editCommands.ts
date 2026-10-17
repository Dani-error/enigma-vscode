import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { Enigma } from '../enigma';
import { EntryRef } from '../engine/protocol';
import { ClassNode, ClassTreeNode, PackageNode } from '../views/classTree';
import { Register, Targets } from './registry';
import { t } from '../l10n';

/** Asks for a new name, validating it against the engine while the user types. */
const askName = (backend: Backend, entry: EntryRef, title: string, value: string) => {
    const lastSlash = value.lastIndexOf('/');
    return vscode.window.showInputBox({
        title,
        value,
        valueSelection: [lastSlash + 1, value.length],
        prompt: entry.kind === 'class' && !entry.name.includes('$') ? t('editCommands.useToSeparatePackagesForExample') : undefined,
        validateInput: async text => {
            if (text.trim().length === 0) {
                return t('common.theNameCannotBeEmpty');
            }

            try {
                const result = await backend.request('entry/rename', { entry, newName: text.trim(), validateOnly: true });
                const errors = result.messages.filter(message => message.type === 'error');
                if (errors.length > 0) {
                    return { message: errors.map(message => message.text).join(' '), severity: vscode.InputBoxValidationSeverity.Error };
                }

                const warnings = result.messages.filter(message => message.type === 'warning');
                if (warnings.length > 0) {
                    return {
                        message: warnings.map(message => message.text).join(' '),
                        severity: vscode.InputBoxValidationSeverity.Warning,
                    };
                }
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }

            return undefined;
        },
    });
};

/** Changes to the mappings that are not made by typing in the code: from the class trees, from keys, undo. */
export const registerEditCommands = (register: Register, targets: Targets, { backend, project, editing, entryPane }: Enigma) => {
    register('enigma.renameClass', async (node?: ClassNode) => {
        if (node?.type !== 'class') {
            return;
        }

        const entry: EntryRef = { kind: 'class', name: node.item.obf };
        const name = await askName(backend, entry, t('editCommands.rename', node.item.deobf.replace(/\//g, '.')), node.item.deobf);
        if (name !== undefined) {
            await editing.rename(entry, name.trim());
        }
    });

    register('enigma.toggleMapping', async (argument?: unknown) => {
        const target = await targets.entry(argument);
        if (target && !target.renamable) {
            // Enigma's own interface offers no way to do this here; a key still can
            const why = target.inJar ? 'rename.cannotBeRenamedItIsA' : 'rename.isNotPartOfTheJar';
            vscode.window.setStatusBarMessage(`Enigma: ${t(why, target.simpleName)}`, 4000);
        } else if (target) {
            await editing.toggleMapping(target.renameEntry);
        }
    });

    register('enigma.editJavadoc', () => entryPane.focus('javadoc'));
    register('enigma.editName', () => entryPane.focus('name'));

    register('enigma.undo', async () => {
        if (project.state?.canUndo) {
            await editing.undo();
        } else {
            vscode.window.setStatusBarMessage(t('editCommands.enigmaNothingToUndo'), 3000);
        }
    });

    register('enigma.redo', async () => {
        if (project.state?.canRedo) {
            await editing.redo();
        } else {
            vscode.window.setStatusBarMessage(t('editCommands.enigmaNothingToRedo'), 3000);
        }
    });

    const changePackage = async (node: ClassTreeNode | undefined, mode: 'refactor' | 'move') => {
        if (!targets.requireProject()) {
            return;
        }

        const title = mode === 'move' ? t('editCommands.movePackage') : t('editCommands.renamePackage');
        // on a class, its package is meant; classes without a package have none to rename
        const from = (
            node?.type === 'package'
                ? node.name
                : node?.type === 'class'
                  ? node.parent?.name
                  : await vscode.window.showInputBox({
                        title,
                        prompt: t('editCommands.packageToChangeWithBetweenIts'),
                        placeHolder: 'com/example/old',
                    })
        )?.trim();
        if (!from) {
            return;
        }

        const to = await vscode.window.showInputBox({
            title: `${title}: ${from.replace(/\//g, '.')}`,
            value: from,
            prompt: mode === 'move' ? t('editCommands.whereToMoveTheClassesThat') : t('editCommands.newNameOfThePackageClasses'),
            validateInput: text =>
                /^[a-zA-Z0-9_/]+$/.test(text) && !text.startsWith('/') && !text.endsWith('/')
                    ? undefined
                    : t('editCommands.useLettersDigitsAndWithBetween'),
        });
        if (to && to !== from) {
            await editing.renamePackage(from, to, mode);
        }
    };

    register('enigma.renamePackage', (node?: PackageNode | ClassNode) => changePackage(node, 'refactor'));
    register('enigma.movePackage', (node?: PackageNode | ClassNode) => changePackage(node, 'move'));
};
