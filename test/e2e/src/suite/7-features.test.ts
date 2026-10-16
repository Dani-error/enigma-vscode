import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EntryRef } from '../../../../src/engine/protocol';
import { Api, Offered, activate, entryInfo, execute, fixtures, jar, pause, reported, waitFor, workspace } from './harness';

// The commands around the mappings and the jar that the other suites do not get to: what the menus of the class
// trees and of the editor do, saving in other ways, exporting, and the choices about the engine. On a jar of its own,
// whose classes are named here first.

/** Answers the dialogues of the editor for the duration of an action, and tells what was asked. */
async function answering<T>(
    answers: {
        input?: string[];
        warning?: string;
        information?: string;
        pick?: (items: Offered[]) => Offered | undefined;
        open?: string;
        save?: string;
    },
    action: () => Promise<T>,
): Promise<{ result: T; asked: string[] }> {
    const asked: string[] = [];
    const inputs = [...(answers.input ?? [])];
    const originals = {
        showInputBox: vscode.window.showInputBox,
        showWarningMessage: vscode.window.showWarningMessage,
        showInformationMessage: vscode.window.showInformationMessage,
        showQuickPick: vscode.window.showQuickPick,
        showOpenDialog: vscode.window.showOpenDialog,
        showSaveDialog: vscode.window.showSaveDialog,
    };
    // the API is a plain object of functions, and stand-ins take the place of some of them
    const window = vscode.window as unknown as Record<string, unknown>;
    window.showInputBox = async (options: vscode.InputBoxOptions) => {
        asked.push(`input: ${options.title ?? options.prompt}`);
        return inputs.shift();
    };
    window.showWarningMessage = async (message: string, options?: vscode.MessageOptions) => {
        asked.push(`warning: ${message}${options?.detail ? ` [${options.detail.replace(/\n/g, ', ')}]` : ''}`);
        return answers.warning;
    };
    window.showInformationMessage = async (message: string) => {
        asked.push(`information: ${message}`);
        return answers.information;
    };
    window.showQuickPick = async (items: Offered[], options: vscode.QuickPickOptions) => {
        asked.push(`pick: ${options?.title}`);
        return answers.pick?.(items);
    };
    window.showOpenDialog = async (options: vscode.OpenDialogOptions) => {
        asked.push(`open: ${options.title}`);
        return answers.open ? [vscode.Uri.file(answers.open)] : undefined;
    };
    window.showSaveDialog = async (options: vscode.SaveDialogOptions) => {
        asked.push(`save: ${options.title}`);
        return answers.save ? vscode.Uri.file(answers.save) : undefined;
    };
    try {
        return { result: await action(), asked };
    } finally {
        Object.assign(window, originals);
    }
}

describe('Enigma in VS Code: the commands around mappings, classes and the engine', () => {
    let api: Api;
    const packagesJar = path.join(workspace, 'packages.jar');
    const saved = path.join(workspace, 'packages.mapping');
    const name = (obf: string) => api.index.get(obf)?.deobf;
    const type = (obf: string): EntryRef => ({ kind: 'class', name: obf });
    const rename = (obf: string, to: string) => answering({ warning: 'Proceed' }, () => api.editing.rename(type(obf), to));

    before(async () => {
        api = await activate();
        fs.copyFileSync(path.join(fixtures, 'packages.jar'), packagesJar);
    });

    it('opens another jar, asking about the one that is open', async () => {
        await answering({ warning: "Don't Save" }, () => execute('enigma.openJar', packagesJar));
        await waitFor('the jar to be open', () => api.project.isOpen && api.index.get('g') !== undefined);
        assert.equal(fs.realpathSync(api.project.state!.jarPath), fs.realpathSync(packagesJar));
        assert.equal(api.index.size, 8);
    });

    it('asks for the file when opened from the buttons of a view, which pass something else than a file', async () => {
        // what the editor passes to the commands of a tree view's title
        const fromTheTitle = { $treeViewId: 'enigma.classes.all' };
        const before = reported.length;
        const jar = await answering({}, () => execute('enigma.openJar', fromTheTitle));
        const mappings = await answering({}, () => execute('enigma.openMappings', fromTheTitle));
        assert.deepEqual([jar.asked, mappings.asked], [['open: Open Jar'], ['open: Open Mappings']]);
        assert.deepEqual(reported.slice(before), [], 'no error is shown');
    });

    it('renames a class from the class tree, with the name checked while it is typed', async () => {
        const node = api.classTrees.all.nodeOf('a');
        const { asked } = await answering({ input: ['pkg/one/Alpha'], warning: 'Proceed' }, () => execute('enigma.renameClass', node));
        assert.match(asked[0], /^input: Rename a$/);
        await waitFor('the class to have its name', () => name('a') === 'pkg/one/Alpha');

        // giving up at the question changes nothing
        await answering({ input: [] }, () => execute('enigma.renameClass', api.classTrees.all.nodeOf('b')));
        assert.equal(name('b'), 'b');
    });

    it('renames a package with everything below it, and moves one without', async () => {
        await rename('b', 'pkg/one/sub/Beta');
        await rename('c', 'pkg/two/Gamma');
        await waitFor('the classes to be named', () => name('c') === 'pkg/two/Gamma');

        const renamed = await answering({ input: ['pkg/one', 'lib/core'], warning: 'Rename' }, () => execute('enigma.renamePackage'));
        // what will be renamed is listed before anything is
        const question = renamed.asked.find(asked => asked.startsWith('warning: Rename package pkg/one to lib/core?'));
        assert.ok(
            question?.includes('pkg/one/Alpha → lib/core/Alpha') && question.includes('pkg/one/sub/Beta → lib/core/sub/Beta'),
            renamed.asked.join('\n'),
        );
        await waitFor('the package to be renamed', () => name('a') === 'lib/core/Alpha' && name('b') === 'lib/core/sub/Beta');
        // Enigma renames the parts of a package one by one, which takes the packages next to it along where a part
        // they share changes: here "pkg". That is how its own interface behaves (see PackageRenamePlanner).
        assert.equal(name('c'), 'lib/core/two/Gamma');

        // moving takes the classes of the package itself; what is below it stays where it is
        await answering({ input: ['lib/core', 'lib/moved'], warning: 'Rename' }, () => execute('enigma.movePackage'));
        await waitFor('the package to be moved', () => name('a') === 'lib/moved/Alpha');
        assert.equal(name('b'), 'lib/core/sub/Beta');

        // declined, nothing happens
        await answering({ input: ['lib/moved', 'lib/elsewhere'], warning: undefined }, () => execute('enigma.movePackage'));
        await pause(300);
        assert.equal(name('a'), 'lib/moved/Alpha');
    });

    it('marks a class as deobfuscated and resets it', async () => {
        assert.equal(api.index.get('d')!.obfuscated, true);
        await execute('enigma.toggleMapping', type('d'));
        await waitFor('the class to count as named', () => !api.index.get('d')!.obfuscated);
        assert.equal(name('d'), 'd', 'under the name it has');
        await execute('enigma.toggleMapping', type('d'));
        await waitFor('the class to be obfuscated again', () => api.index.get('d')!.obfuscated);
    });

    it('copies the name something has in the jar', async () => {
        await execute('enigma.copyObfuscatedName', type('a'));
        assert.equal(await vscode.env.clipboard.readText(), 'a');
    });

    it('saves the mappings in a chosen format, and from then on by itself if asked to', async () => {
        const { result, asked } = await answering(
            {
                pick: items =>
                    items.find(item => item.format?.id === 'enigma:enigma_file') ??
                    items.find(item => item.format && !item.format.directory),
                save: saved,
            },
            () => execute('enigma.saveMappingsAs'),
        );
        assert.notEqual(result, false);
        assert.deepEqual(
            asked.map(question => question.split(':')[0]),
            ['pick', 'save'],
        );
        assert.match(fs.readFileSync(saved, 'utf8'), /lib\/moved\/Alpha/);
        assert.equal(api.project.state!.dirty, false);
        assert.equal(fs.realpathSync(api.project.state!.mappingsPath!), fs.realpathSync(saved));

        const configuration = vscode.workspace.getConfiguration('enigma');
        await configuration.update('autoSaveMappings', true, vscode.ConfigurationTarget.Global);
        try {
            await pause(300);
            await rename('e', 'pkg/two/Epsilon');
            await waitFor('the change to be in the file', () => /pkg\/two\/Epsilon/.test(fs.readFileSync(saved, 'utf8')));
            assert.equal(api.project.state!.dirty, false);
        } finally {
            await configuration.update('autoSaveMappings', undefined, vscode.ConfigurationTarget.Global);
            await pause(300);
        }
    });

    it('reloads the mappings and the jar from disk, giving up what was not saved when told to', async () => {
        await rename('f', 'pkg/two/Unsaved');
        await waitFor('the change', () => name('f') === 'pkg/two/Unsaved' && api.project.state!.dirty);

        // asked about the changes; cancelling keeps them
        const kept = await answering({ warning: undefined }, () => execute('enigma.reloadMappings'));
        assert.equal(kept.asked.length, 1);
        assert.match(kept.asked[0], /^warning: Your mappings have unsaved changes\./);
        assert.equal(name('f'), 'pkg/two/Unsaved');

        await answering({ warning: "Don't Save" }, () => execute('enigma.reloadMappings'));
        await waitFor('the mappings as they were saved', () => name('f') === 'f' && !api.project.state!.dirty);
        assert.equal(name('e'), 'pkg/two/Epsilon');

        await rename('f', 'pkg/two/UnsavedAgain');
        await waitFor('the change', () => name('f') === 'pkg/two/UnsavedAgain');
        await answering({ warning: "Don't Save" }, () => execute('enigma.reloadAll'));
        await waitFor(
            'the jar and the mappings as they were saved',
            () => api.project.isOpen && name('f') === 'f' && name('a') === 'lib/moved/Alpha',
        );
    });

    it('drops mappings that do not match the jar', async () => {
        // a class the jar does not have, as left behind by a newer version of it
        fs.appendFileSync(saved, 'CLASS zz/gone Vanished\n');
        await execute('enigma.reloadMappings');
        await waitFor('the mappings to be loaded again', () => name('a') === 'lib/moved/Alpha');

        const { asked } = await answering({}, () => execute('enigma.dropMappings'));
        assert.ok(
            asked.some(question => /^information: Enigma dropped \d+ mapping\(s\)/.test(question)),
            asked.join('\n'),
        );
        assert.equal(name('a'), 'lib/moved/Alpha', 'what matches stays');

        await execute('enigma.saveMappings');
        assert.doesNotMatch(fs.readFileSync(saved, 'utf8'), /Vanished/);
        const again = await answering({}, () => execute('enigma.dropMappings'));
        assert.deepEqual(again.asked, ['information: Enigma: all mappings match the jar; nothing was dropped.']);
    });

    it('exports the decompiled source and a jar with the names given', async () => {
        const sources = path.join(workspace, 'exported-source');
        fs.mkdirSync(sources, { recursive: true });
        const source = await answering({ open: sources }, () => execute('enigma.exportSource'));
        assert.ok(
            source.asked.some(question => question.startsWith('information: Enigma exported the decompiled source')),
            source.asked.join('\n'),
        );
        assert.match(fs.readFileSync(path.join(sources, 'lib', 'moved', 'Alpha.java'), 'utf8'), /class Alpha/);
        assert.ok(fs.existsSync(path.join(sources, 'lib', 'core', 'two', 'Gamma.java')));

        const target = path.join(workspace, 'exported.jar');
        const exported = await answering({ save: target }, () => execute('enigma.exportJar'));
        assert.ok(
            exported.asked.some(question => question.startsWith('information: Enigma exported the remapped jar')),
            exported.asked.join('\n'),
        );
        // the names of its entries are stored as they are
        const bytes = fs.readFileSync(target).toString('latin1');
        assert.ok(bytes.includes('lib/moved/Alpha.class') && bytes.includes('lib/core/two/Gamma.class'));

        // nothing is exported without saying where
        const before = fs.statSync(target).mtimeMs;
        await answering({}, () => execute('enigma.exportJar'));
        assert.equal(fs.statSync(target).mtimeMs, before);
    });

    it('switches the decompiler, and decompiles a class again on request', async () => {
        await execute('enigma.openClass', 'a');
        const shown = () => vscode.window.activeTextEditor?.document.getText() ?? '';
        await waitFor('the class', () => /Vineflower/.test(shown()) && /class Alpha/.test(shown()));

        const offered: string[] = [];
        await answering(
            { pick: items => (offered.push(...items.map(item => item.id ?? '')), items.find(item => /cfr/i.test(item.id ?? ''))) },
            () => execute('enigma.selectDecompiler'),
        );
        assert.ok(offered.length >= 3, `decompilers offered: ${offered.join(', ')}`);
        await waitFor(
            'the class decompiled by the other one',
            () => /cfr/i.test(api.project.state!.decompiler) && !/Vineflower/.test(shown()) && /class Alpha/.test(shown()),
        );
        assert.match(String(vscode.workspace.getConfiguration('enigma').get('decompiler')), /cfr/i);

        await answering({ pick: items => items.find(item => /vineflower/i.test(item.id ?? '')) }, () => execute('enigma.selectDecompiler'));
        await waitFor('the class decompiled as before', () => /Vineflower/.test(shown()));

        let loaded = 0;
        const listener = api.documents.onDidLoadSource(() => loaded++);
        try {
            await execute('enigma.reloadClass');
            await waitFor('the class to be decompiled again', () => loaded > 0);
        } finally {
            listener.dispose();
        }
    });

    it('goes from one obfuscated name to the next', async () => {
        await execute('enigma.openClass', 'org/quiltmc/enigma/input/Keep');
        const editor = await waitFor('the class', () => {
            const active = vscode.window.activeTextEditor;
            return active?.document.uri.path.endsWith('/Keep.java') &&
                (api.documents.source(active.document.uri)?.tokens.obfuscated.length ?? 0) > 0
                ? active
                : undefined;
        });
        const obfuscated = api.documents.source(editor.document.uri)!.tokens.obfuscated.map(([line, character]) => `${line}:${character}`);
        const top = new vscode.Position(0, 0);
        editor.selection = new vscode.Selection(top, top);
        const visited: string[] = [];
        for (let step = 0; step < obfuscated.length; step++) {
            await execute('enigma.nextObfuscated');
            visited.push(`${editor.selection.active.line}:${editor.selection.active.character}`);
        }

        assert.deepEqual([...visited].sort(), [...obfuscated].sort(), 'every obfuscated name is reached, each once');
        await execute('enigma.nextObfuscated');
        assert.equal(`${editor.selection.active.line}:${editor.selection.active.character}`, visited[0], 'and then the first one again');
        await execute('enigma.previousObfuscated');
        assert.equal(`${editor.selection.active.line}:${editor.selection.active.character}`, visited[visited.length - 1]);
    });

    it('opens a recent project again, with the mappings it was used with', async () => {
        let offered: Offered[] = [];
        await answering(
            { pick: items => ((offered = items), items.find(item => item.label === 'inheritance_tree.jar')), warning: "Don't Save" },
            () => execute('enigma.openRecent'),
        );
        assert.deepEqual(
            offered.slice(0, 2).map(item => item.label),
            ['packages.jar', 'inheritance_tree.jar'],
            'most recent first',
        );
        assert.equal(offered[0].description, '→ packages.mapping');
        await waitFor(
            'the other jar',
            () =>
                api.project.isOpen &&
                fs.realpathSync(api.project.state!.jarPath) === fs.realpathSync(jar) &&
                api.index.get('a')?.deobf === 'BaseClass',
        );

        await answering({ pick: items => items.find(item => item.label === 'packages.jar'), warning: "Don't Save" }, () =>
            execute('enigma.openRecent'),
        );
        await waitFor(
            'the jar of these tests, with its names',
            () => api.project.isOpen && name('a') === 'lib/moved/Alpha' && name('e') === 'pkg/two/Epsilon',
        );
        assert.equal((await entryInfo(api, type('a'))).name, 'lib/moved/Alpha');

        await answering({ warning: "Don't Save" }, () => execute('enigma.closeJar'));
        await waitFor('the jar to be closed', () => !api.project.isOpen);
    });
});
