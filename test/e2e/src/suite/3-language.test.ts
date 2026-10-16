import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Api, activate, classDocument, execute, expectTrouble, positionOf, waitFor } from './harness';

describe('Enigma in VS Code: the features of the editor on decompiled classes', () => {
    let api: Api;

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
