import * as vscode from 'vscode';
import { toRange } from '../documents/classUri';
import { Enigma } from '../enigma';
import { EntryRef, View } from '../engine/protocol';
import { ClassNode, ClassTreeNode } from '../views/classTree';
import { ClassViews } from '../views/classViews';
import { settings } from '../config';
import { Register, Targets } from './registry';
import { t } from '../l10n';

/** Opening classes, moving around in them, and finding them in the lists. */
export const registerClassCommands = (register: Register, targets: Targets, { backend, documents, editors, editor, classes }: Enigma) => {
    // used by tree items and panes
    register('enigma.openClass', async (target: string | ClassNode, view: View = 'source') => {
        const obf = typeof target === 'string' ? target : target?.item.obf;
        if (obf) {
            await editors.openClass(obf, view);
        }
    });

    register('enigma.navigateTo', async (entry: EntryRef, context?: EntryRef) => {
        if (!(await editors.navigate(entry, context))) {
            vscode.window.setStatusBarMessage(t('classCommands.enigmaThatEntryIsNotPart'), 4000);
        }
    });

    const showAs = (view: View) => async (node?: ClassTreeNode) => {
        const current = targets.class(node);
        if (current) {
            await editors.openClass(current.class, view, { preview: false });
        }
    };
    register('enigma.showBytecode', showAs('bytecode'));
    register('enigma.showSource', showAs('source'));

    register('enigma.reloadClass', async () => {
        const current = targets.class();
        if (current) {
            await backend.request('class/reload', current);
        }
    });

    const jumpToObfuscated = (direction: 1 | -1) => {
        const active = vscode.window.activeTextEditor;
        const source = active && documents.source(active.document.uri);
        if (!active || !source || editor.renaming) {
            return;
        }

        const ranges = source.tokens.obfuscated.map(toRange).sort((a, b) => a.start.compareTo(b.start));
        if (ranges.length === 0) {
            vscode.window.setStatusBarMessage(`$(check) ${t('classCommands.noObfuscatedNamesLeftInThis')}`, 4000);
            return;
        }

        const position = active.selection.active;
        const next =
            direction === 1
                ? (ranges.find(range => range.start.isAfter(position)) ?? ranges[0])
                : ([...ranges].reverse().find(range => range.end.isBefore(position)) ?? ranges[ranges.length - 1]);
        active.selection = new vscode.Selection(next.start, next.start);
        active.revealRange(next, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    };
    register('enigma.nextObfuscated', () => jumpToObfuscated(1));
    register('enigma.previousObfuscated', () => jumpToObfuscated(-1));

    register('enigma.copyObfuscatedName', async (argument?: unknown) => {
        const target = await targets.entry(argument);
        if (target) {
            await vscode.env.clipboard.writeText(target.obfName);
            vscode.window.setStatusBarMessage(t('classCommands.copied', target.obfName), 3000);
        }
    });

    // the setting, from the menu of the views it changes
    register('enigma.classTree.showAll', () => settings.updateWhereSet('classTree.mode', 'all'));
    register('enigma.classTree.showSplit', () => settings.updateWhereSet('classTree.mode', 'split'));

    // by its view rather than by Enigma's side bar: views can be dragged elsewhere, and that side bar is then empty
    register('enigma.showClasses', () => vscode.commands.executeCommand(ClassViews.focusCommand));

    register('enigma.revealInClassTree', async () => {
        const current = targets.class();
        if (current) {
            await classes.reveal(current.class);
        }
    });
};
