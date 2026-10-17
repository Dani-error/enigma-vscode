import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {
    Api,
    METHOD_GET_NAME,
    activate,
    classDocument,
    entryInfo,
    everywhere,
    execute,
    openClass,
    pause,
    positionOf,
    typeAt,
    typeOver,
    waitFor,
    withStub,
} from './harness';

describe('Enigma in VS Code: the constrained editor', () => {
    let api: Api;

    before(async () => {
        api = await activate();
    });

    it('shows decompiled classes under a language of their own', async () => {
        const editor = await openClass(api, 'd');
        // not "java": Java tooling must not try to analyse decompiled code as a file of a project
        assert.equal(editor.document.languageId, 'enigma-java');
        assert.equal(editor.document.uri.path, '/inheritance_tree.jar!/d.java');
        assert.match(editor.document.getText(), /class d extends a/);

        const source = api.documents.source(editor.document.uri)!;
        assert.ok(source.tokens.obfuscated.length > 0, 'obfuscated names are highlighted');
        assert.equal(source.tokens.deobfuscated.length, 0);
    });

    it('protects everything that is not a name', async () => {
        const editor = await openClass(api, 'd');
        const before = editor.document.getText();

        // typing into a keyword, between words, or into a name of a library is undone at once
        for (const [anchor, offset] of [
            ['public class', 3],
            ['extends', 0],
            ['System.out', 2],
        ] as const) {
            await typeAt(editor, anchor, offset, 'x');
            await waitFor(`the text to be restored after typing in "${anchor}"`, () => editor.document.getText() === before);
        }

        // so are edits that are not typing at all
        const edit = new vscode.WorkspaceEdit();
        edit.insert(editor.document.uri, new vscode.Position(0, 0), '// injected\n');
        await vscode.workspace.applyEdit(edit);
        await waitFor('the injected line to be removed', () => editor.document.getText() === before);

        await waitFor('the document to be unmodified', () => !editor.document.isDirty);
        assert.equal(api.editor.renaming, false);
        assert.equal(api.project.state?.dirty, false, 'nothing was renamed');
    });

    it('reads a class again that changed while it was being saved', async () => {
        // A change that arrives while a document is saved leaves it modified, but the extension host is told that it
        // was saved, and takes it for unmodified. The editor does not read again what it holds as modified: shown or
        // not, the class would keep its old text. Here a refused change is undone and saved, and another arrives
        // meanwhile, at another moment each round.
        let document: vscode.TextDocument | undefined;
        for (let round = 0; round < 10; round++) {
            const editor = await openClass(api, 'd');
            document = editor.document;
            const before = document.getText();
            await editor.edit(builder => builder.insert(new vscode.Position(0, 0), 'x'));
            await pause(round);
            // refused when the first change was undone first, which a test cannot know: made again until it is made
            await waitFor('the second change', () =>
                Promise.resolve(editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// injected\n'))),
            );
            await waitFor('the text to be restored', () => document!.getText() === before && !document!.isDirty);

            // not shown, and changed by a new name of the class it extends
            await openClass(api, 'c');
            const name = `Base${round}`;
            await api.backend.request('entry/rename', { entry: { kind: 'class', name: 'a' }, newName: name, confirmWarnings: true });
            await waitFor(`the subclass to extend ${name}`, () => document!.getText().includes(`extends ${name} `), 15000);
            // a document is saved a few times a second at most
            await pause(400);
        }

        // back to the name the following tests expect
        await api.backend.request('entry/toggleMapping', { entry: { kind: 'class', name: 'a' }, confirmWarnings: true });
        await waitFor('the class to have its name from the jar again', () => document!.getText().includes('extends a '));
    });

    it('renames by typing over a name, with every other use in the file following', async () => {
        const base = (await openClass(api, 'a')).document;
        const editor = await openClass(api, 'e');
        const document = editor.document;
        assert.match(document.getText(), /"subsub" \+ super\.a\(\)/);

        // "String a()" in SubsubclassAA overrides BaseClass.getName. The name is obfuscated: typing replaces it, as
        // in Enigma, rather than adding to "a".
        await typeAt(editor, 'String a()', 'String '.length, 'getName');
        await waitFor('the name to be typed', () => document.getText().includes('String getName()'));
        assert.equal(api.editor.renaming, true);

        // the super call and the call on this are the same method: they change while typing, before anything is applied
        await waitFor(
            'the other uses to follow',
            () => document.getText().includes('super.getName()') && document.getText().includes('this.getName()'),
        );
        assert.equal((await entryInfo(api, METHOD_GET_NAME)).tokenType, 'obfuscated', 'nothing is renamed until the name is applied');
        assert.ok(base.getText().includes('String a()'));

        assert.equal(await execute('enigma.inlineRename.commit'), true);
        assert.deepEqual(await entryInfo(api, METHOD_GET_NAME).then(info => [info.name, info.tokenType]), ['getName', 'deobfuscated']);
        assert.equal(api.editor.renaming, false);

        // the override was typed on; the method it overrides is renamed in the class that declares it
        await waitFor('the base class to show the new name', () => base.getText().includes('String getName()'));
        await waitFor('the edited document to be unmodified', () => !document.isDirty && document.getText().includes('String getName()'));
        assert.equal(api.project.state?.dirty, true, 'the mappings have unsaved changes');

        const source = await waitFor('the highlighting of the new name', () => {
            const current = api.documents.source(document.uri);
            return current && current.text === document.getText() && current.tokens.deobfuscated.length > 0 ? current : undefined;
        });
        assert.equal(source.tokens.deobfuscated.length, 3);
    });

    it('edits a name that was already given like ordinary text, and Escape gives up', async () => {
        const editor = await openClass(api, 'e');
        const document = editor.document;

        // "getName" is not obfuscated any more: typing inside it inserts, it does not replace
        await typeAt(editor, 'String getName()', 'String get'.length, 'Full');
        await waitFor('the insertion', () => everywhere(document, 'getFullName'));
        assert.equal(await execute('enigma.inlineRename.commit'), true);
        assert.equal((await entryInfo(api, METHOD_GET_NAME)).name, 'getFullName');
        await waitFor(
            'the document to settle',
            () => !document.isDirty && !api.editor.renaming && document.getText().includes('super.getFullName()'),
        );

        await typeAt(editor, 'String getFullName()', 'String getFull'.length, 'Wrong');
        await waitFor('the edit', () => document.getText().includes('String getFullWrongName()'));
        await execute('enigma.inlineRename.cancel');
        await waitFor('the name to be restored', () => !document.getText().includes('Wrong') && everywhere(document, 'getFullName'));
        await waitFor('the document to be unmodified', () => !document.isDirty);
        assert.equal(api.editor.renaming, false);
        assert.equal((await entryInfo(api, METHOD_GET_NAME)).name, 'getFullName');
    });

    it('keeps an invalid name in the editor to be fixed, and refuses other edits meanwhile', async () => {
        const editor = await openClass(api, 'e');
        const document = editor.document;
        const original = document.getText();

        await typeOver(editor, 'String getFullName()', 'String '.length, 'getFullName', 'class');
        await waitFor('the name to be typed', () => everywhere(document, 'class'));
        assert.equal(await execute('enigma.inlineRename.commit'), false, 'the name is not accepted');
        assert.equal(api.editor.renaming, true, 'it stays in the editor');
        assert.ok(everywhere(document, 'class'));
        assert.equal((await entryInfo(api, METHOD_GET_NAME)).name, 'getFullName');

        // while a name is pending, nothing else can be changed, not even another name
        const pending = document.getText();
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, positionOf(document, 'public class e', 'public class e'.length), 'Z');
        assert.equal(await vscode.workspace.applyEdit(edit), true);
        await waitFor('the other edit to be undone', () => document.getText() === pending);
        assert.equal(api.editor.renaming, true);

        await execute('enigma.inlineRename.cancel');
        await waitFor('the original text', () => document.getText() === original && !document.isDirty);
        assert.equal(api.editor.renaming, false);
    });

    it('applies the name when the cursor moves away from it', async () => {
        const editor = await openClass(api, 'e');
        const document = editor.document;

        await typeAt(editor, 'String getFullName()', 'String getFullName'.length, '2');
        await waitFor('the edit', () => document.getText().includes('String getFullName2()'));
        const elsewhere = positionOf(document, 'System.out');
        editor.selection = new vscode.Selection(elsewhere, elsewhere);
        await waitFor('the engine to have the name', async () => (await entryInfo(api, METHOD_GET_NAME)).name === 'getFullName2');
        await waitFor('the document to settle', () => !document.isDirty && !api.editor.renaming && everywhere(document, 'getFullName2'));

        // a name that cannot be applied is dropped when moving away, with a message saying so
        let warned = '';
        await withStub(
            vscode.window,
            'showWarningMessage',
            async (message: string) => {
                warned = message;
                return undefined;
            },
            async () => {
                await typeOver(editor, 'String getFullName2()', 'String '.length, 'getFullName2', 'int');
                await waitFor('the name to be typed', () => document.getText().includes('String int()'));
                const away = positionOf(document, 'System.out');
                editor.selection = new vscode.Selection(away, away);
                await waitFor('the name to be restored', () => everywhere(document, 'getFullName2') && !api.editor.renaming);
                await waitFor('the message', () => warned.length > 0);
            },
        );
        assert.match(warned, /did not rename/);
        assert.equal((await entryInfo(api, METHOD_GET_NAME)).name, 'getFullName2');
        await waitFor('the document to be unmodified', () => !document.isDirty);
    });

    it('applies the name when the class is saved, as when closing its tab', async () => {
        const editor = await openClass(api, 'e');
        const document = editor.document;

        await typeAt(editor, 'String getFullName2()', 'String getFullName2'.length, 'x');
        await waitFor('the edit', () => everywhere(document, 'getFullName2x'));
        assert.equal(await document.save(), true);
        await waitFor('the engine to have the name', async () => (await entryInfo(api, METHOD_GET_NAME)).name === 'getFullName2x');
        await waitFor('the document to settle', () => !document.isDirty && !api.editor.renaming && everywhere(document, 'getFullName2x'));

        // back to the name the following tests expect
        await api.backend.request('entry/rename', { entry: METHOD_GET_NAME, newName: 'getFullName2' });
        await waitFor('the name to be shown', () => everywhere(document, 'getFullName2') && !document.isDirty);
    });

    it('typing over a class name renames the class and its tab', async () => {
        const editor = await openClass(api, 'a');
        await typeAt(editor, 'class a', 'class '.length, 'BaseClass');
        await waitFor('the name to be typed', () => editor.document.getText().includes('class BaseClass'));
        assert.equal(await execute('enigma.inlineRename.commit'), true);

        await waitFor('the class list to be updated', () => api.index.get('a')?.deobf === 'BaseClass');
        assert.equal(api.index.get('a')?.obfuscated, false);

        const renamed = await waitFor('the tab to be replaced', () => {
            const active = vscode.window.activeTextEditor;
            return active?.document.uri.path === '/inheritance_tree.jar!/BaseClass.java' ? active : undefined;
        });
        await waitFor(
            'the renamed class to load',
            () => renamed.document.getText().includes('protected BaseClass(') && !renamed.document.isDirty,
        );

        const paths = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .map(tab => (tab.input instanceof vscode.TabInputText ? tab.input.uri.path : ''));
        assert.ok(!paths.includes('/inheritance_tree.jar!/a.java'), `the stale tab is closed: ${paths.join(', ')}`);
        await waitFor('the subclass to reference the new name', () => classDocument('d').getText().includes('extends BaseClass'));
        assert.equal(api.editor.renaming, false);
    });
});
