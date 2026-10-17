import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { EntryRef } from '../../../../src/engine/protocol';
import {
    Api,
    METHOD_DO_BASE_THINGS,
    METHOD_GET_NAME,
    activate,
    classDocument,
    execute,
    expectTrouble,
    positionOf,
    waitFor,
    withStub,
} from './harness';

describe('Enigma in VS Code: the features of the editor on decompiled classes', () => {
    let api: Api;

    /** Where something is declared: its document, and a position on its name. */
    const declaration = async (entry: EntryRef): Promise<[vscode.TextDocument, vscode.Position]> => {
        const found = await api.backend.request('nav/declaration', { entry });
        assert.ok(found, `${entry.name} is declared in the jar`);
        const location = api.index.location(found);
        const document = await vscode.workspace.openTextDocument(location.uri);
        await waitFor(`the source of ${entry.name}`, () => api.documents.source(document.uri));
        return [document, location.range.start.translate(0, 1)];
    };
    /** The class of a document, by its name in the jar. */
    const classOf = (uri: vscode.Uri) => new URLSearchParams(uri.query).get('class');

    before(async () => {
        api = await activate();
    });

    it('still renames through the rename command, and rejects invalid names', async () => {
        const document = classDocument('d');
        const position = positionOf(document, 'void a()', 'void '.length);
        const prepared = await execute<{ range: vscode.Range; placeholder: string }>('vscode.prepareRename', document.uri, position);
        assert.equal(prepared.placeholder, 'a');

        const edit = await execute<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, position, 'doBaseThings');
        assert.equal(edit.size, 0, 'the rename changes mappings, not text');
        await waitFor('the subclass to show the new name', () => document.getText().includes('void doBaseThings()'));
        await waitFor('the base class to show the new name', () => classDocument('a').getText().includes('void doBaseThings()'));
        assert.equal(document.isDirty, false);

        await assert.rejects(
            execute(
                'vscode.executeDocumentRenameProvider',
                document.uri,
                positionOf(document, 'void doBaseThings()', 'void '.length),
                'class',
            ),
            /reserved/i,
        );
        // names that are not part of the jar cannot be renamed at all; VS Code logs the refusal
        expectTrouble(/is not part of the jar and cannot be renamed/);
        await assert.rejects(execute('vscode.prepareRename', classDocument('a').uri, positionOf(classDocument('a'), 'String')));
    });

    it('navigates with go to definition, find references, hover and outline', async () => {
        const subclass = classDocument('d');
        const base = classDocument('a');
        const position = positionOf(subclass, 'void doBaseThings()', 'void '.length + 2);

        const definitions = await execute<vscode.Location[]>('vscode.executeDefinitionProvider', subclass.uri, position);
        assert.equal(definitions.length, 1);
        assert.equal(definitions[0].uri.toString(), base.uri.toString());
        assert.equal(base.getText(definitions[0].range), 'doBaseThings');

        const references = await execute<vscode.Location[]>('vscode.executeReferenceProvider', subclass.uri, position);
        const referencing = new Set(references.map(location => new URLSearchParams(location.uri.query).get('class')));
        assert.ok(
            referencing.has('a') && referencing.has('d') && referencing.has('e'),
            `references in a, d and e: ${[...referencing].join(', ')}`,
        );

        const hovers = await execute<vscode.Hover[]>('vscode.executeHoverProvider', subclass.uri, position);
        const hoverText = hovers
            .flatMap(hover => hover.contents)
            .map(content => (typeof content === 'string' ? content : content.value))
            .join('\n');
        assert.match(hoverText, /doBaseThings\(\): void/);
        assert.match(hoverText, /Obfuscated: `a` `\(\)V`/);

        const symbols = await execute<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', base.uri);
        assert.equal(symbols.length, 1);
        assert.equal(symbols[0].kind, vscode.SymbolKind.Class);
        assert.ok(symbols[0].children.some(child => child.name === 'doBaseThings' && child.kind === vscode.SymbolKind.Method));

        const workspaceSymbols = await execute<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', 'doBase');
        assert.ok(workspaceSymbols.some(symbol => symbol.name.startsWith('doBaseThings')));
    });

    it('shows what a class extends and what extends it', async () => {
        const [document, position] = await declaration({ kind: 'class', name: 'c' });
        const [item] = await execute<vscode.TypeHierarchyItem[]>('vscode.prepareTypeHierarchy', document.uri, position);
        assert.ok(item, 'there is a hierarchy at the name of the class');
        assert.equal(classOf(item.uri), 'c');

        const supertypes = await execute<vscode.TypeHierarchyItem[]>('vscode.provideSupertypes', item);
        assert.deepEqual(
            supertypes.map(type => classOf(type.uri)),
            ['a'],
            'what it extends, of the jar: Object is not part of it',
        );
        const subtypes = await execute<vscode.TypeHierarchyItem[]>('vscode.provideSubtypes', item);
        assert.deepEqual(
            subtypes.map(type => classOf(type.uri)),
            ['e'],
        );

        // from a member, the hierarchy of its class
        const [, member] = await declaration(METHOD_GET_NAME);
        const [ofMember] = await execute<vscode.TypeHierarchyItem[]>('vscode.prepareTypeHierarchy', classDocument('a').uri, member);
        assert.equal(classOf(ofMember.uri), 'a');
    });

    it('shows who calls a method and what it calls', async () => {
        const overriding: EntryRef = { kind: 'method', owner: 'e', name: 'a', desc: '()Ljava/lang/String;' };
        const [document, position] = await declaration(overriding);
        const [item] = await execute<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', document.uri, position);
        assert.ok(item, 'there is a call hierarchy at the name of the method');

        // e's getName calls super.getName(), and e's doBaseThings calls this.getName()
        const outgoing = await execute<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item);
        const toBase = outgoing.find(call => classOf(call.to.uri) === 'a');
        assert.ok(toBase, `calls the method it overrides: ${outgoing.map(call => `${classOf(call.to.uri)}.${call.to.name}`).join(', ')}`);
        assert.ok(toBase.fromRanges.length > 0, 'with where it is called');
        assert.match(document.getText(toBase.fromRanges[0]), /\w+/);

        const incoming = await execute<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
        assert.ok(
            incoming.some(call => classOf(call.from.uri) === 'e'),
            `called in its own class: ${incoming.map(call => `${classOf(call.from.uri)}.${call.from.name}`).join(', ')}`,
        );

        // not a method: no call hierarchy
        const [classDocumentOfE, className] = await declaration({ kind: 'class', name: 'e' });
        assert.deepEqual(await execute('vscode.prepareCallHierarchy', classDocumentOfE.uri, className), []);
    });

    it('goes to the implementations of a method', async () => {
        const [document, position] = await declaration(METHOD_DO_BASE_THINGS);
        const implementations = await execute<vscode.Location[]>('vscode.executeImplementationProvider', document.uri, position);
        const classes = new Set(implementations.map(location => classOf(location.uri)));
        assert.ok(classes.has('d') && classes.has('e'), `d and e override it: ${[...classes].join(', ')}`);
    });

    it('finds a method by part of its name, and goes to it', async () => {
        // the picker of the editor, as the command shows it
        const create = vscode.window.createQuickPick;
        let picker: vscode.QuickPick<vscode.QuickPickItem> | undefined;
        await withStub(
            vscode.window,
            'createQuickPick',
            () => (picker = create.call(vscode.window)),
            () => execute('enigma.searchMethods'),
        );
        assert.ok(picker, 'the search is shown');
        const shown = picker;
        shown.value = 'doBase';
        const found = await waitFor('results', () => !shown.busy && shown.items.find(item => item.label.includes('doBaseThings')));
        assert.ok(
            shown.items.every(item => item.label.startsWith('$(symbol-method)')),
            'only methods',
        );

        shown.activeItems = [found];
        await waitFor('the result to be the active one', () => shown.activeItems[0] === found);
        // the window may take in the active item after the command that accepts it arrives: then it accepts nothing
        const showing = () => {
            const active = vscode.window.activeTextEditor;
            return active?.document.uri.scheme === 'enigma' && active.document.getText(active.selection) === 'doBaseThings'
                ? active
                : undefined;
        };
        assert.equal(showing(), undefined, 'the method is not shown before it is chosen');
        for (let attempt = 0; attempt < 3 && !showing(); attempt++) {
            await execute('workbench.action.acceptSelectedQuickOpenItem');
            await waitFor('the method in an editor', showing, 3000).catch(() => undefined);
        }

        const editor = await waitFor('the method in an editor', showing);
        assert.ok(['a', 'd', 'e'].includes(classOf(editor.document.uri) ?? ''));
    });

    it('undoes and redoes mapping changes', async () => {
        const subclass = classDocument('d');
        assert.ok(api.project.state?.canUndo);

        await execute('enigma.undo');
        await waitFor('the method rename to be undone', () => subclass.getText().includes('void a()'));
        assert.ok(subclass.getText().includes('extends BaseClass'), 'earlier changes are kept');

        await execute('enigma.redo');
        await waitFor('the method rename to be redone', () => subclass.getText().includes('void doBaseThings()'));
    });
});
